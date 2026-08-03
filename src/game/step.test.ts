import { describe, expect, it } from 'vitest'
import {
  ARENA,
  BOMB,
  BULLET,
  ENEMY,
  GEOM,
  SHIP,
  SNIPER,
  SPAWN_GRACE,
  SWARM_SIZE,
  WAVE_BREATH,
  WELL,
} from './constants'
import { makeDrifter, makeRock, makeSnake, makeSniper, makeSwarm, makeWell } from './enemies'
import { IDLE_INTENT, type Intent, clearEffects, stepAttract, stepWorld } from './step'
import type { Enemy, SoundCue, World } from './types'
import { getWorld, useGameStore } from './useGameStore'
import { vec } from './vec'
import { freshWorld, startRun } from './world'

// The simulation's tests.
//
// Every one of these is a question about the game that would otherwise be answered by playing it for
// twenty minutes and hoping: does a bomb pay the multiplier, does a wave end while a well is alive, does
// dying cost you the run's work. None of it touches WebGL, the DOM or an AudioContext, so the whole file
// runs in a few milliseconds.

/**
 * A world set up for an experiment: a run in progress, the player mortal, and the spawn director asleep.
 *
 * The director is stopped by giving it budget it will never get to spend rather than by zeroing it — a
 * wave with no budget left and an empty arena immediately declares itself clear, which would move the
 * status out from under every test that then tries to shoot something.
 */
function testWorld(seed = 1): World {
  const world = freshWorld(seed)
  startRun(world)
  world.ship.invulnerable = 0
  world.spawn.budget = 99
  world.spawn.timer = Number.POSITIVE_INFINITY
  return world
}

/** Step for a stretch of simulated time at a plausible frame rate. */
function run(world: World, seconds: number, intent: Intent = IDLE_INTENT): void {
  const step = 1 / 60
  for (let elapsed = 0; elapsed < seconds; elapsed += step) stepWorld(world, intent, step)
}

function intent(overrides: Partial<Intent> = {}): Intent {
  return { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, firing: false, bomb: false, ...overrides }
}

/** An enemy that has finished materialising, so it can be shot and can kill. */
function ready(enemy: Enemy): Enemy {
  enemy.age = SPAWN_GRACE
  return enemy
}

function sounds(world: World): SoundCue[] {
  return [...world.effects.sounds]
}

describe('the gun', () => {
  it('fires a pair, centred on the aim', () => {
    const world = testWorld()
    stepWorld(world, intent({ firing: true, aim: { x: 0, y: 1 } }), 1 / 60)

    expect(world.bullets).toHaveLength(BULLET.perShot)
    const angles = world.bullets.map((bullet) => Math.atan2(bullet.vel.y, bullet.vel.x))
    // Symmetric about straight up: the centre of the pair is exactly where the reticle is.
    expect((angles[0] + angles[1]) / 2).toBeCloseTo(Math.PI / 2, 4)
    expect(sounds(world)).toContain('shoot')
  })

  it('respects the fire interval', () => {
    const world = testWorld()
    const firing = intent({ firing: true })
    // Half an interval's worth of frames — one volley's worth of bullets, not two.
    run(world, SHIP.fireInterval * 0.5, firing)
    expect(world.bullets).toHaveLength(BULLET.perShot)
    run(world, SHIP.fireInterval, firing)
    expect(world.bullets.length).toBeGreaterThan(BULLET.perShot)
  })

  it('does not fire between waves', () => {
    const world = testWorld()
    world.status = 'wave-clear'
    world.pause = 5
    stepWorld(world, intent({ firing: true }), 1 / 60)
    expect(world.bullets).toHaveLength(0)
  })

  it('gives a bullet some of the momentum of the ship that fired it', () => {
    const world = testWorld()
    world.ship.vel = vec(0, 40)
    stepWorld(world, intent({ firing: true, aim: { x: 1, y: 0 } }), 1 / 60)
    expect(world.bullets[0].vel.y).toBeGreaterThan(0)
  })
})

