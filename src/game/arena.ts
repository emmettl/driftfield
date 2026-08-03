import { ARENA, WALL_BOUNCE } from './constants'
import { type Rng, range } from './rng'
import type { Vec2 } from './vec'
import { distanceSq } from './vec'

// The rectangle everything happens in, and the three things anything can do with a wall:
// stop at it, bounce off it, or be placed away from it.

/** Whether a point with a radius is fully inside the arena. */
export function insideArena(pos: Vec2, radius = 0): boolean {
  return (
    Math.abs(pos.x) <= ARENA.halfWidth - radius && Math.abs(pos.y) <= ARENA.halfHeight - radius
  )
}

/**
 * Hold something inside the walls, and report which walls it is against.
 *
 * The ship's behaviour. Returns the axes that clamped rather than a boolean, because the
 * wall spark and the fluid splat want to know *where* — and because the ship's velocity
 * has to be zeroed on the axis it is pressed against, or holding into a corner builds up
 * speed that fires you across the arena the moment you let go.
 */
export function clampToArena(pos: Vec2, radius: number): { x: boolean; y: boolean } {
  const limitX = ARENA.halfWidth - radius
  const limitY = ARENA.halfHeight - radius
  const hit = { x: false, y: false }

  if (pos.x < -limitX) {
    pos.x = -limitX
    hit.x = true
  } else if (pos.x > limitX) {
    pos.x = limitX
    hit.x = true
  }
  if (pos.y < -limitY) {
    pos.y = -limitY
    hit.y = true
  } else if (pos.y > limitY) {
    pos.y = limitY
    hit.y = true
  }
  return hit
}

/**
 * Bounce something off the walls, losing a little speed.
 *
 * The position is clamped *before* the velocity is flipped, so a body that arrives deep
 * inside the wall on a long frame leaves on the next one. Flipping the velocity alone
 * would leave it stuck: still overlapping, now heading out, clamped back in, flipped
 * again — a wanderer vibrating in the wall for the rest of the wave.
 */
export function bounceInArena(pos: Vec2, vel: Vec2, radius: number): boolean {
  const hit = clampToArena(pos, radius)
  if (hit.x) vel.x = -vel.x * WALL_BOUNCE
  if (hit.y) vel.y = -vel.y * WALL_BOUNCE
  return hit.x || hit.y
}

/** Distance to the nearest wall, ignoring which one. Used to keep spawns off the edge,
 *  where an enemy is half out of frame and unreadable. */
export function distanceToWall(pos: Vec2): number {
  return Math.min(ARENA.halfWidth - Math.abs(pos.x), ARENA.halfHeight - Math.abs(pos.y))
}

/**
 * Somewhere to put a new enemy: inside the walls, off the edge, and not on top of the ship.
 *
 * Rejection sampling, with a bounded number of attempts and a considered fallback. In a
 * bounded arena the constraint can genuinely be unsatisfiable — a ship parked in the middle
 * of a small arena is within `minDistance` of everywhere — and looping until it is not
 * would hang the frame. So after `attempts` tries this returns the best candidate it saw:
 * the furthest from the ship. Combined with the materialising window (see `SPAWN_GRACE`)
 * that is fair, which is the property that actually matters.
 */
export function spawnPoint(
  rng: Rng,
  away: Vec2,
  minDistance: number,
  margin: number,
  attempts = 12,
): Vec2 {
  const limitX = ARENA.halfWidth - margin
  const limitY = ARENA.halfHeight - margin
  const minSq = minDistance * minDistance

  let best: Vec2 = { x: 0, y: 0 }
  let bestSq = -1

  for (let i = 0; i < attempts; i++) {
    const candidate = { x: range(rng, -limitX, limitX), y: range(rng, -limitY, limitY) }
    const sq = distanceSq(candidate, away)
    if (sq >= minSq) return candidate
    if (sq > bestSq) {
      bestSq = sq
      best = candidate
    }
  }
  return best
}

/**
 * Arena coordinates to the fluid simulation's texture space.
 *
 * The fluid, the particles and the warping grid all sample the same two textures, so they
 * all need the same mapping, and it is a one-liner that is wrong in a way nobody notices
 * until the smoke sits slightly to the left of the explosion. Kept here, with the arena it
 * describes, and asserted in the tests.
 */
export function arenaToUv(x: number, y: number): { u: number; v: number } {
  return {
    u: (x + ARENA.halfWidth) / (2 * ARENA.halfWidth),
    v: (y + ARENA.halfHeight) / (2 * ARENA.halfHeight),
  }
}

/** Arena aspect ratio, which the fluid grid matches so that its cells are square. A
 *  non-square cell makes a circular splat elliptical and every vortex lopsided. */
export const ARENA_ASPECT = ARENA.halfWidth / ARENA.halfHeight
