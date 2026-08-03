import { describe, expect, it } from 'vitest'
import { WELL } from './constants'
import { makeWell } from './enemies'
import { mulberry32 } from './rng'
import { vec } from './vec'
import { applyWellGravity, wellAcceleration, wellStress, wellsIn } from './wells'

const rng = mulberry32(17)

describe('wellAcceleration', () => {
  it('falls off with distance', () => {
    expect(wellAcceleration(10)).toBeGreaterThan(wellAcceleration(20))
  })

  it('is bounded at the centre', () => {
    // The softening is not an approximation for speed. True inverse-square has no upper bound, so anything
    // that passes close takes an arbitrarily large impulse in one frame — a bullet leaves at thousands of
    // units a second and tunnels through every wall and collision check on the way out.
    const atCentre = wellAcceleration(0)
    expect(Number.isFinite(atCentre)).toBe(true)
    expect(atCentre).toBe(wellAcceleration(1e-9))
    // Whatever it is, one frame of it must not exceed a sane speed for anything in the arena.
    expect(atCentre * (1 / 60) * 1.7).toBeLessThan(600)
  })

  it('is strongest at the softening floor and flat inside it', () => {
    const floor = WELL.reach * 0.12
    expect(wellAcceleration(floor * 0.5)).toBeCloseTo(wellAcceleration(floor))
  })
})

describe('applyWellGravity', () => {
  it('pulls towards the well', () => {
    const well = makeWell(1, 10, 0, rng)
    const vel = vec(0, 0)
    applyWellGravity([well], vec(0, 0), vel, 1 / 60)
    expect(vel.x).toBeGreaterThan(0)
    expect(vel.y).toBeCloseTo(0)
  })

  it('ignores anything beyond its reach, so the arena is not summing every pair', () => {
    const well = makeWell(1, WELL.reach + 10, 0, rng)
    const vel = vec(0, 0)
    expect(applyWellGravity([well], vec(0, 0), vel, 1 / 60)).toBe(0)
    expect(vel).toEqual({ x: 0, y: 0 })
  })

  it('affects light things more', () => {
    // A well between you and your target should be a shot you have to aim around.
    const well = makeWell(1, 15, 0, rng)
    const bullet = vec(0, 0)
    const enemy = vec(0, 0)
    applyWellGravity([well], vec(0, 0), bullet, 1 / 60, 1.7)
    applyWellGravity([well], vec(0, 0), enemy, 1 / 60, 0.6)
    expect(bullet.x).toBeGreaterThan(enemy.x)
  })

  it('sums several wells', () => {
    const left = makeWell(1, -12, 0, rng)
    const right = makeWell(2, 12, 0, rng)
    const vel = vec(0, 0)
    // Symmetric, so they cancel — which is also the reason wells do not pull each other.
    applyWellGravity([left, right], vec(0, 0), vel, 1 / 60)
    expect(vel.x).toBeCloseTo(0)

    const off = vec(0, 0)
    applyWellGravity([left, right], vec(6, 0), off, 1 / 60)
    expect(off.x).toBeGreaterThan(0)
  })

  it('skips dead wells', () => {
    const well = makeWell(1, 10, 0, rng)
    well.alive = false
    const vel = vec(0, 0)
    applyWellGravity([well], vec(0, 0), vel, 1 / 60)
    expect(vel).toEqual({ x: 0, y: 0 })
  })

  it('does not produce NaN for something sitting exactly on a well', () => {
    const well = makeWell(1, 0, 0, rng)
    const vel = vec(0, 0)
    applyWellGravity([well], vec(0, 0), vel, 1 / 60)
    expect(Number.isFinite(vel.x)).toBe(true)
    expect(Number.isFinite(vel.y)).toBe(true)
  })
})

describe('wellsIn', () => {
  it('finds live wells and nothing else', () => {
    const well = makeWell(1, 0, 0, rng)
    const dead = makeWell(2, 5, 0, rng)
    dead.alive = false
    const other = { ...well, id: 3, kind: 'drifter' as const }
    expect(wellsIn([well, dead, other])).toEqual([well])
  })

  it('includes a well that is still materialising', () => {
    // A well whose arrival you cannot feel is a well you find out about by being inside it. Pulling from
    // the first frame is the fair version.
    const well = makeWell(1, 0, 0, rng)
    well.age = 0
    expect(wellsIn([well])).toHaveLength(1)
  })
})

describe('wellStress', () => {
  it('runs from nothing to one', () => {
    const well = makeWell(1, 0, 0, rng)
    expect(wellStress(well)).toBe(0)
    well.charge = well.hp
    expect(wellStress(well)).toBe(1)
  })

  it('cannot exceed one, however much fire goes in on one frame', () => {
    const well = makeWell(1, 0, 0, rng)
    well.charge = well.hp * 4
    expect(wellStress(well)).toBe(1)
  })
})
