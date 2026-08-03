import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D } from 'three'
import { flashProgress, flashes } from '../render/flashes'
import { hueToRgb } from '../render/blasts'
import { filledPolygon, regularPolygon, strokedPolygon } from '../render/outline'

// The two fast layers of an impact: a white core and an expanding ring.
//
// See `flashes.ts` for why they exist at all — in short, everything else about an explosion is slow, and an
// impact needs something that is over before you can look at it. Two instanced meshes, both driven from the same
// pool so a core can never outlive its own ring.

const dummy = new Object3D()
const tint = new Color()

/** The core's size, as a fraction of the blast radius. Smaller than the blast: it is the bright centre of the
 *  event, not an outline of it. */
const CORE_SCALE = 0.55

/** What the ring expands from and to, as fractions of the blast radius. Past 1, because a shockwave should
 *  overrun the mark it leaves — a ring that stops at the dye's edge reads as a boundary rather than a wave. */
const RING_FROM = 0.25
const RING_TO = 1.6

export function Flashes() {
  return (
    <group>
      <Cores />
      <Rings />
    </group>
  )
}

/**
 * The white core.
 *
 * Dies in the first third of the flash's life, and shrinks rather than growing. Both halves of that matter: a
 * core that grows reads as something arriving, and a core that lasts as long as the ring turns the whole thing
 * into a blob with an outline instead of a flash with a shockwave.
 */
function Cores() {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      geometry: filledPolygon(regularPolygon(16)),
      material: new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
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
    for (const flash of flashes()) {
      const t = flashProgress(flash)
      if (t === null || t > 0.34) continue

      // Normalised across the core's own third of the life, so it fades to nothing exactly as it disappears
      // rather than being cut off mid-brightness.
      const fade = 1 - t / 0.34
      const scale = flash.radius * CORE_SCALE * (0.55 + fade * 0.65)
      dummy.position.set(flash.x, flash.y, 0.5)
      dummy.rotation.z = 0
      dummy.scale.set(scale, scale, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)

      // Barely tinted. The core is the part that saturates to white — the hue lives in the ring, and a core
      // that carried it too would just be a coloured blob.
      const [r, g, b] = hueToRgb(flash.hue)
      const heat = fade * fade * (0.7 + flash.strength * 0.6)
      tint.setRGB(0.75 + r * 0.25, 0.75 + g * 0.25, 0.75 + b * 0.25).multiplyScalar(heat)
      instances.setColorAt(count, tint)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, 48]} frustumCulled={false} />
}

/** The shockwave: a thin ring that overruns the blast and thins as it goes. */
function Rings() {
  const mesh = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(
    () => ({
      // Thin at radius 1, so the instance scale is the ring's radius and the stroke scales with it — which is
      // what makes a big ring read as a big wave rather than as a thicker small one.
      geometry: strokedPolygon(regularPolygon(32), 0.07),
      material: new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
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
    for (const flash of flashes()) {
      const t = flashProgress(flash)
      if (t === null) continue

      // Eased out, so the ring leaves fast and slows as it fades — a linear expansion reads as a mechanical
      // circle growing, and this should read as something being thrown outward.
      const eased = 1 - (1 - t) * (1 - t)
      const scale = flash.radius * (RING_FROM + (RING_TO - RING_FROM) * eased)
      dummy.position.set(flash.x, flash.y, 0.45)
      dummy.rotation.z = 0
      dummy.scale.set(scale, scale, 1)
      dummy.updateMatrix()
      instances.setMatrixAt(count, dummy.matrix)

      const [r, g, b] = hueToRgb(flash.hue)
      // Starts white and falls back to its own hue as it expands, which is what a cooling front does.
      const fade = (1 - t) * (1 - t)
      const white = (1 - t) * 0.7
      tint
        .setRGB(r + (1 - r) * white, g + (1 - g) * white, b + (1 - b) * white)
        .multiplyScalar(fade * (1.1 + flash.strength * 0.9))
      instances.setColorAt(count, tint)
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, 48]} frustumCulled={false} />
}
