import { useEffect, useRef, type RefObject } from 'react'
import { BOMB_KEYS, type RawInput, readGamepad } from './input'
import { touch } from './touch'
import { vec } from './vec'

// Reading the devices.
//
// The hook does nothing but keep a struct up to date — no state, no re-renders, no game logic. All the
// decisions about what the devices *mean* are in `input.ts`, which is pure and tested; this is the part
// that has to touch the browser and therefore the part worth keeping as small as possible.
//
// The returned object is a ref, and the game loop reads it every frame. Deliberately not state: a key
// press must not re-render a tree that draws a hundred thousand additive sprites.

export interface InputHandle {
  raw: RawInput
  /** The pointer in normalised device coordinates, for the loop to turn into arena coordinates — it
   *  has the camera and this does not. */
  ndc: { x: number; y: number }
  /** Whether the pointer has been seen at all yet. Before it has, aim falls to the keyboard. */
  seen: boolean
}

export function useInput(): RefObject<InputHandle> {
  const handle = useRef<InputHandle>({
    raw: {
      keys: new Set<string>(),
      pointer: vec(),
      pointerDown: false,
      pointerIsFresher: false,
      bombTapped: false,
      gamepad: null,
      touch,
    },
    ndc: { x: 0, y: 0 },
    seen: false,
  })

  useEffect(() => {
    const state = handle.current
    const keys = state.raw.keys as Set<string>

    const onKeyDown = (event: KeyboardEvent) => {
      // Lowercased, so Shift+W is still W. Both the key and the modifier arrive as separate events, so
      // nothing is lost by folding case.
      const key = event.key.toLowerCase()
      keys.add(key)
      // Latched as well as held, so a press shorter than a frame is not thrown away. See
      // `RawInput.bombTapped`; the loop clears this once it has been read.
      if (BOMB_KEYS.has(key)) state.raw.bombTapped = true
      // An arrow key is an aim, and using one takes aim authority back from the mouse. See
      // `pointerIsFresher`.
      if (event.key.startsWith('Arrow')) state.raw.pointerIsFresher = false
      // The arrow keys and space scroll the page, which in a full-screen game means the canvas jumps
      // and the pointer coordinates are wrong until it settles.
      if (event.key.startsWith('Arrow') || event.key === ' ') event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase())

    // Every key released. Without this, alt-tabbing while holding W leaves the ship flying into the
    // wall — the key-up went to whatever took the focus, so it never arrives here.
    const onBlur = () => keys.clear()

    const onPointerMove = (event: PointerEvent) => {
      state.ndc.x = (event.clientX / window.innerWidth) * 2 - 1
      state.ndc.y = -(event.clientY / window.innerHeight) * 2 + 1
      state.seen = true
      state.raw.pointerIsFresher = true
    }
    const onPointerDown = (event: PointerEvent) => {
      onPointerMove(event)
      state.raw.pointerDown = true
    }
    const onPointerUp = () => {
      state.raw.pointerDown = false
    }
    // A pointer that leaves the window releases. A mouse button let go outside the page never sends an
    // up event, and the gun would keep firing.
    const onPointerLeave = () => {
      state.raw.pointerDown = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('pointerleave', onPointerLeave)
    // The right button is a perfectly good bomb key on a mouse, and it is unusable while the browser
    // is putting a menu over the arena.
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('contextmenu', onContextMenu)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  return handle
}

/**
 * Poll the gamepads.
 *
 * Polled rather than evented because the Gamepad API has no events for axes — `gamepadconnected` tells
 * you one exists and everything after that is reading `navigator.getGamepads()` whenever you care. So
 * it is read once a frame, from the loop.
 *
 * The first connected pad wins. Two players is not a thing this game does, and picking "the pad with
 * the most recent input" would mean a player who nudges an idle second controller loses control.
 */
export function pollGamepad(handle: InputHandle): void {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return
  const pads = navigator.getGamepads()
  for (const pad of pads) {
    if (!pad?.connected) continue
    handle.raw.gamepad = readGamepad(pad)
    return
  }
  handle.raw.gamepad = null
}
