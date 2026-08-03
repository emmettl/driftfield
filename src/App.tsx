import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { AdaptiveRenderScale } from './components/AdaptiveRenderScale'
import { FieldProvider } from './components/Field'
import { Grade } from './components/Grade'
import { Scene } from './components/Scene'
import { useAudioRecovery } from './game/audioRecovery'
import { useLayout } from './game/useLayout'
import { START_FACTOR } from './game/renderScale'
import { useMusic } from './game/useMusic'
import { useRenderDpr } from './game/useRenderDpr'
import { Respawning, WaveBanner, WaveClear } from './ui/Banners'
import { Hud } from './ui/Hud'
import { Overlay } from './ui/Overlay'
import { TouchBand, TouchRail } from './ui/TouchZones'

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

  // How the screen is divided between the playfield and the controls, and which way round the arena is drawn. On a
  // desktop the canvas is the window and this is a no-op; on touch it reserves space for the sticks, fits the canvas
  // to the arena's own shape, and on a tall screen rolls the view a quarter turn so the arena's long axis runs down
  // it. All the reasoning — and the numbers — are in `layout.ts`.
  const layout = useLayout()
  // Priced against the canvas rather than the window: on touch they are different, and the budget is about the
  // pixels actually shaded.
  const dpr = useRenderDpr(factor, layout.canvas)
  const rails = layout.placement === 'rails'

  return (
    // A row when the controls are rails, a column when they are a band — see `resolveLayout` for which and why.
    <div className={`app app-${layout.placement}`}>
      {/* One rail either side of the stage, so in a flex row the playfield ends up between them rather than pushed
          off the edge — see `TouchRail`. */}
      {rails ? <TouchRail side="left" layout={layout} /> : null}

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
            <Scene rolled={layout.rolled} />
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

      {rails ? <TouchRail side="right" layout={layout} /> : null}
      {layout.placement === 'band' ? <TouchBand layout={layout} /> : null}
    </div>
  )
}
