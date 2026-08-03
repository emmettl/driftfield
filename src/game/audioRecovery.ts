import { useEffect } from 'react'
import { peekAudioContext } from './audio'
import { retryMusic } from './music'

// Getting the audio back after the system takes it away.
//
// iOS suspends an AudioContext on an incoming call, on Siri, on a screen lock, and on the app
// being backgrounded — and it does not resume it when the interruption ends. Safari also reports
// a non-standard `'interrupted'` state, which the standard `'suspended'` check misses entirely.
// The visible symptom is a game that is silent for the rest of the session with no indication
// why, and no gesture short of a reload fixing it.
//
// So: watch for the moments when the audio might have come back, and ask for it.

/** Whether a context is in a state that needs a nudge. Exported for the test — this predicate is
 *  the whole bug, and `'interrupted'` is not in the TypeScript union for `AudioContextState`. */
export function needsResume(state: string): boolean {
  return state !== 'running' && state !== 'closed'
}

/**
 * Poll interval, in milliseconds.
 *
 * A poll as well as the events, because the events are not reliable: on some iOS versions an
 * interruption ends with no `visibilitychange`, no `focus` and no `statechange`, and the only
 * thing that notices is somebody looking. Two seconds is far below anything a player would call
 * a delay and costs one property read.
 */
const POLL_MS = 2000

/**
 * Keep trying to get the audio back.
 *
 * Deliberately built on `peekAudioContext` rather than `getAudioContext`: this hook mounts with
 * the app, long before the first gesture, and a context created before the player has touched
 * the page starts suspended — on some browsers permanently. The watchdog must never be the thing
 * that creates one.
 */
export function useAudioRecovery(): void {
  useEffect(() => {
    let disposed = false

    const attempt = () => {
      if (disposed) return
      const ctx = peekAudioContext()
      if (!ctx || !needsResume(ctx.state)) return
      void ctx.resume().then(
        () => {
          // The transport was stopped by the interruption, and no cue change is coming to
          // restart it — the game state has not moved. See `retryMusic`.
          if (!disposed) retryMusic()
        },
        () => {},
      )
    }

    const onVisibility = () => {
      if (!document.hidden) attempt()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', attempt)
    window.addEventListener('pageshow', attempt)
    // A gesture is the one moment a browser will definitely honour a resume, so it is worth
    // trying on every one rather than only on the first.
    window.addEventListener('pointerdown', attempt)
    window.addEventListener('keydown', attempt)
    const timer = window.setInterval(attempt, POLL_MS)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', attempt)
      window.removeEventListener('pageshow', attempt)
      window.removeEventListener('pointerdown', attempt)
      window.removeEventListener('keydown', attempt)
      window.clearInterval(timer)
    }
  }, [])
}
