import { unroll } from './cameraFit'
import type { Intent } from './step'
import type { Vec2 } from './vec'

// Three ways to play, one intent.
//
// A twin-stick shooter is unusual in how many genuinely different control schemes it has to
// support at once — mouse and keyboard, a gamepad, and two thumbs on glass — and the way
// that usually goes wrong is that each one grows its own path into the game loop, at which
// point they drift and only one of them is ever really tested. So all three are collapsed
// here, into a pure function from raw device state to the `Intent` the step consumes, and
// the hook that reads the devices does nothing but fill in the struct.

/** What the devices are currently saying. Filled in by `useInput`; every field optional in
 *  the sense that a scheme not in use supplies nulls. */
export interface RawInput {
  /** Keys currently down, as `KeyboardEvent.key` lowercased. */
  keys: ReadonlySet<string>
  /** Where the pointer is, in arena coordinates. Null if it has never been seen. */
  pointer: Vec2 | null
  pointerDown: boolean
  /**
   * Whether the pointer has moved more recently than an aim key was pressed.
   *
   * Both aim, and both must work without a mode switch: somebody playing on a laptop
   * touchpad will reach for the arrow keys, and somebody who has just used the arrow keys
   * should not have their aim yanked back to a stale cursor position the moment they nudge
   * the pad. Whichever was used last wins.
   */
  pointerIsFresher: boolean
  /**
   * A bomb key that went down since the last frame, whether or not it is still down.
   *
   * The held set is not enough on its own. A key that goes down and up between two frames leaves no trace
   * in it — the down adds and the up removes, both before anything reads it — so a quick tap is simply
   * lost, and the one control in the game where that is unacceptable is the bomb: it is pressed in a panic,
   * usually about a tenth of a second before dying, and "I pressed it and nothing happened" is the worst
   * bug a game can have. So a press is latched here and consumed by the frame that sees it.
   *
   * Firing is deliberately *not* latched: it is continuous, a dropped shot costs a ninth of a second of
   * fire, and latching it would mean a stray click fires a shot the player has already thought better of.
   */
  bombTapped: boolean
  gamepad: GamepadIntent | null
  touch: TouchIntent | null
}

/** A gamepad, already reduced to sticks and buttons. Deadzones are applied here rather than
 *  in the hook so they are testable. */
export interface GamepadIntent {
  moveX: number
  moveY: number
  aimX: number
  aimY: number
  fire: boolean
  bomb: boolean
}

/** Two virtual sticks and a button. Each stick is already normalised to 0..1 of its own
 *  travel by the UI that drew it — it knows its own radius, and this file should not. */
export interface TouchIntent {
  move: Vec2 | null
  aim: Vec2 | null
  bomb: boolean
  /** As `RawInput.bombTapped`, for the on-screen button — a thumb can tap glass inside one frame just as
   *  easily as a finger can tap a key. */
  bombTapped: boolean
  /**
   * Whether the view is rolled a quarter turn, as portrait is (see `layout.ts`).
   *
   * Only the sticks care. They are the one input that is genuinely in *screen* space — a thumb pushed towards the
   * top of the glass means "up the screen" whichever way the arena is drawn — so they are the one input that has to
   * be rotated to match the camera. The pointer needs no such thing because it is already unprojected through the
   * camera into arena coordinates before it arrives here, and a gamepad stick is not attached to the screen at all.
   */
  rolled: boolean
}

/** State the mapping has to remember between frames. Just the bomb, which is edge-triggered
 *  — see `Intent.bomb`. Held externally so the mapping itself stays a function. */
export interface InputMemory {
  bombHeld: boolean
}

export function freshInputMemory(): InputMemory {
  return { bombHeld: false }
}

/**
 * Radial deadzone for an analogue stick.
 *
 * Radial rather than per-axis, and rescaled rather than merely clipped. Per-axis deadzones
 * are the classic mistake: they make a stick pushed diagonally at 30% register as nothing
 * at all on both axes, so slow diagonal movement — which is most of the movement in this
 * game — becomes impossible. Rescaling means the first unit past the deadzone is a genuine
 * small input rather than a jump to 22%.
 */
export function applyDeadzone(x: number, y: number, deadzone = 0.22): Vec2 {
  const magnitude = Math.hypot(x, y)
  if (magnitude <= deadzone) return { x: 0, y: 0 }
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone)) / magnitude
  return { x: x * scaled, y: y * scaled }
}

const MOVE_KEYS: Record<string, Vec2> = {
  w: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  s: { x: 0, y: -1 },
  d: { x: 1, y: 0 },
}

/** The arrow keys aim *and* fire, which is how every arcade twin-stick has worked on a
 *  keyboard since Robotron. Holding one is holding the trigger. */
const AIM_KEYS: Record<string, Vec2> = {
  arrowup: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  arrowdown: { x: 0, y: -1 },
  arrowright: { x: 1, y: 0 },
}

export const BOMB_KEYS = new Set(['shift', ' ', 'spacebar'])

/** Sum of the direction keys held, normalised. Diagonals come out at magnitude 1 rather
 *  than 1.41, so holding two keys is not 40% faster than holding one. */
