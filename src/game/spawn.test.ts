import { describe, expect, it } from 'vitest'
import { budgetForWave, clusterSizeForWave, modeForWave } from './constants'
import { mulberry32 } from './rng'
import {
  freshSpawn,
  mixForWave,
  nextCluster,
  spawnCost,
  spawnExhausted,
  wellLimit,
} from './spawn'
import type { EnemyKind, WaveMode } from './types'

const rng = mulberry32(2024)

/** Every kind a mix can produce, given enough rolls. */
function kindsFrom(mode: WaveMode, wave: number, liveWells = 0, rolls = 4000): Set<EnemyKind> {
  const spawn = freshSpawn(wave)
  spawn.budget = 1e6
  const seen = new Set<EnemyKind>()
  for (let i = 0; i < rolls; i++) {
    spawn.timer = 0
    for (const kind of nextCluster(spawn, wave, mode, liveWells, rng, 1)) seen.add(kind)
  }
  return seen
}

describe('modeForWave', () => {
  it('opens on two plain swarm waves', () => {
    expect(modeForWave(1)).toBe('swarm')
    expect(modeForWave(2)).toBe('swarm')
  })

  it('gives a wave that is both to the singularity', () => {
    // 15 is divisible by 3 and by 5. The order of the checks decides it, and the singularity is the
    // more interesting wave, so it wins.
    expect(modeForWave(15)).toBe('singularity')
    expect(modeForWave(3)).toBe('belt')
    expect(modeForWave(5)).toBe('singularity')
    expect(modeForWave(4)).toBe('swarm')
  })
})

describe('mixForWave', () => {
  it('keeps weavers and snakes out of the first waves', () => {
    const kinds = kindsFrom('swarm', 1)
    expect(kinds.has('drifter')).toBe(true)
    expect(kinds.has('wanderer')).toBe(true)
    expect(kinds.has('weaver')).toBe(false)
    expect(kinds.has('snake')).toBe(false)
    expect(kinds.has('well')).toBe(false)
  })

  it('lets them in later', () => {
    const kinds = kindsFrom('swarm', 8)
    expect(kinds.has('weaver')).toBe(true)
    expect(kinds.has('snake')).toBe(true)
  })

  it('teaches the swarm before the sniper', () => {
    // Order matters more than the exact waves: a swarm teaches you to keep moving, and a sniper punishes you
    // for standing still. Meeting the punishment first is how a player concludes the game is unfair.
    const early = kindsFrom('swarm', 3)
    expect(early.has('swarmer')).toBe(true)
    expect(early.has('sniper')).toBe(false)
    expect(kindsFrom('swarm', 7).has('sniper')).toBe(true)
  })

  it('keeps both new kinds out of the opening wave', () => {
    const opening = kindsFrom('swarm', 1)
    expect(opening.has('swarmer')).toBe(false)
    expect(opening.has('sniper')).toBe(false)
  })

  it('never sends a well outside a singularity wave', () => {
    expect(kindsFrom('swarm', 30).has('well')).toBe(false)
    expect(kindsFrom('belt', 30).has('well')).toBe(false)
    expect(kindsFrom('singularity', 5).has('well')).toBe(true)
  })

  it('makes a belt wave mostly rocks', () => {
    const mix = mixForWave(9, 'belt', 0)
    const rock = mix.find((entry) => entry.item === 'rock')
    const total = mix.reduce((sum, entry) => sum + entry.weight, 0)
    expect((rock?.weight ?? 0) / total).toBeGreaterThan(0.4)
  })

  it('gates wells by the live count rather than by weight', () => {
    // A weight cannot express "no more than three", and three wells with a fourth queued behind them is
    // the difference between hard and unplayable.
    const limit = wellLimit(20)
    expect(mixForWave(20, 'singularity', limit - 1).find((e) => e.item === 'well')?.weight).toBeGreaterThan(0)
    expect(mixForWave(20, 'singularity', limit).find((e) => e.item === 'well')?.weight).toBe(0)
  })

  it('caps the wells at three however deep the run gets', () => {
    expect(wellLimit(1)).toBe(1)
    expect(wellLimit(1000)).toBe(3)
  })
})

describe('nextCluster', () => {
  it('sends nothing until the timer runs out', () => {
    const spawn = freshSpawn(1)
    expect(nextCluster(spawn, 1, 'swarm', 0, rng, 0.1)).toHaveLength(0)
    expect(spawn.timer).toBeLessThan(0.9)
  })

  it('sends a cluster when it does', () => {
    const spawn = freshSpawn(1)
    const kinds = nextCluster(spawn, 1, 'swarm', 0, rng, 5)
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.length).toBeLessThanOrEqual(clusterSizeForWave(1))
  })

  it('spends the budget and then stops', () => {
    const spawn = freshSpawn(4)
    let sent = 0
    for (let i = 0; i < 200 && !spawnExhausted(spawn); i++) {
      sent += nextCluster(spawn, 4, 'swarm', 0, rng, 5).length
    }
    expect(spawnExhausted(spawn)).toBe(true)
    expect(sent).toBeGreaterThan(0)
    expect(nextCluster(spawn, 4, 'swarm', 0, rng, 5)).toHaveLength(0)
  })

  it('cannot spend a whole cluster on wells', () => {
    // The count is re-derived per pick inside the cluster, so a cluster of six cannot produce six wells
    // just because the count it started from was zero.
    const spawn = freshSpawn(30)
    spawn.budget = 1e6
    spawn.timer = 0
    const kinds = nextCluster(spawn, 30, 'singularity', 0, rng, 1)
    const wells = kinds.filter((kind) => kind === 'well').length
    expect(wells).toBeLessThanOrEqual(wellLimit(30))
  })

  it('grows the budget with the wave and then flattens', () => {
    expect(budgetForWave(1)).toBeLessThan(budgetForWave(5))
    expect(budgetForWave(5)).toBeLessThan(budgetForWave(15))
    // Past a point the arena is full and more budget only makes the wave longer, which is not the same
    // as harder.
    expect(budgetForWave(60) - budgetForWave(30)).toBeLessThan(3)
  })
})

describe('spawnCost', () => {
  it('charges most for a well and least for a drifter', () => {
    expect(spawnCost('well')).toBeGreaterThan(spawnCost('snake'))
    expect(spawnCost('snake')).toBeGreaterThan(spawnCost('drifter'))
    expect(spawnCost('drifter')).toBe(1)
  })
})
