import {
  budgetForWave,
  clusterIntervalForWave,
  clusterSizeForWave,
  modeForWave,
} from './constants'
import { type Rng, weighted } from './rng'
import type { EnemyKind, SpawnState, WaveMode } from './types'

// The spawn director: what arrives, when, and how much of it.
//
// Everything here is a pure function of the wave number, the mode and a seeded random
// source, which is what makes the difficulty curve something you can look at instead of
// something you have to survive to measure. `nextCluster` is the only part that mutates,
// and all it mutates is the two counters it is handed.

/** How many spawn orders each kind costs against a wave's budget. */
export function spawnCost(kind: EnemyKind): number {
  switch (kind) {
    // One order, seven bodies. Cheap in orders because the chain dies as a unit — killing
    // the head is one act, so charging seven would make snake waves trivially short.
    case 'snake':
      return 2
    // A well is most of a wave on its own, and keeps producing drifters for as long as it
    // survives. Charging it four means a singularity wave is two or three wells and the
    // drifters they make, rather than two wells hidden inside forty other things.
    case 'well':
      return 4
    case 'rock':
      return 2
    // One order, eight bodies — the same bargain as a snake. Charging eight would make a swarm wave three
    // enemies long.
    case 'swarmer':
      return 3
    // Expensive, because a sniper does not die quickly and keeps working from across the arena for as long as
    // it is alive. Two on the field at once is a genuine crossfire; four would be a firing squad.
    case 'sniper':
      return 3
    default:
      return 1
  }
}

/**
 * Most wells allowed on the field at once.
 *
 * Hard-capped, and the cap is low. Wells stack multiplicatively rather than additively —
 * two of them either side of the ship do not double the pull, they make the arena
 * unnavigable — and their gravity reaches 34 units in a 120-unit-wide arena, so three is
 * already most of it.
 */
export function wellLimit(wave: number): number {
  return Math.min(3, 1 + Math.floor(wave / 10))
}

/**
 * The spawn mix for a wave, as weights.
 *
 * Written as weights rather than as branching probabilities so that the mix is a *value*:
 * it can be printed, diffed between waves, and asserted on. The gates ("no weavers before
 * wave 3") are zero weights rather than omitted entries, so every table has the same shape
 * and a kind is never accidentally unreachable because its branch was never written.
 */
export function mixForWave(
  wave: number,
  mode: WaveMode,
  liveWells: number,
): { item: EnemyKind; weight: number }[] {
  // Wells are gated by the live count rather than by weight, because a weight cannot
  // express "no more than three" — and three wells with a fourth queued behind them is the
  // difference between hard and unplayable.
  const wellsAllowed = mode === 'singularity' && liveWells < wellLimit(wave)

  switch (mode) {
    case 'belt':
      return [
        { item: 'rock', weight: 6 },
        { item: 'wanderer', weight: 2 },
        { item: 'drifter', weight: 2 },
        // A weaver in a rock field is the interesting case: something that dodges, in a
        // space where your shots are already being blocked.
        { item: 'weaver', weight: wave >= 6 ? 1.5 : 0 },
        // A sniper behind cover it did not choose. The rocks block your line to it as much as its line to
        // you, which makes a belt wave the best place in the game for one.
        { item: 'sniper', weight: wave >= 7 ? 1.5 : 0 },
        { item: 'swarmer', weight: wave >= 8 ? 1 : 0 },
        { item: 'snake', weight: 0 },
        { item: 'well', weight: 0 },
      ]
    case 'singularity':
      return [
        { item: 'well', weight: wellsAllowed ? 5 : 0 },
        { item: 'drifter', weight: 3 },
        { item: 'weaver', weight: 2 },
        { item: 'wanderer', weight: 1 },
        { item: 'rock', weight: 1 },
        { item: 'snake', weight: wave >= 10 ? 1 : 0 },
        // Both of the new kinds are at their nastiest here, and for opposite reasons: a swarm arriving while
        // you are being pulled sideways is very hard to sweep, and a sniper's shot curves in the well's
        // gravity — the only projectile in the game whose path you have to read rather than predict.
        { item: 'swarmer', weight: 1.5 },
        { item: 'sniper', weight: wave >= 10 ? 1 : 0 },
      ]
    case 'swarm':
      return [
        // The staple, and it stays the staple. Every other kind is an answer to a specific
        // question; drifters are the pressure everything else is layered on top of.
        { item: 'drifter', weight: 6 },
        { item: 'wanderer', weight: 2.5 },
        { item: 'weaver', weight: wave >= 3 ? 2 : 0 },
        { item: 'snake', weight: wave >= 4 ? 1.5 : 0 },
        { item: 'rock', weight: wave >= 6 ? 1 : 0 },
        // Introduced one at a time, and in this order on purpose: a swarm teaches you to move before a sniper
        // starts punishing you for standing still.
        { item: 'swarmer', weight: wave >= 3 ? 2 : 0 },
        { item: 'sniper', weight: wave >= 6 ? 1.5 : 0 },
        { item: 'well', weight: 0 },
      ]
  }
}

/** A wave's opening state. The first cluster is delayed by a beat so the wave banner is
 *  readable before anything is shooting at you. */
export function freshSpawn(wave: number): SpawnState {
  return { budget: budgetForWave(wave), timer: 0.9 }
}

/**
 * Advance the director, and return the kinds to spawn this frame.
 *
 * Usually an empty list. Clusters rather than a steady drip: a wave that trickles is a wave
 * with no shape, and the moments between clusters are where the geoms get collected and the
 * next thirty seconds get decided.
 *
 * Returning the kinds rather than the enemies keeps this file free of construction and
 * placement — `step.ts` decides where they go, using `arena.ts` — so the director can be
 * tested by asking what it would send without a world existing at all.
 */
export function nextCluster(
  spawn: SpawnState,
  wave: number,
  mode: WaveMode,
  liveWells: number,
  rng: Rng,
  dt: number,
): EnemyKind[] {
  if (spawn.budget <= 0) return []

  spawn.timer -= dt
  if (spawn.timer > 0) return []
  spawn.timer = clusterIntervalForWave(wave)

  const mix = mixForWave(wave, mode, liveWells)
  const size = clusterSizeForWave(wave)
  const kinds: EnemyKind[] = []
  let wells = liveWells

  for (let i = 0; i < size && spawn.budget > 0; i++) {
    // Re-derived per pick, so a cluster cannot spend the whole well allowance in one go
    // just because the count it started from was stale.
    const kind = weighted(rng, mixForWave(wave, mode, wells))
    if (kind === 'well') wells++
    kinds.push(kind)
    spawn.budget -= spawnCost(kind)
  }
  // Guard against a table whose only positive weights are gated off, which would otherwise
  // hand back an empty cluster forever and hang the wave: `mix` is unused above except as
  // documentation of that risk, so make the check explicit.
  if (kinds.length === 0 && mix.some((entry) => entry.weight > 0)) {
    spawn.budget = 0
  }
  return kinds
}

/** Whether a wave has sent everything it owes. The wave is over when this is true *and*
 *  the arena is clear — which is the caller's business, since it can see the arena. */
export function spawnExhausted(spawn: SpawnState): boolean {
  return spawn.budget <= 0
}

/** The mode a wave runs in. Re-exported so callers have one import for spawning rather
 *  than reaching into the constants for the half of it that lives there. */
export { modeForWave }
