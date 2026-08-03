import { Color, type BufferGeometry } from 'three'
import { ENEMY } from '../game/constants'
import type { EnemyKind } from '../game/types'
import { filledPolygon, irregular, regularPolygon, star, strokedPolygon, type Point } from './outline'

// What everything looks like.
//
// One shape per enemy kind, and the shape is the enemy's only tell — there is no health bar, no
// label, and at the top of a bad wave there are two hundred of them at once. So the roster is
// designed as a set of silhouettes that stay distinguishable when they are twelve pixels across,
// overlapping, and glowing: the tests for that are colour, corner count, and whether the outline is
// convex, and no two kinds may share more than one of the three.
//
// All shapes are built at radius 1 and scaled by the instance matrix, so the drawn size is the
// collision radius from `constants.ts` — which is how "you can hit what you can see" stays true
// without anybody maintaining a second set of numbers.

/** Stroke width, in units of the shape's radius. Constant across the roster so that a small enemy
 *  is a small version of its shape rather than a thinner one. */
const STROKE = 0.26

const SHAPES: Record<EnemyKind, Point[]> = {
  // A diamond: four corners, pointing at you. The most legible shape available and it goes to the
  // most numerous enemy.
  drifter: regularPolygon(4, Math.PI / 2),
  // An octagon.
  //
  // It was a square, on the theory that four corners rotated an eighth of a turn reads differently from a
  // diamond — and that was simply wrong, because every enemy spins. A square and a diamond are the same shape
  // a quarter of a second apart, so the drifter and the wanderer were separated by colour alone, which is
  // exactly the failure this roster is built to avoid. Eight corners is unique in the set, and a shape with
  // this many of them reads as inert furniture, which is what a wanderer is.
  wanderer: regularPolygon(8),
  // A five-pointed pinwheel. Sharp, busy, and the only radially asymmetric outline in the set, which
  // is why it is the one that spins visibly.
  weaver: star(5, 0.42),
  // A hexagon for a snake segment. Round enough that seven of them in a line read as one body.
  snake: regularPolygon(6),
  // A chipped nine-sided lump. The irregularity is fixed rather than random: one geometry is
  // instanced across every rock in the arena, so a "random" rock is the same random rock ninety
  // times, and it is better for that to be a decision than a surprise.
  rock: irregular(regularPolygon(9), [0.12, -0.16, 0.08, -0.1, 0.18, -0.06, 0.1, -0.2, 0.04]),
  // A twelve-sided ring — as close to a circle as the roster gets, because a gravity well should
  // read as a hole rather than as a thing.
  well: regularPolygon(12),
  // A triangle, and the only one in the set — three corners is the fewest a shape can have, so even at the
  // handful of pixels a swarmer occupies it is unambiguous. Tiny and pointed, which is what you want for
  // something that arrives eight at a time.
  swarmer: regularPolygon(3, Math.PI / 2),
  // A convex pentagon. The weaver is the other five-cornered shape, but it is a *star* — concave, with
  // alternating radii — so the pair differ on the third of the three cues this roster is built on. Nothing
  // else here is a plain convex pentagon.
  sniper: regularPolygon(5, Math.PI / 2),
}

/**
 * Colours, derived from the hues the simulation already carries for its dye splats.
 *
 * *Derived*, not a parallel table. The previous version of this was a hand-written list of `setHSL` calls
 * whose comment claimed they were one source with `ENEMY[kind].hue` — they were not, they were a copy, and a
 * copy of a palette is a palette that drifts. Now an enemy's outline cannot disagree with the colour of the
 * smoke it leaves, because there is one number.
 *
 * Two rules the pickups depend on, and both are enforced by `shapes.test.ts`:
 *
 * **Every enemy is fully saturated**, so nothing hostile is ever white or grey. See `geomGeometry`.
 *
 * **No enemy is blue or cyan** — see `BANNED_HUES`. The arena's own grid and walls are blue, so a blue enemy is
 * camouflaged against the floor; and blue is the palest part of the wheel once the bloom has had it, which put
 * the two most numerous kinds within a shade of the white reserved for the pickups.
 */
export const ENEMY_COLOUR: Record<EnemyKind, Color> = Object.fromEntries(
  (Object.keys(ENEMY) as EnemyKind[]).map((kind) => [kind, new Color().setHSL(ENEMY[kind].hue, 1, 0.62)]),
) as Record<EnemyKind, Color>

export function enemyGeometry(kind: EnemyKind): BufferGeometry {
  return strokedPolygon(SHAPES[kind], STROKE)
}

/**
 * The ship: a delta, longer than it is wide, with a notch in the tail.
 *
 * The notch does the work. A plain triangle is symmetric enough that at speed you lose track of which
 * end is the front, and in a game where facing and travel are independent that is fatal — you end up
 * reading your own heading off the bullets. The notch makes the tail unmistakably the tail.
 */
export function shipGeometry(): BufferGeometry {
  return strokedPolygon(
    [
      { x: 1.5, y: 0 },
      { x: -0.9, y: 0.95 },
      { x: -0.35, y: 0 },
      { x: -0.9, y: -0.95 },
    ],
    0.3,
  )
}

/**
 * A geom: a small solid diamond, genuinely filled.
 *
 * Two cues separate a pickup from an enemy, and both are needed. It is **filled** where every enemy is a
 * hollow outline — the stroke here is wide enough to close the shape completely. And it is drawn **white**
 * (see `Geoms` in Bullets.tsx) where every enemy is a saturated hue.
 *
 * The colour is the one that matters. The first version made them mint green, which put them at hue 0.45 —
 * directly between the drifter's azure and the wanderer's green — so the one thing in the arena you are
 * supposed to fly *into* looked like two of the things that kill you. Reserving white for the pickups means
 * the distinction survives a busy wave, a bloomed frame and peripheral vision, none of which a hue does.
 */
export function geomGeometry(): BufferGeometry {
  return filledPolygon(regularPolygon(4, Math.PI / 2))
}

/**
 * A bullet: a stretched dart, so it has a nose and a tail and reads as travelling even in a still frame.
 *
 * The stroke is much thinner than the roster's, relative to the shape. At a bullet's size an outline as
 * thick as an enemy's fills the shape in and every shot reads as the same little lozenge, whichever way it
 * is pointing — and which way a shot is pointing is the one thing a bullet has to communicate.
 */
export function bulletGeometry(): BufferGeometry {
  return strokedPolygon(
    [
      { x: 3.2, y: 0 },
      { x: 0.4, y: 0.5 },
      { x: -2.8, y: 0.34 },
      { x: -2.8, y: -0.34 },
      { x: 0.4, y: -0.5 },
    ],
    0.26,
  )
}

/** The arena wall, as a rectangle traced at radius 1 in each axis — scaled to the arena by the mesh
 *  that uses it, so the wall is defined in exactly one place (`ARENA`). */
export function wallGeometry(width: number, height: number, stroke: number): BufferGeometry {
  return strokedPolygon(
    [
      { x: width, y: height },
      { x: -width, y: height },
      { x: -width, y: -height },
      { x: width, y: -height },
    ],
    stroke,
  )
}
