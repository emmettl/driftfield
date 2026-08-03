import { clampToArena, insideArena, spawnPoint } from './arena'
import { SpatialGrid, circlesOverlap } from './collide'
import {
  BLAST,
  BOMB,
  BULLET,
  ENEMY,
  GEOM,
  MAX_DT,
  SHAKE,
  SHIP,
  SNIPER,
  SPAWN_GRACE,
  WAVE_BREATH,
  WELL,
  smoothing,
} from './constants'
import {
  type SteerContext,
  integratesVelocity,
  makeDrifter,
  makeRock,
  makeSnake,
  makeSniper,
  makeSwarm,
  makeWanderer,
  makeWeaver,
  makeWell,
  splitRock,
  steer,
  wellEjectPoint,
} from './enemies'
import { range } from './rng'
import { addPoints, collectGeom, loseLife, scoreForEnemy } from './score'
import { freshSpawn, modeForWave, nextCluster, spawnExhausted } from './spawn'
import type { Enemy, EnemyKind, SoundCue, World } from './types'
import { addScaled, clampLength, scale, set, vec } from './vec'
import { applyWellGravity, wellsIn } from './wells'

// One frame of the game, as a function.
//
// This is the whole simulation. It takes a world, what the player is asking for, and a
// delta; it moves everything, resolves everything, and leaves a list of things that
// happened on `world.effects` for the presentation layer to pick up. It draws nothing,
// plays nothing, and touches no browser API — which is why the interesting questions about
// this game ("can a wave end while a well is alive", "does a bomb pay out the multiplier")
// are answered in `step.test.ts` in a few milliseconds rather than by playing it.
//
// The order things happen in is load-bearing and worth stating once:
//
//   1. the clock and the status machine
//   2. the ship — input, gravity, walls, its own gun
//   3. bullets, enemies, geoms — steering, then gravity, then integration
//   4. collisions, in the order bullets → ship → geoms
//   5. the wave: spawn, then the end-of-wave check
//   6. compaction
//
// Collisions come after all movement, so nothing resolves against a position half the
// world has already moved past. Compaction comes last, so every index and id used above is
// still valid for the whole of the frame that used it.

/** What the player is asking for this frame. Produced by `input.ts` from whatever the
 *  player is actually holding — a keyboard, a gamepad, two thumbs on glass. */
export interface Intent {
  /** Direction to travel, magnitude 0..1. */
  move: { x: number; y: number }
  /** Direction to face and fire. A zero vector means "keep the current facing", which is
   *  what a released stick does — a ship that snaps back to facing right when you let go
   *  of the aim stick is unusable. */
  aim: { x: number; y: number }
  firing: boolean
  /** Edge-triggered by the caller. The step treats it as "detonate now if you can", so a
   *  held key must not arrive as `true` on sixty consecutive frames. */
  bomb: boolean
}

export const IDLE_INTENT: Intent = {
  move: { x: 0, y: 0 },
  aim: { x: 0, y: 0 },
  firing: false,
  bomb: false,
}

/**
 * Enemy lookup for the frame.
 *
 * Module-level and cleared at the top of each step, rather than rebuilt per call or stored
 * on the world. A snake segment finds the one ahead by id, which needs an index; building a
 * `Map` inside the step allocates one per frame, and putting it on the world makes the
 * world's shape depend on an implementation detail of the step. Reuse is safe because a
 * step never yields — there is no await in here, and nothing else can run between the
 * clear at the top and the last read.
 */
const index = new Map<number, Enemy>()

const _tmp = vec()
const candidates: number[] = []
const grid = new SpatialGrid()

function nextIdFrom(world: World): () => number {
  return () => world.nextId++
}

function pushBlast(world: World, x: number, y: number, radius: number, strength: number, hue: number): void {
  world.effects.blasts.push({ x, y, radius, strength, hue })
}

function pushSound(world: World, cue: SoundCue): void {
  world.effects.sounds.push(cue)
}

/** Drop a geom, thrown outward from wherever the thing died. */
function dropGeoms(world: World, x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const heading = range(world.rng, 0, Math.PI * 2)
    const speed = GEOM.scatterSpeed * range(world.rng, 0.5, 1.3)
    world.geoms.push({
      id: world.nextId++,
      pos: vec(x, y),
      vel: vec(Math.cos(heading) * speed, Math.sin(heading) * speed),
      age: 0,
      alive: true,
    })
  }
}

