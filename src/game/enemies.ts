import { bounceInArena, distanceToWall } from './arena'
import {
  ENEMY,
  SNAKE_LENGTH,
  SNAKE_SPACING,
  SNIPER,
  SWARMER,
  SWARM_SIZE,
  SWARM_SPREAD,
  WEAVER,
  WELL,
  rockTier,
  smoothing,
} from './constants'
import { type Rng, range } from './rng'
import type { Bullet, Enemy, EnemyKind, Ship } from './types'
import {
  addScaled,
  clampLength,
  copy,
  direction,
  distance,
  length,
  normalise,
  scale,
  set,
  vec,
} from './vec'

// What each enemy kind does with a frame.
//
// One steering function per kind, each of which takes the enemy, what it can see, and a
// delta — and mutates the enemy's velocity. Nothing in here spawns, scores, collides or
// makes a sound; `step.ts` does all of that. The split is what makes the behaviours
// testable in isolation, and the tests are worth having: "a weaver dodges a bullet that is
// coming at it and ignores one that is going past" is exactly the kind of thing that
// quietly stops being true.

/** What a steering function is allowed to know. Deliberately small — an enemy that can see
 *  the whole world will eventually be written to depend on all of it. */
export interface SteerContext {
  ship: Ship
  bullets: Bullet[]
  /** For the snake, whose segments follow the one ahead by id. */
  byId: (id: number) => Enemy | undefined
  rng: Rng
  time: number
}

const _tmp = vec()
const _tmp2 = vec()

/** A fresh enemy of a kind, at rest, with its type's numbers filled in. Callers set the
 *  velocity and any kind-specific fields; everything has every field, so nothing anywhere
 *  has to reason about a half-built enemy. */
export function makeEnemy(id: number, kind: EnemyKind, x: number, y: number, rng: Rng): Enemy {
  const spec = ENEMY[kind]
  return {
    id,
    kind,
    pos: vec(x, y),
    vel: vec(),
    radius: spec.radius,
    hp: spec.hp,
    angle: range(rng, 0, Math.PI * 2),
    spin: range(rng, -1.6, 1.6),
    age: 0,
    alive: true,
    tier: kind === 'rock' ? 2 : 0,
    segment: 0,
    follows: -1,
    charge: 0,
    spawnTimer: WELL.spawnInterval,
    dodge: rng() < 0.5 ? -1 : 1,
    phase: range(rng, 0, Math.PI * 2),
  }
}

/** A drifter, already moving towards the ship. Used both by the spawn director and by the
 *  wells, which is why it takes a target rather than reading one out of a context. */
export function makeDrifter(id: number, x: number, y: number, towards: { x: number; y: number }, rng: Rng): Enemy {
  const enemy = makeEnemy(id, 'drifter', x, y, rng)
  direction(enemy.vel, enemy.pos, towards)
  scale(enemy.vel, ENEMY.drifter.speed)
  return enemy
}

/** A wanderer on a heading it will keep until a wall says otherwise. */
export function makeWanderer(id: number, x: number, y: number, rng: Rng): Enemy {
  const enemy = makeEnemy(id, 'wanderer', x, y, rng)
  const heading = range(rng, 0, Math.PI * 2)
  set(enemy.vel, Math.cos(heading) * ENEMY.wanderer.speed, Math.sin(heading) * ENEMY.wanderer.speed)
  // Barely turns. The wanderer is the only enemy that is not pointed at anything, and a shape tumbling slowly
  // reads as debris where the same shape spinning reads as a machine — which is the difference between the
  // thing you can ignore and the things you cannot.
  enemy.spin = range(rng, -0.25, 0.25)
  return enemy
}

export function makeWeaver(id: number, x: number, y: number, rng: Rng): Enemy {
  return makeEnemy(id, 'weaver', x, y, rng)
}

