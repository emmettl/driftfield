import { describe, expect, it } from 'vitest'
import { GEOM } from '../game/constants'
import { shipWarp } from './warp'

describe('shipWarp', () => {
  it('is nothing at all when there is no ship', () => {
    expect(shipWarp(40, false).strength).toBe(0)
  })

  it('bends the floor a little even at the start of a run', () => {
    // Presence, not power: the arena should acknowledge the ship from the first frame.
    const opening = shipWarp(1, true)
    expect(opening.strength).toBeGreaterThan(0)
    expect(opening.strength).toBeLessThan(1.5)
  })

  it('grows with the multiplier, in both strength and reach', () => {
    const early = shipWarp(1, true)
    const good = shipWarp(30, true)
    expect(good.strength).toBeGreaterThan(early.strength * 2)
    expect(good.reach).toBeGreaterThan(early.reach)
  })

  it('is monotonic', () => {
    let previous = -1
    for (let multiplier = 1; multiplier <= GEOM.maxMultiplier; multiplier++) {
      const { strength } = shipWarp(multiplier, true)
      expect(strength).toBeGreaterThanOrEqual(previous)
      previous = strength
    }
  })

  it('caps, so the dome can never swallow the cells around the ship', () => {
    // The cap is what the whole effect's safety rests on: the grid is the player's sense of distance, and a
    // displacement larger than a cell or two around their own ship takes that away exactly where they need it.
    const enormous = shipWarp(10_000, true)
    expect(enormous.strength).toBeLessThanOrEqual(3.2)
    expect(enormous.strength).toBe(shipWarp(GEOM.maxMultiplier, true).strength)
  })

  it('stays well inside a gravity well, so the two are different sizes as well as shapes', () => {
    expect(shipWarp(GEOM.maxMultiplier, true).reach).toBeLessThan(30)
  })

  it('survives a nonsense multiplier', () => {
    expect(shipWarp(0, true).strength).toBeGreaterThan(0)
    expect(shipWarp(-5, true).strength).toBeGreaterThan(0)
    expect(Number.isFinite(shipWarp(Infinity, true).strength)).toBe(true)
  })
})
