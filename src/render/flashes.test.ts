import { beforeEach, describe, expect, it } from 'vitest'
import { clearFlashes, flashProgress, flashes, pushFlash, stepFlashes } from './flashes'

function live() {
  return flashes().filter((flash) => flashProgress(flash) !== null)
}

describe('the flash pool', () => {
  beforeEach(() => clearFlashes())

  it('starts empty', () => {
    expect(live()).toHaveLength(0)
  })

  it('holds a flash for a fraction of a second and then drops it', () => {
    // Short is the whole point: an impact has to be over before the eye settles on it, or it reads as an object
    // that appeared rather than as a moment.
    pushFlash(3, 4, 5, 0.5, 1)
    expect(live()).toHaveLength(1)

    stepFlashes(0.1)
    expect(live()).toHaveLength(1)
    stepFlashes(0.5)
    expect(live()).toHaveLength(0)
  })

  it('runs its progress from 0 to 1 and then reports dead', () => {
    pushFlash(0, 0, 4, 0.2, 1)
    const [flash] = live()
    expect(flashProgress(flash)).toBe(0)
    stepFlashes(flash.life / 2)
    expect(flashProgress(flash)).toBeCloseTo(0.5, 2)
    stepFlashes(flash.life)
    expect(flashProgress(flash)).toBeNull()
  })

  it('gives a bigger event a longer flash, but not proportionally', () => {
    // A bomb is forty times a kill's area and must not be on screen for forty times as long.
    pushFlash(0, 0, 4, 0.2, 0.2)
    const small = live()[0].life
    clearFlashes()
    pushFlash(0, 0, 30, 0.2, 3)
    const large = live()[0].life
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThan(small * 2)
  })

  it('recycles the oldest rather than growing, and never allocates', () => {
    // A bomb into a rock field pushes eighty of these on one frame. The pool is fixed, so the honest choices are
    // to allocate eighty objects at the worst possible moment or to overwrite — and at eighty simultaneous
    // impacts nobody is tracking an individual one.
    const before = flashes().length
    for (let i = 0; i < 500; i++) pushFlash(i, i, 4, 0.2, 1)
    expect(flashes().length).toBe(before)
    expect(live().length).toBe(before)
  })

  it('keeps what it was told', () => {
    pushFlash(-12, 7, 6.5, 0.83, 1.4)
    const [flash] = live()
    expect(flash.x).toBe(-12)
    expect(flash.y).toBe(7)
    expect(flash.radius).toBe(6.5)
    expect(flash.hue).toBe(0.83)
    expect(flash.strength).toBe(1.4)
  })

  it('is emptied by a restart, so a new run does not open on the last one', () => {
    pushFlash(0, 0, 4, 0.2, 1)
    clearFlashes()
    expect(live()).toHaveLength(0)
  })
})
