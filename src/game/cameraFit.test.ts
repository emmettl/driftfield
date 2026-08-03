import { describe, expect, it } from 'vitest'
import { CAMERA_LEAN, FOV, MOBILE_LEAN, cameraDistance, fitCamera, marginFor } from './cameraFit'
import { ARENA } from './constants'

/** What is actually visible at a distance, so the test checks the arena rather than the arithmetic. */
function visible(fov: number, aspect: number, distance: number) {
  const height = 2 * distance * Math.tan((fov * Math.PI) / 360)
  return { width: height * aspect, height }
}

describe('cameraDistance', () => {
  it('fits the whole arena at 16:9', () => {
    const aspect = 16 / 9
    const view = visible(FOV, aspect, cameraDistance(FOV, aspect))
    expect(view.width).toBeGreaterThanOrEqual(ARENA.halfWidth * 2)
    expect(view.height).toBeGreaterThanOrEqual(ARENA.halfHeight * 2)
  })

  it('fits it in a portrait window too, by pulling back', () => {
    // The bug this prevents: on 16:9 the height decides and the width comes free, so a version that only
    // ever fits the height looks perfect on a monitor and cuts the ends off the arena on a phone.
    const aspect = 9 / 16
    const distance = cameraDistance(FOV, aspect)
    const view = visible(FOV, aspect, distance)
    expect(view.width).toBeGreaterThanOrEqual(ARENA.halfWidth * 2)
    expect(distance).toBeGreaterThan(cameraDistance(FOV, 16 / 9))
  })

  it('fits every shape of window anybody has', () => {
    for (const aspect of [0.45, 0.6, 1, 1.33, 1.78, 2.33, 3.5]) {
      const view = visible(FOV, aspect, cameraDistance(FOV, aspect))
      expect(view.width).toBeGreaterThanOrEqual(ARENA.halfWidth * 2)
      expect(view.height).toBeGreaterThanOrEqual(ARENA.halfHeight * 2)
    }
  })

  it('leaves enough air for the camera to lean without cropping a wall', () => {
    // The bug this pins: the camera slides towards the ship by the lean of its offset, so with the ship in a
    // corner the view has already moved by that fraction of the arena's half-extent. A margin sized only for the
    // wall glow framed the arena perfectly in the middle and cropped the far wall whenever the player was pressed
    // against the near one — which is precisely when they need to see it.
    //
    // Checked at both leans, because the margin is now derived from the lean rather than fixed: the relationship
    // between them is the thing that must hold, not one particular pair of numbers.
    for (const lean of [CAMERA_LEAN, MOBILE_LEAN]) {
      for (const aspect of [0.6, 1, 1.78, 2.4]) {
        const view = visible(FOV, aspect, cameraDistance(FOV, aspect, lean))
        const leanX = ARENA.halfWidth * lean
        const leanY = ARENA.halfHeight * lean
        expect(view.width).toBeGreaterThanOrEqual((ARENA.halfWidth + leanX) * 2)
        expect(view.height).toBeGreaterThanOrEqual((ARENA.halfHeight + leanY) * 2)
      }
    }
  })

  it('draws the arena bigger on a phone, by not paying for a lean it does not have', () => {
    // The margin only ever existed to keep the far wall in frame while the view leaned. A phone turns the lean off,
    // so it gets that margin back — worth about a tenth of the arena's drawn size on the device sharing its screen
    // with a control band.
    const aspect = 16 / 9
    const desktop = cameraDistance(FOV, aspect, CAMERA_LEAN)
    const phone = cameraDistance(FOV, aspect, MOBILE_LEAN)
    expect(phone).toBeLessThan(desktop)
    expect(desktop / phone).toBeGreaterThan(1.08)
  })

  it('never lets the margin fall below the wall glow, whatever the lean', () => {
    expect(marginFor(0)).toBeGreaterThan(1.02)
    expect(marginFor(-5)).toBeGreaterThan(1.02)
    expect(marginFor(0.2)).toBeGreaterThan(marginFor(0.1))
  })

  it('does not divide by a zero aspect', () => {
    expect(Number.isFinite(cameraDistance(FOV, 0))).toBe(true)
  })
})

describe('fitCamera', () => {
  it('hands back both numbers the camera needs', () => {
    const fit = fitCamera(1.78)
    expect(fit.fov).toBe(FOV)
    expect(fit.distance).toBeCloseTo(cameraDistance(FOV, 1.78))
  })

  it('keeps the field of view narrow, so the grid stays nearly parallel', () => {
    // A wide angle on a flat top-down arena does nothing but distort the corners and make the
    // perspective on the grid obvious, which costs the vector-graphics read.
    expect(FOV).toBeLessThan(50)
  })
})
