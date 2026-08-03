import { GEOM } from '../game/constants'

// How much the ship bends the floor around it.
//
// The grid already warps for two things: the fluid, which is what explosions push, and the gravity wells, which
// funnel it inward. This is the third, and it is the only one that is about the player rather than about
// something happening to them — a standing dome the ship carries with it, so the arena visibly acknowledges
// that you are in it.
//
// Two decisions make it work rather than just being more warping:
//
// **It pushes outward, where a well pulls inward.** That is not decoration, it is the whole reason the effect
// is safe to add: the player must never mistake their own presence for a gravity well, because one is harmless
// and the other is the most dangerous thing in the game. Opposite signs make them opposite shapes — a dome
// against a funnel — which reads instantly and at any size.
//
// **It grows with the multiplier.** The game has no powerup pickups, so the multiplier is what "powered up"
// means here: it is the number that climbs as you play well and collapses when you die. Tying the warp to it
// means a good run is visible in the floor before you look at the score, and losing it is felt as the arena
// going flat. A real powerup system, if there ever is one, adds to `steps` rather than needing its own path.

/** World units of displacement at ×1, before anything has been earned. Small — presence, not power. */
const BASE = 0.9

/** Added per multiplier step, and the cap. The cap matters more than the rate: past about three units the dome
 *  starts to swallow the cells immediately around the ship, and the grid is the player's sense of distance. */
const PER_STEP = 0.05
const MAX_STRENGTH = 3.2

/** How far the dome reaches, in world units, and how far that grows to. Kept well inside a gravity well's 34
 *  so that the two are different sizes as well as different shapes. */
const BASE_REACH = 13
const MAX_REACH = 22

export interface ShipWarp {
  /** Outward displacement at the centre, in world units. Zero when there is no ship to warp anything. */
  strength: number
  /** Radius the displacement falls off over, in world units. */
  reach: number
}

/**
 * The dome for a given multiplier.
 *
 * A pure function of the two things it depends on, so the progression can be checked rather than eyeballed
 * across a twenty-minute run — "a good player's warp is bigger than a new player's, and neither can grow
 * enough to hide the floor" is exactly the sort of claim that quietly stops being true when a constant moves.
 */
export function shipWarp(multiplier: number, present: boolean): ShipWarp {
  if (!present) return { strength: 0, reach: BASE_REACH }

  // Clamped at both ends: a multiplier below 1 is nonsense, and the cap is what the whole effect's safety
  // rests on.
  const steps = Math.max(0, Math.min(GEOM.maxMultiplier, multiplier) - 1)
  return {
    strength: Math.min(MAX_STRENGTH, BASE + steps * PER_STEP),
    reach: Math.min(MAX_REACH, BASE_REACH + steps * 0.22),
  }
}
