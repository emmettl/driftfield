import type { Vec2 } from './vec'

// The world, as data.
//
// Everything in here is a plain mutable object, and the step function in `step.ts` moves
// it forward. That is a deliberate choice against the more React-shaped alternative of
// keeping entities in the store: at the top of a bad wave there are a couple of hundred
// enemies, six hundred particles' worth of bullets and geoms, and all of it changes every
// frame. Publishing that through zustand would re-render the tree sixty times a second to
// tell it things no component reads — the components read the same arrays directly and
// write matrices into instanced meshes.
//
// What the UI does read goes through the store, and only when it changes. See `hud.ts`.

export type GameStatus =
  /** Attract screen. The world is running — the arena is populated and drifting — but
   *  the ship is not in it and nothing can be scored. */
  | 'menu'
  | 'playing'
  /** Ship destroyed, lives remaining. A short beat before it comes back. */
  | 'respawning'
  /** Between waves. Everything still animates; nothing spawns. */
  | 'wave-clear'
  | 'gameover'

/**
 * The enemy roster.
 *
 * Eight kinds, each of which answers a different question about how you are moving. A shooter with one enemy
 * is a shooting gallery; the interest is entirely in the mix, so every kind here has a distinct steering rule
 * rather than a distinct sprite. See `enemies.ts` — the rules are one function each, and each is tested.
 *
 * The set is deliberately spread across the axes a player can respond to: things that chase (drifter, weaver,
 * swarmer), things that do not care about you at all (wanderer, rock), a thing that commits to a path
 * (snake), a thing that changes the shape of the space (well), and a thing that makes you move rather than
 * making you shoot (sniper).
 */
export type EnemyKind =
  /** Homes straight at you, slowly, in numbers. The bread and butter. */
  | 'drifter'
  /** Ignores you entirely, bouncing off the walls on a fixed heading. Free points, if
   *  you can be bothered to go and get them. */
  | 'wanderer'
  /** Homes at you, but sidesteps a bullet that is about to arrive. Punishes spraying. */
  | 'weaver'
  /** A head that homes, with a tail that follows the path it took. Kill the head and the
   *  whole chain goes with it. */
  | 'snake'
  /** Asteroid. Big, slow, tumbling, and splits into two smaller ones when shot. */
  | 'rock'
  /** A gravity well. Pulls everything — you, bullets, geoms, the grid itself — and spits
   *  out drifters until enough fire has gone into it to make it collapse. */
  | 'well'
  /** Tiny, fast, and never arrives alone — a pack of eight that weave rather than tracking, so they arrive
   *  spread out and from slightly different angles. The answer to a player who has learned to hold one
   *  corner and shoot down a corridor. */
  | 'swarmer'
  /** The only thing in the arena that shoots back. Holds its distance, telegraphs, and fires an aimed shot
   *  you have to actually move out of the way of. */
  | 'sniper'

export interface Enemy {
  id: number
  kind: EnemyKind
  pos: Vec2
  vel: Vec2
  /** Collision radius, and what the outline is drawn at. One number for both, so what
   *  you see is genuinely what you can hit. */
  radius: number
  hp: number
  /** Drawn rotation, in radians. Purely cosmetic; nothing collides against a corner. */
  angle: number
  spin: number
  /** Seconds since it appeared. Below `SPAWN_GRACE` it is still materialising: it cannot
   *  be shot and cannot kill you. Without that, a wave that spawns behind you is a death
   *  you could not have avoided, which is the fastest way to make a shooter feel unfair. */
  age: number
  alive: boolean
  /** Rock size class: 2 big, 1 medium, 0 small. A small rock leaves nothing behind. */
  tier: number
  /** Snake only: how far down the chain this segment is. The head is 0. */
  segment: number
  /** Snake only: the segment this one follows. The head follows nothing. */
  follows: number
  /** Well only: fire absorbed so far, against `WELL_HP`. */
  charge: number
  /** Seconds until this enemy does the thing it does on a timer: a well spitting a drifter, a sniper
   *  firing. Shared because they are the same mechanism, and an enemy with two timers would need two. */
  spawnTimer: number
  /** Weaver only: which way it is currently sidestepping, -1 or 1. */
  dodge: number
  /**
   * A per-enemy constant offset, in radians.
   *
   * The swarmer's weave is a sine of time plus this, which is the whole reason a pack reads as a swarm: eight
   * enemies homing on the same point with the same weave travel as one thick line, and eight with different
   * phases spread into a cloud that arrives from several angles at once.
   */
  phase: number
}

/**
 * A shot fired at the player.
 *
 * Deliberately its own type rather than a flag on `Bullet`: the two have nothing in common but a position.
 * A player bullet is fast, short-lived, and tested against every enemy; a hostile shot is slow, long-lived,
 * and tested against exactly one thing. Sharing a list would mean every collision check asking whose it was.
 *
 * Not destructible, and that is a decision. A slow projectile you could simply shoot down is not a threat —
 * it becomes another target, and the sniper stops being the enemy that makes you move. So instead it is slow
 * enough to dodge on sight and telegraphed before it is fired.
 */
