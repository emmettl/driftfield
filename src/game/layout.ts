import { ARENA } from './constants'

// How the screen is divided up.
//
// On a desktop this is trivial: the canvas is the window and the HUD floats in the corners. On a phone it is the
// hardest layout problem in the game, and it is worth setting out why before the numbers.
//
// **Thumbs cover the playfield.** The desktop build draws its touch sticks over the arena, which is fine on a
// tablet held at arm's length and useless on a phone: your thumbs sit exactly where the ship is, and the two
// things you most need to see — where you are, and what is arriving — are underneath them. So the controls get a
// band of their own along the bottom, and the canvas is only the space above it. Cheaper as well as clearer: a
// shorter canvas is fewer pixels for the fluid, the particles and the bloom to cover.
//
// **The arena has a fixed shape, and a phone does not match it.** The arena is 120 × 68 — 16:9, near enough —
// and it cannot be reshaped to suit the screen, because it is the level: a player on one device must not be able
// to see enemies a player on another cannot. A landscape phone is more like 2.2:1, which is *wider* than the
// arena, so the arena's height is what binds and there is unavoidable space either side. Taking a band off the
// bottom therefore costs arena size directly — every pixel of band is a pixel of height the arena cannot use,
// and because the fit is height-limited, height is the expensive direction.
//
// That trade is worth making, and it is the whole reason this file exists: the band is as small as a thumb can
// work with rather than as large as looks comfortable in a mockup, and the stick's travel is derived *from* the
// band rather than fixed independently of it.

/** The arena's own aspect. What the camera is trying to fit into whatever is left over. */
export const ARENA_ASPECT = ARENA.halfWidth / ARENA.halfHeight

/**
 * The band's share of the viewport height.
 *
 * Just under a third. That is a lot to give up, and it is the smallest share that leaves a stick with enough
 * travel to steer accurately — see `stickRange`. Anything less and the band is a strip you jab at rather than a
 * control you hold.
 */
const BAND_FRACTION = 0.3

/**
 * Floor and ceiling on the band, in CSS pixels.
 *
 * The floor is what a thumb needs whatever the screen: on a very short viewport — a phone in landscape with the
 * browser chrome showing — a third of the height is not enough to steer with, and the honest answer is to take
 * more of it rather than to ship a stick nobody can aim.
 *
 * The ceiling is for tablets, where a third of an 820-pixel height would be a 270-pixel band holding two sticks
 * a thumb can cross in a centimetre. Past about this the extra space buys nothing.
 */
const BAND_MIN = 104
const BAND_MAX = 190

/**
 * A stick's full-deflection radius, as a share of the band's height.
 *
 * Derived from the band rather than chosen independently, which is the point: the two numbers have to agree or
 * the stick either overflows the band it lives in or rattles around inside it. At a third, a knob at full
 * deflection sits inside the band with room left for the ring around it and the label under it — which at 0.36
 * was being clipped by a couple of pixels.
 */
const STICK_SHARE = 0.33

export interface ViewportShape {
  width: number
  height: number
  /** Whether the controls need a band of their own. False on anything with a real pointer. */
  touch: boolean
  /** Phone-class: small screen as well as touch. Tablets are touch but not phones. */
  phone: boolean
}

export interface Layout {
  /** Height of the control band, in CSS pixels. Zero when there is no touch. */
  band: number
  /**
   * The canvas, in CSS pixels.
   *
   * On a desktop this is simply the window: the arena sits inside it with whatever margins its shape implies, and
   * the grade's vignette falls away at the edges of the screen, which is the look the game has.
   *
   * On touch the canvas is instead the largest arena-shaped box that fits the space above the band, centred. That
   * is worth doing for one reason above all: a landscape phone is around 2.2:1 against an arena of 1.76:1, so
   * nearly half of a full-width canvas is empty space either side of the playfield — and every one of those pixels
   * is still paid for by the bloom, the grade and the particle overdraw. Fitting the canvas to the arena throws
   * away that cost entirely, which on a phone is the single cheapest performance decision available. The strips
   * either side become ordinary page background, and the grade ends up framing the playfield rather than the
   * device, which suits a game that already looks like something in a cabinet.
   */
  canvas: { width: number; height: number }
  aspect: number
  /** Full-deflection radius for a stick, in CSS pixels. */
  stickRange: number
  /**
   * Whether to ask the player to turn the device round instead of playing.
   *
   * Phones only. A phone in portrait is around 0.46:1 against an arena of 1.76:1, so fitting the arena's width
   * leaves it as a thin strip across the middle of a tall screen with the ship a few pixels across — not
   * difficult, just not the game. A tablet in portrait is 0.7:1, which is wasteful but perfectly playable, so it
   * is left alone: telling somebody to rotate a device that works is worse than a slightly empty screen.
   */
  rotate: boolean
  /**
   * How much of the canvas the arena actually fills, 0..1, along its tighter axis.
   *
   * Not used to lay anything out — it is here to be asserted on. "Does the playfield end up a sensible size on a
   * phone" is the question this whole file exists to answer, and it is much easier to answer with a number than
   * by looking at a screenshot on one device.
   */
  fill: number
}

export function resolveLayout({ width, height, touch, phone }: ViewportShape): Layout {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  const band = touch
    ? Math.min(BAND_MAX, Math.max(BAND_MIN, Math.round(safeHeight * BAND_FRACTION)))
    : 0
  // Never more than two-thirds of the screen, however short it is — a viewport that cannot afford the band at all
  // is better off with a cramped one than with no canvas.
  const clamped = Math.min(band, Math.floor(safeHeight * 0.66))
  const availableHeight = Math.max(1, safeHeight - clamped)

  // On touch, the largest arena-shaped box that fits the space above the band — see `Layout.canvas`. Whichever
  // axis binds is the one that ends up exact; the other is derived from it, so the box is never larger than the
  // space it has.
  const canvas =
    touch && safeWidth / availableHeight > ARENA_ASPECT
      ? { width: Math.round(availableHeight * ARENA_ASPECT), height: availableHeight }
      : touch
        ? { width: safeWidth, height: Math.round(safeWidth / ARENA_ASPECT) }
        : { width: safeWidth, height: availableHeight }

  const aspect = canvas.width / Math.max(1, canvas.height)

  return {
    band: clamped,
    canvas,
    aspect,
    stickRange: Math.round(clamped * STICK_SHARE),
    rotate: phone && safeWidth < safeHeight,
    fill: arenaFill(aspect),
  }
}

/**
 * What fraction of the canvas the arena covers along whichever axis binds.
 *
 * A canvas wider than the arena is height-limited, so the arena fills the height and this reports how much of the
 * *width* it uses; a narrow canvas is the other way round. Either way it is the number that says whether the
 * playfield ended up a reasonable size.
 */
export function arenaFill(aspect: number): number {
  return aspect > ARENA_ASPECT ? ARENA_ASPECT / aspect : aspect / ARENA_ASPECT
}
