import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { AdaptiveRenderScale } from './components/AdaptiveRenderScale'
import { FieldProvider } from './components/Field'
import { Grade } from './components/Grade'
import { Scene } from './components/Scene'
import { useAudioRecovery } from './game/audioRecovery'
import { isTouch } from './game/device'
import { useLayout } from './game/useLayout'
import { START_FACTOR } from './game/renderScale'
import { useMusic } from './game/useMusic'
import { useRenderDpr } from './game/useRenderDpr'
import { Respawning, WaveBanner, WaveClear } from './ui/Banners'
import { Hud } from './ui/Hud'
import { Overlay } from './ui/Overlay'
import { RotateHint } from './ui/RotateHint'
import { TouchZones } from './ui/TouchZones'

export default function App() {
  // The soundtrack follows the wave mode; see `musicCue.ts` for which song goes where.
  useMusic()
  // iOS takes the audio context away on a call or a backgrounding and does not give it back on its own.
  // See `audioRecovery.ts`.
  useAudioRecovery()

  // Rendering opens at a pixel-budget cap, so a maximised window on a dense display never asks the GPU
  // for four times the frame it can fill, and then follows the frame rate this machine actually achieves.
  // See `renderScale.ts`.
  const [factor, setFactor] = useState(START_FACTOR)

  // How the screen is divided between the playfield and the controls. On a desktop the canvas is the window and
  // this is a no-op; on touch it reserves a band along the bottom and fits the canvas to the arena's own shape.
  // All the reasoning — and the cost in playfield size — is in `layout.ts`.
  const layout = useLayout()
  // Priced against the canvas rather than the window: on touch they are different, and the budget is about the
  // pixels actually shaded.
  const dpr = useRenderDpr(factor, layout.canvas)

  return (
    <div className="app">
      <div
        className="stage"
        // Sized in JS rather than by CSS, because the same numbers have to be the ones the layout tests assert on
        // and the ones r3f measures for the camera fit. A CSS approximation of `resolveLayout` would be a second
        // implementation of it, free to disagree.
        style={{ width: `${layout.canvas.width}px`, height: `${layout.canvas.height}px` }}
      >
        <Canvas
          dpr={dpr}
          // The whole scene is additive neon on black and every edge in it is already softened by the bloom,
          // so MSAA would cost bandwidth to smooth edges that are not there. The grade's own passes are the
          // anti-aliasing.
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true }}
          // Position and fov are overwritten by the camera rig once the viewport is known — this is only so
          // the first frame is not drawn from inside the arena.
          camera={{ position: [0, 0, 120], fov: 38, near: 0.5, far: 400 }}
          // The arena is drawn in linear-ish additive values that the grade tone-maps; three's own
          // ACESFilmic pass on top of that would flatten every highlight the bloom is there to catch.
          flat
        >
          <color attach="background" args={['#03040c']} />
          <AdaptiveRenderScale onFactor={setFactor} />
          <FieldProvider>
            <Scene />
          </FieldProvider>
          <Grade factor={factor} />
        </Canvas>

        {/* Inside the stage, so on touch they sit over the playfield rather than over the control band. */}
        <Hud />
        <WaveBanner />
        <WaveClear />
        <Respawning />
        <Overlay />
      </div>

      {/* The controls get a strip of their own below the playfield. Only where there is no pointer: drawing them on
          a laptop with a touchscreen would take the mouse away from a player using it. */}
      {isTouch ? <TouchZones stickRange={layout.stickRange} /> : null}

      {/* Over everything, including the band — there is nothing to do in portrait but turn the phone. */}
      {layout.rotate ? <RotateHint /> : null}
    </div>
  )
}
