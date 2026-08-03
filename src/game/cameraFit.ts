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
 *
 * `rolled` is a quarter turn about the view axis, which portrait uses to run the arena's long axis down the screen
 * (see `layout.ts`). All it changes here is which of the arena's half-extents each screen axis has to cover — the
 * arena itself is untouched, which is the entire appeal of doing portrait this way.
 */
export function cameraDistance(
  fovDegrees: number,
  aspect: number,
  lean = CAMERA_LEAN,
  rolled = false,
): number {
  const halfFov = (fovDegrees * Math.PI) / 360
  const margin = marginFor(lean)
  // Which arena extent lands on which screen axis. Rolled, the screen's vertical covers the arena's *width*.
  const down = rolled ? ARENA.halfWidth : ARENA.halfHeight
  const across = rolled ? ARENA.halfHeight : ARENA.halfWidth
  const forHeight = (down * margin) / Math.tan(halfFov)
  // A perspective camera's horizontal half-angle satisfies tan(h) = tan(v) * aspect.
  const forWidth = (across * margin) / (Math.tan(halfFov) * Math.max(aspect, 1e-3))
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
export function fitCamera(
  aspect: number,
  lean = CAMERA_LEAN,
  rolled = false,
): { fov: number; distance: number; roll: number } {
  return { fov: FOV, distance: cameraDistance(FOV, aspect, lean, rolled), roll: rolled ? ROLL : 0 }
}

/**
 * The roll itself, in radians, for a rolled view.
 *
 * Negative, and the sign is load-bearing: with `camera.rotation.z = -π/2` the arena's +x appears as screen *up*, so
 * screen-space directions come back into world space as `(y, -x)`. `intentFrom` applies exactly that to the touch
 * sticks, and the two have to agree or "up" steers sideways — which is why the transform lives next to the angle
 * rather than being open-coded at the call site.
 */
export const ROLL = -Math.PI / 2

/** A screen-space direction in world space, for a rolled view. The identity when upright. */
export function unroll(x: number, y: number, rolled: boolean): { x: number; y: number } {
  return rolled ? { x: y, y: -x } : { x, y }
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
