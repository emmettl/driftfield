import { describe, expect, it } from 'vitest'
import {
  type RawInput,
  applyDeadzone,
  clearTaps,
  freshInputMemory,
  intentFrom,
  readGamepad,
} from './input'
import { vec } from './vec'

function raw(overrides: Partial<RawInput> = {}): RawInput {
  return {
    keys: new Set<string>(),
    pointer: null,
    pointerDown: false,
    pointerIsFresher: false,
    bombTapped: false,
    gamepad: null,
    touch: null,
    ...overrides,
  }
}

const origin = vec(0, 0)

describe('applyDeadzone', () => {
  it('is radial, not per-axis', () => {
    // The classic mistake. A stick pushed diagonally at 30% has 0.3 on neither axis alone, so a per-axis
    // deadzone reads it as nothing at all — and slow diagonal movement is most of the movement in this
    // game.
    const diagonal = applyDeadzone(0.2, 0.2)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeGreaterThan(0)
  })

  it('rejects anything inside the deadzone', () => {
    expect(applyDeadzone(0.1, 0.1)).toEqual({ x: 0, y: 0 })
    expect(applyDeadzone(0, 0)).toEqual({ x: 0, y: 0 })
  })

  it('rescales rather than clipping, so the first real input is small', () => {
    // Clipping would make the first unit past the deadzone jump straight to 22% deflection.
    const just = applyDeadzone(0.24, 0)
    expect(just.x).toBeGreaterThan(0)
    expect(just.x).toBeLessThan(0.1)
  })

  it('reaches exactly 1 at full deflection', () => {
    const full = applyDeadzone(1, 0)
    expect(full.x).toBeCloseTo(1)
    const corner = applyDeadzone(1, 1)
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1)
  })
})

describe('the keyboard', () => {
  it('normalises diagonals, so two keys are not faster than one', () => {
    const memory = freshInputMemory()
    const result = intentFrom(raw({ keys: new Set(['w', 'd']) }), origin, memory)
    expect(Math.hypot(result.move.x, result.move.y)).toBeCloseTo(1)
    expect(result.move.x).toBeCloseTo(result.move.y)
  })

  it('cancels opposite keys', () => {
    const result = intentFrom(raw({ keys: new Set(['a', 'd']) }), origin, freshInputMemory())
    expect(result.move).toEqual({ x: 0, y: 0 })
  })

  it('makes the arrow keys aim and fire together', () => {
    // How every arcade twin-stick has worked on a keyboard since Robotron: holding an arrow is holding
    // the trigger.
    const result = intentFrom(raw({ keys: new Set(['arrowup']) }), origin, freshInputMemory())
    expect(result.aim).toEqual({ x: 0, y: 1 })
    expect(result.firing).toBe(true)
  })

  it('leaves the aim alone when nothing is aiming', () => {
    // A released stick must not snap the facing back to some default — the step reads a zero aim as
    // "keep the current facing".
    const result = intentFrom(raw(), origin, freshInputMemory())
    expect(result.aim).toEqual({ x: 0, y: 0 })
  })
})

describe('the pointer', () => {
  it('aims from the ship, not from the screen', () => {
    // Taken as a direction so that a cursor sitting still while the ship flies past it sweeps the aim
    // across — which is what a mouse-aimed shooter should do, and cannot be done in screen space.
    const result = intentFrom(
      raw({ pointer: vec(10, 0), pointerIsFresher: true }),
      vec(4, 0),
      freshInputMemory(),
    )
    expect(result.aim.x).toBeCloseTo(1)

    const behind = intentFrom(
      raw({ pointer: vec(10, 0), pointerIsFresher: true }),
      vec(20, 0),
      freshInputMemory(),
    )
    expect(behind.aim.x).toBeCloseTo(-1)
  })

  it('ignores a cursor sitting on the ship', () => {
    // Otherwise the facing spins wildly as the ship passes underneath it.
    const result = intentFrom(
      raw({ pointer: vec(0.1, 0), pointerIsFresher: true }),
      origin,
      freshInputMemory(),
    )
    expect(result.aim).toEqual({ x: 0, y: 0 })
  })

  it('fires while held', () => {
    const result = intentFrom(raw({ pointerDown: true }), origin, freshInputMemory())
    expect(result.firing).toBe(true)
  })

  it('yields to the arrow keys when they were used more recently', () => {
    const result = intentFrom(
      raw({ pointer: vec(0, -30), pointerIsFresher: false, keys: new Set(['arrowup']) }),
      origin,
      freshInputMemory(),
    )
    expect(result.aim).toEqual({ x: 0, y: 1 })
  })

  it('takes authority back when it moves', () => {
    const result = intentFrom(
      raw({ pointer: vec(0, -30), pointerIsFresher: true, keys: new Set(['arrowup']) }),
      origin,
      freshInputMemory(),
    )
    expect(result.aim.y).toBeCloseTo(-1)
    // Still firing, because an arrow key is still held.
    expect(result.firing).toBe(true)
  })
})