/**
 * A rock of a given size class, tumbling on a random heading.
 *
 * Rocks are the one enemy that ignores the player completely *and* is dangerous, which
 * makes them the arena's furniture: they are what turns a wave into a place with a shape
 * rather than an empty box with things homing across it.
 */
export function makeRock(id: number, x: number, y: number, tier: number, rng: Rng): Enemy {
  const enemy = makeEnemy(id, 'rock', x, y, rng)
  const { radius, speedScale } = rockTier(tier)
  enemy.tier = tier
  enemy.radius = radius
  const heading = range(rng, 0, Math.PI * 2)
  const speed = ENEMY.rock.speed * speedScale * range(rng, 0.7, 1.25)
  set(enemy.vel, Math.cos(heading) * speed, Math.sin(heading) * speed)
  enemy.spin = range(rng, -1.1, 1.1)
  return enemy
}

/**
 * What a rock leaves behind: two of the next size down, thrown apart.
 *
 * They are pushed off the parent's heading rather than given fresh ones, so a rock you
 * shoot head-on gives you two you can still see coming. The smallest class returns
 * nothing — without a floor this is an infinite supply of enemies, and the arena fills up
 * with gravel until the frame rate gives out.
 */
export function splitRock(rock: Enemy, nextId: () => number, rng: Rng): Enemy[] {
  if (rock.tier <= 0) return []

  const tier = rock.tier - 1
  const parentSpeed = Math.max(length(rock.vel), ENEMY.rock.speed)
  const parentHeading = Math.atan2(rock.vel.y, rock.vel.x)
  const { speedScale } = rockTier(tier)

  return [1, -1].map((side) => {
    const child = makeRock(nextId(), rock.pos.x, rock.pos.y, tier, rng)
    const heading = parentHeading + side * range(rng, 0.5, 1.1)
    const speed = parentSpeed * speedScale * range(rng, 0.85, 1.15)
    set(child.vel, Math.cos(heading) * speed, Math.sin(heading) * speed)
    // Nudged apart along their new headings so the pair does not spend its first frames
    // overlapping, which reads as one rock that got smaller.
    addScaled(child.pos, child.vel, 0.06)
    return child
  })
}

/**
 * A snake: a head that hunts, and a tail that goes where the head went.
 *
 * Returned as a list because a snake is one spawn order and several bodies. The segments
 * refer to the one ahead by id rather than by array index — the arrays are compacted when
 * things die, so an index would point at a stranger within a second of the first kill.
 */
export function makeSnake(nextId: () => number, x: number, y: number, rng: Rng): Enemy[] {
  const heading = range(rng, 0, Math.PI * 2)
  const step = ENEMY.snake.radius * SNAKE_SPACING
  const segments: Enemy[] = []

  for (let i = 0; i < SNAKE_LENGTH; i++) {
    // Laid out backwards along the heading, so the whole snake starts straight and its
    // first movement does not snap the tail across the arena to catch up.
    const enemy = makeEnemy(
      nextId(),
      'snake',
      x - Math.cos(heading) * step * i,
      y - Math.sin(heading) * step * i,
      rng,
    )
    enemy.segment = i
    enemy.follows = i === 0 ? -1 : segments[i - 1].id
    if (i === 0) {
      set(enemy.vel, Math.cos(heading) * ENEMY.snake.speed, Math.sin(heading) * ENEMY.snake.speed)
    }
    segments.push(enemy)
  }
  return segments
}

/**
 * A pack of swarmers, scattered around a point.
 *
 * One spawn order, eight bodies — the same arrangement as a snake, and for the same reason: a swarmer on its
 * own is a slower, weaker drifter and completely uninteresting. The pack is the enemy.
 *
 * Scattered rather than placed together, because eight enemies born on the same texel overlap into what looks
 * like one thing until they fan out, and the half-second where the player cannot tell how many there are is
 * exactly the half-second they are deciding whether to run.
 */
