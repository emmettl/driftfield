import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import { BANNED_HUES, ENEMY } from '../game/constants'
import type { EnemyKind } from '../game/types'
import { ENEMY_COLOUR, enemyGeometry, geomGeometry } from './shapes'

const KINDS = Object.keys(ENEMY) as EnemyKind[]

/** Corners in the authored outline: a stroked ribbon is two vertices per corner. */
function corners(kind: EnemyKind): number {
  const attribute = enemyGeometry(kind).getAttribute('position') as BufferAttribute
  return attribute.count / 2
}

describe('the roster', () => {
  it('gives every kind a shape and a colour', () => {
    for (const kind of KINDS) {
      expect(corners(kind)).toBeGreaterThanOrEqual(3)
      expect(ENEMY_COLOUR[kind]).toBeDefined()
    }
  })

  it('derives the outline colour from the hue the simulation splats', () => {
    // One source, so an enemy's outline cannot disagree with the colour of the smoke it leaves. The previous
    // version was a hand-written parallel table whose comment claimed exactly this and did not deliver it.
    for (const kind of KINDS) {
      const { h } = ENEMY_COLOUR[kind].getHSL({ h: 0, s: 0, l: 0 })
      // Hue 0.99 and hue 0.0 are the same colour a hair apart, so compare around the wheel.
      const gap = Math.abs(h - ENEMY[kind].hue)
      expect(Math.min(gap, 1 - gap)).toBeLessThan(0.02)
    }
  })

  it('never gives two kinds the same corner count and the same colour', () => {
    // The roster's rule. Every enemy spins, so *rotation* is not a cue — a square and a diamond are the same
    // shape a quarter of a second apart, which is exactly how the drifter and the wanderer ended up
    // distinguished by colour alone. Corner count is the cue that survives rotation.
    const seen = new Map<number, EnemyKind[]>()
    for (const kind of KINDS) {
      const list = seen.get(corners(kind)) ?? []
      list.push(kind)
      seen.set(corners(kind), list)
    }

    for (const [count, kinds] of seen) {
      if (kinds.length < 2) continue
      // Sharing a corner count is allowed, but only if the hues are far apart *and* one of them is concave —
      // the weaver's five-pointed star against a convex pentagon, for instance.
      for (let i = 0; i < kinds.length; i++) {
        for (let j = i + 1; j < kinds.length; j++) {
          const gap = Math.abs(ENEMY[kinds[i]].hue - ENEMY[kinds[j]].hue)
          expect(
            Math.min(gap, 1 - gap),
            `${kinds[i]} and ${kinds[j]} both have ${count} corners and near-identical hues`,
          ).toBeGreaterThan(0.12)
        }
      }
    }
  })

  it('keeps every enemy out of the blue band', () => {
    // Two compounding reasons, both in `BANNED_HUES`: the arena's own furniture is blue, so a blue enemy hides
    // against the floor; and blue blooms to very nearly white, which is reserved for the geoms — an enemy that
    // reads as a pickup is worse than one that is merely hard to see.
    for (const kind of KINDS) {
      const hue = ENEMY[kind].hue
      expect(
        hue < BANNED_HUES.from || hue > BANNED_HUES.to,
        `${kind} is at hue ${hue}, inside the banned blue band`,
      ).toBe(true)
    }
  })

  it('spaces the hues far enough apart to tell apart', () => {
    const hues = KINDS.map((kind) => ENEMY[kind].hue).sort((a, b) => a - b)
    for (let i = 1; i < hues.length; i++) {
      expect(hues[i] - hues[i - 1], `hues ${hues[i - 1]} and ${hues[i]} are too close`).toBeGreaterThan(0.06)
    }
  })

  it('reserves an unsaturated pickup, so nothing hostile can look like a geom', () => {
    // The rule the pickups depend on: every enemy is fully saturated, and the geoms are drawn white (see
    // `Geoms`). The first version made them mint green, sitting between two enemies' hues.
    for (const kind of KINDS) {
      const { s } = ENEMY_COLOUR[kind].getHSL({ h: 0, s: 0, l: 0 })
      expect(s).toBeGreaterThan(0.9)
    }
    // And a geom is solid where every enemy is a hollow outline: a fan has one centre vertex plus its corners.
    const geom = geomGeometry().getAttribute('position') as BufferAttribute
    expect(geom.count).toBe(5)
  })
})