/**
 * How an enemy died, which decides what dying gets the player.
 *
 * Three distinct kinds of death, and every combination of the three consequences is used by one of them —
 * which is why this is a shape rather than a boolean:
 *
 *   * `shot`    — a bullet, or being rammed by an invulnerable ship. Pays, drops geoms, and breaks a rock
 *                 into pieces, because breaking one up is the point of shooting it.
 *   * `blast`   — a bomb, or a collapsing well taking its neighbours. Pays, but does not break rocks up:
 *                 a bomb is a reset, and a reset that leaves the arena full of the gravel it just made is
 *                 not one. Whether it drops geoms is the caller's business — a well's collapse is earned
 *                 and a bomb's is not.
 *   * `cleared` — the player's own death taking the arena with it. Pays nothing, drops nothing, splits
 *                 nothing. Dying is not a play, and a rock that split here would leave two rocks waiting
 *                 for the ship that is about to respawn on top of them.
 */
type Cause = 'shot' | 'blast' | 'cleared'

function killEnemy(
  world: World,
  enemy: Enemy,
  cause: Cause,
  spawned: Enemy[],
  drops = true,
): void {
  if (!enemy.alive) return
  enemy.alive = false

  const credited = cause !== 'cleared'
  const hue = ENEMY[enemy.kind].hue

  if (enemy.kind === 'rock') {
    const children = cause === 'shot' ? splitRock(enemy, nextIdFrom(world), world.rng) : []
    for (const child of children) {
      // Children arrive already materialised. A rock you have just broken must be dangerous immediately,
      // or shooting one is a free half-second of safety.
      child.age = SPAWN_GRACE
      spawned.push(child)
    }
    pushBlast(world, enemy.pos.x, enemy.pos.y, BLAST.rockRadius * (0.6 + enemy.tier * 0.2), BLAST.rockStrength, hue)
    world.effects.shake += SHAKE.rock
    if (credited) pushSound(world, children.length > 0 ? 'rockBreak' : 'kill')
  } else {
    pushBlast(world, enemy.pos.x, enemy.pos.y, BLAST.killRadius, BLAST.killStrength, hue)
    world.effects.shake += SHAKE.kill
    if (credited) pushSound(world, 'kill')
  }

  if (!credited) return

  const { lives, bombs } = addPoints(world, scoreForEnemy(enemy))
  if (lives > 0 || bombs > 0) pushSound(world, 'extraLife')
  if (drops) dropGeoms(world, enemy.pos.x, enemy.pos.y, ENEMY[enemy.kind].geoms)
}

/**
 * A well reaching its limit.
 *
 * It takes everything nearby with it, and those kills pay — a well is the one enemy where
 * the reward for the work is the chain reaction, and paying for it is what makes shooting
 * one worth the thirty seconds it costs to line up.
 */
function collapseWell(world: World, well: Enemy, spawned: Enemy[]): void {
  pushBlast(world, well.pos.x, well.pos.y, BLAST.wellRadius, BLAST.wellStrength, ENEMY.well.hue)
  world.effects.shake += SHAKE.well
  pushSound(world, 'wellCollapse')

  well.alive = false
  const { lives } = addPoints(world, ENEMY.well.score)
  if (lives > 0) pushSound(world, 'extraLife')
  dropGeoms(world, well.pos.x, well.pos.y, ENEMY.well.geoms)

  for (const other of world.enemies) {
    if (!other.alive || other === well) continue
    const dx = other.pos.x - well.pos.x
    const dy = other.pos.y - well.pos.y
    if (dx * dx + dy * dy > WELL.collapseRadius * WELL.collapseRadius) continue
    killEnemy(world, other, 'blast', spawned)
  }
}

