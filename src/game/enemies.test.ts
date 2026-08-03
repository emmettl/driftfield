import { describe, expect, it } from 'vitest'
import {
  ARENA,
  ENEMY,
  SNAKE_LENGTH,
  SNAKE_SPACING,
  SNIPER,
  SWARM_SIZE,
  SWARM_SPREAD,
  WEAVER,
} from './constants'
import {
  type SteerContext,
  makeDrifter,
  makeEnemy,
  makeRock,
  makeSnake,
  makeSniper,
  makeSwarm,
  makeWanderer,
  makeWeaver,
  makeWell,
  nearestThreat,
  sniperAiming,
  splitRock,
  steerDrifter,
  steerSnakeSegment,
  steerSniper,
  steerSwarmer,
  steerWanderer,
  steerWeaver,
  wellEjectPoint,
} from './enemies'
import { mulberry32 } from './rng'
import type { Bullet, Enemy, Ship } from './types'
import { addScaled, distance, length, set, vec } from './vec'

const rng = mulberry32(42)

function ship(x = 0, y = 0): Ship {
  return { pos: vec(x, y), vel: vec(), aim: 0, cooldown: 0, invulnerable: 0, present: true }
}

function context(target: Ship, bullets: Bullet[] = [], enemies: Enemy[] = []): SteerContext {
  return {
    ship: target,
    bullets,
    byId: (id) => enemies.find((e) => e.id === id),
    rng,
    time: 0,
  }
}

function bullet(x: number, y: number, vx: number, vy: number): Bullet {
  return { id: 1, pos: vec(x, y), vel: vec(vx, vy), life: 1, alive: true }
}

describe('makeDrifter', () => {
  it('is already moving at the target when it appears', () => {
    // A drifter that spawns stationary and then accelerates gives the player a free second, which
    // wells — which spit drifters continuously — would turn into a free wave.
    const drifter = makeDrifter(1, -20, 0, { x: 20, y: 0 }, rng)
    expect(drifter.vel.x).toBeCloseTo(ENEMY.drifter.speed)
    expect(drifter.vel.y).toBeCloseTo(0)
  })
})

describe('steerDrifter', () => {
  it('turns towards the ship rather than snapping', () => {
    const target = ship(40, 0)
    const drifter = makeDrifter(1, 0, 0, { x: -1, y: 0 }, rng)
    const away = drifter.vel.x
    steerDrifter(drifter, context(target), 1 / 60)
    // Moved towards the ship, but nowhere near all the way: a drifter arcs, and a cloud of them reads
    // as a shoal because of it.
    expect(drifter.vel.x).toBeGreaterThan(away)
    expect(drifter.vel.x).toBeLessThan(ENEMY.drifter.speed)
  })

  it('converges on its own speed given long enough', () => {
    const target = ship(0, 50)
    const drifter = makeDrifter(1, 0, 0, { x: 1, y: 0 }, rng)
    for (let i = 0; i < 600; i++) steerDrifter(drifter, context(target), 1 / 60)
    expect(length(drifter.vel)).toBeCloseTo(ENEMY.drifter.speed, 1)
    expect(drifter.vel.y).toBeGreaterThan(drifter.vel.x)
  })
})

describe('steerWanderer', () => {
  it('bounces off a wall it has reached', () => {
    const wanderer = makeWanderer(1, ARENA.halfWidth, 0, rng)
    wanderer.vel.x = Math.abs(wanderer.vel.x) + 5
    steerWanderer(wanderer, context(ship()), 1 / 60)
    expect(wanderer.vel.x).toBeLessThan(0)
  })

  it('does not grind along a wall it arrived at almost parallel', () => {
    const wanderer = makeWanderer(1, ARENA.halfWidth - 0.1, 0, rng)
    wanderer.vel.x = 0.2
    wanderer.vel.y = ENEMY.wanderer.speed
    for (let i = 0; i < 30; i++) steerWanderer(wanderer, context(ship()), 1 / 60)
    // The nudge towards the centre has to have moved it off the wall.
    expect(wanderer.vel.x).toBeLessThan(0)
  })
})

