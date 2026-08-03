import { useEffect, useRef } from 'react'
import { releaseTouch, touch } from '../game/touch'

// The control band: two sticks and a bomb, in a strip of their own below the playfield.
//
// This replaced a pair of sticks drawn *over* the arena, which is fine on a tablet held at arm's length and
// useless on a phone — your thumbs end up exactly where the ship is, covering the two things you most need to
// see. See `layout.ts` for what that costs in playfield size and why it is worth paying.
//
// Two decisions inside the band are worth stating, because they pull against each other:
//
// **The bases are drawn, and fixed.** A stick you cannot see is a stick you have to find, and on a phone you are
// finding it while something is flying at you. Each half of the band has a ring drawn in it at rest, so a thumb
// knows where to go before it needs to.
//
// **But the stick still floats.** The touch that starts it becomes the centre, wherever in that half of the band
// it landed — the drawn ring is a hint, not a target. Requiring the thumb to land on the ring would make the
// visible base a liability: a near-miss would do nothing at all, which is the worst possible outcome for a
// control you grabbed in a panic.
//
// Nothing here goes through React state. A thumb moving produces a pointer event every frame, and re-rendering
// this strip sixty times a second to move two circles would be the most expensive thing on the page. The knobs
// are moved by writing transforms directly, and the game reads the stick values out of `touch.ts`.

/** Deflection under this is treated as nothing. A thumb resting on glass drifts by a pixel or two, and without a
 *  floor the ship never quite stops. */
const DEADZONE = 0.14

interface Stick {
  id: number
  originX: number
  originY: number
}

export function TouchZones({ stickRange }: { stickRange: number }) {
  const root = useRef<HTMLDivElement>(null)
  const moveKnob = useRef<HTMLDivElement>(null)
  const aimKnob = useRef<HTMLDivElement>(null)
  /** Read inside the handlers, which are bound once — so the current value has to be reachable through a ref
   *  rather than captured, or a resize would leave the sticks calibrated to the old band. */
  const range = useRef(stickRange)
  range.current = stickRange
  const diameter = stickRange * 2

  useEffect(() => {
    const element = root.current
    if (!element) return

    const sticks: { move: Stick | null; aim: Stick | null } = { move: null, aim: null }
    const knobFor = (which: 'move' | 'aim') => (which === 'move' ? moveKnob.current : aimKnob.current)

    /** Which half of the band a touch landed in. Not which stick is free: a thumb that has drifted across the
     *  middle while steering is still steering, and reassigning it to aim would be a death. */
    const halfFor = (x: number) => (x < window.innerWidth / 2 ? 'move' : 'aim')

    const place = (which: 'move' | 'aim', dx: number, dy: number, held: boolean) => {
      const knob = knobFor(which)
      if (!knob) return
      knob.dataset.held = held ? 'yes' : 'no'
      knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    }

    const vectorFor = (stick: Stick, x: number, y: number) => {
      const dx = (x - stick.originX) / range.current
      // Screen y grows downwards and the arena's grows up.
      const dy = -(y - stick.originY) / range.current
      const magnitude = Math.hypot(dx, dy)
      if (magnitude < DEADZONE) return { x: 0, y: 0 }
      const clamped = Math.min(1, magnitude)
      return { x: (dx / magnitude) * clamped, y: (dy / magnitude) * clamped }
    }

    const onDown = (event: PointerEvent) => {
      const which = halfFor(event.clientX)
      if (sticks[which]) return
      sticks[which] = { id: event.pointerId, originX: event.clientX, originY: event.clientY }
      element.setPointerCapture(event.pointerId)
      place(which, 0, 0, true)
      // An aim stick is also the trigger, and a tap should fire — so the aim is seeded rather than left at zero,
      // which `intentFrom` reads as "keep the current facing".
      if (which === 'aim') touch.aim = { x: 0, y: 0 }
      else touch.move = { x: 0, y: 0 }
      event.preventDefault()
    }

    const onMove = (event: PointerEvent) => {
      for (const which of ['move', 'aim'] as const) {
        const stick = sticks[which]
        if (!stick || stick.id !== event.pointerId) continue

        const vector = vectorFor(stick, event.clientX, event.clientY)
        if (which === 'move') touch.move = vector
        // A released aim keeps the last direction rather than falling to zero. The aim stick is the trigger, so a
        // thumb that has drifted back to the centre while still held is a player who wants to keep firing where
        // they were firing.
        else if (vector.x !== 0 || vector.y !== 0) touch.aim = vector

        // The drawn knob follows the thumb up to the stick's range and then stops, which is the feedback that says
        // "this is as far as it goes".
        const rawX = event.clientX - stick.originX
        const rawY = event.clientY - stick.originY
        const distance = Math.hypot(rawX, rawY)
        const limit = distance > range.current ? range.current / distance : 1
        place(which, rawX * limit, rawY * limit, true)
      }
    }

    const onUp = (event: PointerEvent) => {
      for (const which of ['move', 'aim'] as const) {
        const stick = sticks[which]
        if (!stick || stick.id !== event.pointerId) continue
        sticks[which] = null
        place(which, 0, 0, false)
        if (which === 'move') touch.move = null
        else touch.aim = null
      }
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
      // Both sticks released on unmount, or a layout change leaves the ship flying into a wall on a stick that is
      // no longer on screen.
      releaseTouch()
    }
  }, [])

  return (
    <div className="band" ref={root}>
      <div className="band-half">
        {/* Sized here rather than in CSS, for the same reason the stage is: the stick's travel is a layout number,
            and `resolveLayout` is the only thing allowed to decide one. A `calc()` over a custom property was the
            first attempt and it silently resolved to `auto` — which in a centring flex column is a zero-width box,
            so the ring simply was not there. Inline pixels cannot fail that way. */}
        <div className="stick" style={{ width: diameter, height: diameter }}>
          <div className="stick-knob" ref={moveKnob} data-held="no" />
        </div>
        <span className="band-label">MOVE</span>
      </div>

      {/* Between the sticks rather than in a corner. A bomb is the last thing you do before dying, so it has to be
          somewhere a thumb can reach without leaving either stick — and putting it in a corner would put it under
          whichever thumb is already there. Both the held state and the latch are set; `intentFrom` does the edge
          detection for every scheme in one place. See `RawInput.bombTapped`. */}
      <button
        type="button"
        className="band-bomb"
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

      <div className="band-half">
        <div className="stick stick-aim" style={{ width: diameter, height: diameter }}>
          <div className="stick-knob" ref={aimKnob} data-held="no" />
        </div>
        <span className="band-label">AIM &amp; FIRE</span>
      </div>
    </div>
  )
}
