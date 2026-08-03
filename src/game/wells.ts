import { WELL } from './constants'
import type { Enemy } from './types'
import type { Vec2 } from './vec'

// Gravity, as the one force in the game that acts at a distance.
//
// Wells pull everything: the ship, enemies, bullets, geoms — and, through the same
// velocity field the fluid runs on, the grid the arena is drawn on. That last one is why
// this is worth having at all. A black hole that only ate the player would be an obstacle;
// one that visibly bends the floor, drags the smoke into a spiral and curves your own
// bullets past it is a *place*.

/**
 * Softened inverse-square: the acceleration towards a well at `distance`.
 *
 * The softening — a floor on the distance, rather than the true 1/r² — is not an
 * approximation for speed. True inverse-square has no upper bound, so anything that passes
 * close takes an arbitrarily large impulse in one frame: bullets leave at thousands of
 * units a second, tunnel through every wall and collision check on the way out, and the
 * arena quietly loses them. Softening caps the impulse at the value it reaches at the
 * well's own radius, which is strong enough to be frightening and finite.
 */
export function wellAcceleration(distance: number): number {
  const soft = Math.max(distance, WELL.reach * 0.12)
  return WELL.gravity / (soft * soft)
}

/**
 * Add every well's pull to one velocity.
 *
 * `susceptibility` is how much this particular thing is affected — 1 for the ship and for
 * enemies, more for bullets and geoms, which are light. It is a multiplier rather than a
 * mass because nothing here has a mass, and inventing one would mean inventing units.
 *
 * Returns the total acceleration applied, which the caller uses to decide whether it is
 * worth telling anybody: the ship being tugged is worth a shake, being 34 units away and
 * feeling nothing is not.
 */
export function applyWellGravity(
  wells: readonly Enemy[],
  pos: Vec2,
  vel: Vec2,
  dt: number,
  susceptibility = 1,
): number {
  let total = 0

  for (const well of wells) {
    if (!well.alive) continue
    const dx = well.pos.x - pos.x
    const dy = well.pos.y - pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > WELL.reach || distance < 1e-4) continue

    const accel = wellAcceleration(distance) * susceptibility
    vel.x += (dx / distance) * accel * dt
    vel.y += (dy / distance) * accel * dt
    total += accel
  }
  return total
}

/**
 * The wells in a list of enemies.
 *
 * Materialising wells are included deliberately, even though they cannot be shot or
 * touched yet. A well that appears and only starts pulling half a second later is a well
 * whose arrival you cannot feel; one that pulls from the first frame announces itself,
 * which for something this dangerous is the fair version.
 */
export function wellsIn(enemies: readonly Enemy[]): Enemy[] {
  const wells: Enemy[] = []
  for (const enemy of enemies) if (enemy.kind === 'well' && enemy.alive) wells.push(enemy)
  return wells
}

/** How far through its lifespan a well is, 0..1, for the visual to pulse harder as it
 *  nears collapse. The simulation does not care; the renderer and the audio do. */
export function wellStress(well: Enemy): number {
  return Math.min(1, well.charge / Math.max(1, well.hp))
}