describe('nearestThreat', () => {
  const weaver = makeWeaver(1, 0, 0, rng)

  it('spots a bullet that is going to arrive', () => {
    expect(nearestThreat(weaver, [bullet(-8, 0, 100, 0)])).not.toBeNull()
  })

  it('ignores a bullet that has already gone past', () => {
    // Closing, not merely nearby. A weaver that flinches at its own near-misses jitters in place and
    // never closes on the ship.
    expect(nearestThreat(weaver, [bullet(-8, 0, -100, 0)])).toBeNull()
  })

  it('ignores a bullet outside its lookahead', () => {
    expect(nearestThreat(weaver, [bullet(-WEAVER.lookahead - 5, 0, 100, 0)])).toBeNull()
  })

  it('ignores a bullet whose line misses it', () => {
    // Pointing the right way is not the same as being on a collision course.
    expect(nearestThreat(weaver, [bullet(-8, weaver.radius * 4, 100, 0)])).toBeNull()
  })

  it('ignores dead bullets and stationary ones', () => {
    const spent = bullet(-8, 0, 100, 0)
    spent.alive = false
    expect(nearestThreat(weaver, [spent])).toBeNull()
    expect(nearestThreat(weaver, [bullet(-8, 0, 0, 0)])).toBeNull()
  })

  it('prefers the nearest of several', () => {
    const near = bullet(-4, 0, 100, 0)
    const far = bullet(-12, 0, 100, 0)
    expect(nearestThreat(weaver, [far, near])).toBe(near)
  })
})

describe('steerWeaver', () => {
  it('sidesteps a bullet instead of driving into it', () => {
    const target = ship(30, 0)
    const weaver = makeWeaver(1, 0, 0, rng)
    weaver.dodge = 1
    const incoming = bullet(-10, 0, 120, 0)
    for (let i = 0; i < 12; i++) steerWeaver(weaver, context(target, [incoming]), 1 / 60)
    // The bullet travels along +x, so a sidestep is movement in y — which it has none of without one.
    expect(Math.abs(weaver.vel.y)).toBeGreaterThan(ENEMY.weaver.speed * 0.5)
  })

  it('heads straight at the ship when nothing is coming', () => {
    const target = ship(30, 0)
    const weaver = makeWeaver(1, 0, 0, rng)
    for (let i = 0; i < 200; i++) steerWeaver(weaver, context(target), 1 / 60)
    expect(weaver.vel.x).toBeGreaterThan(0)
    expect(Math.abs(weaver.vel.y)).toBeLessThan(ENEMY.weaver.speed * 0.4)
  })
})

describe('makeSnake', () => {
  it('lays out a straight chain, each segment following the one ahead by id', () => {
    let next = 1
    const segments = makeSnake(() => next++, 0, 0, rng)
    expect(segments).toHaveLength(SNAKE_LENGTH)
    expect(segments[0].segment).toBe(0)
    expect(segments[0].follows).toBe(-1)
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].segment).toBe(i)
      // By id rather than by index, because the enemy array is compacted when things die and an index
      // would point at a stranger within a second of the first kill.
      expect(segments[i].follows).toBe(segments[i - 1].id)
      expect(distance(segments[i].pos, segments[i - 1].pos)).toBeCloseTo(
        ENEMY.snake.radius * SNAKE_SPACING,
      )
    }
  })

  it('only gives the head a velocity', () => {
    let next = 1
    const segments = makeSnake(() => next++, 0, 0, rng)
    expect(length(segments[0].vel)).toBeCloseTo(ENEMY.snake.speed)
    expect(length(segments[1].vel)).toBe(0)
  })
})

describe('steerSnakeSegment', () => {
  it('holds the gap exactly rather than easing towards it', () => {
    // Position is written, not steered. Seven segments each easing towards the last is a rubber band,
    // and the arcade original was rigid.
    let next = 1
    const segments = makeSnake(() => next++, 0, 0, rng)
    const [head, second] = segments
    head.pos.x += 20
    steerSnakeSegment(second, context(ship(), [], segments), 1 / 60)
    expect(distance(second.pos, head.pos)).toBeCloseTo(ENEMY.snake.radius * SNAKE_SPACING)
  })

  it('coasts when the segment ahead has gone', () => {
    const orphan = makeSnake(() => 1, 0, 0, rng)[1]
    orphan.follows = 999
    const before = { ...orphan.pos }
    steerSnakeSegment(orphan, context(ship(), [], []), 1 / 60)
    expect(orphan.pos).toEqual(before)
  })
})