export function makeSwarm(nextId: () => number, x: number, y: number, rng: Rng): Enemy[] {
  return Array.from({ length: SWARM_SIZE }, () => {
    const angle = range(rng, 0, Math.PI * 2)
    const spread = range(rng, 0.2, 1) * SWARM_SPREAD
    const enemy = makeEnemy(
      nextId(),
      'swarmer',
      x + Math.cos(angle) * spread,
      y + Math.sin(angle) * spread,
      rng,
    )
    enemy.spin = range(rng, -6, 6)
    return enemy
  })
}

/** A sniper, holding station wherever it appeared. Its first shot is a full interval away, so arriving is
 *  never the same event as firing. */
export function makeSniper(id: number, x: number, y: number, rng: Rng): Enemy {
  const enemy = makeEnemy(id, 'sniper', x, y, rng)
  enemy.spawnTimer = SNIPER.interval
  enemy.spin = range(rng, -0.5, 0.5)
  // Which way it strafes. Reusing `dodge` rather than adding a field: it means exactly the same thing here as
  // it does on a weaver — the side this enemy has committed to.
  enemy.dodge = rng() < 0.5 ? -1 : 1
  return enemy
}

export function makeWell(id: number, x: number, y: number, rng: Rng): Enemy {
  const enemy = makeEnemy(id, 'well', x, y, rng)
  const heading = range(rng, 0, Math.PI * 2)
  set(enemy.vel, Math.cos(heading) * ENEMY.well.speed, Math.sin(heading) * ENEMY.well.speed)
  enemy.spin = range(rng, 0.4, 0.9)
  enemy.hp = ENEMY.well.hp
  return enemy
}

// ---- steering ------------------------------------------------------------------

/** Head straight for the ship at a fixed speed. Turning is smoothed so a drifter arcs
 *  rather than pivoting, which is what makes a cloud of them read as a shoal. */
export function steerDrifter(enemy: Enemy, ctx: SteerContext, dt: number): void {
  direction(_tmp, enemy.pos, ctx.ship.pos)
  scale(_tmp, ENEMY.drifter.speed)
  const k = smoothing(3.2, dt)
  enemy.vel.x += (_tmp.x - enemy.vel.x) * k
  enemy.vel.y += (_tmp.y - enemy.vel.y) * k
}

/**
 * Keep going, and bounce.
 *
 * The nudge away from a wall it is *nearly* touching is not physics — it stops a wanderer
 * that happens to arrive almost parallel to a wall from grinding along it for ten seconds,
 * which looks like it is stuck even though it is doing exactly what it was told.
 */
export function steerWanderer(enemy: Enemy, _ctx: SteerContext, _dt: number): void {
  bounceInArena(enemy.pos, enemy.vel, enemy.radius)
  if (distanceToWall(enemy.pos) < enemy.radius * 1.5) {
    direction(_tmp, enemy.pos, { x: 0, y: 0 })
    addScaled(enemy.vel, _tmp, 6)
    clampLength(enemy.vel, ENEMY.wanderer.speed * 1.3)
  }
}

/**
 * Home at the ship, but step aside from a bullet that is actually going to arrive.
 *
 * "Actually going to arrive" is the whole thing. A weaver that dodges every bullet in the
 * arena jitters in place and never closes; one that dodges only what is aimed at it is a
 * target that punishes spraying and rewards leading. So a bullet counts only if it is
 * within `lookahead`, closing (its velocity points at the weaver), and its closest
 * approach along its current path is inside a couple of radii.
 */
