import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
} from 'three'
import { BULLET, ENEMY, GEOM, SNIPER } from '../game/constants'
import { getWorld } from '../game/useGameStore'
import { regularPolygon, strokedPolygon } from '../render/outline'
import { bulletGeometry, geomGeometry } from '../render/shapes'

// The three kinds of small thing: the player's bullets, the rounds fired back at them, and the geoms they are
// trying to pick up. All the same problem — a few hundred small identical additive shapes — so they share a
// file, and differ in exactly the ways that stop them being mistaken for each other.

/** Bullets live 1.05s at eleven a second in pairs, so about two dozen are ever live at once; the rest of
 *  this is headroom for a future weapon that fires wider. */
const MAX_BULLETS = 256
/** Geoms accumulate when a player is too busy to collect them, and a bomb into a full arena drops none —
 *  see `detonateBomb` — so the realistic ceiling is one wave's worth of kills. */
const MAX_GEOMS = 384
/** Snipers are capped at a handful and fire every 2.6s, so a dozen rounds in the air at once would be a very
 *  bad singularity wave. The rest is headroom. */
const MAX_HOSTILES = 64

const dummy = new Object3D()

export function Bullets() {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      geometry: bulletGeometry(),
      material: new MeshBasicMaterial({
        // Gold, and it used to be a pale cyan-white — which was wrong twice over. It bloomed to very nearly
        // the white of the geoms, so the thing you fire and the thing you collect were the same colour; and
        // pale blue on a blue grid is the worst contrast available in this arena. Gold is the HUD's colour for
        // what belongs to the player (bombs, the multiplier), it is nowhere near white, and it is the highest
        // contrast there is against a blue floor.
        color: 0xffc233,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    }),
    [],
  )

  useFrame(() => {
    const instances = mesh.current
    if (!instances) return

    let count = 0
    for (const bullet of getWorld().bullets) {
      if (!bullet.alive) continue
      if (count >= MAX_BULLETS) break

      dummy.position.set(bullet.pos.x, bullet.pos.y, 0.2)
      // Oriented by velocity rather than by the angle it was fired at, which matters near a well: a shot
      // whose path has been bent should be pointing along the curve it is actually travelling, not at
      // where it was aimed ten metres ago.
      dummy.rotation.z = Math.atan2(bullet.vel.y, bullet.vel.x)
      dummy.scale.set(BULLET.radius, BULLET.radius, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_BULLETS]} frustumCulled={false} />
}

/**
 * The rounds snipers have fired at you.
 *
 * Drawn deliberately unlike a player bullet, because mistaking one for the other in either direction is fatal:
 * they are red — the sniper's own colour, so it is obvious where the shot came from — round rather than
 * pointed, and they pulse. A pointed dart implies "travelling fast, will be past you in a moment", which is
 * exactly the wrong thing to think about a round doing 44 units a second that is going to cross the whole
 * arena. See `Hostile` for why they cannot be shot down.
 */
export function Hostiles() {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      // A ring, filled enough to read as solid at this size.
      geometry: strokedPolygon(regularPolygon(9), 0.85),
      material: new MeshBasicMaterial({
        color: new Color().setHSL(ENEMY.sniper.hue, 1, 0.62),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    }),
    [],
  )

  useFrame((state) => {
    const instances = mesh.current
    if (!instances) return

    let count = 0
    for (const hostile of getWorld().hostiles) {
      if (!hostile.alive) continue
      if (count >= MAX_HOSTILES) break

      dummy.position.set(hostile.pos.x, hostile.pos.y, 0.3)
      dummy.rotation.z = Math.atan2(hostile.vel.y, hostile.vel.x)
      // Pulsing, on a shared clock. A steady dot at this size is easy to lose against a busy grid, and the
      // one thing that must never happen is a player not noticing a round that is already on its way.
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 14) * 0.14
      const scale = SNIPER.shotRadius * pulse
      dummy.scale.set(scale, scale, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_HOSTILES]} frustumCulled={false} />
}

export function Geoms() {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      geometry: geomGeometry(),
      material: new MeshBasicMaterial({
        // White, and reserved: every enemy in the game is a saturated hue (see `ENEMY_COLOUR`), so nothing
        // hostile can ever look like this. The first version was mint green at hue 0.45, sitting exactly
        // between the drifter's azure and the wanderer's green — so the one thing you are supposed to fly
        // into looked like two of the things that kill you.
        color: 0xffffff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    }),
    [],
  )

  useFrame((state) => {
    const instances = mesh.current
    if (!instances) return

    let count = 0
    for (const geom of getWorld().geoms) {
      if (!geom.alive) continue
      if (count >= MAX_GEOMS) break

      // Fades out over its last second and a half rather than vanishing, so a geom you were on your way
      // to is a geom you can see you are about to lose. Scale rather than opacity: these are additive, so
      // shrinking them dims them, and one instanced material cannot carry a per-instance alpha without an
      // instance colour attribute this does not otherwise need.
      const remaining = GEOM.life - geom.age
      const fade = Math.min(1, remaining / 1.5)
      // Spun on a shared clock, so the whole scatter twinkles together — they are crystals, and crystals
      // catching the light at the same moment is more legible than each one doing its own thing.
      dummy.position.set(geom.pos.x, geom.pos.y, 0.1)
      dummy.rotation.z = state.clock.elapsedTime * 2.2 + geom.id
      const scale = GEOM.radius * fade
      dummy.scale.set(scale, scale, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_GEOMS]} frustumCulled={false} />
}
