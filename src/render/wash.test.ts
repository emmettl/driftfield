import { describe, expect, it } from 'vitest'
import { freshWash, stepWash } from './wash'

const FRAME = 1 / 60

/** Run for a stretch, collecting every splat the wash emitted along with when it happened. */
function run(state: ReturnType<typeof freshWash>, seconds: number) {
  const emitted: { at: number; u: number; v: number; vx: number }[] = []
  for (let t = 0; t < seconds; t += FRAME) {
    for (const splat of stepWash(state, FRAME)) {
      emitted.push({ at: t, u: splat.u, v: splat.v, vx: splat.vx })
    }
  }
  return emitted
}

describe('stepWash', () => {
  it('waits before the first one, so the title screen is not already mid-wash', () => {
    const state = freshWash()
    expect(stepWash(state, FRAME)).toHaveLength(0)
  })

  it('crosses the whole arena exactly once per wash', () => {
    // The property that is obvious in a test and very hard to see by eye: a front that only crosses half the
    // arena, or crosses it twice, looks like a glitch rather than a sweep.
    const state = freshWash()
    const emitted = run(state, 4)
    expect(emitted.length).toBeGreaterThan(20)

    const us = emitted.map((splat) => splat.u)
    // Starts off one side and ends off the other — the front arrives from outside the frame rather than
    // appearing at the wall.
    expect(Math.min(...us)).toBeLessThan(0)
    expect(Math.max(...us)).toBeGreaterThan(1)

    // Monotonic: it never doubles back.
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThanOrEqual(us[i - 1] - 1e-9)
  })

  it('emits a column rather than a single point, so it is a front and not a blob', () => {
    const state = freshWash()
    const emitted = run(state, 4)
    const heights = new Set(emitted.map((splat) => splat.v.toFixed(4)))
    expect(heights.size).toBeGreaterThan(1)
  })

  it('sweeps across a band rather than the whole arena height', () => {
    const state = freshWash()
    const vs = run(state, 4).map((splat) => splat.v)
    expect(Math.min(...vs)).toBeGreaterThan(0.1)
    expect(Math.max(...vs)).toBeLessThan(0.9)
  })

  it('fades in and out rather than switching on', () => {
    const state = freshWash()
    const emitted = run(state, 4)
    const first = Math.abs(emitted[0].vx)
    const middle = Math.abs(emitted[Math.floor(emitted.length / 2)].vx)
    const last = Math.abs(emitted[emitted.length - 1].vx)
    expect(middle).toBeGreaterThan(first * 2)
    expect(middle).toBeGreaterThan(last * 2)
  })

  it('goes quiet between washes and then does it again', () => {
    const state = freshWash()
    run(state, 4)
    // Straight after one finishes there is a long gap.
    expect(stepWash(state, FRAME)).toHaveLength(0)
    const later = run(state, 12)
    expect(later.length).toBeGreaterThan(20)
  })

  it('pushes along the sweep, so the front leaves a wake', () => {
    // A purely radial wash would bloom outward and go nowhere. The directional push is what drags the dust and
    // bends the grid behind it.
    const state = freshWash()
    for (const splat of run(state, 4)) expect(splat.vx).toBeGreaterThan(0)
  })

  it('ignores a zero or negative frame', () => {
    const state = freshWash()
    expect(stepWash(state, 0)).toHaveLength(0)
    expect(stepWash(state, -1)).toHaveLength(0)
    expect(state.countdown).toBe(freshWash().countdown)
  })
})
