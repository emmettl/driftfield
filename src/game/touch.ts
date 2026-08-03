import type { Vec2 } from './vec'

// What the on-screen sticks are doing.
//
// A mutable module object, written by the touch UI and read by `intentFrom`. That is deliberately not
// React state: a thumb on a virtual stick produces a `pointermove` on every frame it moves, and
// routing sixty of those a second through `setState` would re-render the overlay — which is drawn over
// the game — sixty times a second to move a circle. The overlay draws the knob imperatively for the
// same reason.

export interface TouchState {
  move: Vec2 | null
  aim: Vec2 | null
  bomb: boolean
  /** Latched press, cleared by the loop. See `RawInput.bombTapped` — a tap inside one frame must not be
   *  lost, and a thumb on glass taps at least as quickly as a finger on a key. */
  bombTapped: boolean
}

export const touch: TouchState = { move: null, aim: null, bomb: false, bombTapped: false }

/** Both sticks released, everything off. Called when the sticks unmount, so a scheme change cannot
 *  leave the ship flying into a wall on a stick that is no longer on screen. */
export function releaseTouch(): void {
  touch.move = null
  touch.aim = null
  touch.bomb = false
  touch.bombTapped = false
}
