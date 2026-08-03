import { describe, expect, it } from 'vitest'
import { ARENA_ASPECT, orientationFor, resolveLayout } from './layout'

/**
 * A landscape iPhone with Safari's chrome showing, in CSS pixels.
 *
 * Taken from a real device rather than invented, because the browser chrome is the whole problem: it costs about a
 * fifth of the height, which leaves a viewport far wider relative to its height than any emulator preset suggests —
 * 2.7:1 against an arena of 1.76:1.
 */
const PHONE = { width: 874, height: 322, touch: true, phone: true }
/** The same phone added to the Home Screen, so there is no browser chrome. */
const PHONE_STANDALONE = { width: 874, height: 402, touch: true, phone: true }
/** The same phone held upright, chrome showing. 0.52:1 — far taller than the arena is tall. */
const PHONE_PORTRAIT = { width: 430, height: 822, touch: true, phone: true }
/** A tablet in landscape — 1.44:1, which is *narrower* than the arena. */
const TABLET = { width: 1180, height: 820, touch: true, phone: false }
const TABLET_PORTRAIT = { width: 820, height: 1180, touch: true, phone: false }
const DESKTOP = { width: 1600, height: 900, touch: false, phone: false }

const TOUCH_SHAPES = [PHONE, PHONE_STANDALONE, PHONE_PORTRAIT, TABLET, TABLET_PORTRAIT]

/** The canvas area, which is what the orientation choice is actually maximising. */
const area = (shape: Parameters<typeof resolveLayout>[0]) => {
  const layout = resolveLayout(shape)
  return layout.canvas.width * layout.canvas.height
}