describe('shooting things', () => {
  it('kills a drifter, scores it, and drops a geom', () => {
    const world = testWorld()
    const drifter = ready(makeDrifter(world.nextId++, 20, 0, { x: 0, y: 0 }, world.rng))
    drifter.vel = vec(0, 0)
    world.enemies.push(drifter)
    world.bullets.push({ id: 1, pos: vec(20, 0), vel: vec(1, 0), life: 1, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.enemies).toHaveLength(0)
    expect(world.bullets).toHaveLength(0)
    expect(world.score).toBe(ENEMY.drifter.score)
    expect(world.geoms).toHaveLength(ENEMY.drifter.geoms)
    expect(sounds(world)).toContain('kill')
    // The blast is how the fluid, the particles and the shake all hear about it.
    expect(world.effects.blasts).toHaveLength(1)
    expect(world.effects.blasts[0].hue).toBe(ENEMY.drifter.hue)
    expect(world.effects.shake).toBeGreaterThan(0)
  })

  it('cannot hit something that is still materialising', () => {
    // The grace window is load-bearing: enemies spawn away from the ship but the ship moves at 42 u/s, so
    // without it a wave that appears behind you is a death you could not have avoided.
    const world = testWorld()
    const drifter = makeDrifter(world.nextId++, 20, 0, { x: 0, y: 0 }, world.rng)
    drifter.age = 0
    drifter.vel = vec(0, 0)
    world.enemies.push(drifter)
    world.bullets.push({ id: 1, pos: vec(20, 0), vel: vec(1, 0), life: 1, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(world.enemies).toHaveLength(1)
    expect(world.score).toBe(0)
  })

  it('breaks a rock into two faster ones that are dangerous immediately', () => {
    const world = testWorld()
    const rock = ready(makeRock(world.nextId++, 0, 20, 2, world.rng))
    world.enemies.push(rock)
    world.bullets.push({ id: 1, pos: vec(0, 20), vel: vec(0, 1), life: 1, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.enemies).toHaveLength(2)
    expect(world.enemies.every((enemy) => enemy.tier === 1)).toBe(true)
    // No free half-second after breaking one open.
    expect(world.enemies.every((enemy) => enemy.age >= SPAWN_GRACE)).toBe(true)
    expect(sounds(world)).toContain('rockBreak')
  })

  it('kills a whole snake when the head goes', () => {
    const world = testWorld()
    const segments = makeSnake(() => world.nextId++, 0, 20, world.rng)
    for (const segment of segments) world.enemies.push(ready(segment))
    world.bullets.push({ id: 1, pos: vec(0, 20), vel: vec(0, 1), life: 1, alive: true })

    // The head dies in the collision phase, which is after the steering phase — so the tail notices on
    // the next frame, and the whole chain unravels within it.
    stepWorld(world, IDLE_INTENT, 1 / 240)
    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.enemies).toHaveLength(0)
    // A snake is one enemy occupying seven places, and killing it pays for all of them.
    expect(world.score).toBe(ENEMY.snake.score * segments.length)
  })
})

describe('dying', () => {
  it('costs a life, the multiplier, and the whole arena', () => {
    const world = testWorld()
    world.multiplier = 24
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))
    world.enemies.push(ready(makeRock(world.nextId++, 30, 0, 2, world.rng)))
    world.bullets.push({ id: 1, pos: vec(40, 40), vel: vec(1, 0), life: 1, alive: true })
    const before = world.score

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.status).toBe('respawning')
    expect(world.lives).toBe(2)
    expect(world.multiplier).toBe(1)
    expect(world.ship.present).toBe(false)
    expect(world.enemies).toHaveLength(0)
    expect(world.bullets).toHaveLength(0)
    // Dying is not a play: the arena clearing pays nothing and drops nothing.
    expect(world.score).toBe(before)
    expect(world.geoms).toHaveLength(0)
    expect(sounds(world)).toContain('death')
  })

  it('brings the ship back, briefly invulnerable', () => {
    const world = testWorld()
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))
    stepWorld(world, IDLE_INTENT, 1 / 240)

    run(world, SHIP.deathPause + 0.1)

    expect(world.status).toBe('playing')
    expect(world.ship.present).toBe(true)
    expect(world.ship.invulnerable).toBeGreaterThan(0)
    expect(world.ship.pos).toEqual({ x: 0, y: 0 })
  })

  it('clears a path on the way in rather than dying again', () => {
    // Invulnerable is not intangible. Respawning into a crowd has to be survivable, or the two seconds
    // of grace are just a wait for the same death.
    const world = testWorld()
    world.ship.invulnerable = 1
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.status).toBe('playing')
    expect(world.lives).toBe(3)
    expect(world.enemies).toHaveLength(0)
    expect(world.score).toBe(ENEMY.drifter.score)
  })

  it('does not let a death that empties the arena become a wave clear', () => {
    // The bug, and it made the game unplayable rather than merely wrong.
    //
    // `live` was captured at the top of the frame. Dying mid-frame set the status to 'respawning' and
    // cleared the arena — and then the end-of-wave check at the bottom of the same frame, still holding the
    // stale `live === true`, saw an empty arena with a spent budget and overwrote the status with
    // 'wave-clear'. So `respawnShip` never ran: the wave-clear timer expired, the next wave began, and the
    // ship simply never came back. With no ship there are no collisions, so nothing could kill the player
    // and the run could never end — the exact "the ship disappears and there is nothing you can do" state.
    const world = testWorld()
    world.spawn.budget = 0
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))

    stepWorld(world, IDLE_INTENT, 1 / 240)
    // The death has to survive the rest of its own frame.
    expect(world.status).toBe('respawning')

    // The wave really is over — budget spent, arena empty — so a wave clear afterwards is correct. What
    // matters is that the ship comes back either way.
    run(world, SHIP.deathPause + WAVE_BREATH + 0.5)
    expect(world.ship.present).toBe(true)
    expect(world.lives).toBe(2)
    expect(world.status).not.toBe('respawning')
    expect(world.status).not.toBe('gameover')
  })

  it('does not let a death on the last ship become a wave clear either', () => {
    // The same stale flag also overwrote 'gameover', so the run carried on with no ship and no way to end.
    const world = testWorld()
    world.lives = 1
    world.spawn.budget = 0
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))

    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(world.status).toBe('gameover')

    run(world, 10)
    expect(world.status).toBe('gameover')
  })

  it('ends the run on the last ship', () => {
    const world = testWorld()
    world.lives = 1
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))
    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.status).toBe('gameover')
    expect(sounds(world)).toContain('gameOver')

    // And it stays over: no timer brings the ship back.
    run(world, 10)
    expect(world.status).toBe('gameover')
    expect(world.ship.present).toBe(false)
  })
})

