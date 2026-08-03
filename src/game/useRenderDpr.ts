import { useEffect, useState } from 'react'
import { isMobile } from './device'
import {
  type RenderScaleBounds,
  dprForFactor,
  resolveRenderBounds,
} from './renderScale'

// The canvas's pixel ratio, as a hook.
//
// Two inputs: the window's shape, which decides what the pixel budget affords, and the measured
// performance factor, which decides where inside that range to sit. The arithmetic is all in
// `renderScale.ts` and tested there; this is the part that has to listen to the window.

/**
 * @param canvas the canvas's size in CSS pixels — not the window's.
 *
 * They are the same thing on a desktop and they are not on touch, where the canvas is an arena-shaped box above
 * the control band (see `layout.ts`). The budget is about the pixels actually shaded, so measuring the window
 * would price in a third of a phone's screen that the renderer never touches — and price the ratio down
 * accordingly, costing sharpness on the device that can least afford to lose it.
 */
function metrics(canvas: { width: number; height: number }) {
  return {
    width: canvas.width,
    height: canvas.height,
    devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    mobile: isMobile,
  }
}

export function useRenderDpr(factor: number, canvas: { width: number; height: number }): number {
  // Destructured so the effect depends on the two numbers rather than on the object identity — the caller rebuilds
  // that object on every layout change, and depending on it would re-run this on changes it does not care about.
  const { width, height } = canvas
  const [bounds, setBounds] = useState<RenderScaleBounds>(() => resolveRenderBounds(metrics(canvas)))

  useEffect(() => {
    const onResize = () => {
      const next = resolveRenderBounds(metrics({ width, height }))
      // Compared before setting, because a resize fires continuously while a window is being dragged and
      // the bounds are quantised — most of those events resolve to the ratio already in use, and setting
      // state anyway would rebuild the canvas and every render target on each one.
      setBounds((current) => (current.cap === next.cap && current.top === next.top ? current : next))
    }
    // Run immediately as well as on resize: the canvas can change size without the window doing so — the control
    // band appearing, or an orientation change resolving to a different arena-shaped box.
    onResize()
    window.addEventListener('resize', onResize)
    // Moving a window between a laptop panel and an external monitor changes `devicePixelRatio` without
    // changing the window's size, so a resize listener alone misses it.
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    media.addEventListener('change', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      media.removeEventListener('change', onResize)
    }
  }, [width, height])

  return dprForFactor(bounds, factor)
}
