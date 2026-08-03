import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Plane, Vector2, Vector3 } from 'three'
import { FOV } from '../game/cameraFit'
import { MAX_DT } from '../game/constants'
import { clearTaps, freshInputMemory, intentFrom } from '../game/input'
import { feedBeat, freshBeat, lowBandEnergy, setBeatPulse } from '../game/beat'
import { musicAnalyser } from '../game/music'
import { addShake } from '../game/shake'
import { clearEffects, stepAttract, stepWorld } from '../game/step'
import { playCue } from '../game/audio'
import { getWorld, useGameStore } from '../game/useGameStore'
import { pollGamepad, useInput } from '../game/useInput'
import { length } from '../game/vec'
import { particlesForBlast, splatForBlast, splatForWake } from '../render/blasts'
import { pushFlash, stepFlashes } from '../render/flashes'
import { freshWash, stepWash } from '../render/wash'
import { useField } from './Field'

// The driver: one component that renders nothing and advances everything.
//
// Its whole job is to be the single place per frame where the pure simulation meets the impure world.
// It reads the devices, steps the world, and then drains what the step left behind into the three
// things that can hear about it — the fluid, the particle pool and the audio. Nothing else in the tree
// calls `stepWorld`, and nothing else splats.
//
// Ordering inside the frame matters and is fixed here: input, step, drain, fields. In particular the
// fluid is updated *after* the splats are queued, so an explosion is pushed into the field on the frame
// it happened rather than the frame after — at 60fps that is 16ms of the bang and the shockwave being
// out of step, which is not something you can see but is absolutely something you can feel.

/** The z=0 plane, which is where the game happens. Used to turn the pointer into arena coordinates. */
const GAME_PLANE = new Plane(new Vector3(0, 0, 1), 0)

/**
 * Most particle bursts in one frame.
 *
 * Each is a scissored draw into the state texture, so they are cheap but not free, and a bomb landing
 * in a rock field produces eighty blasts at once. The cap is applied to the *largest* blasts rather
 * than the first — see the ordering below — because on those frames the big ones are the ones anybody
 * is looking at.
 */
const MAX_BURSTS = 8

/** Reused so the per-frame ordering allocates nothing. */
const order: number[] = []
/** Scratch, for the two three.js calls per frame that insist on being handed a vector. */
const ndc = new Vector2()
const bufferSize = new Vector2()

/** Seconds the game-over screen holds before the attract screen takes back over. */
const GAMEOVER_HOLD = 6

/** Below this speed the ship leaves no wake. Stops a ship nudged by a well from painting a trail while
 *  the player is not flying anywhere. */
const WAKE_MIN_SPEED = 3

