// A 2D vector as plain data, and the handful of operations the simulation needs.
//
// Not `THREE.Vector2`. The whole point of `src/game` is that it is the game rather than
// the picture of the game: it runs in Node under vitest, it has no idea a renderer
// exists, and importing three here would be the first thread of the renderer pulled into
// the part that has to stay answerable. `{ x, y }` is also what survives being cloned,
// serialised into a replay, or compared in an assertion, which `Vector2` is not.
//
// The mutating forms take a destination because the step runs over a few hundred
// entities sixty times a second, and a fresh object per operation is a garbage collection
// pause landing on a frame somebody is aiming through.

export interface Vec2 {
  x: number
  y: number
}

export function vec(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x
  out.y = y
  return out
}

export function copy(out: Vec2, from: Vec2): Vec2 {
  out.x = from.x
  out.y = from.y
  return out
}

export function add(out: Vec2, v: Vec2): Vec2 {
  out.x += v.x
  out.y += v.y
  return out
}

export function addScaled(out: Vec2, v: Vec2, k: number): Vec2 {
  out.x += v.x * k
  out.y += v.y * k
  return out
}

export function scale(out: Vec2, k: number): Vec2 {
  out.x *= k
  out.y *= k
  return out
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Unit vector, in place. A zero vector is left alone rather than becoming NaN — every
 *  caller here is steering something, and "no direction" must mean "do not turn". */
export function normalise(out: Vec2): Vec2 {
  const len = Math.hypot(out.x, out.y)
  if (len > 1e-6) {
    out.x /= len
    out.y /= len
  }
  return out
}

/** The unit vector from `from` towards `to`, written into `out`. */
export function direction(out: Vec2, from: Vec2, to: Vec2): Vec2 {
  return normalise(set(out, to.x - from.x, to.y - from.y))
}

/** Hold a vector's magnitude at or below `max`, keeping its direction. */
export function clampLength(out: Vec2, max: number): Vec2 {
  const len = Math.hypot(out.x, out.y)
  if (len > max && len > 1e-6) scale(out, max / len)
  return out
}

export function rotate(out: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return set(out, out.x * c - out.y * s, out.x * s + out.y * c)
}

/** Move `out` a fraction `k` of the way towards `to`. Frame-rate dependent by nature, so
 *  callers pass a `k` already derived from dt — see `smoothing` in constants.ts. */
export function lerp(out: Vec2, to: Vec2, k: number): Vec2 {
  out.x += (to.x - out.x) * k
  out.y += (to.y - out.y) * k
  return out
}