/** Everything the player's own death clears. No score, no geoms, no debris — dying is not a play. */
function clearArena(world: World, spawned: Enemy[]): void {
  for (const enemy of world.enemies) killEnemy(world, enemy, 'cleared', spawned)
  for (const bullet of world.bullets) bullet.alive = false
  // Shots in flight go too. A sniper's round outliving the ship it was aimed at would still be travelling
  // when the next one respawns in the middle of the arena, which is a death from a gun that no longer exists.
  for (const hostile of world.hostiles) hostile.alive = false
}

function detonateBomb(world: World, spawned: Enemy[]): void {
  world.bombs--
  pushBlast(world, world.ship.pos.x, world.ship.pos.y, BLAST.bombRadius, BLAST.bombStrength, 0.5)
  world.effects.shake += SHAKE.bomb
  pushSound(world, 'bomb')
  // Granted immediately: the bomb is usually fired *because* something is about to land,
  // and losing the life anyway on the same frame would make it useless exactly when it
  // matters. Kept short, so it is a getaway rather than a free wave.
  world.ship.invulnerable = Math.max(world.ship.invulnerable, BOMB.invulnerable)
  // A bomb is a reset, so it clears what is in the air as well as what is flying it. A bomb that left the
  // snipers' rounds in place would not be the panic button it is fired as.
  for (const hostile of world.hostiles) hostile.alive = false

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue
    const dx = enemy.pos.x - world.ship.pos.x
    const dy = enemy.pos.y - world.ship.pos.y
    if (dx * dx + dy * dy > BOMB.radius * BOMB.radius) continue
    // Bomb kills score but drop nothing. Score, because clearing a bad situation is a play and should feel
    // like one; no geoms, because otherwise the optimal way to build a multiplier is to hoard bombs and
    // never learn to move.
    killEnemy(world, enemy, 'blast', spawned, false)
  }
}

function killShip(world: World, spawned: Enemy[]): void {
  const ship = world.ship
  ship.present = false
  pushBlast(world, ship.pos.x, ship.pos.y, BLAST.deathRadius, BLAST.deathStrength, 0.02)
  world.effects.shake += SHAKE.death
  pushSound(world, 'death')

  clearArena(world, spawned)
  loseLife(world)

  if (world.lives <= 0) {
    world.status = 'gameover'
    pushSound(world, 'gameOver')
  } else {
    world.status = 'respawning'
    world.pause = SHIP.deathPause
  }
}

function respawnShip(world: World): void {
  const ship = world.ship
  set(ship.pos, 0, 0)
  set(ship.vel, 0, 0)
  ship.present = true
  ship.invulnerable = SHIP.respawnInvulnerable
  ship.cooldown = 0
}

/** Put one spawn order into the arena. */
function placeSpawn(world: World, kind: EnemyKind, spawned: Enemy[]): void {
  const away = world.ship.present ? world.ship.pos : { x: 0, y: 0 }
  // Well away from the ship, and off the wall. The margin is the biggest enemy radius plus
  // a little, so nothing is ever born half-inside a wall and immediately bounced.
  const at = spawnPoint(world.rng, away, 30, 6)

  switch (kind) {
    case 'drifter':
      spawned.push(makeDrifter(world.nextId++, at.x, at.y, away, world.rng))
      break
    case 'wanderer':
      spawned.push(makeWanderer(world.nextId++, at.x, at.y, world.rng))
      break
    case 'weaver':
      spawned.push(makeWeaver(world.nextId++, at.x, at.y, world.rng))
      break
    case 'snake':
      for (const segment of makeSnake(nextIdFrom(world), at.x, at.y, world.rng)) {
        spawned.push(segment)
      }
      break
    case 'rock':
      spawned.push(makeRock(world.nextId++, at.x, at.y, 2, world.rng))
      break
    case 'well':
      spawned.push(makeWell(world.nextId++, at.x, at.y, world.rng))
      break
    case 'swarmer':
      for (const member of makeSwarm(nextIdFrom(world), at.x, at.y, world.rng)) spawned.push(member)
      break
    case 'sniper':
      spawned.push(makeSniper(world.nextId++, at.x, at.y, world.rng))
      break
  }
  pushBlast(world, at.x, at.y, BLAST.spawnRadius, BLAST.spawnStrength, ENEMY[kind].hue)
  pushSound(world, 'spawn')
}

/** Compact a list of entities, dropping the dead and keeping the order. In place and
 *  without allocating, because this runs on three arrays every frame. */
