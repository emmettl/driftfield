import { useEffect, useRef } from 'react'
import type { Layout } from '../game/layout'
import { releaseTouch, touch } from '../game/touch'

// The touch controls: two sticks and a bomb, in space of their own beside or below the playfield.
//
// Where that space is depends on the device and is decided in `layout.ts` — rails either side on a landscape
// phone, a band along the bottom on a tablet. Both arrangements are built from the same two pieces here, which is
// the point of splitting them out: a stick knows how to be a stick and does not know where it is.
//
// Three decisions worth stating.
//
// **Each zone owns its role.** A stick is told whether it is `move` or `aim`; it does not work it out from which
// half of the screen a thumb landed in. The first version did the latter, which was fine for a bottom band split
// down the middle and wrong for anything else — and "which half of the screen is this" is a question that stops
// having an answer the moment the controls are not one contiguous strip.
//
// **The bases are drawn, and fixed.** A stick you cannot see is a stick you have to find, and on a phone you are
// finding it while something is flying at you.
//
// **But the stick still floats.** The touch that starts it becomes the centre, wherever in the zone it landed —
// the drawn ring is a hint, not a target. Requiring the thumb to hit the ring would make the visible base a
// liability, because a near-miss would do nothing at all, which is the worst outcome for a control you grabbed in
// a panic.
//
// Nothing here goes through React state. A thumb moving produces a pointer event every frame, and re-rendering
// this to move two circles would be the most expensive thing on the page. The knobs are moved by writing
// transforms directly, and the game reads the stick values out of `touch.ts`.

/** Deflection under this is treated as nothing. A thumb resting on glass drifts by a pixel or two, and without a
 *  floor the ship never quite stops. */
const DEADZONE = 0.14

type Role = 'move' | 'aim'

/**
 * One stick, in whatever zone it has been given.
 *
 * The whole zone is the touch surface, not just the drawn ring — see the note above about floating. Pointer capture
 * means a thumb that starts here and slides out of the zone keeps steering, which matters because the zones are
 * only as big as the space left over.
 */
function TouchStick({ role, range }: { role: Role; range: number }) {
  const zone = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  /** Read inside handlers that are bound once, so the live value has to come through a ref — otherwise a rotation
   *  would leave the stick calibrated to the old zone. */
  const travel = useRef(range)
  travel.current = range

  useEffect(() => {
    const element = zone.current
    if (!element) return

    let active: { id: number; x: number; y: number } | null = null

    const place = (dx: number, dy: number, held: boolean) => {
      const target = knob.current
      if (!target) return
      target.dataset.held = held ? 'yes' : 'no'
      target.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    }

    const onDown = (event: PointerEvent) => {
      if (active) return
      active = { id: event.pointerId, x: event.clientX, y: event.clientY }
      element.setPointerCapture(event.pointerId)
      place(0, 0, true)
      // Seeded rather than left at zero: an aim stick is also the trigger and a tap should fire, and `intentFrom`
      // reads a zero aim as "keep the current facing".
      if (role === 'aim') touch.aim = { x: 0, y: 0 }
      else touch.move = { x: 0, y: 0 }
      event.preventDefault()
    }

    const onMove = (event: PointerEvent) => {
      if (!active || active.id !== event.pointerId) return

      const dx = (event.clientX - active.x) / travel.current
      // Screen y grows downwards and the arena's grows up.
      const dy = -(event.clientY - active.y) / travel.current
      const magnitude = Math.hypot(dx, dy)
      const vector =
        magnitude < DEADZONE
          ? { x: 0, y: 0 }
          : { x: (dx / magnitude) * Math.min(1, magnitude), y: (dy / magnitude) * Math.min(1, magnitude) }

      if (role === 'move') touch.move = vector
      // A released aim keeps its last direction rather than falling to zero. The aim stick is the trigger, so a
      // thumb that has drifted back to the centre while still held is a player who wants to keep firing where they
      // were firing.
      else if (vector.x !== 0 || vector.y !== 0) touch.aim = vector

      // The drawn knob follows the thumb up to the stick's range and then stops, which is the feedback that says
      // "this is as far as it goes".
      const rawX = event.clientX - active.x
      const rawY = event.clientY - active.y
      const distance = Math.hypot(rawX, rawY)
      const limit = distance > travel.current ? travel.current / distance : 1
      place(rawX * limit, rawY * limit, true)
    }

    const onUp = (event: PointerEvent) => {
      if (!active || active.id !== event.pointerId) return
      active = null
      place(0, 0, false)
      if (role === 'move') touch.move = null
      else touch.aim = null
    }

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)

    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
    }
  }, [role])

  const diameter = range * 2

  return (
    <div className="zone" ref={zone}>
      {/* Sized here rather than in CSS, for the same reason the stage is: the stick's travel is a layout number and
          `resolveLayout` is the only thing allowed to decide one. A `calc()` over a custom property was the first
          attempt and it silently resolved to `auto`, which in a centring flex column is a zero-width box — so the
          ring simply was not there. Inline pixels cannot fail that way. */}
      <div
        className={role === 'aim' ? 'stick stick-aim' : 'stick'}
        style={{ width: diameter, height: diameter }}
      >
        <div className="stick-knob" ref={knob} data-held="no" />
      </div>
      <span className="zone-label">{role === 'aim' ? 'AIM & FIRE' : 'MOVE'}</span>
    </div>
  )
}