function keyVector(keys: ReadonlySet<string>, table: Record<string, Vec2>): Vec2 {
  let x = 0
  let y = 0
  for (const key in table) {
    if (!keys.has(key)) continue
    x += table[key].x
    y += table[key].y
  }
  const magnitude = Math.hypot(x, y)
  if (magnitude < 1e-6) return { x: 0, y: 0 }
  return { x: x / magnitude, y: y / magnitude }
}

/**
 * Everything the player is holding, as one intent.
 *
 * The precedence rules are the only real decisions in here, and they are all of the form
 * "the thing being used right now wins": a gamepad stick overrides the keyboard because
 * nobody has a hand on both, and the pointer and the aim keys defer to whichever moved last.
 */
export function intentFrom(raw: RawInput, shipPos: Vec2, memory: InputMemory): Intent {
  let move: Vec2 = keyVector(raw.keys, MOVE_KEYS)
  const aimKeys = keyVector(raw.keys, AIM_KEYS)
  let aim: Vec2 = { x: 0, y: 0 }
  let firing = raw.pointerDown || aimKeys.x !== 0 || aimKeys.y !== 0
  let bombHeld = false

  for (const key of raw.keys) if (BOMB_KEYS.has(key)) bombHeld = true

  // Pointer aim, taken as the direction from the ship rather than as a screen position, so
  // that a cursor sitting still while the ship flies past it sweeps the aim across — which
  // is what a mouse-aimed shooter should do, and is why this cannot be done in screen space.
  if (raw.pointer && (raw.pointerIsFresher || (aimKeys.x === 0 && aimKeys.y === 0))) {
    const dx = raw.pointer.x - shipPos.x
    const dy = raw.pointer.y - shipPos.y
    const magnitude = Math.hypot(dx, dy)
    // A cursor exactly on the ship carries no direction. Leaving the aim alone is right:
    // the alternative is a facing that spins wildly as the ship passes under the pointer.
    if (magnitude > 0.5) aim = { x: dx / magnitude, y: dy / magnitude }
  }
  if (aim.x === 0 && aim.y === 0) aim = aimKeys

  if (raw.gamepad) {
    const stickMove = applyDeadzone(raw.gamepad.moveX, raw.gamepad.moveY)
    const stickAim = applyDeadzone(raw.gamepad.aimX, raw.gamepad.aimY)
    if (stickMove.x !== 0 || stickMove.y !== 0) move = stickMove
    if (stickAim.x !== 0 || stickAim.y !== 0) {
      aim = stickAim
      // The right stick is the trigger as well as the aim. A gamepad twin-stick that needs
      // a shoulder button held to shoot is a gamepad twin-stick nobody enjoys.
      firing = true
    }
    if (raw.gamepad.fire) firing = true
    if (raw.gamepad.bomb) bombHeld = true
  }

  if (raw.touch) {
    // Screen space into world space. The identity unless the view is rolled — see `TouchIntent.rolled`.
    const { rolled } = raw.touch
    if (raw.touch.move) move = unroll(raw.touch.move.x, raw.touch.move.y, rolled)
    if (raw.touch.aim) {
      aim = unroll(raw.touch.aim.x, raw.touch.aim.y, rolled)
      firing = true
    }
    if (raw.touch.bomb) bombHeld = true
  }

  // The edge, not the state. A held bomb key must fire one bomb, not one per frame until the stock is gone
  // — which is what the first version of this did, and it took the whole stock in under a tenth of a
  // second. The latched taps are ORed in so that a press too short to be held across a frame boundary
  // still counts; see `RawInput.bombTapped`.
  const tapped = raw.bombTapped || raw.touch?.bombTapped === true
  const bomb = (bombHeld && !memory.bombHeld) || tapped
  memory.bombHeld = bombHeld

  return { move, aim, firing, bomb }
}

/**
 * Forget the latched taps.
 *
 * Called by the game loop immediately after building an intent, because a latch nobody clears is a bomb
 * that fires on every frame for the rest of the run. It lives here, next to the code that reads the latch,
 * rather than in the loop where it would look like an unrelated line of bookkeeping.
 */
export function clearTaps(raw: RawInput): void {
  raw.bombTapped = false
  if (raw.touch) raw.touch.bombTapped = false
}

/** Standard-mapping gamepad, reduced. Kept next to `intentFrom` because the two have to
 *  agree about which stick is which, and that agreement is easier to see in one file. */
export function readGamepad(pad: Gamepad): GamepadIntent {
  const axis = (i: number) => pad.axes[i] ?? 0
  const button = (i: number) => (pad.buttons[i]?.pressed ?? false) || (pad.buttons[i]?.value ?? 0) > 0.4
  return {
    moveX: axis(0),
    // Both sticks are inverted. Gamepad Y is positive downwards, the arena's is positive
    // up, and forgetting this is the classic "the ship goes the wrong way" bug.
    moveY: -axis(1),
    aimX: axis(2),
    aimY: -axis(3),
    // Either trigger or the face button, so it does not matter which one a player reaches
    // for on a pad whose layout we cannot know.
    fire: button(7) || button(0) || button(5),
    bomb: button(6) || button(1) || button(4),
  }
}
