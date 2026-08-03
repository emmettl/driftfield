import { ARENA } from './constants'

// How the screen is divided up, and which way round the arena is drawn.
//
// On a desktop this is trivial: the canvas is the window and the HUD floats in the corners. On a phone it is the
// hardest layout problem in the game, and the reasoning is worth setting out before the numbers.
//
// **Thumbs cover the playfield.** Sticks drawn *over* the arena are fine on a tablet held at arm's length and
// useless on a phone: your thumbs sit exactly where the ship is, covering the two things you most need to see. So
// the controls get space of their own, and the canvas is what is left.
//
// **The arena's shape is fixed.** It is 120 × 68 and it *is* the level: a player on one device must not be able to
// see enemies a player on another cannot.
//
// **But which way round it is drawn is free.** That is the idea this file turns on. The camera can be rolled a
// quarter turn, so the arena's long axis runs *down* the screen instead of across it — and because nothing about
// the simulation changes, a player in portrait is looking at exactly the same 120 × 68 arena as a player in
// landscape. Same level, same spawns, same distances; rotated on the glass. It is the cheapest possible way to
// support portrait, and it is why portrait needed no changes to `src/game` at all.
//
// It matters enormously. On a portrait phone the upright arena is a 430 × 244 strip across the middle of a tall
// screen; rolled, it is 407 × 718 — 2.8 times the area, and 5.98 pixels per world unit against 3.58. In landscape
// the comparison reverses just as hard. So rather than guessing per device class, both orientations are costed and
// the bigger one wins.
//
// **The controls then follow from the orientation.** A rolled view is a tall screen, and on a tall screen the hands
// are at the bottom, so the controls go in a band along the bottom. An upright view on a wide screen has slack at the
// sides and thumbs that reach them, so the controls become rails — which costs the playfield nothing, because the
// arena is drawn as large as the *tighter* axis allows and the looser axis was going spare. Either way the rule is
// the same: spend the slack first, and only take from the arena if the controls' minimum is not covered.

/** The arena's own aspect, drawn upright. Everything here is a comparison against this or its reciprocal. */
export const ARENA_ASPECT = ARENA.halfWidth / ARENA.halfHeight

export type ControlPlacement = 'none' | 'rails' | 'band'

/**
 * Bounds on the bottom band, in CSS pixels.
 *
 * The floor is what a thumb needs whatever the screen; the ceiling is because past about this the extra space buys
 * nothing and is better spent on the arena.
 */
const BAND_MIN = 104
const BAND_MAX = 190

/**
 * Narrowest a rail may be, in CSS pixels.
 *
 * A stick needs a ring around a thumb's travel, and 88 is about the least that reads as one. If the viewport is so
 * wide that the arena at full height leaves less than this either side, the arena gives up the difference — the
 * controls have a hard minimum and the playfield does not.
 */
const RAIL_MIN = 88

/** Widest useful rail. Past this the stick stops growing and the rest becomes margin, because a stick with more
 *  travel than a thumb has is a stick you cannot reach the edge of. */
const RAIL_MAX = 168

/** A stick's full-deflection radius, as a share of the space its zone has to give — the rail's width, or the band's
 *  height. Derived rather than fixed, so the two cannot disagree and leave a stick overflowing its own zone. */
const RAIL_STICK_SHARE = 0.34
const BAND_STICK_SHARE = 0.33

export interface ViewportShape {
  width: number
  height: number
  /** Whether the controls need space of their own. False on anything with a real pointer. */
  touch: boolean
  /** Phone-class: small screen as well as touch. Kept because the quality tiers care, even though the layout no
   *  longer treats phones and tablets differently — the aspect ratio says everything it needs to know. */
  phone: boolean
}

export interface Layout {
  placement: ControlPlacement
  /**
   * Whether the camera is rolled a quarter turn, so the arena's long axis runs down the screen.
   *
   * Chosen by costing both orientations and taking the bigger playfield — see the note at the top. Consumed by the
   * camera (`fitCamera`, and the roll itself in `Scene`) and by `intentFrom`, which has to rotate the touch sticks'
   * screen-space directions into world space to match.
   */
  rolled: boolean
  /** Width of each side rail, in CSS pixels. Zero unless `placement` is `rails`. */
  rail: number
  /** Height of the bottom band, in CSS pixels. Zero unless `placement` is `band`. */
  band: number
  /**
   * The canvas, in CSS pixels — the largest arena-shaped box that fits what the controls left over.
   *
   * Arena-shaped on touch rather than filling the space, and that is worth a note because it looks like it should
   * cost playfield and does not. The arena is drawn as large as the tighter axis allows either way; fitting the
   * canvas to it only decides whether the leftover space sits *inside* the canvas or outside it. Outside is much
   * cheaper — every pixel inside is still paid for by the bloom, the grade and the particle overdraw — and it
   * leaves the grade framing the playfield rather than the device.
   */
  canvas: { width: number; height: number }
  aspect: number
  /** Full-deflection radius for a stick, in CSS pixels. */
  stickRange: number
  /**
   * Pixels per world unit along the arena's long axis.
   *
   * Here to be asserted on rather than to lay anything out. "Is the playfield a sensible size" is the question this
   * file exists to answer, and it is much easier to answer with a number than with a screenshot from one device.
   */
  scale: number
}

