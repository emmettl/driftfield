import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import { beatPulse } from '../game/beat'
import { CAMERA_LEAN, MOBILE_LEAN, fitCamera } from '../game/cameraFit'
import { isMobile } from '../game/device'
import { smoothing } from '../game/constants'
import { stepShake } from '../game/shake'
import { getWorld } from '../game/useGameStore'
import { Arena } from './Arena'
import { Backdrop } from './Backdrop'
import { Bullets, Geoms, Hostiles } from './Bullets'
import { Enemies } from './Enemies'
import { Flashes } from './Flashes'
import { GameLoop } from './GameLoop'
import { Particles } from './Particles'
import { Ship } from './Ship'

// Everything in the arena, in the order it is drawn.
//
// The order is the composition: dye, then the grid, then the things in the arena from least to most
// important, then the particle field over the top of all of it. Everything is additive and nothing
// writes depth, so this list *is* the layering — there is no depth sorting to fall back on, which is
// deliberate. Additive neon has no occlusion to get wrong, and a hundred thousand sprites with the
// depth test off is a great deal cheaper than one with it on.

export function Scene({ rolled = false }: { rolled?: boolean }) {
  return (
    <>
      <CameraRig rolled={rolled} />
      <Backdrop />
      <Arena />
      <Geoms />
      <Bullets />
      <Enemies />
      {/* After the enemies, so a round crossing one is drawn over it — the shot is the more urgent thing. */}
      <Hostiles />
      <Ship />
      {/* Over the entities: a flash is the brightest thing in the frame for a tenth of a second and nothing
          should be drawn on top of it. */}
      <Flashes />
      <Particles />
      <GameLoop />
    </>
  )
}

/**
 * The camera: fitted to the window, leaning with the ship, shaken, and — in portrait — rolled a quarter turn.
 *
 * It never rotates to look at anything. A camera that turns towards the ship would put the arena into
 * perspective from the side, and the grid's lines — which are the game's frame of reference — would
 * converge differently depending on where the player was standing. So it stays square to the arena and
 * only ever translates, which keeps the floor's geometry constant and means the lean can be felt
 * without being read.
 *
 * The roll is the one exception, and it is square to the arena too: a quarter turn about the view axis, so a tall
 * screen can show the arena's long axis running down it instead of a letterboxed strip across the middle. It is
 * worth nearly three times the playfield area on a portrait phone, and it costs the simulation nothing — the arena
 * is the same 120 × 68 either way round. See `layout.ts`.
 */
function CameraRig({ rolled }: { rolled: boolean }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const size = useThree((state) => state.size)
  /** The fitted distance, kept so the beat can breathe around it without losing the fit. */
  const distance = useRef(0)
  /** The base roll, kept for the same reason: the shake adds to it every frame and must not overwrite it. */
  const roll = useRef(0)
  // No lean on a phone, and the fit hands back the margin that was only ever there to cover it. See `MOBILE_LEAN`.
  const lean = isMobile ? MOBILE_LEAN : CAMERA_LEAN

  useEffect(() => {
    const fit = fitCamera(size.width / Math.max(1, size.height), lean, rolled)
    camera.fov = fit.fov
    distance.current = fit.distance
    roll.current = fit.roll
    camera.position.set(0, 0, fit.distance)
    camera.rotation.set(0, 0, fit.roll)
    camera.updateProjectionMatrix()
  }, [camera, size, lean, rolled])

  useFrame((state, dt) => {
    const shake = stepShake(dt)
    const ship = getWorld().ship

    const leanX = ship.present ? ship.pos.x * lean : 0
    const leanY = ship.present ? ship.pos.y * lean : 0
    // Eased rather than followed. The lean is small, so easing is not about smoothing out jitter — it is
    // so that a death, which teleports the ship back to the centre, does not snap the whole arena
    // sideways on the frame the player is already reeling from.
    const k = smoothing(3.5, dt)

    // Shake as a pair of out-of-phase sines rather than as noise. Random offsets per frame look like a
    // dropped frame at low amplitude and like a fault at high; a couple of incommensurable frequencies
    // read as a physical wobble, and cost two `sin` calls.
    const t = state.clock.elapsedTime
    const amplitude = shake * 1.4
    const shakeX = Math.sin(t * 47) * amplitude
    const shakeY = Math.cos(t * 61.7) * amplitude

    camera.position.x += (leanX + shakeX - camera.position.x) * k
    camera.position.y += (leanY + shakeY - camera.position.y) * k
    // A breath in on the beat, and a very small one — three parts in a thousand of the camera's distance. Small
    // enough that nobody would name it if asked what the screen was doing, large enough that turning it off is
    // noticeable. The fit is preserved because it pushes *in*: the arena can only ever be more than framed.
    if (distance.current > 0) {
      camera.position.z = distance.current * (1 - beatPulse() * 0.003)
    }
    // A little roll, which is what makes a bomb feel like an impact rather than a pan. Kept under a
    // degree: any more and the arena's walls visibly stop being parallel to the screen. Added to the base roll
    // rather than assigned — in portrait that base is a quarter turn, and assigning here would undo it on the first
    // frame and leave the arena letterboxed with the sticks mapped sideways.
    camera.rotation.z = roll.current + shake * 0.008 * Math.sin(t * 37)
  })

  return null
}