describe('splitRock', () => {
  it('leaves two of the next size down, thrown apart', () => {
    let next = 10
    const rock = makeRock(1, 0, 0, 2, rng)
    const children = splitRock(rock, () => next++, rng)
    expect(children).toHaveLength(2)
    expect(children.every((child) => child.tier === 1)).toBe(true)
    // Different headings, so a rock shot head-on gives you two you can still see coming.
    expect(children[0].vel.y).not.toBeCloseTo(children[1].vel.y)
  })

  it('makes the children faster than the parent', () => {
    const rock = makeRock(1, 0, 0, 2, rng)
    let next = 10
    const children = splitRock(rock, () => next++, rng)
    for (const child of children) expect(length(child.vel)).toBeGreaterThan(length(rock.vel))
  })

  it('leaves nothing from the smallest class', () => {
    // Without this floor the arena fills with gravel until the frame rate gives out.
    const pebble = makeRock(1, 0, 0, 0, rng)
    expect(splitRock(pebble, () => 99, rng)).toHaveLength(0)
  })

  it('gets smaller each tier', () => {
    const big = makeRock(1, 0, 0, 2, rng)
    let next = 10
    const medium = splitRock(big, () => next++, rng)[0]
    const small = splitRock(medium, () => next++, rng)[0]
    expect(medium.radius).toBeLessThan(big.radius)
    expect(small.radius).toBeLessThan(medium.radius)
  })
})

describe('makeSwarm', () => {
  it('arrives as a pack, spread out rather than stacked', () => {
    // Eight enemies born on the same spot overlap into what looks like one thing until they fan out, and that
    // half-second is exactly when the player is deciding whether to run.
    let next = 1
    const pack = makeSwarm(() => next++, 0, 0, rng)
    expect(pack).toHaveLength(SWARM_SIZE)
    expect(pack.every((member) => member.kind === 'swarmer')).toBe(true)

    const spread = Math.max(...pack.map((member) => length(member.pos)))
    expect(spread).toBeGreaterThan(1)
    expect(spread).toBeLessThanOrEqual(SWARM_SPREAD + 1e-6)
  })

  it('gives every member its own weave phase', () => {
    // The load-bearing detail. With a shared phase the pack oscillates in lockstep and travels as one thick
    // line that a single stream cuts down; with spread phases it fans out and arrives from several angles.
    let next = 1
    const phases = new Set(makeSwarm(() => next++, 0, 0, rng).map((member) => member.phase))
    expect(phases.size).toBe(SWARM_SIZE)
  })
})

describe('steerSwarmer', () => {
  it('closes on the ship overall', () => {
    const target = ship(40, 0)
    const swarmer = makeEnemy(1, 'swarmer', -40, 0, rng)
    for (let i = 0; i < 400; i++) {
      steerSwarmer(swarmer, context(target), 1 / 60)
      addScaled(swarmer.pos, swarmer.vel, 1 / 60)
    }
    expect(swarmer.pos.x).toBeGreaterThan(-10)
  })

  it('does not travel in a straight line', () => {
    // A swarmer that homes cleanly is a fast drifter. The weave is the enemy.
    const target = ship(40, 0)
    const swarmer = makeEnemy(1, 'swarmer', -40, 0, rng)
    swarmer.phase = 0
    let drift = 0
    for (let i = 0; i < 240; i++) {
      steerSwarmer(swarmer, { ...context(target), time: i / 60 }, 1 / 60)
      addScaled(swarmer.pos, swarmer.vel, 1 / 60)
      drift = Math.max(drift, Math.abs(swarmer.pos.y))
    }
    expect(drift).toBeGreaterThan(2)
  })

  it('two members with different phases separate', () => {
    const target = ship(0, 40)
    const a = makeEnemy(1, 'swarmer', 0, -40, rng)
    const b = makeEnemy(2, 'swarmer', 0, -40, rng)
    a.phase = 0
    b.phase = Math.PI
    // The widest they get, not where they happen to be at the end — they are both homing on the same point, so
    // they cross, and a snapshot can catch them at the crossing.
    let widest = 0
    for (let i = 0; i < 180; i++) {
      const ctx = { ...context(target), time: i / 60 }
      steerSwarmer(a, ctx, 1 / 60)
      steerSwarmer(b, ctx, 1 / 60)
      addScaled(a.pos, a.vel, 1 / 60)
      addScaled(b.pos, b.vel, 1 / 60)
      widest = Math.max(widest, distance(a.pos, b.pos))
    }
    expect(widest).toBeGreaterThan(4)
  })
})