export interface Hostile {
  id: number
  pos: Vec2
  vel: Vec2
  life: number
  alive: boolean
}

export interface Bullet {
  id: number
  pos: Vec2
  vel: Vec2
  /** Seconds left before it expires. Bullets die of old age rather than at the wall, so
   *  that a shot fired into a corner does not vanish where the wall is off-screen. */
  life: number
  alive: boolean
}

/** A geom. Dropped by everything that dies, and the only thing that moves the multiplier.
 *  Drifts outward, slows, then homes at the ship once it is close enough to notice. */
export interface Geom {
  id: number
  pos: Vec2
  vel: Vec2
  /** Seconds since it was dropped. Geoms expire, so a wave you refuse to collect from
   *  does not leave the arena knee-deep in them for the rest of the run. */
  age: number
  alive: boolean
}

export interface Ship {
  pos: Vec2
  vel: Vec2
  /** Facing, in radians. Independent of travel — this is a twin-stick, so you can run
   *  one way and shoot another, and that is the whole game. */
  aim: number
  /** Seconds until the next shot is allowed. */
  cooldown: number
  /** Seconds of post-respawn invulnerability left. */
  invulnerable: number
  /** Whether the ship is in the arena at all. False on the attract screen and in the beat
   *  after a death. */
  present: boolean
}

/**
 * A detonation, as the presentation layer needs to hear about it.
 *
 * The step does not draw anything and does not own a renderer, so the only way an
 * explosion reaches the fluid simulation, the particles and the audio is as a value on
 * this list. It is drained once a frame by `GameLoop`, which turns each entry into a
 * velocity splat, a dye splat, a particle burst and possibly a sound.
 *
 * Being a value rather than a callback is what makes the interesting assertions possible:
 * a test can shoot a rock and check that three blasts came out of it at the right places
 * without a WebGL context anywhere in sight.
 */
export interface Blast {
  x: number
  y: number
  /** World units. Drives the splat radius, so it is the size of the *mark*, not of the
   *  thing that made it. */
  radius: number
  /** 0..1-ish. How hard the fluid is pushed and how bright the dye lands. */
  strength: number
  /** Dye colour, as a hue in turns (0..1). Kills are tinted by what died, which is what
   *  makes the smoke over a busy arena read as a record of the last few seconds. */
  hue: number
}

/** One-shot sounds. Named for what happened rather than for what it sounds like, so the
 *  synthesis in `audio.ts` can be changed without touching the simulation. */
export type SoundCue =
  | 'shoot'
  | 'kill'
  | 'rockBreak'
  | 'pickup'
  | 'multiplierUp'
  | 'bomb'
  | 'wellBurst'
  | 'wellCollapse'
  | 'spawn'
  | 'snipe'
  | 'death'
  | 'extraLife'
  | 'waveClear'
  | 'gameOver'

/** What one step produced, beyond moving things. Cleared by the consumer, not by the
 *  step — a test drives several steps and then looks at the accumulated result. */
export interface Effects {
  blasts: Blast[]
  sounds: SoundCue[]
  /** Camera shake to add, in the same arbitrary units `shake.ts` uses. Summed rather
   *  than assigned, so two things happening at once shake harder than one. */
  shake: number
}

/** Which shape a wave takes. Drives both the spawn mix and — through `musicCue.ts` — the
 *  soundtrack, which is why it is a mode rather than a difficulty number. */
export type WaveMode = 'swarm' | 'belt' | 'singularity'

export interface SpawnState {
  /** Enemies this wave still owes. Counted in *spawn units*, not bodies: a snake is one
   *  order and arrives as seven segments. */
  budget: number
  /** Seconds until the next cluster. */
  timer: number
}

export interface World {
  /** Seconds since the run began. Used for anything that needs a phase rather than a
   *  delta — the wander of the attract screen, the pulse on a well. */
  time: number
  status: GameStatus
  ship: Ship
  enemies: Enemy[]
  bullets: Bullet[]
  /** Shots fired at the player. See `Hostile`. */
  hostiles: Hostile[]
  geoms: Geom[]

  wave: number
  waveMode: WaveMode
  spawn: SpawnState
  /** Seconds left of the between-waves breath, or of the respawn pause. One timer for
   *  both because they are the same thing from the world's point of view: a beat in which
   *  nothing spawns and the player is not in control. */
  pause: number

  score: number
  /** Score at which the next extra life is awarded. Raised each time one is. */
  nextExtraLife: number
  multiplier: number
  /** Geoms collected towards the next multiplier step. */
  geomsHeld: number
  lives: number
  bombs: number

  effects: Effects
  /** How the world decides what is random. Seeded per run — see `rng.ts`. */
  rng: () => number
  /** Ids are handed out from here. Monotonic for the life of the world so that a
   *  snake's `follows` reference can never point at a segment that was recycled. */
  nextId: number
}
