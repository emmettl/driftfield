import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import { SHIP } from '../game/constants'
import { getWorld } from '../game/useGameStore'
import { length } from '../game/vec'
import { shipGeometry } from '../render/shapes'
import { regularPolygon, strokedPolygon } from '../render/outline'

// The ship, and the only thing in the game drawn as a single object.
//
// Three parts, each doing one job: the hull, which tells you where you are and which way you are facing;
// the thruster, which tells you which way you are *travelling*, and is the reason a twin-stick is
// readable at all; and the reticle, a ring out along the aim that answers "where will my shots go" without
// the player having to infer it from the hull.
//
// Facing and travel being different is the whole genre, and it is also the thing new players find
// confusing — so the two are given completely different visual languages. The hull points at the aim and
// never lies about it. The thruster is behind the velocity, scales with speed, and is the only part of the
// ship that is not rigidly attached to the facing.

/** How far ahead of the ship the reticle sits, in world units. Far enough to be a separate object,
 *  near enough to be seen in the same glance as the ship. */
const RETICLE_DISTANCE = 9

export function Ship() {
  const group = useRef<Group>(null)
  const hull = useRef<Mesh>(null)
  const thruster = useRef<Mesh>(null)
  const reticle = useRef<Mesh>(null)

  const geometries = useMemo(
    () => ({
      hull: shipGeometry(),
      // A short bar for the exhaust, stretched by the instance scale rather than animated, so its length
      // is a direct readout of speed.
      thruster: strokedPolygon(
        [
          { x: 0, y: 0.55 },
          { x: -1, y: 0.16 },
          { x: -1, y: -0.16 },
          { x: 0, y: -0.55 },
        ],
        0.34,
      ),
      reticle: strokedPolygon(regularPolygon(3, Math.PI / 2), 0.22),
    }),
    [],
  )

  const materials = useMemo(
    () => ({
      hull: new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
      thruster: new MeshBasicMaterial({
        color: 0x4fb4ff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
      reticle: new MeshBasicMaterial({
        color: 0xff5ea8,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    }),
    [],
  )

  useFrame((state) => {
    const container = group.current
    if (!container) return

    const ship = getWorld().ship
    container.visible = ship.present
    if (!ship.present) return

    container.position.set(ship.pos.x, ship.pos.y, 0.4)

    // Invulnerability blinks the hull rather than tinting it. A tint has to compete with the additive
    // blending and the bloom, and loses; a blink is unmistakable at any brightness. Fast enough to read as
    // "protected" rather than as a rendering fault.
    const blinking = ship.invulnerable > 0 && Math.sin(state.clock.elapsedTime * 30) < -0.1
    if (hull.current) {
      hull.current.rotation.z = ship.aim
      hull.current.scale.setScalar(SHIP.radius)
      hull.current.visible = !blinking
    }

    const speed = length(ship.vel)
    if (thruster.current) {
      // Behind the direction of travel, not behind the nose. At full speed sideways this puts the flame
      // out of the ship's flank, which looks wrong for an aircraft and is exactly right for something
      // that manoeuvres like this — it is the only cue that the ship is sliding.
      const heading = Math.atan2(ship.vel.y, ship.vel.x)
      const stretch = Math.min(1, speed / SHIP.speed)
      thruster.current.visible = stretch > 0.06
      thruster.current.rotation.z = heading
      thruster.current.position.set(
        -Math.cos(heading) * SHIP.radius * 1.25,
        -Math.sin(heading) * SHIP.radius * 1.25,
        0,
      )
      // Long enough to read as thrust at a glance, and not longer than the hull by much: the exhaust is
      // the cue for which way you are *travelling*, and a flame twice the length of the ship stops being a
      // cue and starts being the thing you track instead of the ship.
      thruster.current.scale.set(SHIP.radius * (0.55 + stretch * 1.4), SHIP.radius * 0.55, 1)
    }

    if (reticle.current) {
      reticle.current.position.set(
        Math.cos(ship.aim) * RETICLE_DISTANCE,
        Math.sin(ship.aim) * RETICLE_DISTANCE,
        0,
      )
      reticle.current.rotation.z = ship.aim - Math.PI / 2
      // Pulses on the fire cooldown, so the reticle is also a rate-of-fire readout. Costs nothing and
      // means the gun is legible without a HUD element for it.
      const heat = Math.max(0, ship.cooldown / SHIP.fireInterval)
      reticle.current.scale.setScalar(1.1 + heat * 0.5)
    }
  })

  return (
    <group ref={group}>
      <mesh ref={thruster} geometry={geometries.thruster} material={materials.thruster} />
      <mesh ref={hull} geometry={geometries.hull} material={materials.hull} />
      <mesh ref={reticle} geometry={geometries.reticle} material={materials.reticle} />
    </group>
  )
}
