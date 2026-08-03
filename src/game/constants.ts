import type { EnemyKind, WaveMode } from './types'

// Every number the game is tuned by, in one place.
//
// Arranged by what it affects rather than alphabetically, and the ones that matter carry
// the reasoning. A shooter is entirely made of these — the difference between one that
// feels good and one that does not is a handful of them being 20% different — so a value
// here that nobody can explain is a value nobody can safely change.

// ---- the arena -----------------------------------------------------------------
//
// A fixed rectangle, in world units, with the ship held inside it. Fixed rather than
// scrolling, and fixed rather than aspect-dependent: the arena is the level, and a player
// on a wide monitor must not be able to see enemies a player on a laptop cannot. The
// camera pulls back to fit whatever shape the window is (see `cameraFit.ts`), so a narrow
// window shows *more* dead space around the arena, never less arena.
//
// 120 × 68 is 16:9 to within a unit, so the common case wastes almost nothing.

export const ARENA = {
  halfWidth: 60,
  halfHeight: 34,
} as const

/** Where the walls are for something that has a radius. */
export const WALL_BOUNCE = 0.82 // energy kept when a wanderer or a rock hits the edge

// ---- the ship ------------------------------------------------------------------

export const SHIP = {
  radius: 1.5,
  /** Units per second at full stick. */
  speed: 42,
  /**
   * How sharply the ship reaches the stick's direction, as the fraction of the gap closed
   * per second. High enough that it never feels like steering a boat, low enough that
   * there is a slide out of a hard reversal — that slide is where the fluid trail comes
   * from, and it is most of why the ship feels like it has mass.
   */
  responsiveness: 14,
  /** Seconds between shots. 11 a second: fast enough to hold a wall of fire, slow enough
   *  that a single tap is a distinct event you can hear. */
  fireInterval: 0.09,
  /** Seconds of invulnerability after a respawn. Long enough to get out of whatever
   *  killed you, and it blinks so it is never a mystery why you survived that. */
  respawnInvulnerable: 2.2,
  /** Seconds the arena keeps going without you after a death, before you come back. */
  deathPause: 1.6,
} as const

export const BULLET = {
  radius: 0.55,
  speed: 135,
  /** Seconds. Just over one arena crossing at that speed, so a shot dies of old age past
   *  the far wall rather than being culled at it — a bullet vanishing at a wall the camera
   *  cannot see reads as the gun misfiring. */
  life: 1.05,
  /** Shots per trigger pull. Two, a hair apart, so the stream has width without becoming
   *  a shotgun — a single bullet down the exact centre is hard to aim with at this speed. */
  perShot: 2,
  /** Radians between the pair. */
  spread: 0.055,
  /** How much of the ship's own velocity a bullet inherits. Not zero: firing backwards
   *  while sprinting forwards should visibly cost the shot some speed, the same way it
   *  does in Asteroids. Not one either, or strafing curves the stream. */
  inheritance: 0.22,
} as const

/** The screen-clearing bomb. Three to start, one per 100k, and the only answer to being
 *  properly surrounded. */
export const BOMB = {
  startCount: 3,
  /** World units. Comfortably the whole arena — a bomb is a reset, not a weapon you aim.
   *  It is a radius rather than "everything" so the shockwave has somewhere to travel
   *  from and the kills ripple outward from the ship instead of happening all at once. */
  radius: 150,
  /** Units per second the clearing front travels. Slow enough to watch. */
  frontSpeed: 190,
  /** Seconds of invulnerability the detonation grants, so the bomb you fired to save
   *  yourself cannot be beaten to it by the thing you fired it at. */
  invulnerable: 1.1,
} as const

// ---- enemies -------------------------------------------------------------------

/**
 * Seconds an enemy spends materialising, during which it neither collides nor takes
 * damage.
 *
 * Load-bearing, not polish. Enemies are placed away from the ship but the ship moves at
 * 42 u/s, so by the time a spawn resolves the player may already be on top of it. Without
 * this window, waves in a busy arena produce deaths that look exactly like the game
 * cheating — and the fix cannot be "spawn further away", because in a bounded arena there
 * eventually is no further away.
 */
