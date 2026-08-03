import { describe, expect, it } from 'vitest'
import {
  CAMERA_LEAN,
  FOV,
  MOBILE_LEAN,
  ROLL,
  cameraDistance,
  fitCamera,
  marginFor,
  unroll,
} from './cameraFit'
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

  it('fits the arena rolled a quarter turn, which is how portrait works', () => {
    // Rolled, the screen's vertical axis has to cover the arena's *width* and its horizontal the arena's height. The
    // check is the same as every other fit here, with the extents swapped — because the arena has not changed, only
    // which way round it is being looked at.
    const aspect = 430 / 718
    const view = visible(FOV, aspect, cameraDistance(FOV, aspect, MOBILE_LEAN, true))
    expect(view.height).toBeGreaterThanOrEqual(ARENA.halfWidth * 2)
    expect(view.width).toBeGreaterThanOrEqual(ARENA.halfHeight * 2)
  })

  it('gets much closer rolled than upright on a portrait viewport', () => {
    // Where the playfield size actually comes from: fitting the arena's long axis to the screen's long axis instead
    // of across its short one lets the camera come in, and everything is drawn correspondingly bigger.
    const aspect = 430 / 718
    const rolled = cameraDistance(FOV, aspect, MOBILE_LEAN, true)
    const upright = cameraDistance(FOV, aspect, MOBILE_LEAN, false)
    expect(rolled).toBeLessThan(upright * 0.7)
  })

  it('fits every shape of window rolled, too', () => {
    for (const aspect of [0.45, 0.6, 1, 1.33, 1.78]) {
      const view = visible(FOV, aspect, cameraDistance(FOV, aspect, CAMERA_LEAN, true))
      expect(view.height).toBeGreaterThanOrEqual(ARENA.halfWidth * 2)
      expect(view.width).toBeGreaterThanOrEqual(ARENA.halfHeight * 2)
    }
  })
})

describe('unroll', () => {
  it('is the identity when the view is upright', () => {
    expect(unroll(0.6, -0.8, false)).toEqual({ x: 0.6, y: -0.8 })
  })

  it('sends a thumb pushed up the screen to the arena, not sideways', () => {
    // The transform that has to agree with `ROLL`, and the one place a sign error would be invisible in a screenshot
    // and obvious the moment somebody tried to play. With `camera.rotation.z = -π/2` the arena's +x appears as screen
    // up, so a stick pushed up the screen must come back as +x.
    //
    // Component-wise, because a right-angle rotation produces signed zeros and `toEqual` holds -0 and 0 apart.
    const cases: [[number, number], [number, number]][] = [
      [[0, 1], [1, 0]], // up the screen    -> +x
      [[1, 0], [0, -1]], // right           -> -y
      [[0, -1], [-1, 0]], // down           -> -x
      [[-1, 0], [0, 1]], // left            -> +y
    ]
    for (const [[sx, sy], [wx, wy]] of cases) {
      const world = unroll(sx, sy, true)
      expect(world.x).toBeCloseTo(wx)
      expect(world.y).toBeCloseTo(wy)
    }
  })

  it('matches the roll the camera is actually given', () => {
    // Derived from `ROLL` rather than hard-coded, so the two cannot drift apart: rotating a screen direction by ROLL
    // is what the camera does to it, and `unroll` must be exactly that.
    const [x, y] = [0.38, 0.92]
    expect(unroll(x, y, true).x).toBeCloseTo(x * Math.cos(ROLL) - y * Math.sin(ROLL))
    expect(unroll(x, y, true).y).toBeCloseTo(x * Math.sin(ROLL) + y * Math.cos(ROLL))
  })

  it('preserves magnitude, so rolling cannot change the ship speed', () => {
    expect(Math.hypot(...Object.values(unroll(0.6, 0.8, true)))).toBeCloseTo(1)
  })
})

describe('fitCamera', () => {
  it('hands back both numbers the camera needs', () => {
    const fit = fitCamera(1.78)
    expect(fit.fov).toBe(FOV)
    expect(fit.distance).toBeCloseTo(cameraDistance(FOV, 1.78))
    expect(fit.roll).toBe(0)
  })

  it('hands back the roll when the view is rolled', () => {
    expect(fitCamera(0.6, MOBILE_LEAN, true).roll).toBe(ROLL)
  })

  it('keeps the field of view narrow, so the grid stays nearly parallel', () => {
    // A wide angle on a flat top-down arena does nothing but distort the corners and make the
    // perspective on the grid obvious, which costs the vector-graphics read.
    expect(FOV).toBeLessThan(50)
  })
})
