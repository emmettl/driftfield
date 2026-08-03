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
import { beatPulse } from '../game/beat'
import { SNIPER, SPAWN_GRACE, WELL } from '../game/constants'
import type { EnemyKind } from '../game/types'
import { getWorld } from '../game/useGameStore'
import { sniperAiming } from '../game/enemies'
import { wellStress } from '../game/wells'
import { ENEMY_COLOUR, enemyGeometry } from '../render/shapes'
import { regularPolygon, strokedPolygon } from '../render/outline'

// Every enemy on screen, in six draw calls.
//
// One `InstancedMesh` per kind, rebuilt from the world's arrays every frame. Instancing rather than a
// component per enemy, for the obvious reason — two hundred React components mounting and unmounting
// through a wave would cost more than the simulation does — and the arrays are read directly rather than
// through the store, so a wave's worth of movement causes no renders at all. This component renders once
// and then never again; everything after that happens in `useFrame`.

/**
 * Instances reserved per kind.
 *
 * One number for all six rather than a table, because the cost of a reserved instance is 16 floats of
 * matrix and three of colour — 76 bytes — and a table of six carefully chosen limits would be six things
 * to get wrong when the spawn mix changes. 256 comfortably covers the worst wave the director can
 * produce (a late singularity wave with three wells pumping out drifters), and the overflow behaviour is
 * to stop drawing rather than to stop simulating, which is the right way round: an enemy that is not
 * drawn can still kill you, and being killed by something invisible would be a genuine bug — hence the
 * headroom.
 */
const MAX_PER_KIND = 256

const KINDS: EnemyKind[] = [
  'drifter',
  'wanderer',
  'weaver',
  'snake',
  'rock',
  'well',
  'swarmer',
  'sniper',
]

const dummy = new Object3D()
const tint = new Color()

export function Enemies() {
  return (
    <group>
      {KINDS.map((kind) => (
        <EnemyKindMesh key={kind} kind={kind} />
      ))}
      <WellHalos />
    </group>
  )
}

function EnemyKindMesh({ kind }: { kind: EnemyKind }) {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      geometry: enemyGeometry(kind),
      material: new MeshBasicMaterial({
        // White, because the instance colour multiplies it. A tinted base would multiply twice and every
        // enemy would be darker than its own colour.
        color: 0xffffff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        // The outlines are flat ribbons and the instance matrix can mirror them; a back-face cull would
        // make an enemy vanish for the half of its spin where the ribbon faces away.
        side: DoubleSide,
      }),
    }),
    [kind],
  )

  useFrame(() => {
    const instances = mesh.current
    if (!instances) return

    const base = ENEMY_COLOUR[kind]
    // The beat, applied to everything in the arena at once. This is how the bloom ends up swelling with the
    // music: the pass itself is never touched (see `Grade`), the scene simply gets brighter and the glow
    // follows — which is what bloom is for.
    const pulse = 1 + beatPulse() * 0.2
    let count = 0

    for (const enemy of getWorld().enemies) {
      if (enemy.kind !== kind || !enemy.alive) continue
      if (count >= MAX_PER_KIND) break

      // Materialising: scales up from a third and burns bright white on the way in. Both halves matter —
      // the scale is what makes it read as arriving, and the brightness is what makes it impossible to
      // miss, which is the whole point of a spawn you cannot yet be hit by.
      const arriving = Math.min(1, enemy.age / SPAWN_GRACE)
      const scale = enemy.radius * (0.35 + 0.65 * arriving)

      dummy.position.set(enemy.pos.x, enemy.pos.y, 0)
      dummy.rotation.z = enemy.angle
      dummy.scale.set(scale, scale, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)

      let brightness = 0.85 + (1 - arriving) * 2.6
      // A well brightens as it fills up, so twenty seconds of shooting into something that appears not
      // to change is instead twenty seconds of watching it get hotter.
      if (kind === 'well') brightness *= 0.7 + wellStress(enemy) * 1.9
      // The sniper's telegraph, and it is the enemy's whole fairness budget. It is the only thing that can
      // reach across the arena, so the half-second before it fires it stops moving (see `steerSniper`) and
      // flares — the two halves have to agree, which is why both ask `sniperAiming` rather than each deciding.
      // Ramped rather than switched, so the flare is a wind-up you can time and not a light coming on.
      if (kind === 'sniper' && sniperAiming(enemy)) {
        brightness *= 1 + 2.4 * (1 - enemy.spawnTimer / SNIPER.telegraph)
      }
      // A swarmer is a fifth the area of a drifter, so at the same brightness it disappears in a busy frame.
      if (kind === 'swarmer') brightness *= 1.5
      tint.copy(base).multiplyScalar(brightness * pulse)
      instances.setColorAt(count, tint)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, MAX_PER_KIND]}
      // The arrays are rewritten every frame from world positions that three never sees, so the bounds
      // three would compute are the bounds of an empty mesh.
      frustumCulled={false}
    />
  )
}

/**
 * The accretion ring around a gravity well.
 *
 * A well's own outline is three units across and its pull reaches thirty-four, so without something
 * showing the extent, the first thing a player learns about a well is that they were already inside it.
 * The halo is drawn at the real reach — it is not decoration, it is the hitbox of the gravity — and it
 * spins and brightens with the well's stress.
 */
function WellHalos() {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      // Thin, and at radius 1 like everything else, so the instance scale is the reach. Sixty-four sides
      // rather than a couple of dozen: this is drawn at 34 world units, so at 28 sides each edge is over
      // seven units long and the ring is visibly a polygon — which reads as a rendering fault rather than
      // as a circle, on the one object whose whole job is to describe a radius.
      geometry: strokedPolygon(regularPolygon(64), 0.012),
      material: new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        // Faint. It is a boundary, not a wall — and it is on screen for as long as the well is, so it has
        // to be legible without becoming the thing the player is looking at.
        opacity: 0.32,
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

    const base = ENEMY_COLOUR.well
    let count = 0
    for (const enemy of getWorld().enemies) {
      if (enemy.kind !== 'well' || !enemy.alive) continue
      if (count >= 4) break

      const stress = wellStress(enemy)
      dummy.position.set(enemy.pos.x, enemy.pos.y, -0.6)
      // Counter-rotating against the well's own spin, which is a cheap way to make one object read as
      // two things — a core and something falling into it.
      dummy.rotation.z = -state.clock.elapsedTime * (0.4 + stress)
      const scale = WELL.reach * (0.86 + Math.sin(state.clock.elapsedTime * 3 + count) * 0.03)
      dummy.scale.set(scale, scale, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)
      tint.copy(base).multiplyScalar(0.5 + stress * 1.6)
      instances.setColorAt(count, tint)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, 4]} frustumCulled={false} />
}