export const SPAWN_GRACE = 0.55

/**
 * The band of hues no enemy may use, in turns.
 *
 * Blue and cyan, and it is banned for two reasons that compound. The arena's own furniture is blue — the grid,
 * the walls — so a blue enemy is camouflaged against the floor it is crossing. And blue is the *palest* region
 * of the wheel once the bloom has had it: a saturated azure diamond blooms to something very close to white,
 * and white is reserved for the geoms, which are the one thing in the arena you are supposed to fly into.
 * An enemy that reads as a pickup is worse than an enemy that is hard to see.
 *
 * The drifter used to be azure and the swarmer cyan — the two most numerous kinds, both in the band.
 */
export const BANNED_HUES = { from: 0.42, to: 0.7 } as const

export const ENEMY: Record<
  EnemyKind,
  {
    radius: number
    speed: number
    hp: number
    score: number
    /**
     * Dye hue, in turns. Also what the outline is drawn in — one source, so the smoke a kill leaves behind is
     * the colour of the thing that died.
     *
     * Spread around the wheel at roughly 0.08 intervals, skipping `BANNED_HUES` entirely. Eight saturated hues
     * are not reliably distinguishable on their own, so the shapes carry most of the load (see `shapes.ts`) —
     * but no two kinds may be close in both.
     */
    hue: number
    /** Geoms dropped on death. */
    geoms: number
  }
> = {
  // Purple. The most numerous enemy, so it gets the most distinct thing available outside the banned band —
  // and a saturated purple holds its hue under bloom where the azure it used to be did not.
  drifter: { radius: 1.5, speed: 15, hp: 1, score: 50, hue: 0.83, geoms: 1 },
  wanderer: { radius: 1.6, speed: 21, hp: 1, score: 75, hue: 0.3, geoms: 1 },
  weaver: { radius: 1.7, speed: 24, hp: 1, score: 120, hue: 0.91, geoms: 2 },
  snake: { radius: 1.3, speed: 27, hp: 1, score: 100, hue: 0.21, geoms: 1 },
  // Speed is the *big* rock's; the tiers scale it up as they get smaller, so breaking one
  // makes the arena more dangerous rather than less. See `rockTier`.
  rock: { radius: 4.2, speed: 9, hp: 1, score: 60, hue: 0.06, geoms: 2 },
  well: { radius: 3.2, speed: 5, hp: 24, score: 1500, hue: 0.73, geoms: 8 },
  // Tiny, quick, and arrives in packs — see `SWARM_SIZE`. Worth little on its own; the point of a swarmer is
  // that there are eight of them and they do not travel in a straight line.
  // Green, not the cyan it started as — cyan is in the banned band, and eight small pale triangles were the
  // worst offender for looking like a handful of geoms.
  swarmer: { radius: 0.95, speed: 34, hp: 1, score: 30, hue: 0.38, geoms: 1 },
  // Red, because it is the only thing in the game that shoots back and red is what that means. Two hits, so
  // a glancing shot at range does not remove it and it stays a priority rather than an accident.
  sniper: { radius: 1.8, speed: 17, hp: 2, score: 250, hue: 0.99, geoms: 3 },
}

/** Size, speed multiplier and score for each rock class. Small rocks are quick and worth
 *  the least, which is the Asteroids bargain: breaking one up is a decision. */
export function rockTier(tier: number): { radius: number; speedScale: number; score: number } {
  if (tier >= 2) return { radius: 4.2, speedScale: 1, score: 60 }
  if (tier === 1) return { radius: 2.7, speedScale: 1.5, score: 90 }
  return { radius: 1.7, speedScale: 2.1, score: 140 }
}

export const SNAKE_LENGTH = 7
/** How far apart segments sit, in radii. Under about 1.6 the chain reads as a blob. */
export const SNAKE_SPACING = 1.8

