import { useEffect, useState } from 'react'
import { isMobile, isTouch } from './device'
import { type Layout, resolveLayout } from './layout'

// The screen division, as a hook.
//
// All the reasoning lives in `layout.ts`, which is pure and tested. This is the part that has to listen to the
// window — and on a phone that is more work than it sounds, because a phone's viewport changes size for reasons a
// desktop's never does: the URL bar retracts as you scroll, the keyboard appears, and rotating swaps both axes.

function shape() {
  return {
    // `visualViewport` where it exists, which is the only measurement that accounts for a retracted URL bar on
    // mobile Safari — `innerHeight` lies about it, and a band positioned from a lie is a band half off the screen.
    width: typeof window === 'undefined' ? 1280 : Math.round(window.visualViewport?.width ?? window.innerWidth),
    height: typeof window === 'undefined' ? 720 : Math.round(window.visualViewport?.height ?? window.innerHeight),
    touch: isTouch,
    phone: isMobile,
  }
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => resolveLayout(shape()))

  useEffect(() => {
    const update = () => {
      const next = resolveLayout(shape())
      // Compared before setting, because this drives the canvas's size: every change reallocates the drawing
      // buffer and every render target in the composer, and a phone fires resize events continuously while the URL
      // bar animates. Most of those resolve to the layout already in use.
      setLayout((current) =>
        current.band === next.band &&
        current.canvas.width === next.canvas.width &&
        current.canvas.height === next.canvas.height &&
        current.rotate === next.rotate
          ? current
          : next,
      )
    }

    window.addEventListener('resize', update)
    // Rotating a phone fires `resize` too, but not always with the new dimensions on the first tick — Safari has
    // historically reported the old ones until the next frame. The orientation event is the reliable signal.
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])

  return layout
}