function compact<T extends { alive: boolean }>(list: T[]): void {
  let write = 0
  for (let read = 0; read < list.length; read++) {
    if (list[read].alive) list[write++] = list[read]
  }
  list.length = write
}

/**
 * Move the world forward.
 *
 * `dt` is clamped here rather than at the call site. The renderer already clamps its own,
 * but this function is also driven from tests and from the attract screen, and a
 * simulation that can be handed a two-second frame from anywhere is one that can be made
 * to tunnel from anywhere.
 */
export function stepWorld(world: World, intent: Intent, rawDt: number): void {
  const dt = Math.min(Math.max(rawDt, 0), MAX_DT)
  if (dt <= 0) return

  world.time += dt

  index.clear()
  for (const enemy of world.enemies) index.set(enemy.id, enemy)

  const spawned: Enemy[] = []
  const ship = world.ship
  const wells = wellsIn(world.enemies)

  // ---- status machine ----------------------------------------------------------

  if (world.status === 'respawning' || world.status === 'wave-clear') {
    world.pause -= dt
    if (world.pause <= 0) {
      if (world.status === 'respawning') {
        respawnShip(world)
        world.status = 'playing'
      } else {
        world.wave++
        world.waveMode = modeForWave(world.wave)
        world.spawn = freshSpawn(world.wave)
        world.status = 'playing'
      }
    }
  }

  const live = world.status === 'playing'

  // ---- the ship ---------------------------------------------------------------

  if (ship.present) {
    if (ship.invulnerable > 0) ship.invulnerable = Math.max(0, ship.invulnerable - dt)

    // Aim is a direction, not a turn rate: this is a twin-stick, and any smoothing at all
    // on the facing makes flick shots land behind where they were aimed.
    if (intent.aim.x !== 0 || intent.aim.y !== 0) {
      ship.aim = Math.atan2(intent.aim.y, intent.aim.x)
    }

    set(_tmp, intent.move.x, intent.move.y)
    clampLength(_tmp, 1)
    scale(_tmp, SHIP.speed)
    const k = smoothing(SHIP.responsiveness, dt)
    ship.vel.x += (_tmp.x - ship.vel.x) * k
    ship.vel.y += (_tmp.y - ship.vel.y) * k

    applyWellGravity(wells, ship.pos, ship.vel, dt, 1)
    addScaled(ship.pos, ship.vel, dt)

    const hit = clampToArena(ship.pos, SHIP.radius)
    // Zeroed on the axis that clamped. Without this, holding into a corner accumulates
    // velocity the walls are quietly absorbing, and the frame you let go the ship is fired
    // across the arena at whatever speed it had built up.
    if (hit.x) ship.vel.x = 0
    if (hit.y) ship.vel.y = 0

    ship.cooldown -= dt
    if (live && intent.firing && ship.cooldown <= 0) {
      ship.cooldown = SHIP.fireInterval
      fireShots(world)
    }

    if (live && intent.bomb && world.bombs > 0) detonateBomb(world, spawned)
  }

  // ---- bullets ----------------------------------------------------------------

  for (const bullet of world.bullets) {
    if (!bullet.alive) continue
    // Bullets are light, so a well bends them hard. This is the single best thing about
    // having gravity in the game: a well between you and your target is a shot you have to
    // aim *around*, and you can see the curve happen.
    applyWellGravity(wells, bullet.pos, bullet.vel, dt, 1.7)
    addScaled(bullet.pos, bullet.vel, dt)
    bullet.life -= dt
    if (bullet.life <= 0) bullet.alive = false
  }

  // ---- shots fired at the player ----------------------------------------------

  for (const hostile of world.hostiles) {
    if (!hostile.alive) continue
    // As light as a bullet, so a well bends a sniper's round hard — which is the whole reason a sniper is
    // interesting in a singularity wave: the shot arrives on a curve you have to read rather than a line you
    // can predict.
    applyWellGravity(wells, hostile.pos, hostile.vel, dt, 1.7)
    addScaled(hostile.pos, hostile.vel, dt)
    hostile.life -= dt
    // Expires on the wall as well as on the clock. A player bullet is allowed past the wall because it dies
    // of old age off-screen anyway; a slow round that bounced or lingered outside the arena would be a threat
    // arriving from somewhere the player cannot see.
    if (hostile.life <= 0 || !insideArena(hostile.pos, -SNIPER.shotRadius)) hostile.alive = false
  }

  // ---- enemies ----------------------------------------------------------------

  const ctx: SteerContext = {
    ship,
    bullets: world.bullets,
    byId: (id) => index.get(id),
    rng: world.rng,
    time: world.time,
  }

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue
    enemy.age += dt
    enemy.angle += enemy.spin * dt

    // A snake whose head has gone dies with it, wherever the break happened. The chain is
    // one enemy that happens to occupy seven places.
    if (enemy.kind === 'snake' && enemy.segment > 0 && !index.get(enemy.follows)?.alive) {
      // Credited as a shot, because it was one: whatever killed the head killed the chain, and a snake
      // is one enemy that happens to occupy seven places.
      killEnemy(world, enemy, 'shot', spawned)
      continue
    }

    steer(enemy, ctx, dt)

    // Wells do not pull each other. Two wells that did would collapse into a single point
    // within a second, and the pair would then behave as one very strong well that the
    // spawn cap was written to prevent.
    if (enemy.kind !== 'well') applyWellGravity(wells, enemy.pos, enemy.vel, dt, 0.6)
    if (integratesVelocity(enemy)) addScaled(enemy.pos, enemy.vel, dt)

    if (enemy.kind === 'sniper' && live) {
      enemy.spawnTimer -= dt
      if (enemy.spawnTimer <= 0) {
        enemy.spawnTimer = SNIPER.interval
        fireSnipe(world, enemy)
      }
    }

    if (enemy.kind === 'well' && live) {
      enemy.spawnTimer -= dt
      if (enemy.spawnTimer <= 0) {
        enemy.spawnTimer = WELL.spawnInterval
        const at = wellEjectPoint(enemy, ship, world.rng)
        const drifter = makeDrifter(world.nextId++, at.x, at.y, ship.pos, world.rng)
        spawned.push(drifter)
        pushBlast(world, at.x, at.y, BLAST.spawnRadius, BLAST.spawnStrength * 2, ENEMY.well.hue)
        pushSound(world, 'wellBurst')
      }
    }
  }

  // ---- geoms ------------------------------------------------------------------

  for (const geom of world.geoms) {
    if (!geom.alive) continue
    geom.age += dt

    if (ship.present) {
      const dx = ship.pos.x - geom.pos.x
      const dy = ship.pos.y - geom.pos.y
      const gap = Math.hypot(dx, dy)
      if (gap < GEOM.magnetRange && gap > 1e-4) {
        // Pull that strengthens as it closes, so a geom on the edge of range drifts over
        // and one nearby snaps in. A constant pull makes the last unit take as long as the
        // first twenty, which reads as the ship refusing to pick it up.
        const pull = GEOM.magnetForce * (1 - gap / GEOM.magnetRange)
        geom.vel.x += (dx / gap) * pull * dt
        geom.vel.y += (dy / gap) * pull * dt
      }
    }
    applyWellGravity(wells, geom.pos, geom.vel, dt, 1.4)

    // Drag, so a geom that has been flung by a well eventually settles instead of
    // ricocheting around the arena for the rest of the wave.
    scale(geom.vel, 1 - Math.min(0.9, 1.6 * dt))
    addScaled(geom.pos, geom.vel, dt)
    clampToArena(geom.pos, GEOM.radius)
    if (geom.age >= GEOM.life) geom.alive = false
  }

  // ---- collisions -------------------------------------------------------------

  grid.clear()
  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i]
    if (enemy.alive) grid.insert(i, enemy.pos.x, enemy.pos.y)
  }

  for (const bullet of world.bullets) {
    if (!bullet.alive) continue
    grid.query(bullet.pos.x, bullet.pos.y, candidates)
    for (const i of candidates) {
      const enemy = world.enemies[i]
      if (!enemy.alive || enemy.age < SPAWN_GRACE) continue
      if (!circlesOverlap(bullet.pos.x, bullet.pos.y, BULLET.radius, enemy.pos.x, enemy.pos.y, enemy.radius)) {
        continue
      }

      bullet.alive = false
      if (enemy.kind === 'well') {
        // A well absorbs fire rather than taking hits. Every bullet that goes in makes it
        // brighter and less stable — see `wellStress` — so the twenty seconds of shooting
        // are legible as progress rather than as nothing happening.
        enemy.charge++
        pushBlast(world, bullet.pos.x, bullet.pos.y, 2.2, 0.35, ENEMY.well.hue)
        if (enemy.charge >= enemy.hp) collapseWell(world, enemy, spawned)
      } else {
        // Everything else takes damage rather than dying outright, because the sniper has two hit points and
        // most of the roster has one. A tougher enemy that simply ignored the first bullet with no feedback
        // would read as a missed shot, so a non-fatal hit still marks the field — smaller, and it pays nothing.
        enemy.hp -= 1
        if (enemy.hp > 0) {
          pushBlast(world, bullet.pos.x, bullet.pos.y, 2.4, 0.4, ENEMY[enemy.kind].hue)
        } else {
          killEnemy(world, enemy, 'shot', spawned)
        }
      }
      break
    }
  }

  if (ship.present && live) {
    grid.query(ship.pos.x, ship.pos.y, candidates)
    for (const i of candidates) {
      const enemy = world.enemies[i]
      if (!enemy.alive || enemy.age < SPAWN_GRACE) continue
      if (!circlesOverlap(ship.pos.x, ship.pos.y, SHIP.radius, enemy.pos.x, enemy.pos.y, enemy.radius)) {
        continue
      }
      if (ship.invulnerable > 0) {
        // Invulnerable does not mean intangible: whatever you flew through still dies, so respawning
        // into a crowd clears a path rather than being a two-second wait for the same death.
        killEnemy(world, enemy, 'shot', spawned)
        continue
      }
      killShip(world, spawned)
      break
    }

    // ...and against anything that has been fired at it. Checked separately from the enemies rather than
    // folded into the grid: there are rarely more than a handful of rounds in the air, so a linear scan is
    // cheaper than inserting them into a spatial structure that exists for two hundred enemies.
    for (const hostile of world.hostiles) {
      if (!hostile.alive) continue
      if (!circlesOverlap(ship.pos.x, ship.pos.y, SHIP.radius, hostile.pos.x, hostile.pos.y, SNIPER.shotRadius)) {
        continue
      }
      hostile.alive = false
      pushBlast(world, hostile.pos.x, hostile.pos.y, 3, 0.5, ENEMY.sniper.hue)
      if (ship.invulnerable <= 0) {
        killShip(world, spawned)
        break
      }
    }
  }

  if (ship.present) {
    for (const geom of world.geoms) {
      if (!geom.alive) continue
      if (!circlesOverlap(ship.pos.x, ship.pos.y, SHIP.radius + 0.6, geom.pos.x, geom.pos.y, GEOM.radius)) {
        continue
      }
      geom.alive = false
      if (collectGeom(world)) pushSound(world, 'multiplierUp')
      else pushSound(world, 'pickup')
    }
  }

  // ---- the wave ---------------------------------------------------------------

  if (live) {
    const liveWells = wells.filter((w) => w.alive).length
    for (const kind of nextCluster(world.spawn, world.wave, world.waveMode, liveWells, world.rng, dt)) {
      placeSpawn(world, kind, spawned)
    }
  }

  for (const enemy of spawned) world.enemies.push(enemy)

  compact(world.enemies)
  compact(world.bullets)
  compact(world.hostiles)
  compact(world.geoms)

  // `world.status`, not the `live` captured at the top of the frame.
  //
  // This is the difference between a working game and an unplayable one. The ship can die *during* this
  // frame, which sets the status to 'respawning' or 'gameover' and clears the arena — and an arena cleared
  // by a death satisfies every condition below. Testing the stale flag therefore overwrote the death with a
  // wave clear, so `respawnShip` never ran and the ship never came back; and with no ship there are no
  // collisions, so nothing could kill the player and the run could never end.
  if (
    world.status === 'playing' &&
    spawnExhausted(world.spawn) &&
    world.enemies.length === 0
  ) {
    world.status = 'wave-clear'
    world.pause = WAVE_BREATH
    pushSound(world, 'waveClear')
  }

  // An invariant, not a fix: a playable status with no ship in the arena is a game nobody can play or lose.
  // Nothing should be able to produce it — the bug above did, for a fortnight of an afternoon — so rather
  // than trust that, it is checked and repaired. If this ever fires it is a bug elsewhere, but the player
  // gets their ship back instead of a dead run.
  if (world.status === 'playing' && !world.ship.present && world.lives > 0) {
    respawnShip(world)
  }
}

