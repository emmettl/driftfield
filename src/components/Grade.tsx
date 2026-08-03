import { useRef } from 'react'
import { Vector2 } from 'three'
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  Noise,
  Vignette,
} from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { quality } from '../game/device'
import { START_FACTOR } from '../game/renderScale'

// The colour grade, and the reason the arena looks like light rather than like geometry.
//
// Bloom is not optional here in the way it usually is. Everything in the scene is additive and unlit:
// the enemies are thin ribbons, the grid is one-pixel lines, the particles are sub-pixel points. Without
// a bloom pass those are a wireframe diagram — the glow is what turns a two-pixel ribbon into a tube of
// light, and it is why the geometry could be built as thin as it is.
//
// The rest of the stack is the difference between a bright wireframe and a screen. A little extra
// saturation so the hues have somewhere to bleed to, a lens offset that separates the channels by well
// under a pixel, grain, and a vignette that lets the corners fall away.
//
// **Nothing here is animated, and it cannot be.** The bloom swells on the beat — but by the *scene* getting
// brighter (see `beatPulse` in Arena and Enemies), never by this component touching the pass. Two reasons, and
// the first one is fatal: `@react-three/postprocessing` serialises its children with `JSON.stringify` to decide
// when to rebuild the pass chain, so attaching a ref to an effect puts a populated ref object — which
// transitively reaches the scene graph — into something being stringified, and the whole canvas dies with
// "Converting circular structure to JSON" on the second render. And passing the pulse as a prop instead would
// re-render this component sixty times a second, rebuilding that pass chain on every frame.
//
// The indirect route is also the more honest one: bloom responds to a brighter arena because that is what bloom
// does, rather than because something reached in and turned it up.

// Well under a pixel. The grid is one-pixel lines and the outlines are two, so an offset large enough to
// see on a solid edge fringes every line in the arena red and green — the effect has to be felt in the
// wash rather than seen on the geometry.
const ABERRATION = new Vector2(0.00042, 0.00032)

/**
 * @param factor Measured performance from `AdaptiveRenderScale`. Below the opening guess the machine has
 * already been caught dropping frames, and the softer half of the grade is the first thing that should
 * go — the bloom and the vignette carry the look, and neither the grain nor the lens bleed is worth a
 * frame.
 */
export function Grade({ factor = START_FACTOR }: { factor?: number }) {
  // Latched: once a machine has shown it cannot afford the extras, they stay off. The composer rebuilds
  // its pass chain when this list changes, so it must not be able to oscillate — a hitch every time the
  // frame rate wobbles would cost more than the passes save.
  const dropped = useRef(false)
  if (factor < START_FACTOR) dropped.current = true
  const rich = quality.richGrade && !dropped.current

  return (
    <EffectComposer>
      {/* Mipmap blur rather than the older kernel-based path: it is a fixed cost per frame regardless of
          how wide the glow is, which is what makes a radius this large affordable at all. The threshold
          is low because almost nothing in this scene is dim — the intent is that everything blooms a
          little and the bright things bloom enormously. */}
      <Bloom
        mipmapBlur
        intensity={quality.bloomIntensity}
        luminanceThreshold={0.18}
        luminanceSmoothing={0.85}
        radius={0.86}
      />
      <HueSaturation saturation={0.18} hue={0} />
      {rich ? (
        <ChromaticAberration
          offset={ABERRATION}
          radialModulation
          modulationOffset={0.3}
          blendFunction={BlendFunction.NORMAL}
        />
      ) : (
        <></>
      )}
      {rich ? <Noise premultiply opacity={0.04} blendFunction={BlendFunction.OVERLAY} /> : <></>}
      <Vignette offset={0.22} darkness={0.78} eskil={false} />
    </EffectComposer>
  )
}
