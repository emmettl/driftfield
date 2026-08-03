import { arenaToUv } from '../game/arena'
import { ARENA } from '../game/constants'
import type { Blast } from '../game/types'
import type { Splat } from '../gpu/fluid'

// Turning a thing that happened into a thing you can see.
//
// The simulation emits `Blast`es in world units: a position, a radius, a strength around 1, and a hue.
// The fluid wants uv coordinates, a Gaussian sigma in units of the arena's height, and a velocity in
// uv per second. This is the conversion, and it is a pure function on purpose — the constants below
// are the entire relationship between "a rock broke" and what the screen does about it, and they are
// much easier to tune, and to test, when they are not scattered through a `useFrame`.

/** The corrected splat space is measured in arena *heights* — see the aspect note in the splat
 *  shader — so everything world-sized divides by this. */
const HEIGHT_SPAN = ARENA.halfHeight * 2

/**
 * How much of a blast's radius becomes the Gaussian's sigma.
 *
 * Under one, because a Gaussian has no edge: it is still perceptibly bright at two sigma, so a sigma
 * equal to the radius produces a mark twice the size of the thing that made it. 0.55 puts the visible
 * edge of the splat at roughly the radius the simulation asked for.
 */
const SIGMA = 0.55

/**
 * World units per second of outward push, per unit of blast strength.
 *
 * Tuned against the velocity dissipation in `fluid.ts`: at this scale a kill's shove peaks at about a
 * seventh of a domain per second — twelve world units — and is visibly gone in two seconds, while a
 * bomb's takes nearer five. Higher than about 25 and the field's peak velocity exceeds anything the
 * grid can be displaced by without tearing, which is a look nobody wants twice.
 */
const PUSH = 18

/** Dye brightness per unit of strength. The dye field is unbounded and tone-mapped on the way out
 *  (see `DYE_DISPLAY_FRAGMENT`), so this can be well over 1 without clipping — it buys headroom for
 *  the tone map to work with rather than blowing out. */
const DYE = 1.15

/**
 * Particles a blast claims from the pool.
 *
 * Proportional to area rather than to radius, because that is what looks right: a bomb is not four
 * times the event a kill is, it is the whole arena, and a linear count makes it look like a slightly
 * bigger kill. Capped, because past a few thousand the burst is limited by how much of the pool
 * exists rather than by anything visible.
 */
export function particlesForBlast(blast: Blast): number {
  const area = blast.radius * blast.radius * blast.strength
  // 34, not the 14 this started at. A kill now claims around 750 particles rather than 90, which is the
  // difference between seeing sparks and seeing dust — and it costs nothing, because the pool is a fixed
  // 65,536 either way and a burst only overwrites part of it.
  return Math.min(12_000, Math.round(area * 34))
}

/**
 * The push, the mark, and where they go.
 *
 * The hue arrives as a turn (0..1) and is converted here rather than in the simulation, because the
 * simulation has no business knowing about colour spaces — it knows that a wanderer is green in the
 * sense that green is its identity, and this is the only place that becomes three floats.
 */
export function splatForBlast(blast: Blast): Splat {
  const { u, v } = arenaToUv(blast.x, blast.y)
  const [r, g, b] = hueToRgb(blast.hue)
  const brightness = DYE * blast.strength

  return {
    u,
    v,
    radius: (blast.radius * SIGMA) / HEIGHT_SPAN,
    // No direction: a detonation is radial. The directional channel is for wakes — see the ship's
    // trail in `GameLoop`.
    vx: 0,
    vy: 0,
    radial: (blast.strength * PUSH) / HEIGHT_SPAN,
    r: r * brightness,
    g: g * brightness,
    b: b * brightness,
  }
}

/**
 * Fully saturated hue to RGB.
 *
 * Written out rather than going through `THREE.Color`: this is called for every blast on every frame
 * of a bad wave, and `setHSL` allocates nothing but does route through three's colour management,
 * which would convert these values into the renderer's working space. The dye field is not a colour
 * anybody is managing — it is a set of numbers that gets tone-mapped later — so the conversion would
 * be both wasted and wrong.
 */
export function hueToRgb(hue: number): [number, number, number] {
  // Wrapped into 0..1 first, so a hue of -0.2 or 1.3 is still a colour rather than black.
  const h = (((hue % 1) + 1) % 1) * 6
  const x = 1 - Math.abs((h % 2) - 1)
  if (h < 1) return [1, x, 0]
  if (h < 2) return [x, 1, 0]
  if (h < 3) return [0, 1, x]
  if (h < 4) return [0, x, 1]
  if (h < 5) return [x, 0, 1]
  return [1, 0, x]
}

/**
 * How much of the ship's own velocity goes into the field, per second of flying.
 *
 * **Per second**, and that distinction is the whole comment. A splat *accumulates* into the field: a
 * detonation is one event and its magnitude is simply how hard it pushed, but the wake is splatted on
 * every frame the ship is moving, so an un-scaled magnitude is a source term that integrates without
 * bound. The first version of this passed the ship's velocity straight in at 0.17 of a domain per frame
 * against a dissipation of 0.22 per *second* — so ten seconds of flying built a field two orders of
 * magnitude stronger than a bomb, the grid was displaced by more than the arena is wide, and the whole
 * screen tore into white ribbons. Scaling by dt is not a refinement; it is the difference between a
 * source and a runaway.
 */
const WAKE = 0.55

/** Dye the wake leaves, per second. Cold, and faint enough to be invisible under anything else. */
const WAKE_DYE = 0.9

/**
 * The ship's wake.
 *
 * A directional splat rather than a radial one, and far weaker than any detonation — the point is that
 * the smoke over the arena remembers where you have been, not that flying is an explosion. The velocity
 * is the ship's own, so the trail curls behind a turn instead of pointing at wherever the nose is.
 *
 * @param dt the frame's delta. See `WAKE`: this is a continuous source and must be integrated, not
 * applied.
 */
export function splatForWake(x: number, y: number, vx: number, vy: number, dt: number): Splat {
  const { u, v } = arenaToUv(x, y)
  const rate = WAKE * dt
  const dye = WAKE_DYE * dt
  return {
    u,
    v,
    radius: (1.8 * SIGMA) / HEIGHT_SPAN,
    // The ship's velocity is in world units per second, and the field's is in uv per second. Note the
    // asymmetric divisors: uv is not square, so the two axes genuinely do scale differently.
    vx: (vx * rate) / (ARENA.halfWidth * 2),
    vy: (vy * rate) / HEIGHT_SPAN,
    radial: 0,
    r: 0.06 * dye,
    g: 0.16 * dye,
    b: 0.3 * dye,
  }
}