/** One trigger pull. Two bullets, a hair apart, carrying a little of the ship's momentum. */
function fireShots(world: World): void {
  const ship = world.ship
  for (let i = 0; i < BULLET.perShot; i++) {
    // Symmetric about the aim: with two shots that is ±half the spread, so the centre of
    // the pair is exactly where the reticle is.
    const offset = (i - (BULLET.perShot - 1) / 2) * BULLET.spread
    const angle = ship.aim + offset
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    world.bullets.push({
      id: world.nextId++,
      pos: vec(ship.pos.x + dir.x * (SHIP.radius + 0.9), ship.pos.y + dir.y * (SHIP.radius + 0.9)),
      vel: vec(
        dir.x * BULLET.speed + ship.vel.x * BULLET.inheritance,
        dir.y * BULLET.speed + ship.vel.y * BULLET.inheritance,
      ),
      life: BULLET.life,
      alive: true,
    })
  }
  pushSound(world, 'shoot')
}

/**
 * One sniper's round, aimed at where the ship is now.
 *
 * At where it *is*, not where it is going. A leading shot from an enemy that already outranges you is a shot
 * you cannot dodge by moving — moving is what makes it land — and an enemy that punishes the correct response
 * is an enemy players learn to hate rather than to beat. Aimed at the current position, the counter is simply
 * "keep moving", which is the behaviour the whole game is trying to teach.
 */
