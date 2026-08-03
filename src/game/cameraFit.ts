import { ARENA } from './constants'

// Where the camera has to sit for the whole arena to be on screen.
//
// The arena is a fixed rectangle and the window is whatever shape the player's window is,
// so one of the two axes always decides. Getting this wrong in the forgiving direction
// costs nothing visible on a 16:9 monitor and cuts the corners off the arena on a portrait
// phone, which is exactly the sort of bug that ships.

/**
 * Air around the arena, as a fraction — derived from the lean rather than fixed.
 *
 * Not taste: the camera slides towards the ship by `lean` of its offset from the centre, so at the far corner of
 * the arena the view has already moved by that fraction of the arena's half-extent, and shake adds a little on
 * top. A margin that only allowed for the wall glow looked right in the middle of the arena and cropped the far
 * wall whenever the player was pressed against the near one — which is exactly when knowing where the walls are
 * matters most.
 *
 * Derived, because the margin is expensive on a small screen: it is empty pixels around a playfield that is
 * already sharing the display with a control band. A phone turns the lean off (see `MOBILE_LEAN`) and this hands
 * back the margin that was only ever there to cover it, which is around a tenth of the arena's drawn size.
 */
export function marginFor(lean: number): number {
  return 1.04 + Math.max(0, lean) * 1.2
}

/**
 * Camera distance for a perspective camera looking straight down the Z axis at the arena.
 *
 * The vertical half-angle is `fov / 2`; the horizontal one is derived from it through the
 * aspect ratio. Fitting *both* means taking the larger of the two required distances —
 * which is the whole trick, and the reason this is a function rather than a constant.
 */
export function cameraDistance(fovDegrees: number, aspect: number, lean = CAMERA_LEAN): number {
  const halfFov = (fovDegrees * Math.PI) / 360
  const margin = marginFor(lean)
  const forHeight = (ARENA.halfHeight * margin) / Math.tan(halfFov)
  // A perspective camera's horizontal half-angle satisfies tan(h) = tan(v) * aspect.
  const forWidth = (ARENA.halfWidth * margin) / (Math.tan(halfFov) * Math.max(aspect, 1e-3))
  return Math.max(forHeight, forWidth)
}

/**
 * The field of view to use.
 *
 * Narrow. A wide angle on a flat top-down arena does nothing but distort the corners and
 * make the grid's perspective obvious, and this arena wants to look like a display rather
 * than like a place — 38° is barely more than a telephoto and keeps the grid's lines
 * nearly parallel, which is what makes the neon read as vector graphics.
 */
export const FOV = 38

/** Everything the camera needs, for a given viewport shape. Pure, so the test can check
 *  that a portrait window pulls back further than a landscape one. */
export function fitCamera(aspect: number, lean = CAMERA_LEAN): { fov: number; distance: number } {
  return { fov: FOV, distance: cameraDistance(FOV, aspect, lean) }
}

/**
 * How far the camera leans towards the ship, as a fraction of the ship's offset from the
 * centre.
 *
 * Not zero, and nowhere near one. A camera locked to the centre makes a large arena feel
 * like a diagram; a camera that follows the ship makes a *bounded* arena feel like it is
 * sliding around underneath you, and loses the one advantage a fixed arena has, which is
 * that the walls are always where you left them. A tenth is enough to feel the arena
 * breathe without the walls ever appearing to move.
 */
export const CAMERA_LEAN = 0.1

/**
 * The lean on a phone: none.
 *
 * Two reasons, and the second is the real one. A lean is a luxury — it makes a large arena feel like a place
 * rather than a diagram — and on a screen a few inches across there is not enough travel for it to register. And
 * it is not free: the margin above exists to keep the far wall in frame while the view is leaning, so a lean on a
 * phone is paid for in empty pixels around a playfield that is already sharing the display with a control band.
 * Turning it off hands about a tenth of the arena's drawn size back.
 */
export const MOBILE_LEAN = 0