describe('the wave', () => {
  it('ends when the budget is spent and the arena is empty', () => {
    const world = testWorld()
    world.spawn.budget = 0
    stepWorld(world, IDLE_INTENT, 1 / 60)

    expect(world.status).toBe('wave-clear')
    expect(world.pause).toBeCloseTo(WAVE_BREATH)
    expect(sounds(world)).toContain('waveClear')
  })

  it('does not end while anything is still alive', () => {
    const world = testWorld()
    world.spawn.budget = 0
    world.enemies.push(ready(makeWell(world.nextId++, 30, 0, world.rng)))
    run(world, 1)
    // A well that is ignored keeps the wave open, which is the whole reason it is worth 1500 points.
    expect(world.status).toBe('playing')
  })

  it('moves on to the next wave after the breath', () => {
    const world = testWorld()
    world.spawn.budget = 0
    stepWorld(world, IDLE_INTENT, 1 / 60)
    run(world, WAVE_BREATH + 0.1)

    expect(world.status).toBe('playing')
    expect(world.wave).toBe(2)
    expect(world.spawn.budget).toBeGreaterThan(0)
  })

  it('reaches a belt wave and then a singularity wave, in that order', () => {
    const world = testWorld()
    const modes: string[] = []
    for (let wave = 1; wave <= 5; wave++) {
      world.spawn.budget = 0
      world.enemies.length = 0
      stepWorld(world, IDLE_INTENT, 1 / 60)
      run(world, WAVE_BREATH + 0.1)
      modes.push(world.waveMode)
    }
    expect(modes).toEqual(['swarm', 'belt', 'swarm', 'singularity', 'belt'])
  })

  it('spawns away from the ship when the director is awake', () => {
    const world = testWorld()
    world.spawn.timer = 0
    world.ship.pos = vec(-40, -20)
    stepWorld(world, IDLE_INTENT, 1 / 60)

    expect(world.enemies.length).toBeGreaterThan(0)
    for (const enemy of world.enemies) {
      expect(Math.hypot(enemy.pos.x + 40, enemy.pos.y + 20)).toBeGreaterThan(20)
      // And every one of them arrives intangible.
      expect(enemy.age).toBeLessThan(SPAWN_GRACE)
    }
  })
})