describe('the gamepad', () => {
  it('overrides the keyboard, because nobody has a hand on both', () => {
    const result = intentFrom(
      raw({
        keys: new Set(['w']),
        gamepad: { moveX: -1, moveY: 0, aimX: 0, aimY: 0, fire: false, bomb: false },
      }),
      origin,
      freshInputMemory(),
    )
    expect(result.move.x).toBeCloseTo(-1)
  })

  it('treats the aim stick as the trigger', () => {
    const result = intentFrom(
      raw({ gamepad: { moveX: 0, moveY: 0, aimX: 0, aimY: 1, fire: false, bomb: false } }),
      origin,
      freshInputMemory(),
    )
    expect(result.firing).toBe(true)
    expect(result.aim.y).toBeCloseTo(1)
  })

  it('leaves the keyboard in charge of an axis the pad is not using', () => {
    const result = intentFrom(
      raw({
        keys: new Set(['d']),
        gamepad: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, bomb: false },
      }),
      origin,
      freshInputMemory(),
    )
    expect(result.move.x).toBeCloseTo(1)
  })
})

describe('readGamepad', () => {
  const pad = (axes: number[], pressed: number[] = []) =>
    ({
      axes,
      buttons: Array.from({ length: 12 }, (_, i) => ({
        pressed: pressed.includes(i),
        value: pressed.includes(i) ? 1 : 0,
        touched: false,
      })),
    }) as unknown as Gamepad

  it('inverts both sticks', () => {
    // Gamepad Y is positive downwards and the arena's is positive up. Forgetting this is the classic
    // "the ship goes the wrong way" bug.
    const result = readGamepad(pad([0, -1, 0, 1]))
    expect(result.moveY).toBe(1)
    expect(result.aimY).toBe(-1)
  })

  it('accepts either trigger or a face button for firing', () => {
    expect(readGamepad(pad([0, 0, 0, 0], [7])).fire).toBe(true)
    expect(readGamepad(pad([0, 0, 0, 0], [0])).fire).toBe(true)
    expect(readGamepad(pad([0, 0, 0, 0], [])).fire).toBe(false)
  })

  it('survives a pad with fewer axes than expected', () => {
    const result = readGamepad(pad([0.5]))
    expect(result.aimX).toBe(0)
    expect(Number.isFinite(result.aimY)).toBe(true)
  })
})

describe('the bomb', () => {
  it('fires once per press, not once per frame', () => {
    // What the first version of this did: a held key took the whole stock in under a tenth of a second.
    const memory = freshInputMemory()
    const held = raw({ keys: new Set(['shift']) })
    expect(intentFrom(held, origin, memory).bomb).toBe(true)
    expect(intentFrom(held, origin, memory).bomb).toBe(false)
    expect(intentFrom(held, origin, memory).bomb).toBe(false)
  })

  it('arms again after a release', () => {
    const memory = freshInputMemory()
    intentFrom(raw({ keys: new Set(['shift']) }), origin, memory)
    intentFrom(raw(), origin, memory)
    expect(intentFrom(raw({ keys: new Set(['shift']) }), origin, memory).bomb).toBe(true)
  })

  it('fires from a press too short to be held across a frame', () => {
    // The bug this pins: a key that goes down and up between two frames leaves no trace in the held set —
    // the down adds and the up removes, both before anything reads it — so the press is simply lost. The
    // bomb is pressed in a panic about a tenth of a second before dying, and losing one is the worst kind
    // of bug a game can have.
    const memory = freshInputMemory()
    const tapped = raw({ bombTapped: true })
    expect(intentFrom(tapped, origin, memory).bomb).toBe(true)
  })

  it('fires only once from a latched press', () => {
    const memory = freshInputMemory()
    const tapped = raw({ bombTapped: true })
    expect(intentFrom(tapped, origin, memory).bomb).toBe(true)
    clearTaps(tapped)
    expect(intentFrom(tapped, origin, memory).bomb).toBe(false)
  })

  it('does not double-fire when a press is both latched and held', () => {
    const memory = freshInputMemory()
    const both = raw({ bombTapped: true, keys: new Set(['shift']) })
    expect(intentFrom(both, origin, memory).bomb).toBe(true)
    clearTaps(both)
    expect(intentFrom(both, origin, memory).bomb).toBe(false)
  })

  it('clears the touch latch as well as the keyboard one', () => {
    const both = raw({
      bombTapped: true,
      touch: { move: null, aim: null, bomb: false, bombTapped: true, rolled: false },
    })
    clearTaps(both)
    expect(both.bombTapped).toBe(false)
    expect(both.touch?.bombTapped).toBe(false)
    expect(intentFrom(both, origin, freshInputMemory()).bomb).toBe(false)
  })

  it('fires from a latched touch tap', () => {
    const tapped = raw({ touch: { move: null, aim: null, bomb: false, bombTapped: true, rolled: false } })
    expect(intentFrom(tapped, origin, freshInputMemory()).bomb).toBe(true)
  })

  it('can be triggered from any scheme', () => {
    expect(intentFrom(raw({ keys: new Set([' ']) }), origin, freshInputMemory()).bomb).toBe(true)
    expect(
      intentFrom(
        raw({ gamepad: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, bomb: true } }),
        origin,
        freshInputMemory(),
      ).bomb,
    ).toBe(true)
    expect(
      intentFrom(
        raw({ touch: { move: null, aim: null, bomb: true, bombTapped: false, rolled: false } }),
        origin,
        freshInputMemory(),
      ).bomb,
    ).toBe(true)
  })
})