describe('makeSniper', () => {
  it('does not arrive shooting', () => {
    // Arriving and firing must never be the same event — a shot from something that appeared a frame ago is a
    // shot nobody could have reacted to.
    const sniper = makeSniper(1, 30, 0, rng)
    expect(sniper.spawnTimer).toBe(SNIPER.interval)
    expect(sniperAiming(sniper)).toBe(false)
  })

  it('takes more than one hit', () => {
    expect(makeSniper(1, 0, 0, rng).hp).toBeGreaterThan(1)
  })
})

describe('steerSniper', () => {
  it('backs away when the player closes on it', () => {
    const target = ship(0, 0)
    const sniper = makeSniper(1, 8, 0, rng)
    for (let i = 0; i < 300; i++) {
      steerSniper(sniper, context(target), 1 / 60)
      addScaled(sniper.pos, sniper.vel, 1 / 60)
    }
    expect(distance(sniper.pos, target.pos)).toBeGreaterThan(18)
  })

  it('closes when it is too far away', () => {
    const target = ship(0, 0)
    const sniper = makeSniper(1, ARENA.halfWidth - 2, 0, rng)
    const opening = distance(sniper.pos, target.pos)
    for (let i = 0; i < 300; i++) {
      steerSniper(sniper, context(target), 1 / 60)
      addScaled(sniper.pos, sniper.vel, 1 / 60)
    }
    expect(distance(sniper.pos, target.pos)).toBeLessThan(opening)
  })

  it('settles into its standoff band rather than oscillating through it', () => {
    const target = ship(0, 0)
    const sniper = makeSniper(1, 12, 6, rng)
    for (let i = 0; i < 900; i++) {
      steerSniper(sniper, context(target), 1 / 60)
      addScaled(sniper.pos, sniper.vel, 1 / 60)
    }
    const gap = distance(sniper.pos, target.pos)
    expect(gap).toBeGreaterThan(SNIPER.standoff - SNIPER.band * 3)
    expect(gap).toBeLessThan(SNIPER.standoff + SNIPER.band * 3)
  })

  it('holds still while it is aiming', () => {
    // The whole fairness budget for the enemy. The tell has to be in the simulation, not only in the
    // renderer — otherwise the two can disagree about whether a shot is coming.
    const target = ship(0, 0)
    const sniper = makeSniper(1, SNIPER.standoff, 0, rng)
    set(sniper.vel, 20, 20)
    sniper.spawnTimer = SNIPER.telegraph * 0.5
    expect(sniperAiming(sniper)).toBe(true)

    for (let i = 0; i < 60; i++) steerSniper(sniper, context(target), 1 / 60)
    expect(length(sniper.vel)).toBeLessThan(1)
  })
})

describe('wellEjectPoint', () => {
  it('puts the drifter on the far side of the well from the ship', () => {
    // A well parked on top of you must not machine-gun drifters into your face.
    const well = makeWell(1, 0, 0, rng)
    const target = ship(-30, 0)
    for (let i = 0; i < 200; i++) {
      const at = wellEjectPoint(well, target, rng)
      expect(at.x).toBeGreaterThan(0)
    }
  })

  it('puts it clear of the well itself', () => {
    const well = makeWell(1, 0, 0, rng)
    for (let i = 0; i < 200; i++) {
      const at = wellEjectPoint(well, ship(-30, 0), rng)
      expect(Math.hypot(at.x, at.y)).toBeGreaterThan(ENEMY.well.radius)
    }
  })
})
