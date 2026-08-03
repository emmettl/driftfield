import { PerformanceMonitor } from '@react-three/drei'
import { useCallback, useRef } from 'react'

// Measure the frame rate, and let the app act on it.
//
// drei's `PerformanceMonitor` does the measuring: it watches frame times, compares them against the
// display's refresh rate, and moves a `factor` in 0..1 up when there is headroom and down when there is
// not. What to do about it is the app's business — here it becomes the render scale (see
// `renderScale.ts`) and the richness of the colour grade (see `Grade`).

export function AdaptiveRenderScale({ onFactor }: { onFactor: (factor: number) => void }) {
  // The factor arrives quantised by the monitor's own step, but it still changes more often than the
  // render scale needs to: the DPR is quantised to 0.05 and every change reallocates the drawing buffer
  // and every render target in the composer. So changes under the quantisation step are dropped here
  // rather than downstream, where they would each cost a reallocation to discover they changed nothing.
  const last = useRef(-1)

  const handle = useCallback(
    (state: { factor: number }) => {
      if (Math.abs(state.factor - last.current) < 0.02) return
      last.current = state.factor
      onFactor(state.factor)
    },
    [onFactor],
  )

  return (
    <PerformanceMonitor
      onChange={handle}
      // Generous bounds and a long flip-flop tolerance. The frame time in this game genuinely varies with
      // what is happening — a bomb is several times the cost of an empty arena — and a monitor that
      // reacts to that would drop the resolution every time something exciting happened and put it back
      // afterwards, which is far more noticeable than either resolution.
      flipflops={4}
      factor={0.5}
      onFallback={() => onFactor(0)}
    />
  )
}
