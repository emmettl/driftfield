import { ARENA } from '../game/constants'
import type { Splat } from '../gpu/fluid'
import { arenaToUv } from '../game/arena'

// The wash that crosses the attract screen every few seconds.
//
// A band of dye and velocity swept across the arena, passing behind the title. It exists because the attract
// screen is the one place with nothing happening: no kills, no wake, so the fluid sits still and the whole reason
// the game looks the way it does is invisible until somebody presses start. A wash is the arena demonstrating
// itself — the smoke curls, the grid bends under it, the particles get dragged along, all from one sweep.
//
// It is a *sweep of splats* rather than one big one, and that is the whole trick. A single splat is a blob; a
// column of them advancing across the domain is a moving front, which is what leaves a wake behind it and drags
// the dust with it. The fluid does the rest — the front breaks up on its own within a second, because that is
// what a real velocity field does to a straight edge.

/** Seconds between washes. Long enough that it is an event rather than a background animation. */
const INTERVAL = 6.5

/** Seconds a wash takes to cross. Slower than it sounds: the point is to watch the fluid react, and a fast
 *  sweep is over before the vortices it started have curled. */
const DURATION = 1.9

/** Splats per frame down the column. More than a couple and the front is a wall rather than a wave; fewer and it
 *  is a dotted line, because each splat is a Gaussian with gaps between them. */
const COLUMN = 3

/** The band of the arena it crosses, in world units, as a fraction of the half-height. Centred a little above
 *  the middle, which is where the title sits. */
const BAND = { from: -0.18, to: 0.55 }

/**
 * How hard the front pushes and how brightly it marks, both **per second**.
 *
 * Per second, and integrated with `dt` below — the same distinction as `WAKE` in `blasts.ts`, and it went wrong
 * here in exactly the same way. A splat accumulates into the field, and this emits a column on *every frame* the
 * front is crossing, so an unscaled magnitude is a source term integrating without bound: a point the front
 * passed over collected four frames' worth of push, which came to a velocity comparable to a bomb's, warped the
 * grid across the whole arena and left the title screen sitting in a fog bank.
 *
 * Scaled, the numbers are a rate rather than an amount, and a wash deposits the same total however fast the
 * machine is drawing.
 */
const PUSH = 2
const DYE = 4.5

export interface WashState {
  /** Seconds until the next wash begins. */
  countdown: number
  /** How far through the current wash, 0..1, or null between them. */
  progress: number | null
}

export function freshWash(): WashState {
  // Starts part-way through the first interval, so the attract screen does not open on a blank arena and then
  // wait the full six seconds before doing anything.
  return { countdown: 1.2, progress: null }
}

/**
 * Advance the wash, and return the splats to inject this frame.
 *
 * Returns an empty array between washes, which is most frames. The splat *positions* are computed here rather
 * than in the caller so that the timing and the geometry stay in one testable place — "the front crosses the
 * whole arena exactly once per wash" is the sort of thing that is obvious in a test and very hard to see by eye.
 */
export function stepWash(state: WashState, dt: number): Splat[] {
  if (dt <= 0) return []

  if (state.progress === null) {
    state.countdown -= dt
    if (state.countdown > 0) return []
    state.progress = 0
  }

  state.progress += dt / DURATION
  if (state.progress >= 1) {
    state.progress = null
    state.countdown = INTERVAL
    return []
  }

  // Eased at both ends, so the front arrives from off-screen and leaves the same way rather than appearing at the
  // wall and stopping dead at the far one.
  const eased = state.progress * state.progress * (3 - 2 * state.progress)
  // From just outside one wall to just outside the other.
  const x = -ARENA.halfWidth * 1.15 + eased * ARENA.halfWidth * 2.3
  // Brightest in the middle of the crossing, so it fades in and out instead of switching on.
  const strength = Math.sin(state.progress * Math.PI)

  // Integrated: see the note on PUSH. Everything below is a rate multiplied by the frame's own delta.
  const push = PUSH * strength * dt
  const dye = DYE * strength * dt

  const splats: Splat[] = []
  for (let i = 0; i < COLUMN; i++) {
    // Spread evenly down the band. `COLUMN` is a literal so the divisor cannot be zero here, but the expression
    // is written to survive somebody setting it to 1.
    const t = COLUMN > 1 ? i / (COLUMN - 1) : 0.5
    const y = ARENA.halfHeight * (BAND.from + (BAND.to - BAND.from) * t)
    const { u, v } = arenaToUv(x, y)
    splats.push({
      u,
      v,
      // Wide and soft. A tight splat would read as three dots crossing the screen rather than as one front.
      radius: 0.075,
      // Pushing along the sweep, which is what gives it a wake — a purely radial wash would just bloom outward
      // and go nowhere.
      vx: push,
      // A little upward drift, so the front tilts as it goes and the fluid has some shear to work with. Perfectly
      // horizontal flow produces perfectly boring smoke.
      vy: push * 0.12,
      radial: 0,
      // Cold and blue-white: the arena's own colour, so it reads as the floor lighting up rather than as
      // something hostile arriving on the title screen.
      r: dye * 0.28,
      g: dye * 0.62,
      b: dye,
    })
  }
  return splats
}