describe('resolveLayout', () => {
  it('gives the whole window to the canvas when there is a real pointer', () => {
    const layout = resolveLayout(DESKTOP)
    expect(layout.placement).toBe('none')
    expect(layout.canvas).toEqual({ width: 1600, height: 900 })
    expect(layout.rail).toBe(0)
    expect(layout.band).toBe(0)
    expect(layout.rolled).toBe(false)
  })

  it('rolls the view a quarter turn on a tall screen, and leaves a wide one upright', () => {
    // The idea the file turns on. The arena is 1.76:1 and a phone held upright is 0.52:1, so drawn upright it is a
    // letterboxed strip; rolled, it runs down the screen. Nothing about the arena changes — only the camera.
    expect(resolveLayout(PHONE_PORTRAIT).rolled).toBe(true)
    expect(resolveLayout(TABLET_PORTRAIT).rolled).toBe(true)
    expect(resolveLayout(PHONE).rolled).toBe(false)
    expect(resolveLayout(TABLET).rolled).toBe(false)
  })

  it('is worth nearly three times the playfield on a portrait phone', () => {
    // The number that justifies the feature, stated as the comparison it was chosen by: the same viewport, forced
    // upright, against what rolling actually gives.
    const rolled = area(PHONE_PORTRAIT)
    const upright = orientationFor(PHONE_PORTRAIT.width, PHONE_PORTRAIT.height, false).area
    expect(rolled / upright).toBeGreaterThan(2.5)
  })

  it('never picks the orientation with the smaller playfield', () => {
    // The choice is made by costing both, so this is the invariant rather than a spot check: whichever way round a
    // given viewport ends up, the other way round must not have been better. Asked of `orientationFor` — the same
    // function that made the decision — rather than of a transposed viewport, which is a tempting shortcut and a
    // wrong one: transposing moves the controls to the other axis as well, so it answers a different question.
    for (const shape of TOUCH_SHAPES) {
      const layout = resolveLayout(shape)
      const rejected = orientationFor(
        shape.width,
        shape.height,
        !layout.rolled,
      )
      expect(layout.canvas.width * layout.canvas.height).toBeGreaterThanOrEqual(rejected.area)
    }
  })

  it('spends the slack on the controls before charging the arena for them', () => {
    // The rule both branches share, and the one that was wrong: the band used to take a fixed share of the height
    // rather than the *free* height, which cost a portrait phone 126 pixels of playfield and a tablet 68 pixels of
    // arena width — charging the arena for space that was already going spare.
    //
    // A tablet in landscape has plenty of slack below the arena, so the arena should keep its full width.
    const tablet = resolveLayout(TABLET)
    expect(tablet.canvas.width).toBe(TABLET.width)
    // A portrait phone has only about 64 pixels spare, so the band takes its minimum and no more.
    const phone = resolveLayout(PHONE_PORTRAIT)
    expect(phone.band).toBe(104)
    expect(phone.canvas.height).toBeGreaterThan(700)
  })

  it('puts the controls where the hands are, which follows from the orientation', () => {
    // A wide upright view has slack at the sides and thumbs that reach them, so it gets rails; anything tall gets a
    // band along the bottom, because that is where hands rest on a tall screen.
    expect(resolveLayout(PHONE).placement).toBe('rails')
    expect(resolveLayout(PHONE_STANDALONE).placement).toBe('rails')
    expect(resolveLayout(PHONE_PORTRAIT).placement).toBe('band')
    expect(resolveLayout(TABLET).placement).toBe('band')
  })

  it('never puts rails on a tall screen, even when they would measure bigger', () => {
    // The defect this pins, found by looking at a portrait tablet rather than at a number: rails there were two
    // 88-pixel slivers pinned to the bezels with the bomb stranded in the bottom corner. They measured 11% more
    // playfield than a band and were materially worse to hold — the wrong trade, and one an area comparison alone
    // will always get wrong. So the orientation decides the arrangement.
    for (const shape of TOUCH_SHAPES) {
      const layout = resolveLayout(shape)
      if (layout.rolled) expect(layout.placement).toBe('band')
    }
    expect(resolveLayout(TABLET_PORTRAIT).placement).toBe('band')
    // ...and it is still much better than not rolling at all, which is what makes the trade affordable.
    expect(area(TABLET_PORTRAIT)).toBeGreaterThan(
      orientationFor(TABLET_PORTRAIT.width, TABLET_PORTRAIT.height, false).area * 1.5,
    )
  })

  it('gives a landscape phone the full height for its playfield', () => {
    // The bug this replaces: a bottom band came out of the *tight* axis, so the arena was 385 × 218 where it could
    // have been 568 × 322 — less than half the area, for nothing.
    const layout = resolveLayout(PHONE)
    expect(layout.canvas.height).toBe(PHONE.height)
    expect(layout.canvas.width).toBeGreaterThan(540)
  })

  it('leaves rails wide enough for a thumb, taking it from the arena if it must', () => {
    // The controls have a hard minimum and the playfield does not: a viewport so wide that the arena at full height
    // leaves no room either side would otherwise get unusable slivers.
    for (const shape of [PHONE, PHONE_STANDALONE, { ...PHONE, width: 700, height: 380 }]) {
      const layout = resolveLayout(shape)
      expect(layout.placement).toBe('rails')
      expect(layout.rail).toBeGreaterThanOrEqual(88)
      // ...and the arena plus both rails still fits the screen.
      expect(layout.canvas.width + layout.rail * 2).toBeLessThanOrEqual(shape.width)
    }
  })

  it('does not let a rail grow past what a thumb can reach across', () => {
    const layout = resolveLayout({ width: 2400, height: 400, touch: true, phone: false })
    expect(layout.rail).toBeLessThanOrEqual(168)
  })

  it('fits the canvas and the controls inside the viewport, whatever the arrangement', () => {
    for (const shape of TOUCH_SHAPES) {
      const layout = resolveLayout(shape)
      expect(layout.canvas.width + layout.rail * 2).toBeLessThanOrEqual(shape.width)
      expect(layout.canvas.height + layout.band).toBeLessThanOrEqual(shape.height)
    }
  })

  it('keeps the canvas arena-shaped, one way round or the other', () => {
    // Which only decides whether the leftover space is inside the canvas or outside it — outside being far cheaper,
    // since every pixel inside is paid for by the bloom, the grade and the particle overdraw.
    for (const shape of TOUCH_SHAPES) {
      const layout = resolveLayout(shape)
      expect(layout.aspect).toBeCloseTo(layout.rolled ? 1 / ARENA_ASPECT : ARENA_ASPECT, 2)
    }
  })

  it('draws the arena bigger in portrait than in landscape on the same phone', () => {
    // The user-visible claim: turning the phone upright makes the playfield larger, not smaller. Compared in pixels
    // per world unit rather than in area, because that is what "the playfield is tiny" was actually about.
    expect(resolveLayout(PHONE_PORTRAIT).scale).toBeGreaterThan(resolveLayout(PHONE).scale * 1.2)
  })

  it('derives the stick travel from the zone, so the two cannot disagree', () => {
    // The failure this prevents is a stick whose full deflection is outside the zone it is drawn in.
    for (const shape of [...TOUCH_SHAPES, { ...PHONE, height: 300 }]) {
      const layout = resolveLayout(shape)
      const zone = layout.placement === 'rails' ? layout.rail : layout.band
      expect(layout.stickRange).toBeGreaterThan(20)
      expect(layout.stickRange * 2).toBeLessThanOrEqual(zone)
    }
  })

  it('never returns a canvas larger than the space it was given', () => {
    for (const shape of [...TOUCH_SHAPES, DESKTOP, { ...PHONE, width: 320, height: 200 }]) {
      const layout = resolveLayout(shape)
      expect(layout.canvas.width).toBeLessThanOrEqual(shape.width)
      expect(layout.canvas.height).toBeLessThanOrEqual(shape.height)
    }
  })

  it('survives a zero or nonsense viewport', () => {
    const layout = resolveLayout({ width: 0, height: 0, touch: true, phone: true })
    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.canvas.height).toBeGreaterThan(0)
    expect(layout.canvas.width).toBeGreaterThan(0)
  })
})
