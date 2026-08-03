import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { AdditiveBlending, ShaderMaterial } from 'three'
import { ARENA } from '../game/constants'
import { DYE_DISPLAY_FRAGMENT } from '../gpu/fluidShaders'
import { useField } from './Field'

// The dye field, drawn as the arena's floor covering.
//
// One quad, under the grid, sampling the fluid's dye texture. Everything that gives it its content is
// elsewhere — the splats in `blasts.ts`, the advection in `fluid.ts` — so this component is genuinely
// just the window onto it.
//
// Additive rather than opaque, and that is what makes the arena feel like it is made of light: the dye
// adds to the black of the page and to the grid drawn on top of it, so smoke over a grid line brightens
// the line instead of covering it.

/** The vertex half of the display pass. The solver's own passes get away with no matrices because their
 *  quad is already in clip space; this one is a real object in the world and needs the camera. */
const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** How bright the dye is on screen, before the tone map in the shader. Over one, deliberately: the tone
 *  map is what holds it in range, and giving it a signal well above 1 is what lets a fresh splat clip to
 *  white while the smoke around it keeps its hue. */
const INTENSITY = 1.15

/** Black point. Anything below this is nothing at all — see the note in `DYE_DISPLAY_FRAGMENT` about
 *  why an arena that never looks empty has no range left for being full. */
const FLOOR = 0.06

export function Backdrop() {
  const field = useField()

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BACKDROP_VERTEX,
        fragmentShader: DYE_DISPLAY_FRAGMENT,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uDye: { value: null },
          uIntensity: { value: INTENSITY },
          uFloor: { value: FLOOR },
        },
      }),
    [],
  )

  useFrame(() => {
    // Reassigned each frame because the dye field ping-pongs. On a machine with no float targets the
    // fluid never runs, the uniform stays null, and three samples an empty texture as black — which is
    // exactly the right fallback: no smoke, and everything else still works.
    if (field.fluid.available) material.uniforms.uDye.value = field.fluid.dyeTexture
  })

  return (
    <mesh material={material} position={[0, 0, -3.2]}>
      {/* Exactly the arena, not a unit larger. The dye's uv space is the arena's, so any mismatch here
          would put the smoke visibly off the explosion that made it. */}
      <planeGeometry args={[ARENA.halfWidth * 2, ARENA.halfHeight * 2]} />
    </mesh>
  )
}
