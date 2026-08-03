import { describe, expect, it } from 'vitest'
import {
  ARENA_ASPECT,
  arenaToUv,
  bounceInArena,
  clampToArena,
  distanceToWall,
  insideArena,
  spawnPoint,
} from './arena'
import { ARENA, WALL_BOUNCE } from './constants'
import { mulberry32 } from './rng'
import { distance, vec } from './vec'

describe('clampToArena', () => {
  it('reports which axes clamped, so the caller can zero the right velocity', () => {
    const pos = vec(ARENA.halfWidth + 5, 0)
    expect(clampToArena(pos, 1)).toEqual({ x: true, y: false })
    expect(pos.x).toBe(ARENA.halfWidth - 1)
  })

  it('leaves something inside the walls alone', () => {
    const pos = vec(3, -4)
    expect(clampToArena(pos, 1)).toEqual({ x: false, y: false })
    expect(pos).toEqual({ x: 3, y: -4 })
  })

  it('accounts for the radius, so nothing is ever half in a wall', () => {
    const pos = vec(0, ARENA.halfHeight)
    clampToArena(pos, 4.2)
    expect(pos.y).toBe(ARENA.halfHeight - 4.2)
    expect(insideArena(pos, 4.2)).toBe(true)
  })
})

describe('bounceInArena', () => {
  it('flips the velocity and loses a little speed', () => {
    const pos = vec(ARENA.halfWidth, 0)
    const vel = vec(10, 3)
    expect(bounceInArena(pos, vel, 1)).toBe(true)
    expect(vel.x).toBeCloseTo(-10 * WALL_BOUNCE)
    expect(vel.y).toBe(3)
  })

  it('does not trap a body that arrives deep inside the wall', () => {
    // The failure this guards against: flipping the velocity without moving the body leaves it
    // overlapping, so the next frame flips it back and it vibrates in the wall forever.
    const pos = vec(ARENA.halfWidth + 30, 0)
    const vel = vec(50, 0)
    bounceInArena(pos, vel, 2)
    expect(insideArena(pos, 2)).toBe(true)
    expect(vel.x).toBeLessThan(0)

    // Second frame: now inside and heading away, so nothing should happen at all.
    const before = { ...pos }
    expect(bounceInArena(pos, vel, 2)).toBe(false)
    expect(pos).toEqual(before)
  })
})

describe('spawnPoint', () => {
  const rng = mulberry32(7)

  it('keeps its distance from the ship when that is possible', () => {
    const ship = vec(-40, -20)
    for (let i = 0; i < 500; i++) {
      const at = spawnPoint(rng, ship, 30, 6)
      expect(distance(at, ship)).toBeGreaterThanOrEqual(30)
    }
  })

  it('stays inside the margin', () => {
    for (let i = 0; i < 500; i++) {
      const at = spawnPoint(rng, vec(0, 0), 20, 6)
      expect(distanceToWall(at)).toBeGreaterThanOrEqual(6 - 1e-9)
    }
  })

  it('returns the furthest candidate rather than hanging when the constraint cannot be met', () => {
    // A ship in the middle of the arena is within 200 units of everywhere, so no candidate can ever
    // satisfy this. The contract is that it gives up and returns its best effort.
    const at = spawnPoint(rng, vec(0, 0), 200, 6)
    expect(Number.isFinite(at.x)).toBe(true)
    expect(distanceToWall(at)).toBeGreaterThanOrEqual(6 - 1e-9)
  })
})

describe('arenaToUv', () => {
  it('maps the arena onto the unit square', () => {
    expect(arenaToUv(0, 0)).toEqual({ u: 0.5, v: 0.5 })
    expect(arenaToUv(-ARENA.halfWidth, -ARENA.halfHeight)).toEqual({ u: 0, v: 0 })
    expect(arenaToUv(ARENA.halfWidth, ARENA.halfHeight)).toEqual({ u: 1, v: 1 })
  })

  it('agrees with the aspect the fluid grid is built at', () => {
    // If these disagree the fluid's cells are not square, and every splat is an oval.
    expect(ARENA_ASPECT).toBeCloseTo(ARENA.halfWidth / ARENA.halfHeight)
  })
})
