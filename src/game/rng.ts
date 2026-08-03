// A seeded pseudo-random source, so that "random" is a decision the caller makes.
//
// `Math.random` would be simpler and is what a first draft of a shooter uses, but it
// makes the spawn director untestable: "wave 7 sends rocks and never puts one on top of
// the player" is a property worth pinning down, and pinning it down means being able to
// run the same wave twice. Every part of the simulation that needs randomness takes an
// `Rng`, and the only place a nondeterministic seed is chosen is where a run begins.

export interface Rng {
  /** Uniform in [0, 1). */
  (): number
}

/**
 * mulberry32 — a 32-bit generator that is four lines long and passes gjrand's smallcrush.
 *
 * The bar here is "no visible structure in where enemies appear", not cryptography, and
 * this clears that easily while staying small enough to read. It also has the property
 * the tests want: identical seeds give identical sequences across platforms, because
 * everything is done in 32-bit integer space with `| 0` and `>>>`.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seed for a real run. Wrapped rather than inlined so the one call to `Date.now` in
 *  the simulation is somewhere you can find it. */
export function randomSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
}

/** Uniform in [low, high). */
export function range(rng: Rng, low: number, high: number): number {
  return low + rng() * (high - low)
}

/** Uniform integer in [low, high]. */
export function intRange(rng: Rng, low: number, high: number): number {
  return low + Math.floor(rng() * (high - low + 1))
}

/** One of `items`, uniformly. Empty lists are a caller error and throw rather than
 *  returning undefined — a spawn table with nothing in it is a bug, not a quiet no-op. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from an empty list')
  return items[Math.floor(rng() * items.length)]
}

/**
 * One of `items`, weighted by `weight`.
 *
 * The spawn mix is the reason this exists: "mostly drifters, some weavers, the occasional
 * snake" is a set of weights, and expressing it as weights rather than as nested
 * probability tests means the mix for a wave is a value that can be printed and asserted.
 * Zero-weight entries are unreachable, which is how a kind is kept out of early waves.
 */
export function weighted<T>(rng: Rng, items: readonly { item: T; weight: number }[]): T {
  let total = 0
  for (const entry of items) total += Math.max(0, entry.weight)
  if (total <= 0) throw new Error('weighted pick with no positive weights')

  let roll = rng() * total
  for (const entry of items) {
    roll -= Math.max(0, entry.weight)
    if (roll < 0) return entry.item
  }
  // Only reachable through floating-point drift on the last entry.
  return items[items.length - 1].item
}