export const WEAVER = {
  /** How far ahead a weaver looks for a bullet, in world units. */
  lookahead: 14,
  /** Sideways speed while dodging, as a multiple of its forward speed. */
  dodgeScale: 1.5,
} as const

/** Swarmers per pack. Eight is enough to feel like a swarm and few enough that a bomb-less player can still
 *  cut through one with a well-placed stream. */
export const SWARM_SIZE = 8

/** How wide a pack is scattered when it arrives, in world units. Spread, so the pack does not spawn as one
 *  overlapping clump that reads as a single enemy until it fans out. */
export const SWARM_SPREAD = 7

export const SWARMER = {
  /** Radians per second the weave oscillates. Fast enough to look erratic, slow enough to be readable. */
  weaveRate: 5.5,
  /** Sideways speed of the weave, as a multiple of forward speed. At 1 the swarmer barely closes; well under
   *  that and it is a drifter with a wobble. */
  weaveScale: 0.55,
} as const

export const SNIPER = {
  /** The distance it tries to hold, in world units. Far enough that it is a shot you have to take
   *  deliberately, near enough that it is always on screen. */
  standoff: 34,
  /** Tolerance either side of the standoff, so it settles into a band rather than oscillating through it. */
  band: 5,
  /** Sideways drift while holding station, as a multiple of its speed. A sniper that sits perfectly still is
   *  a free target; one that strafes has to be led. */
  strafe: 0.8,
  /** Seconds between shots. */
  interval: 2.6,
  /**
   * Seconds of visible aiming before the shot leaves.
   *
   * The fairness budget for the whole enemy. It is the only thing in the game that can hit you from across
   * the arena, so you have to be told it is about to: during the telegraph it stops moving and brightens
   * (see `Enemies.tsx`). Shorter than about a third of a second and the tell is not actionable at all.
   */
  telegraph: 0.55,
  /** Units per second the shot travels. Slow — you should be able to see one coming and step aside, and even
   *  outrun one, because the ship does 42. */
  shotSpeed: 44,
  /** Seconds a shot lives. A little over one arena crossing at that speed. */
  shotLife: 3.4,
  shotRadius: 0.8,
} as const

export const WELL = {
  /**
   * Gravity, as an acceleration at one unit's distance. Applied with a floor on the
   * distance (see `wells.ts`) rather than true inverse-square, because true inverse-square
   * near a point sends anything that gets close to infinity — and a bullet flung across
   * the arena at 10,000 u/s is a tunnelling bug, not a physics feature.
   */
  gravity: 2600,
  /** Beyond this a well is ignored, so the arena does not have to sum every well against
   *  every entity when they are nowhere near each other. */
  reach: 34,
  /** Seconds between the drifters it spits out. */
  spawnInterval: 1.35,
  /** Radius of the shockwave when it collapses, and what that wave kills. */
  collapseRadius: 26,
} as const

export const GEOM = {
  radius: 1.1,
  /** How far away the ship starts pulling geoms in. Generous — chasing geoms is a
   *  distraction from the shooting, and the multiplier is supposed to reward killing
   *  things near you rather than a second job. */
  magnetRange: 22,
  magnetForce: 190,
  /** Units per second a geom leaves the kill at. */
  scatterSpeed: 16,
  /** Seconds before it fades out. */
  life: 9,
  /** Geoms per multiplier step. */
  perMultiplier: 4,
  maxMultiplier: 100,
} as const

// ---- scoring and waves ---------------------------------------------------------

export const SCORE = {
  startLives: 3,
  /** First extra life, and the gap to each one after it. Rising, so the tenth is real
   *  work — a flat interval means a good player accumulates lives forever and the game
   *  stops being able to end. */
  firstExtraLife: 75_000,
  extraLifeStep: 125_000,
  /** Bomb every this many points. */
  bombEvery: 100_000,
} as const