export function GameLoop() {
  const field = useField()
  const input = useInput()
  const memory = useRef(freshInputMemory())
  const pointer = useRef(new Vector3())
  const gameOverFor = useRef(0)
  const beat = useRef(freshBeat())
  const wash = useRef(freshWash())
  /** The status the previous frame ended on, so a transition can be acted on exactly once. */
  const wasStatus = useRef(getWorld().status)
  /**
   * Allocated on first use and kept: `getByteFrequencyData` fills a buffer rather than returning one, and a
   * fresh array every frame is a kilobyte a frame for the garbage collector to no purpose.
   *
   * The buffer type is spelled out because Web Audio's signature demands one backed by an `ArrayBuffer`
   * specifically — a plain `Uint8Array` is `ArrayBufferLike`, which admits a `SharedArrayBuffer` and is
   * therefore rejected.
   */
  const spectrum = useRef<Uint8Array<ArrayBuffer> | null>(null)

  useFrame((state, rawDt) => {
    // Clamped here as well as inside `stepWorld`, because the fluid and the particles are stepped with
    // the same delta and neither of them is stable at a two-second one either.
    const dt = Math.min(rawDt, MAX_DT)
    const world = getWorld()
    const handle = input.current
    const soundOn = useGameStore.getState().soundOn

    // --- input ---------------------------------------------------------------
    pollGamepad(handle)
    if (handle.seen) {
      // The pointer's arena position, by intersecting the camera ray with the play plane. Done here
      // rather than in the input hook because it needs the camera, and the camera moves — it leans with
      // the ship and shakes, so a cached mapping would put the reticle a unit or two out exactly when
      // things are exploding.
      ndc.set(handle.ndc.x, handle.ndc.y)
      state.raycaster.setFromCamera(ndc, state.camera)
      if (state.raycaster.ray.intersectPlane(GAME_PLANE, pointer.current)) {
        handle.raw.pointer = { x: pointer.current.x, y: pointer.current.y }
      }
    } else {
      handle.raw.pointer = null
    }

    const intent = intentFrom(handle.raw, world.ship.pos, memory.current)
    // Immediately: a latched tap that is not cleared is a bomb that fires every frame for the rest of the
    // run. See `clearTaps`.
    clearTaps(handle.raw)

    // --- simulation ----------------------------------------------------------
    if (world.status === 'menu') stepAttract(world, dt)
    else stepWorld(world, intent, dt)

    // A new run, or a return to the title, starts in a clean field.
    //
    // The fluid is the only thing in the game with a memory measured in seconds, and it does not belong to a
    // run — so without this a run opens inside whatever the attract screen was doing. The attract wash sweeps a
    // band across the upper middle of the arena, and pressing start a moment after one passed put the player in
    // a wave whose entire top half was a scrambled grid they had not caused. The reverse is just as bad: the
    // title screen inheriting the smoke of the wave that killed you.
    if (world.status !== wasStatus.current) {
      const newRun = world.status === 'playing' && (wasStatus.current === 'menu' || wasStatus.current === 'gameover')
      if (newRun || world.status === 'menu') field.fluid.clear()
      wasStatus.current = world.status
    }

    // --- drain ---------------------------------------------------------------
    const blasts = world.effects.blasts

    // Largest first, so the cap below throws away the ones nobody would have noticed. Sorted by
    // magnitude rather than by radius: a small blast at high strength (a bullet going into a well) is
    // brighter than a large weak one (something materialising).
    order.length = 0
    for (let i = 0; i < blasts.length; i++) order.push(i)
    if (order.length > 1) {
      order.sort((a, b) => magnitude(blasts[b]) - magnitude(blasts[a]))
    }

    for (let n = 0; n < order.length; n++) {
      const blast = blasts[order[n]]
      const splat = splatForBlast(blast)
      // The fluid queue has a cap of its own and drops the overflow; this is only about the bursts,
      // which have to be limited here because the pool has no queue.
      field.fluid.splat(splat)
      // The fast half of the impact. Everything else about an explosion — dye, sparks — takes a second or more,
      // and an impact needs something that is over before the eye settles on it. See `flashes.ts`.
      pushFlash(blast.x, blast.y, blast.radius, blast.hue, blast.strength)
      if (n < MAX_BURSTS) {
        // Seeded well wider than the dye, so the sparks lead the smoke out rather than appearing inside
        // it — and so they do not all land on top of each other, which on an additive field is a white
        // disc rather than a burst. The fluid then carries both, so they converge over the next second.
        field.particles.burst(splat.u, splat.v, splat.radius * 3.2, particlesForBlast(blast))
      }
    }

    if (soundOn) {
      for (const cue of world.effects.sounds) playCue(cue)
    }
    if (world.effects.shake > 0) addShake(world.effects.shake)

    // The ship's wake. Not an effect the simulation emits, because it is not an event — it is a
    // property of the ship being somewhere, every frame, and the step has no reason to publish that.
    const ship = world.ship
    if (ship.present && length(ship.vel) > WAKE_MIN_SPEED) {
      // `dt` rather than a magnitude: this is a source that runs for as long as the ship is moving, so it
      // has to be integrated. See the note on `WAKE` in blasts.ts for what happens otherwise.
      field.fluid.splat(splatForWake(ship.pos.x, ship.pos.y, ship.vel.x, ship.vel.y, dt))
    }

    clearEffects(world)
    stepFlashes(dt)

    // The attract screen has no kills and no wake, so the fluid would otherwise sit perfectly still behind the
    // title — the one screen where the thing that makes this game look the way it does is invisible. A wash every
    // few seconds is the arena demonstrating itself. See `wash.ts`.
    if (world.status === 'menu') {
      for (const splat of stepWash(wash.current, dt)) field.fluid.splat(splat)
    }

    // --- fields --------------------------------------------------------------
    field.fluid.update(dt)
    field.particles.update(
      dt,
      field.fluid.available ? field.fluid.velocityTexture : null,
      field.fluid.available ? field.fluid.dyeTexture : null,
    )
    // The drawing buffer changes size whenever the adaptive render scale moves, and point sizes are in
    // pixels — so this is re-derived every frame rather than on resize. It is two multiplies.
    field.particles.setProjection(state.gl.getDrawingBufferSize(bufferSize).y, FOV)

    // --- the beat ------------------------------------------------------------
    // Read here rather than in the components that use it, so there is one analysis a frame feeding one shared
    // number — see `beat.ts`. Silent, muted or still loading all come out the same way: energy zero, pulse
    // decaying to zero, every consumer at its base value.
    const analyser = musicAnalyser()
    if (analyser) {
      if (!spectrum.current || spectrum.current.length !== analyser.frequencyBinCount) {
        spectrum.current = new Uint8Array(analyser.frequencyBinCount)
      }
      analyser.getByteFrequencyData(spectrum.current)
      const hzPerBin = analyser.context.sampleRate / analyser.fftSize
      setBeatPulse(feedBeat(beat.current, lowBandEnergy(spectrum.current, hzPerBin), dt))
    } else {
      setBeatPulse(feedBeat(beat.current, 0, dt))
    }

    // --- publish -------------------------------------------------------------
    useGameStore.getState().publishHud()

    if (world.status === 'gameover') {
      gameOverFor.current += dt
      if (gameOverFor.current > GAMEOVER_HOLD) {
        gameOverFor.current = 0
        useGameStore.getState().attract()
      }
    } else {
      gameOverFor.current = 0
    }
  })

  return null
}

function magnitude(blast: { radius: number; strength: number }): number {
  return blast.radius * blast.radius * blast.strength
}