/** The largest box of a given aspect that fits inside a space. */
function fitBox(width: number, height: number, aspect: number): { width: number; height: number } {
  const byWidth = { width, height: width / aspect }
  return byWidth.height <= height ? byWidth : { width: height * aspect, height }
}

export type OrientationFit = Omit<Layout, 'rolled' | 'scale'> & { area: number }

/**
 * What one orientation would give us, controls included.
 *
 * Both orientations go through this and the better one is kept, which is the only honest way to choose: the answer
 * depends on the viewport's aspect against the arena's, and that comparison flips between a phone in portrait, the
 * same phone in landscape, and a tablet in either. Exported so the test can check the rejected orientation really was
 * the worse one, rather than reimplementing the comparison and being free to disagree with it.
 *
 * **Rails are for upright views only.** A rolled view means the screen is tall, and on a tall screen the hands are at
 * the bottom — the sides at mid-height are the one place nothing rests. Allowing rails there produced exactly that:
 * on a portrait tablet, two 88-pixel slivers pinned to the bezels with the bomb stranded in the bottom corner. It
 * measured 11% more playfield than a band and was materially worse to hold, which is the wrong trade. So the
 * orientation decides the arrangement, and rails and a tall screen never meet.
 *
 * Both branches then follow the same rule: **spend the slack, and only then take from the arena.** The controls have
 * a hard minimum and the playfield does not, so if the free space along the loose axis covers the minimum the arena
 * keeps every pixel it can use; if it does not, the arena gives up the difference and no more. Getting this wrong in
 * the band was worth 126 pixels of playfield on a portrait phone and 68 of arena width on a tablet — it took a fixed
 * share of the height rather than the *free* height, so it charged the arena for space that was already going spare.
 */
export function orientationFor(width: number, height: number, rolled: boolean): OrientationFit {
  const aspect = rolled ? 1 / ARENA_ASPECT : ARENA_ASPECT

  if (!rolled && width / height > aspect) {
    // Wider than the arena: height is tight, width is slack, so the controls go at the sides.
    const slack = Math.floor((width - height * aspect) / 2)
    const rail = Math.min(RAIL_MAX, Math.max(RAIL_MIN, slack))
    const box = fitBox(Math.max(1, width - rail * 2), height, aspect)
    const canvas = { width: Math.round(box.width), height: Math.round(box.height) }
    return {
      placement: 'rails',
      rail,
      band: 0,
      canvas,
      aspect: canvas.width / Math.max(1, canvas.height),
      stickRange: Math.round(rail * RAIL_STICK_SHARE),
      area: canvas.width * canvas.height,
    }
  }

  // Either rolled, or narrower than the arena. Width is the tight axis, so the controls go along the bottom — which
  // on a screen held upright is where the thumbs already are.
  const slack = Math.floor(height - width / aspect)
  const band = Math.min(
    // Never more than half the screen, however short it is. A viewport too small to afford the band is better served
    // by a cramped one than by no canvas, and this only ever binds on shapes nobody actually holds.
    Math.floor(height * 0.5),
    Math.min(BAND_MAX, Math.max(BAND_MIN, slack)),
  )
  const box = fitBox(width, Math.max(1, height - band), aspect)
  const canvas = { width: Math.round(box.width), height: Math.round(box.height) }
  return {
    placement: 'band',
    rail: 0,
    band,
    canvas,
    aspect: canvas.width / Math.max(1, canvas.height),
    stickRange: Math.round(band * BAND_STICK_SHARE),
    area: canvas.width * canvas.height,
  }
}

export function resolveLayout({ width, height, touch }: ViewportShape): Layout {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  if (!touch) {
    return {
      placement: 'none',
      rolled: false,
      rail: 0,
      band: 0,
      canvas: { width: safeWidth, height: safeHeight },
      aspect: safeWidth / safeHeight,
      stickRange: 0,
      scale: Math.min(safeWidth / (ARENA.halfWidth * 2), safeHeight / (ARENA.halfHeight * 2)),
    }
  }

  const upright = orientationFor(safeWidth, safeHeight, false)
  const rolled = orientationFor(safeWidth, safeHeight, true)
  // The bigger playfield wins. On a portrait phone that is the rolled one by a factor of nearly three; in landscape
  // it is the upright one by a similar margin. Ties — a square viewport — go to upright, which is the orientation
  // the artwork and the HUD were designed around.
  const better = rolled.area > upright.area ? rolled : upright

  return {
    ...better,
    rolled: better === rolled,
    // The long axis is 120 world units either way round, so this is comparable across orientations.
    scale: Math.max(better.canvas.width, better.canvas.height) / (ARENA.halfWidth * 2),
  }
}