export function steerWeaver(enemy: Enemy, ctx: SteerContext, dt: number): void {
  direction(_tmp, enemy.pos, ctx.ship.pos)
  scale(_tmp, ENEMY.weaver.speed)

  const threat = nearestThreat(enemy, ctx.bullets)
  if (threat) {
    // Sideways relative to the *bullet*, not to the weaver: stepping perpendicular to the
    // thing that is going to hit you is the shortest way out of its path.
    set(_tmp2, -threat.vel.y, threat.vel.x)
    normalise(_tmp2)
    // Commit to a side for as long as the threat lasts. Re-deciding every frame from the
    // geometry produces a weaver that vibrates down the bullet's line and gets hit anyway.
    addScaled(_tmp, _tmp2, ENEMY.weaver.speed * WEAVER.dodgeScale * enemy.dodge)
  } else if (ctx.rng() < dt * 0.7) {
    // Occasionally change which way it will dodge next, so a player cannot learn one
    // weaver's habit and apply it to every weaver for the rest of the run.
    enemy.dodge = -enemy.dodge
  }

  clampLength(_tmp, ENEMY.weaver.speed * (1 + WEAVER.dodgeScale))
  const k = smoothing(threat ? 14 : 4.5, dt)
  enemy.vel.x += (_tmp.x - enemy.vel.x) * k
  enemy.vel.y += (_tmp.y - enemy.vel.y) * k
}

/** The bullet most worth avoiding, or null. Exported for the tests, which is the only way
 *  "does the dodge trigger on the right bullets" is answerable without eyeballing it. */
export function nearestThreat(enemy: Enemy, bullets: Bullet[]): Bullet | null {
  let best: Bullet | null = null
  // Annotated, because `WEAVER` is `as const` and so `lookahead` has the literal type 14 — which would
  // make this variable un-assignable to anything else, including the distance found below.
  let bestDistance: number = WEAVER.lookahead

  for (const bullet of bullets) {
    if (!bullet.alive) continue
    const dx = enemy.pos.x - bullet.pos.x
    const dy = enemy.pos.y - bullet.pos.y
    const gap = Math.hypot(dx, dy)
    if (gap > bestDistance) continue

    // Closing only. A bullet that has already gone past is not a threat, and treating it
    // as one makes weavers flinch at their own near-misses.
    const speed = Math.hypot(bullet.vel.x, bullet.vel.y)
    if (speed < 1e-3) continue
    const towards = (dx * bullet.vel.x + dy * bullet.vel.y) / speed
    if (towards <= 0) continue

    // Perpendicular distance from the weaver to the bullet's line. Inside this and the
    // bullet is on a collision course rather than merely pointing the right way.
    const across = Math.abs((dx * bullet.vel.y - dy * bullet.vel.x) / speed)
    if (across > enemy.radius * 2.4) continue

    best = bullet
    bestDistance = gap
  }
  return best
}

/** The head hunts like a fast drifter that cannot turn sharply — a snake's threat is that
 *  it commits, so it must not be able to pivot on the spot. */
export function steerSnakeHead(enemy: Enemy, ctx: SteerContext, dt: number): void {
  direction(_tmp, enemy.pos, ctx.ship.pos)
  scale(_tmp, ENEMY.snake.speed)
  const k = smoothing(1.4, dt)
  enemy.vel.x += (_tmp.x - enemy.vel.x) * k
  enemy.vel.y += (_tmp.y - enemy.vel.y) * k
  clampLength(enemy.vel, ENEMY.snake.speed)
  bounceInArena(enemy.pos, enemy.vel, enemy.radius)
}

/**
 * A segment holds station behind the one in front.
 *
 * Position is written directly rather than steered towards, because a chain of springs is
 * a chain that stretches: seven segments each easing towards the last leaves a snake that
 * looks like a rubber band under load whenever the head turns. Setting the gap exactly
 * gives the rigid, articulated look the arcade original had, and the velocity is derived
 * afterwards purely so the fluid gets a wake off it.
 */
