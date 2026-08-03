import { describe, expect, it } from 'vitest'
import {
  DPR_CEILING,
  DPR_FLOOR,
  PIXEL_BUDGET,
  START_FACTOR,
  dprForFactor,
  resolveRenderBounds,
  resolveRenderDpr,
} from './renderScale'

describe('resolveRenderDpr', () => {
  it('honours a modest request in a small window', () => {
    expect(resolveRenderDpr({ width: 1280, height: 720, devicePixelRatio: 1 })).toBe(1)
  })

  it('holds a large window on a dense display inside the pixel budget', () => {
    // The case this exists for: a maximised window on a scaled 4K panel asks for ~8M pixels a frame,
    // which on integrated graphics is the difference between 60fps and a slideshow.
    const dpr = resolveRenderDpr({ width: 2560, height: 1440, devicePixelRatio: 2 })
    expect(dpr).toBeLessThan(2)
    expect(2560 * 1440 * dpr * dpr).toBeLessThanOrEqual(PIXEL_BUDGET * 1.05)
  })

  it('never exceeds the ceiling however dense the display', () => {
    expect(resolveRenderDpr({ width: 400, height: 300, devicePixelRatio: 4 })).toBeLessThanOrEqual(
      DPR_CEILING.desktop,
    )
    expect(
      resolveRenderDpr({ width: 400, height: 300, devicePixelRatio: 4, mobile: true }),
    ).toBeLessThanOrEqual(DPR_CEILING.mobile)
  })

  it('never goes below the floor however large the window', () => {
    // Under about 0.6 the thin neon geometry — grid lines, enemy outlines — starts to break up.
    expect(resolveRenderDpr({ width: 8000, height: 4000, devicePixelRatio: 3 })).toBe(DPR_FLOOR)
  })

  it('leaves the request alone for a viewport with no area', () => {
    // A hidden tab or a zero-size harness carries no information, and dividing by it would produce
    // Infinity.
    expect(resolveRenderDpr({ width: 0, height: 0, devicePixelRatio: 1.5 })).toBe(1.5)
  })

  it('survives nonsense', () => {
    expect(resolveRenderDpr({ width: 1280, height: 720, devicePixelRatio: 0 })).toBeGreaterThan(0)
    expect(resolveRenderDpr({ width: 1280, height: 720, devicePixelRatio: NaN })).toBeGreaterThan(0)
  })
})

describe('resolveRenderBounds', () => {
  it('never puts the top below the cap', () => {
    // Otherwise `dprForFactor` interpolates backwards and a machine with headroom gets a blurrier frame
    // the better it performs.
    for (const width of [800, 1440, 2560, 3840]) {
      for (const ratio of [1, 1.5, 2, 3]) {
        const bounds = resolveRenderBounds({ width, height: width * 0.5625, devicePixelRatio: ratio })
        expect(bounds.top).toBeGreaterThanOrEqual(bounds.cap)
      }
    }
  })
})

describe('dprForFactor', () => {
  const bounds = resolveRenderBounds({ width: 2560, height: 1440, devicePixelRatio: 2 })

  it('renders at the budget cap before anything has been measured', () => {
    expect(dprForFactor(bounds, START_FACTOR)).toBeCloseTo(bounds.cap, 2)
  })

  it('gives ground towards the floor on a machine that is struggling', () => {
    expect(dprForFactor(bounds, 0)).toBe(DPR_FLOOR)
    expect(dprForFactor(bounds, 0.25)).toBeLessThan(bounds.cap)
  })

  it('earns its way up towards the display on a machine with headroom', () => {
    expect(dprForFactor(bounds, 1)).toBeCloseTo(bounds.top, 2)
    expect(dprForFactor(bounds, 0.75)).toBeGreaterThan(bounds.cap)
  })

  it('is monotonic', () => {
    let previous = 0
    for (let factor = 0; factor <= 1.001; factor += 0.05) {
      const dpr = dprForFactor(bounds, factor)
      expect(dpr).toBeGreaterThanOrEqual(previous)
      previous = dpr
    }
  })

  it('stays inside the bounds for any factor, including a broken one', () => {
    for (const factor of [-5, 0, 0.5, 1, 12, NaN]) {
      const dpr = dprForFactor(bounds, factor)
      expect(dpr).toBeGreaterThanOrEqual(DPR_FLOOR)
      expect(dpr).toBeLessThanOrEqual(bounds.top)
    }
  })
})