/**
 * Which mode a wave takes.
 *
 * One in three is a belt and one in five a singularity, checked in that order so wave 15
 * — which is both — is the singularity. The pattern is deliberately coarse: it should be
 * learnable, because "the wells are coming" is information worth having, and the music
 * announces it anyway.
 */
export function modeForWave(wave: number): WaveMode {
  if (wave <= 2) return 'swarm'
  if (wave % 5 === 0) return 'singularity'
  if (wave % 3 === 0) return 'belt'
  return 'swarm'
}

/**
 * Spawn budget for a wave, in spawn orders.
 *
 * Grows fast at first and then flattens, because past a point the arena is full and more
 * budget only means the wave lasts longer — which is not the same as being harder, and is
 * a lot more boring. Difficulty past there comes from the mix instead: weavers, snakes
 * and wells all arrive on schedules of their own.
 */
export function budgetForWave(wave: number): number {
  return Math.round(7 + 22 * (1 - Math.exp(-wave / 7)))
}

/** Seconds between spawn clusters, tightening with the wave and floored so that a late
 *  wave is dense rather than instantaneous. */
export function clusterIntervalForWave(wave: number): number {
  return Math.max(0.7, 2.4 - wave * 0.11)
}

/** How many orders go out per cluster. Clusters rather than a steady drip so that there
 *  are moments of pressure and moments to breathe inside a single wave. */
export function clusterSizeForWave(wave: number): number {
  return Math.min(6, 1 + Math.floor(wave / 3))
}

/** Seconds of quiet between waves. Long enough to see the banner and pick up the geoms
 *  you were too busy for; short enough that nobody uses it to go and make tea. */
export const WAVE_BREATH = 2.6

// ---- presentation hooks --------------------------------------------------------
//
// Numbers the simulation needs to know about even though they are only visible: how hard
// a thing shoves the fluid, how much it shakes the camera. They live here with the rest of
// the tuning because they are tuned together — a bomb that shakes hard and splats gently
// looks broken, and finding that out means changing both.

export const BLAST = {
  // A kill is the thing that happens most, so it sets the scale everything else is judged against — and the
  // first pass at these was far too timid. At 3.4 units and 0.6 strength a kill left a mark smaller than the
  // thing that died and put ninety particles on screen, which reads as a puff of dust rather than as
  // something being destroyed. The numbers below are roughly 1.5× the radius and 1.5× the strength, which
  // together with the particle count in `blasts.ts` is nearer 4× the visible event.
  killRadius: 5,
  killStrength: 0.9,
  rockRadius: 8.5,
  rockStrength: 1.5,
  bombRadius: 30,
  bombStrength: 2.6,
  wellRadius: 20,
  wellStrength: 2.2,
  // The one that stays small. A spawn is an announcement, not an explosion, and it has to be legible as
  // *different* from a kill — otherwise a busy wave looks like things dying that are in fact arriving.
  spawnRadius: 2.6,
  spawnStrength: 0.22,
  deathRadius: 18,
  deathStrength: 2.2,
} as const

export const SHAKE = {
  // Small per kill and it has to stay small: the ceiling in `shake.ts` is what stops thirty simultaneous
  // kills from making the arena unreadable, but a value that reaches the ceiling on its own would put every
  // busy moment there. This is a nudge that accumulates into a rumble.
  kill: 0.11,
  rock: 0.3,
  bomb: 1.5,
  well: 1.1,
  death: 1.4,
} as const

/**
 * Turn a per-second smoothing rate into a per-frame fraction.
 *
 * `pos += (target - pos) * rate * dt` is the shape every first draft uses and it is wrong
 * for the same reason everywhere: at 30fps it converges half as fast as at 60, so the ship
 * handles differently on a slower machine. The exponential form is frame-rate independent
 * and costs one `exp` per call.
 */
export function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

/** The longest frame the simulation will accept. A tab that has been in the background
 *  hands back a delta of seconds, and integrating that in one go teleports everything
 *  through everything else. Better to run slow for a frame than to tunnel. */
export const MAX_DT = 0.05