export function steerSnakeSegment(enemy: Enemy, ctx: SteerContext, dt: number): void {
  const ahead = ctx.byId(enemy.follows)
  if (!ahead) {
    // The segment in front died. Nothing to follow, so it coasts — and `step.ts` is about
    // to kill it anyway, since a snake dies whole.
    return
  }
  const gap = ENEMY.snake.radius * SNAKE_SPACING
  direction(_tmp, ahead.pos, enemy.pos)
  const targetX = ahead.pos.x + _tmp.x * gap
  const targetY = ahead.pos.y + _tmp.y * gap

  if (dt > 0) {
    set(enemy.vel, (targetX - enemy.pos.x) / dt, (targetY - enemy.pos.y) / dt)
    clampLength(enemy.vel, ENEMY.snake.speed * 3)
  }
  set(enemy.pos, targetX, targetY)
}

/**
 * A swarmer homes at the ship, but never in a straight line.
 *
 * The weave is a sine of time offset by the enemy's own `phase`, applied perpendicular to the direction of
 * travel. That is the whole trick, and the phase is the important half of it: with a shared phase the pack
 * oscillates in lockstep and arrives as one thick line that a single stream of fire cuts down. With phases
 * spread across the pack, the eight of them fan out, cross each other and arrive from a spread of angles —
 * so you have to sweep rather than aim, which is a different problem from any other enemy here.
 */
export function steerSwarmer(enemy: Enemy, ctx: SteerContext, dt: number): void {
  direction(_tmp, enemy.pos, ctx.ship.pos)
  // Perpendicular to the approach, scaled by a sine. Taken from the *direction to the target* rather than
  // from the current velocity, so the weave cannot feed back on itself and spiral.
  set(_tmp2, -_tmp.y, _tmp.x)
  const weave = Math.sin(ctx.time * SWARMER.weaveRate + enemy.phase) * SWARMER.weaveScale
  scale(_tmp, ENEMY.swarmer.speed)
  addScaled(_tmp, _tmp2, ENEMY.swarmer.speed * weave)

  const k = smoothing(7, dt)
  enemy.vel.x += (_tmp.x - enemy.vel.x) * k
  enemy.vel.y += (_tmp.y - enemy.vel.y) * k
  clampLength(enemy.vel, ENEMY.swarmer.speed * (1 + SWARMER.weaveScale))
}

/**
 * A sniper holds a distance and strafes, and stands still while it aims.
 *
 * Two components: a radial one that pushes it back towards its standoff distance, and a tangential one that
 * makes it orbit rather than sit. The orbit is what makes it a target you have to lead — a stationary enemy
 * at 34 units is hit by holding the trigger and waiting.
 *
 * The stillness while aiming is the fair half of the bargain. It is the only enemy that can reach across the
 * arena, so the moment before it does, it stops — and `Enemies.tsx` brightens it at the same time. A tell that
 * only exists in the renderer would be a tell that the simulation could contradict.
 */
export function steerSniper(enemy: Enemy, ctx: SteerContext, dt: number): void {
  if (sniperAiming(enemy)) {
    // Braking rather than a hard stop: a body that snaps to zero velocity reads as a dropped frame.
    scale(enemy.vel, 1 - Math.min(0.9, 9 * dt))
    return
  }

  direction(_tmp, enemy.pos, ctx.ship.pos)
  const gap = distance(enemy.pos, ctx.ship.pos)
  // Inside the band it closes, outside it backs off, and within the band the radial term is nearly zero so
  // the strafe dominates. Without the band it oscillates through the standoff distance forever.
  const closing = gap > SNIPER.standoff + SNIPER.band ? 1 : gap < SNIPER.standoff - SNIPER.band ? -1 : 0

  set(_tmp2, -_tmp.y * enemy.dodge, _tmp.x * enemy.dodge)
  const target = _tmp
  scale(target, ENEMY.sniper.speed * closing)
  addScaled(target, _tmp2, ENEMY.sniper.speed * SNIPER.strafe)

  const k = smoothing(3, dt)
  enemy.vel.x += (target.x - enemy.vel.x) * k
  enemy.vel.y += (target.y - enemy.vel.y) * k
  clampLength(enemy.vel, ENEMY.sniper.speed)
  // Bounced, so a sniper backing away from a player who is chasing it does not reverse into a wall and stick.
  if (bounceInArena(enemy.pos, enemy.vel, enemy.radius)) enemy.dodge = -enemy.dodge
}