describe('touch', () => {
  it('overrides everything, and aiming fires', () => {
    const result = intentFrom(
      raw({
        keys: new Set(['w']),
        touch: { move: { x: -1, y: 0 }, aim: { x: 0, y: -1 }, bomb: false, bombTapped: false, rolled: false },
      }),
      origin,
      freshInputMemory(),
    )
    expect(result.move).toEqual({ x: -1, y: 0 })
    expect(result.aim).toEqual({ x: 0, y: -1 })
    expect(result.firing).toBe(true)
  })

  it('does not fire on a released aim stick', () => {
    const result = intentFrom(
      raw({ touch: { move: { x: 1, y: 0 }, aim: null, bomb: false, bombTapped: false, rolled: false } }),
      origin,
      freshInputMemory(),
    )
    expect(result.firing).toBe(false)
  })

  it('turns the sticks to match a rolled view', () => {
    // Portrait rolls the camera a quarter turn (see `layout.ts`), and the sticks are the one input in screen space —
    // so a thumb pushed towards the top of the glass has to arrive as "up the screen", which in a rolled world is the
    // arena's +x. Without this the ship flies sideways from every input, which is unplayable and would not show up in
    // any screenshot.
    const result = intentFrom(
      raw({ touch: { move: { x: 0, y: 1 }, aim: { x: 1, y: 0 }, bomb: false, bombTapped: false, rolled: true } }),
      origin,
      freshInputMemory(),
    )
    // Compared component-wise rather than with `toEqual`, because a rotation through a right angle produces a signed
    // zero and `toEqual` holds -0 and 0 to be different objects. They are the same direction.
    expect(result.move.x).toBeCloseTo(1)
    expect(result.move.y).toBeCloseTo(0)
    expect(result.aim.x).toBeCloseTo(0)
    expect(result.aim.y).toBeCloseTo(-1)
  })

  it('leaves the sticks alone when the view is upright', () => {
    const result = intentFrom(
      raw({ touch: { move: { x: 0, y: 1 }, aim: { x: 1, y: 0 }, bomb: false, bombTapped: false, rolled: false } }),
      origin,
      freshInputMemory(),
    )
    expect(result.move).toEqual({ x: 0, y: 1 })
    expect(result.aim).toEqual({ x: 1, y: 0 })
  })

  it('does not change how fast the ship goes when the view rolls', () => {
    // A rotation must not scale. If it did, the ship would be a different speed in portrait than in landscape, which
    // is the kind of thing that gets called "floaty" rather than "rotated wrong".
    const stick = { x: 0.6, y: 0.8 }
    for (const rolled of [false, true]) {
      const result = intentFrom(
        raw({ touch: { move: stick, aim: null, bomb: false, bombTapped: false, rolled } }),
        origin,
        freshInputMemory(),
      )
      expect(Math.hypot(result.move.x, result.move.y)).toBeCloseTo(1)
    }
  })
})