function fireSnipe(world: World, sniper: Enemy): void {
  const ship = world.ship
  if (!ship.present) return

  const dx = ship.pos.x - sniper.pos.x
  const dy = ship.pos.y - sniper.pos.y
  const gap = Math.hypot(dx, dy)
  if (gap < 1e-3) return

  world.hostiles.push({
    id: world.nextId++,
    pos: vec(
      sniper.pos.x + (dx / gap) * (sniper.radius + 1),
      sniper.pos.y + (dy / gap) * (sniper.radius + 1),
    ),
    vel: vec((dx / gap) * SNIPER.shotSpeed, (dy / gap) * SNIPER.shotSpeed),
    life: SNIPER.shotLife,
    alive: true,
  })
  pushBlast(world, sniper.pos.x, sniper.pos.y, 2.4, 0.3, ENEMY.sniper.hue)
  pushSound(world, 'snipe')
}

/**
 * The attract screen's world: populated, drifting, nobody home.
 *
 * The same step runs it, with the ship absent and the spawn budget spent, so the title
 * screen is the real game with nothing in control of it — which means the fluid, the grid
 * and the particles are all doing what they do in play, and the attract screen is a genuine
 * preview rather than a separate scene to be maintained.
 */
export function stepAttract(world: World, dt: number): void {
  // Topped up rather than spawned in a batch, so the arena is never empty and never fills.
  if (world.enemies.length < 7) {
    const at = spawnPoint(world.rng, { x: 0, y: 0 }, 12, 8)
    if (world.rng() < 0.45) {
      world.enemies.push(makeRock(world.nextId++, at.x, at.y, world.rng() < 0.5 ? 2 : 1, world.rng))
    } else {
      const wanderer = makeWanderer(world.nextId++, at.x, at.y, world.rng)
      wanderer.age = SPAWN_GRACE
      world.enemies.push(wanderer)
    }
  }
  stepWorld(world, IDLE_INTENT, dt)
}

/** Drain the effects list. Called by whoever consumed it — the step never clears it,
 *  because a test wants to drive several frames and then look at the total. */
export function clearEffects(world: World): void {
  world.effects.blasts.length = 0
  world.effects.sounds.length = 0
  world.effects.shake = 0
}