/**
 * Whether a sniper is in its telegraph window.
 *
 * Exported because three places need the same answer and must not each decide it: the steering (which holds
 * station), the renderer (which brightens it), and the test that checks the two agree.
 */
export function sniperAiming(enemy: Enemy): boolean {
  return enemy.kind === 'sniper' && enemy.spawnTimer <= SNIPER.telegraph
}

/** Rocks tumble and bounce, and that is all they do. */
export function steerRock(enemy: Enemy, _ctx: SteerContext, _dt: number): void {
  bounceInArena(enemy.pos, enemy.vel, enemy.radius)
}

/** A well drifts slowly and bounces. Its actual effect on the world is gravity, which is
 *  applied to everything else in `wells.ts` rather than from here. */
export function steerWell(enemy: Enemy, _ctx: SteerContext, _dt: number): void {
  bounceInArena(enemy.pos, enemy.vel, enemy.radius)
  clampLength(enemy.vel, ENEMY.well.speed)
}

/** Move one enemy. The one place the kind is dispatched on, so a new kind is a case here
 *  and a function above rather than a search through the step. */
export function steer(enemy: Enemy, ctx: SteerContext, dt: number): void {
  switch (enemy.kind) {
    case 'drifter':
      steerDrifter(enemy, ctx, dt)
      break
    case 'wanderer':
      steerWanderer(enemy, ctx, dt)
      break
    case 'weaver':
      steerWeaver(enemy, ctx, dt)
      break
    case 'snake':
      if (enemy.segment === 0) steerSnakeHead(enemy, ctx, dt)
      else steerSnakeSegment(enemy, ctx, dt)
      break
    case 'rock':
      steerRock(enemy, ctx, dt)
      break
    case 'well':
      steerWell(enemy, ctx, dt)
      break
    case 'swarmer':
      steerSwarmer(enemy, ctx, dt)
      break
    case 'sniper':
      steerSniper(enemy, ctx, dt)
      break
  }
}

/**
 * Whether this kind moves itself by its own velocity in the integration step.
 *
 * Snake segments are the exception: `steerSnakeSegment` has already put them exactly where
 * they belong, and integrating the velocity it derived on top of that would move them
 * twice — a snake that accelerates away from its own head.
 */
export function integratesVelocity(enemy: Enemy): boolean {
  return !(enemy.kind === 'snake' && enemy.segment > 0)
}

/** How far a drifter spat out of a well starts from its centre, so it is not born inside
 *  the thing that is pulling it back in. */
export const WELL_EJECT_DISTANCE = ENEMY.well.radius + 2.4

/** Where the next drifter comes out of a well: on the far side from the ship, so a well
 *  parked on top of you does not machine-gun drifters into your face. */
export function wellEjectPoint(well: Enemy, ship: Ship, rng: Rng): { x: number; y: number } {
  direction(_tmp, ship.pos, well.pos)
  const base = Math.atan2(_tmp.y, _tmp.x)
  const angle = base + range(rng, -1.1, 1.1)
  return {
    x: well.pos.x + Math.cos(angle) * WELL_EJECT_DISTANCE,
    y: well.pos.y + Math.sin(angle) * WELL_EJECT_DISTANCE,
  }
}

/** Distance between two enemies' centres. A thin wrapper, but it keeps `distance` out of
 *  the step's import list for the one place it is needed there. */
export function gapBetween(a: Enemy, b: Enemy): number {
  return distance(a.pos, b.pos)
}

/** Copy of a position, for callers that need one that will not move under them. */
export function positionOf(enemy: Enemy): { x: number; y: number } {
  return copy(vec(), enemy.pos)
}