describe('the bomb', () => {
  it('clears the arena, pays out, and drops nothing', () => {
    const world = testWorld()
    world.bombs = 2
    world.multiplier = 5
    for (let i = 0; i < 6; i++) {
      world.enemies.push(ready(makeDrifter(world.nextId++, i * 6 - 20, 12, { x: 0, y: 0 }, world.rng)))
    }

    stepWorld(world, intent({ bomb: true }), 1 / 240)

    expect(world.enemies).toHaveLength(0)
    expect(world.bombs).toBe(1)
    expect(world.score).toBe(ENEMY.drifter.score * 5 * 6)
    // No geoms: otherwise the best way to build a multiplier is to hoard bombs and never learn to move.
    expect(world.geoms).toHaveLength(0)
    expect(world.ship.invulnerable).toBeCloseTo(BOMB.invulnerable)
    expect(sounds(world)).toContain('bomb')
  })

  it('does nothing without one in stock', () => {
    const world = testWorld()
    world.bombs = 0
    world.enemies.push(ready(makeDrifter(world.nextId++, 20, 12, { x: 0, y: 0 }, world.rng)))
    stepWorld(world, intent({ bomb: true }), 1 / 240)
    expect(world.enemies).toHaveLength(1)
    expect(world.bombs).toBe(0)
  })
})

describe('geoms', () => {
  it('steps the multiplier on the fourth', () => {
    const world = testWorld()
    for (let i = 0; i < GEOM.perMultiplier; i++) {
      world.geoms.push({ id: world.nextId++, pos: vec(0, 0), vel: vec(0, 0), age: 0, alive: true })
    }
    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.geoms).toHaveLength(0)
    expect(world.multiplier).toBe(2)
    expect(sounds(world)).toContain('multiplierUp')
  })

  it('pulls a nearby geom in', () => {
    const world = testWorld()
    const geom = { id: 1, pos: vec(GEOM.magnetRange - 2, 0), vel: vec(0, 0), age: 0, alive: true }
    world.geoms.push(geom)
    run(world, 0.5)
    expect(world.geoms.length === 0 || geom.pos.x < GEOM.magnetRange - 2).toBe(true)
  })

  it('leaves a geom well outside the magnet alone', () => {
    const world = testWorld()
    const geom = { id: 1, pos: vec(GEOM.magnetRange + 12, 0), vel: vec(0, 0), age: 0, alive: true }
    world.geoms.push(geom)
    stepWorld(world, IDLE_INTENT, 1 / 60)
    expect(geom.pos.x).toBeCloseTo(GEOM.magnetRange + 12)
  })

  it('expires rather than piling up forever', () => {
    const world = testWorld()
    world.geoms.push({ id: 1, pos: vec(50, 30), vel: vec(0, 0), age: 0, alive: true })
    run(world, GEOM.life + 0.2)
    expect(world.geoms).toHaveLength(0)
    expect(world.multiplier).toBe(1)
  })
})

