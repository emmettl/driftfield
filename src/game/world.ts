import { SCORE, modeForWave } from './constants'
import { type Rng, mulberry32, randomSeed } from './rng'
import { freshSpawn } from './spawn'
import type { World } from './types'
import { vec } from './vec'

// Building a world, and starting a run in it.
//
// Separate from `step.ts` for the ordinary reason: the step is about a frame and this is
// about a lifetime. Both are pure of the DOM, so a test can build a world, drive it for a
// simulated minute and assert on where it ended up.

/** Every field, always. A world with an optional half is a world every reader has to
 *  defend against, and "the spawn state is missing during the attract screen" is exactly
 *  the sort of thing that turns into a crash three months later. */
export function freshWorld(seed: number = randomSeed()): World {
  const rng: Rng = mulberry32(seed)
  return {
    time: 0,
    // A world begins on the attract screen. The arena is populated and moving before
    // anybody presses anything — see `stepAttract`.
    status: 'menu',
    ship: {
      pos: vec(0, 0),
      vel: vec(0, 0),
      aim: 0,
      cooldown: 0,
      invulnerable: 0,
      present: false,
    },
    enemies: [],
    bullets: [],
    hostiles: [],
    geoms: [],

    wave: 1,
    waveMode: modeForWave(1),
    spawn: freshSpawn(1),
    pause: 0,

    score: 0,
    nextExtraLife: SCORE.firstExtraLife,
    multiplier: 1,
    geomsHeld: 0,
    lives: SCORE.startLives,
    bombs: 0,

    effects: { blasts: [], sounds: [], shake: 0 },
    rng,
    nextId: 1,
  }
}

/**
 * Start a run in an existing world.
 *
 * Mutating rather than returning a new world, and that is deliberate: the renderer holds a
 * reference to this object for the life of the page — every instanced mesh reads straight
 * out of these arrays — so handing back a replacement would mean every component having to
 * notice. The arrays are emptied in place for the same reason.
 *
 * The seed is *not* reset. A run should not replay the previous one, and a player pressing
 * start twice in a row getting the same wave both times would be the tell.
 */
export function startRun(world: World): void {
  world.enemies.length = 0
  world.bullets.length = 0
  world.hostiles.length = 0
  world.geoms.length = 0

  world.status = 'playing'
  world.time = 0
  world.wave = 1
  world.waveMode = modeForWave(1)
  world.spawn = freshSpawn(1)
  world.pause = 0

  world.score = 0
  world.nextExtraLife = SCORE.firstExtraLife
  world.multiplier = 1
  world.geomsHeld = 0
  world.lives = SCORE.startLives
  world.bombs = 0

  const ship = world.ship
  ship.pos.x = 0
  ship.pos.y = 0
  ship.vel.x = 0
  ship.vel.y = 0
  ship.aim = Math.PI / 2
  ship.cooldown = 0
  // A moment of grace on the way in, because wave 1 spawns while the banner is still up.
  ship.invulnerable = 1.4
  ship.present = true

  world.effects.blasts.length = 0
  world.effects.sounds.length = 0
  world.effects.shake = 0
}

/**
 * Put a finished world back on the attract screen.
 *
 * Called a few seconds after a game over. The arena is cleared rather than left as it was:
 * the last thing on screen when you died was the wave that killed you, and leaving it
 * frozen behind the title is a worse advertisement than an empty grid filling itself.
 */
export function returnToAttract(world: World): void {
  world.enemies.length = 0
  world.bullets.length = 0
  world.hostiles.length = 0
  world.geoms.length = 0
  world.status = 'menu'
  world.ship.present = false
  world.wave = 1
  world.waveMode = modeForWave(1)
  world.spawn = freshSpawn(1)
  world.pause = 0
}
