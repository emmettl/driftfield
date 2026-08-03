import { describe, expect, it } from 'vitest'
import { ARENA_ASPECT, arenaFill, resolveLayout } from './layout'

/** A landscape phone, roughly an iPhone 14 with Safari's chrome showing. */
const PHONE = { width: 844, height: 390, touch: true, phone: true }
/** A tablet in landscape. Touch, but not phone-class. */
const TABLET = { width: 1180, height: 820, touch: true, phone: false }
const DESKTOP = { width: 1600, height: 900, touch: false, phone: false }

describe('resolveLayout', () => {
  it('gives the whole window to the canvas when there is a real pointer', () => {
    const layout = resolveLayout(DESKTOP)
    expect(layout.band).toBe(0)
    expect(layout.canvas).toEqual({ width: 1600, height: 900 })
    expect(layout.stickRange).toBe(0)
  })

  it('takes a band off the bottom on touch', () => {
    const layout = resolveLayout(PHONE)
    expect(layout.band).toBeGreaterThan(0)
    expect(layout.canvas.height).toBe(390 - layout.band)
  })

  it('fits the canvas to the arena on touch rather than filling the width', () => {
    // The performance decision, and the biggest one available on a phone: a landscape phone is 2.2:1 against an
    // arena of 1.76:1, so nearly half of a full-width canvas would be empty space that the bloom, the grade and
    // the particle overdraw all still pay for.
    const layout = resolveLayout(PHONE)
    expect(layout.aspect).toBeCloseTo(ARENA_ASPECT, 2)
    expect(layout.canvas.width).toBeLessThan(PHONE.width)
    // ...and the arena then fills what is left, which is the point of doing it.
    expect(layout.fill).toBeCloseTo(1, 2)
  })

  it('saves a real fraction of the pixels by doing so', () => {
    const layout = resolveLayout(PHONE)
    const fullWidth = PHONE.width * layout.canvas.height
    const fitted = layout.canvas.width * layout.canvas.height
    expect(fitted / fullWidth).toBeLessThan(0.65)
  })

  it('binds on height instead when the space is narrower than the arena', () => {
    // A tablet in portrait. The box has to shrink on whichever axis runs out first, or it would be bigger than the
    // space it is being fitted into.
    const layout = resolveLayout({ width: 820, height: 1180, touch: true, phone: false })
    expect(layout.canvas.width).toBeLessThanOrEqual(820)
    expect(layout.canvas.height).toBeLessThanOrEqual(1180 - layout.band)
    expect(layout.aspect).toBeCloseTo(ARENA_ASPECT, 2)
  })

  it('keeps the band inside its floor and ceiling', () => {
    // A third of a short viewport is not enough to steer with, and a third of a tall one is more than a thumb can
    // use — so the fraction is bounded at both ends.
    expect(resolveLayout({ ...PHONE, height: 300 }).band).toBeGreaterThanOrEqual(104)
    expect(resolveLayout({ ...TABLET, height: 1400 }).band).toBeLessThanOrEqual(190)
  })

  it('never eats so much of the screen that there is no canvas', () => {
    // A viewport far shorter than the band's own floor. Better a cramped band than no playfield.
    const layout = resolveLayout({ ...PHONE, height: 120 })
    expect(layout.canvas.height).toBeGreaterThan(0)
    expect(layout.band).toBeLessThan(120)
  })

  it('derives the stick travel from the band, so the two cannot disagree', () => {
    // The failure this prevents is a stick whose full deflection is outside the band it is drawn in.
    for (const shape of [PHONE, TABLET, { ...PHONE, height: 320 }]) {
      const layout = resolveLayout(shape)
      expect(layout.stickRange).toBeGreaterThan(20)
      expect(layout.stickRange * 2).toBeLessThanOrEqual(layout.band)
    }
  })

  it('leaves the playfield a usable size on a phone', () => {
    // The question this whole file exists to answer. The band costs arena height directly, and height is the
    // expensive direction — this is the check that the cost is acceptable rather than something to find out
    // about on a device.
    const layout = resolveLayout(PHONE)
    expect(layout.canvas.height).toBeGreaterThan(180)
    expect(layout.canvas.width).toBeGreaterThan(330)
  })

  it('costs the phone more arena than the tablet, which is the trade being made', () => {
    // Stated as a test because it is counter-intuitive: the band is a fixed number of pixels, so it is a much
    // bigger share of a short viewport — the device with the least room to give is the one that gives most.
    const phone = resolveLayout(PHONE)
    const tablet = resolveLayout(TABLET)
    expect(phone.band / phone.canvas.height).toBeGreaterThan(tablet.band / tablet.canvas.height)
  })

  it('asks a phone in portrait to turn round, and leaves a tablet alone', () => {
    expect(resolveLayout({ width: 390, height: 844, touch: true, phone: true }).rotate).toBe(true)
    // 0.7:1 is wasteful and perfectly playable. Telling somebody to rotate a device that works is worse than a
    // slightly empty screen.
    expect(resolveLayout({ width: 820, height: 1180, touch: true, phone: false }).rotate).toBe(false)
    expect(resolveLayout(PHONE).rotate).toBe(false)
    expect(resolveLayout(DESKTOP).rotate).toBe(false)
  })

  it('survives a zero or nonsense viewport', () => {
    const layout = resolveLayout({ width: 0, height: 0, touch: true, phone: true })
    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.canvas.height).toBeGreaterThan(0)
    expect(layout.canvas.width).toBeGreaterThan(0)
  })
})

describe('arenaFill', () => {
  it('is 1 when the canvas is exactly the arena shape', () => {
    expect(arenaFill(ARENA_ASPECT)).toBeCloseTo(1)
  })

  it('falls off either side of it', () => {
    // A canvas wider than the arena wastes width; a narrower one wastes height. Both are the same loss.
    expect(arenaFill(ARENA_ASPECT * 2)).toBeCloseTo(0.5)
    expect(arenaFill(ARENA_ASPECT / 2)).toBeCloseTo(0.5)
  })

  it('never exceeds 1', () => {
    for (const aspect of [0.2, 0.5, 1, 1.77, 2.4, 4]) {
      expect(arenaFill(aspect)).toBeLessThanOrEqual(1)
      expect(arenaFill(aspect)).toBeGreaterThan(0)
    }
  })
})