describe('gravity wells', () => {
  it('absorbs fire and collapses when it has had enough', () => {
    const world = testWorld()
    const well = ready(makeWell(world.nextId++, 0, 20, world.rng))
    well.vel = vec(0, 0)
    well.charge = well.hp - 1
    world.enemies.push(well)
    // Something else nearby to be taken with it.
    world.enemies.push(ready(makeDrifter(world.nextId++, 6, 20, { x: 0, y: 0 }, world.rng)))
    world.bullets.push({ id: 1, pos: vec(0, 20), vel: vec(0, 1), life: 1, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.enemies).toHaveLength(0)
    expect(world.score).toBe(ENEMY.well.score + ENEMY.drifter.score)
    expect(sounds(world)).toContain('wellCollapse')
    expect(world.geoms.length).toBeGreaterThanOrEqual(ENEMY.well.geoms)
  })

  it('takes many hits before it goes', () => {
    const world = testWorld()
    const well = ready(makeWell(world.nextId++, 0, 20, world.rng))
    well.vel = vec(0, 0)
    world.enemies.push(well)
    world.bullets.push({ id: 1, pos: vec(0, 20), vel: vec(0, 1), life: 1, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(world.enemies).toHaveLength(1)
    expect(well.charge).toBe(1)
    expect(world.score).toBe(0)
  })

  it('bends a bullet that passes it', () => {
    // The best thing about having gravity in the game: a well between you and your target is a shot you
    // have to aim around, and the curve is visible.
    const world = testWorld()
    const well = ready(makeWell(world.nextId++, 0, 10, world.rng))
    well.vel = vec(0, 0)
    world.enemies.push(well)
    const bullet = { id: 1, pos: vec(-30, 0), vel: vec(BULLET.speed, 0), life: 1, alive: true }
    world.bullets.push(bullet)

    run(world, 0.2)
    expect(bullet.vel.y).toBeGreaterThan(1)
  })

  it('spits drifters, on the far side from the ship', () => {
    const world = testWorld()
    const well = ready(makeWell(world.nextId++, 20, 0, world.rng))
    well.vel = vec(0, 0)
    world.enemies.push(well)

    run(world, WELL.spawnInterval + 0.1)

    const drifters = world.enemies.filter((enemy) => enemy.kind === 'drifter')
    expect(drifters.length).toBeGreaterThan(0)
    // The ship is at the origin, so the far side is further out in x.
    expect(drifters[0].pos.x).toBeGreaterThan(20)
  })

  it('does not pull other wells, which would defeat the spawn cap', () => {
    const world = testWorld()
    const a = ready(makeWell(world.nextId++, -10, 0, world.rng))
    const b = ready(makeWell(world.nextId++, 10, 0, world.rng))
    a.vel = vec(0, 0)
    b.vel = vec(0, 0)
    world.enemies.push(a, b)

    run(world, 1)

    // Two wells that attracted each other would merge within a second and behave as one very strong
    // well, which is exactly what `wellLimit` exists to prevent.
    expect(Math.abs(a.pos.x - b.pos.x)).toBeGreaterThan(15)
  })
})

describe('snipers', () => {
  function placedSniper(world: World, x: number, y: number): Enemy {
    const sniper = ready(makeSniper(world.nextId++, x, y, world.rng))
    world.enemies.push(sniper)
    return sniper
  }

  it('fires a round at the ship when its timer runs out', () => {
    const world = testWorld()
    const sniper = placedSniper(world, SNIPER.standoff, 0)
    sniper.spawnTimer = 0.01

    run(world, 0.1)

    expect(world.hostiles.length).toBe(1)
    const shot = world.hostiles[0]
    // Aimed at where the ship is, which is the origin, so the round travels in -x.
    expect(shot.vel.x).toBeLessThan(0)
    expect(Math.abs(shot.vel.y)).toBeLessThan(1)
    expect(sounds(world)).toContain('snipe')
  })

  it('aims at where the ship is rather than leading it', () => {
    // A leading shot from something that already outranges you cannot be dodged by moving — moving is what
    // makes it land — so the counter to a sniper is "keep moving", which is what the whole game teaches.
    const world = testWorld()
    world.ship.pos = vec(0, 0)
    world.ship.vel = vec(40, 0)
    const sniper = placedSniper(world, 0, SNIPER.standoff)
    sniper.spawnTimer = 0.01

    run(world, 0.05)
    expect(world.hostiles).toHaveLength(1)
    // Straight down at the ship's position, with no sideways lead for its 40 u/s of travel.
    expect(Math.abs(world.hostiles[0].vel.x)).toBeLessThan(1)
  })

  it('kills the ship if the round lands', () => {
    const world = testWorld()
    world.hostiles.push({ id: 1, pos: vec(0, 0), vel: vec(0, 0), life: 2, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.status).toBe('respawning')
    expect(world.lives).toBe(2)
    expect(world.hostiles).toHaveLength(0)
  })

  it('is stopped by invulnerability without killing the ship', () => {
    const world = testWorld()
    world.ship.invulnerable = 1
    world.hostiles.push({ id: 1, pos: vec(0, 0), vel: vec(0, 0), life: 2, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)

    expect(world.status).toBe('playing')
    expect(world.lives).toBe(3)
    // Absorbed rather than passing through: a round that survived the shield would hit the moment it expired.
    expect(world.hostiles).toHaveLength(0)
  })

  it('takes two hits to kill, and the first one pays nothing', () => {
    const world = testWorld()
    const sniper = placedSniper(world, 0, 25)
    sniper.vel = vec(0, 0)
    world.bullets.push({ id: 1, pos: vec(0, 25), vel: vec(0, 1), life: 1, alive: true })

    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(world.enemies).toHaveLength(1)
    expect(sniper.hp).toBe(1)
    expect(world.score).toBe(0)

    world.bullets.push({ id: 2, pos: vec(0, 25), vel: vec(0, 1), life: 1, alive: true })
    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(world.enemies).toHaveLength(0)
    expect(world.score).toBe(ENEMY.sniper.score)
  })

  it('has its rounds cleared by a bomb and by a death', () => {
    // A round outliving the ship it was aimed at would still be travelling when the next one respawns in the
    // middle of the arena — a death from a gun that no longer exists.
    const bombed = testWorld()
    bombed.bombs = 1
    bombed.hostiles.push({ id: 1, pos: vec(30, 20), vel: vec(0, -10), life: 3, alive: true })
    stepWorld(bombed, intent({ bomb: true }), 1 / 240)
    expect(bombed.hostiles).toHaveLength(0)

    const died = testWorld()
    died.hostiles.push({ id: 1, pos: vec(30, 20), vel: vec(0, -10), life: 3, alive: true })
    died.enemies.push(ready(makeDrifter(died.nextId++, 0, 0, { x: 0, y: 0 }, died.rng)))
    stepWorld(died, IDLE_INTENT, 1 / 240)
    expect(died.status).toBe('respawning')
    expect(died.hostiles).toHaveLength(0)
  })

  it('expires its rounds at the wall rather than letting them lurk outside it', () => {
    const world = testWorld()
    world.hostiles.push({
      id: 1,
      pos: vec(ARENA.halfWidth - 1, 0),
      vel: vec(SNIPER.shotSpeed, 0),
      life: 5,
      alive: true,
    })
    run(world, 0.6)
    expect(world.hostiles).toHaveLength(0)
  })

  it('does not fire while the ship is away', () => {
    const world = testWorld()
    world.status = 'respawning'
    world.pause = 5
    world.ship.present = false
    const sniper = placedSniper(world, SNIPER.standoff, 0)
    sniper.spawnTimer = 0.01

    run(world, 0.5)
    expect(world.hostiles).toHaveLength(0)
  })
})

describe('swarms', () => {
  it('arrive as a pack and all count towards the wave', () => {
    const world = testWorld()
    for (const member of makeSwarm(() => world.nextId++, 20, 10, world.rng)) {
      world.enemies.push(ready(member))
    }
    expect(world.enemies.filter((e) => e.kind === 'swarmer')).toHaveLength(SWARM_SIZE)

    // Each is worth little on its own, which is the bargain: the pack is the enemy.
    world.bullets.push({
      id: 1,
      pos: { ...world.enemies[0].pos },
      vel: vec(0.1, 0),
      life: 1,
      alive: true,
    })
    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(world.score).toBe(ENEMY.swarmer.score)
  })
})

describe('robustness', () => {
  it('is deterministic for a given seed', () => {
    // Ten seconds of a real run, with the ship left immortal so the trace does not simply end in a game
    // over — the interesting thing to compare is a wave's worth of spawn placement, kills and geoms, and
    // a run that dies early compares almost nothing.
    const play = (seed: number) => {
      const world = freshWorld(seed)
      startRun(world)
      world.ship.invulnerable = Number.POSITIVE_INFINITY
      const step = 1 / 60
      for (let frame = 0; frame < 600; frame++) {
        const t = frame * step
        stepWorld(
          world,
          {
            move: { x: Math.cos(t * 1.3), y: Math.sin(t * 0.7) },
            aim: { x: Math.cos(t * 2), y: Math.sin(t * 2) },
            firing: true,
            bomb: false,
          },
          step,
        )
      }
      return {
        score: world.score,
        wave: world.wave,
        enemies: world.enemies.length,
        // Positions too, rounded: two runs can arrive at the same score by different routes, and the
        // property being tested is that the whole world is reproducible rather than just the scoreboard.
        places: world.enemies.map((enemy) => `${enemy.kind}:${Math.round(enemy.pos.x)}`).join(),
      }
    }

    expect(play(777)).toEqual(play(777))
    expect(play(777)).not.toEqual(play(778))
  })

  it('clamps a huge frame rather than tunnelling', () => {
    // A tab returning from the background hands over a delta measured in seconds. Integrating that in one
    // go teleports everything through everything else.
    const world = testWorld()
    stepWorld(world, intent({ move: { x: 1, y: 0 } }), 30)
    expect(Math.abs(world.ship.pos.x)).toBeLessThan(SHIP.speed * 0.06)
    expect(world.time).toBeLessThan(0.06)
  })

  it('ignores a zero or negative frame', () => {
    const world = testWorld()
    const before = world.time
    stepWorld(world, IDLE_INTENT, 0)
    stepWorld(world, IDLE_INTENT, -1)
    expect(world.time).toBe(before)
  })

  it('holds the ship inside the walls and does not bank speed against them', () => {
    const world = testWorld()
    run(world, 5, intent({ move: { x: 1, y: 1 } }))
    expect(world.ship.vel.x).toBe(0)
    expect(world.ship.vel.y).toBe(0)

    // ...and letting go does not fire it back across the arena.
    const parked = { ...world.ship.pos }
    run(world, 0.2)
    expect(Math.abs(world.ship.pos.x - parked.x)).toBeLessThan(0.5)
  })
})

describe('a whole run, left alone', () => {
  it('reaches a game over and stays there', () => {
    // The report this exists for: "it is possible to get into a state where the ship disappears and there's
    // nothing you can do" and "the game over state not kicking in". Both were the same bug — see the two
    // regression tests in `dying` — and both are the sort of thing unit tests around the edges can miss, so
    // this plays a real run from `startRun` with nobody at the controls and insists that it ends.
    const world = freshWorld(31)
    startRun(world)

    let frames = 0
    // Two minutes of simulated time is far longer than three lives survive with no input at all.
    while (world.status !== 'gameover' && frames < 60 * 120) {
      stepWorld(world, IDLE_INTENT, 1 / 60)
      clearEffects(world)
      frames++

      // At no point may the game be in a state the player could not act in: a playable status always has a
      // ship in the arena. This is the invariant the bug violated, and checking it every frame is the point.
      if (world.status === 'playing') expect(world.ship.present).toBe(true)
    }

    expect(world.status).toBe('gameover')
    expect(world.lives).toBe(0)

    // ...and it stays over. The bug let the wave machinery carry on past a game over.
    run(world, 30)
    expect(world.status).toBe('gameover')
    expect(world.ship.present).toBe(false)
  })

  it('survives a long run with a player who does fight back', () => {
    // The other half: a run that does *not* end quickly still has to stay coherent. Nothing here asserts a
    // score — the point is that two minutes of firing at whatever the director sends never trips an invariant.
    const world = freshWorld(97)
    startRun(world)
    world.lives = 99

    for (let frame = 0; frame < 60 * 120; frame++) {
      const t = frame / 60
      stepWorld(
        world,
        {
          move: { x: Math.cos(t * 0.9), y: Math.sin(t * 1.3) },
          aim: { x: Math.cos(t * 3), y: Math.sin(t * 3) },
          firing: true,
          bomb: frame % 900 === 0,
        },
        1 / 60,
      )
      clearEffects(world)

      if (world.status === 'playing') expect(world.ship.present).toBe(true)
      // Nothing may leave the arena, and nothing may become NaN — the two failure modes that turn a long run
      // into a quietly broken one.
      expect(Number.isFinite(world.ship.pos.x)).toBe(true)
      expect(Math.abs(world.ship.pos.x)).toBeLessThanOrEqual(ARENA.halfWidth)
      expect(Math.abs(world.ship.pos.y)).toBeLessThanOrEqual(ARENA.halfHeight)
    }

    expect(world.wave).toBeGreaterThan(1)
    expect(world.score).toBeGreaterThan(0)
  })
})

describe('the attract screen', () => {
  it('populates itself and keeps the ship out of it', () => {
    const world = freshWorld(3)
    run(world, 0)
    for (let i = 0; i < 60; i++) stepAttract(world, 1 / 60)

    expect(world.status).toBe('menu')
    expect(world.ship.present).toBe(false)
    expect(world.enemies.length).toBeGreaterThan(0)
    expect(world.score).toBe(0)
  })

  it('tops the arena up without filling it', () => {
    const world = freshWorld(4)
    for (let i = 0; i < 2000; i++) stepAttract(world, 1 / 60)
    expect(world.enemies.length).toBeLessThanOrEqual(12)
  })
})

describe('clearEffects', () => {
  it('empties the list without replacing it', () => {
    // The renderer holds the same arrays for the life of the page, so these have to be truncated rather
    // than reassigned.
    const world = testWorld()
    const blasts = world.effects.blasts
    world.enemies.push(ready(makeDrifter(world.nextId++, 0, 0, { x: 0, y: 0 }, world.rng)))
    stepWorld(world, IDLE_INTENT, 1 / 240)
    expect(blasts.length).toBeGreaterThan(0)

    clearEffects(world)
    expect(world.effects.blasts).toBe(blasts)
    expect(blasts).toHaveLength(0)
    expect(world.effects.shake).toBe(0)
  })
})

describe('publishHud', () => {
  it('notifies nobody when nothing has changed', () => {
    // The whole reason the world is not in the store: this runs every frame and has to be a no-op on
    // almost all of them, or the HUD re-renders sixty times a second to say the same thing.
    const store = useGameStore.getState()
    store.start()
    store.publishHud()

    let notifications = 0
    const unsubscribe = useGameStore.subscribe(() => notifications++)
    store.publishHud()
    store.publishHud()
    unsubscribe()

    expect(notifications).toBe(0)
  })

  it('notices a score that has moved', () => {
    const store = useGameStore.getState()
    store.start()
    store.publishHud()
    getWorld().score += 1234

    let notifications = 0
    const unsubscribe = useGameStore.subscribe(() => notifications++)
    store.publishHud()
    unsubscribe()

    expect(notifications).toBe(1)
    expect(useGameStore.getState().score).toBe(1234)
  })
})
