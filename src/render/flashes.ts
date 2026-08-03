// The flash at the moment of an impact.
//
// The fluid and the particles are both *slow*: dye spreads over a second, sparks arc away over three. They are
// what an explosion leaves behind, and they were carrying the whole event on their own — which is why the hits
// still had no punch after the blasts were made bigger. Making a slow thing bigger makes it a bigger slow thing.
//
// This is the fast half, and it is the exact visual counterpart of the click in `audio.ts`: a hard white core
// that is gone in a tenth of a second, and a ring that expands past the blast radius and is gone in a quarter.
// Neither lasts long enough to read as an object; together they read as a *moment*, which is what an impact is.
//
// Module state, like `shake.ts` and `beat.ts`, and for the same reason: it changes every frame and no component
// needs to re-render when it does.

export interface Flash {
  x: number
  y: number
  /** World units — the blast's own radius. The ring expands past it; the core shrinks inside it. */
  radius: number
  /** Hue in turns, taken from whatever died, so the ring is the colour of the thing it came from. */
  hue: number
  strength: number
  age: number
  life: number
}

/**
 * How many flashes can be alive at once.
 *
 * A fixed pool, claimed round-robin, rather than a growing list: a bomb into a rock field pushes eighty of these
 * on one frame, and the honest options are to allocate eighty objects at the worst possible moment or to
 * overwrite the oldest. Overwriting is invisible — at eighty simultaneous impacts nobody is tracking an
 * individual one — and it means this file allocates exactly once, at startup.
 */
const CAPACITY = 48

/** Seconds. Short enough that the flash is over before the eye settles on it, which is what makes it read as an
 *  impact rather than as an object that appeared. */
const LIFE = 0.22

const pool: Flash[] = Array.from({ length: CAPACITY }, () => ({
  x: 0,
  y: 0,
  radius: 0,
  hue: 0,
  strength: 0,
  // Dead: `age >= life` is the only liveness test, so a pool that starts fully aged starts empty.
  age: 1,
  life: LIFE,
}))

let cursor = 0

export function pushFlash(x: number, y: number, radius: number, hue: number, strength: number): void {
  const flash = pool[cursor]
  cursor = (cursor + 1) % CAPACITY
  flash.x = x
  flash.y = y
  flash.radius = radius
  flash.hue = hue
  flash.strength = strength
  flash.age = 0
  // Bigger events flash for slightly longer, but not proportionally — a bomb is forty times a kill's area and
  // must not be on screen for forty times as long.
  flash.life = LIFE * (0.8 + Math.min(1, strength) * 0.6)
}

/** Age every flash. Called once a frame; the renderer reads the pool afterwards. */
export function stepFlashes(dt: number): void {
  for (const flash of pool) {
    if (flash.age < flash.life) flash.age += dt
  }
}

/** The pool. Callers skip anything with `age >= life`. Handed out directly rather than filtered into a new array,
 *  because filtering allocates and this is read every frame. */
export function flashes(): readonly Flash[] {
  return pool
}

/** Drop everything. For a restart, so a new run does not open with the last one's final explosion still on
 *  screen. */
export function clearFlashes(): void {
  for (const flash of pool) flash.age = flash.life
}

/**
 * How far through its life a flash is, 0..1, or null if it is dead.
 *
 * A helper rather than an inline division because both the core and the ring need it and they must agree — a
 * core that outlives its own ring looks like two unrelated effects.
 */
export function flashProgress(flash: Flash): number | null {
  if (flash.age >= flash.life) return null
  return flash.age / flash.life
}