/**
 * The bomb.
 *
 * Its own button rather than a gesture: a bomb is the last thing you do before dying, so it has to be something you
 * can hit without thinking, which a double-tap or a two-finger gesture is not.
 *
 * Sits with the **move** stick rather than the aim stick. Firing a bomb means briefly lifting a thumb, and lifting
 * the left one costs you a moment of steering where lifting the right one stops your fire *and* drops your aim.
 *
 * Both the held state and the latch are set; `intentFrom` does the edge detection for every input scheme in one
 * place. See `RawInput.bombTapped`.
 */
function BombButton() {
  return (
    <button
      type="button"
      className="zone-bomb"
      onPointerDown={(event) => {
        event.stopPropagation()
        touch.bomb = true
        touch.bombTapped = true
      }}
      onPointerUp={() => {
        touch.bomb = false
      }}
      onPointerLeave={() => {
        touch.bomb = false
      }}
    >
      BOMB
    </button>
  )
}

/**
 * Housekeeping shared by both arrangements.
 *
 * Releasing on unmount is so a layout change cannot leave the ship flying into a wall on a stick that is no longer
 * on screen. Publishing `rolled` is because a stick is the one input in screen space: a thumb pushed towards the top
 * of the glass means "up the screen", and in portrait the arena is rotated under it, so the vector has to be turned
 * to match the camera. That happens in `intentFrom`; this is where it is told. Doing it here rather than in the loop
 * keeps it next to the thing it describes — if these sticks are on screen, this is how they are oriented.
 */
function useTouchZones(layout: Layout) {
  useEffect(() => {
    touch.rolled = layout.rolled
  }, [layout.rolled])
  useEffect(() => releaseTouch, [])
}

/**
 * One side rail, for the landscape arrangement.
 *
 * Deliberately one rail per call rather than a component that renders both. The two rails go on opposite sides of the
 * playfield, and in a flex row that means the stage has to be *between* them in document order — a single component
 * returning both can only ever put them next to each other, which is exactly the bug this replaced: both rails
 * stacked up on the left and the arena shoved off the right-hand edge of the screen.
 *
 * The move stick takes the left rail and the aim stick the right, matching a gamepad. The bomb goes with the move
 * stick: firing it means briefly lifting a thumb, and lifting the left one costs a moment of steering where lifting
 * the right one stops your fire *and* drops your aim.
 */
export function TouchRail({ side, layout }: { side: 'left' | 'right'; layout: Layout }) {
  useTouchZones(layout)

  return (
    <div className={`rail rail-${side}`} style={{ width: layout.rail }}>
      <TouchStick role={side === 'left' ? 'move' : 'aim'} range={layout.stickRange} />
      {side === 'left' ? <BombButton /> : null}
    </div>
  )
}

export function TouchBand({ layout }: { layout: Layout }) {
  useTouchZones(layout)

  return (
    <div className="band" style={{ height: layout.band }}>
      <TouchStick role="move" range={layout.stickRange} />
      <BombButton />
      <TouchStick role="aim" range={layout.stickRange} />
    </div>
  )
}
