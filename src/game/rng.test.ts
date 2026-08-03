import { describe, expect, it } from 'vitest'
import { intRange, mulberry32, pick, range, weighted } from './rng'

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    // The whole reason the simulation takes an `Rng` rather than calling `Math.random`. If this fails,
    // every test that drives a wave becomes a coin toss.
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const first = Array.from({ length: 50 }, () => a())
    const second = Array.from({ length: 50 }, () => b())
    expect(first).toEqual(second)
  })

  it('gives different sequences for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('stays in [0, 1)', () => {
    const rng = mulberry32(99)
    for (let i = 0; i < 20_000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is roughly uniform across ten buckets', () => {
    // Not a statistical test, a smoke test: a generator with a broken shift lands everything in one or
    // two buckets, and that is worth catching.
    const rng = mulberry32(4)
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(rng() * 10)]++
    for (const count of buckets) {
      expect(count).toBeGreaterThan(8_000)
      expect(count).toBeLessThan(12_000)
    }
  })
})

describe('range helpers', () => {
  it('keeps range inside its bounds', () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 1000; i++) {
      const value = range(rng, -5, 3)
      expect(value).toBeGreaterThanOrEqual(-5)
      expect(value).toBeLessThan(3)
    }
  })

  it('includes both ends of intRange', () => {
    const rng = mulberry32(3)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(intRange(rng, 1, 3))
    expect([...seen].sort()).toEqual([1, 2, 3])
  })
})

describe('weighted', () => {
  it('never returns a zero-weight entry', () => {
    // How every enemy kind is gated out of the early waves — so "wave 1 cannot send a weaver" rests
    // entirely on this.
    const rng = mulberry32(8)
    const table = [
      { item: 'yes', weight: 1 },
      { item: 'never', weight: 0 },
    ]
    for (let i = 0; i < 5000; i++) expect(weighted(rng, table)).toBe('yes')
  })

  it('respects the weights, roughly', () => {
    const rng = mulberry32(21)
    const table = [
      { item: 'common', weight: 9 },
      { item: 'rare', weight: 1 },
    ]
    let rare = 0
    for (let i = 0; i < 20_000; i++) if (weighted(rng, table) === 'rare') rare++
    expect(rare / 20_000).toBeGreaterThan(0.08)
    expect(rare / 20_000).toBeLessThan(0.12)
  })

  it('throws rather than returning undefined for an empty or dead table', () => {
    const rng = mulberry32(1)
    expect(() => weighted(rng, [])).toThrow()
    expect(() => weighted(rng, [{ item: 'x', weight: 0 }])).toThrow()
    expect(() => pick(rng, [])).toThrow()
  })
})
