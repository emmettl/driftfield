import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import { filledPolygon, irregular, regularPolygon, star, strokedPolygon } from './outline'

function positionsOf(geometry: ReturnType<typeof strokedPolygon>): number[] {
  const attribute = geometry.getAttribute('position') as BufferAttribute
  return Array.from(attribute.array as Float32Array)
}

describe('strokedPolygon', () => {
  it('emits two vertices per corner and two triangles per segment', () => {
    // The count pins the wrap. An off-by-one where the last segment fails to join back to the first is
    // invisible on a shape with rotational symmetry and obvious on nothing else.
    const square = strokedPolygon(regularPolygon(4), 0.2)
    expect(positionsOf(square)).toHaveLength(4 * 2 * 3)
    expect(square.getIndex()?.count).toBe(4 * 6)

    const ring = strokedPolygon(regularPolygon(12), 0.2)
    expect(ring.getIndex()?.count).toBe(12 * 6)
  })

  it('keeps the stroke width through a corner', () => {
    // The mitre exists for this. Offsetting each corner by half the width along its own normal would
    // pinch the stroke at every corner by the cosine of the turn.
    const width = 0.4
    const square = strokedPolygon(regularPolygon(4), width)
    const p = positionsOf(square)
    // The pair for corner 0: outer at [0..2], inner at [3..5]. Their separation is the width divided by
    // the cosine of half the 90° turn, which is the mitre.
    const separation = Math.hypot(p[0] - p[3], p[1] - p[4])
    expect(separation).toBeCloseTo(width / Math.cos(Math.PI / 4), 4)
  })

  it('clamps a spike at a very sharp corner', () => {
    // At corners under about 30° the mitred offset runs away as 1/sin(θ/2), and a five-pointed star with
    // a tight inner radius has exactly those. Unclamped, the shape grows spikes longer than itself.
    const spiky = strokedPolygon(star(5, 0.2), 0.26)
    const p = positionsOf(spiky)
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.hypot(p[i], p[i + 1])).toBeLessThan(2)
    }
  })

  it('stays centred on the path it was given', () => {
    const square = strokedPolygon(regularPolygon(4), 0.3)
    const p = positionsOf(square)
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < p.length; i += 3) {
      sumX += p[i]
      sumY += p[i + 1]
    }
    expect(sumX / (p.length / 3)).toBeCloseTo(0, 5)
    expect(sumY / (p.length / 3)).toBeCloseTo(0, 5)
  })

  it('produces nothing but finite numbers, even for a degenerate path', () => {
    // A path that doubles back on itself has no mitre direction at the reversal, and the naive form
    // divides by zero there — which yields NaN positions and a shape that silently does not render.
    const doubled = strokedPolygon(
      [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
      0.2,
    )
    for (const value of positionsOf(doubled)) expect(Number.isFinite(value)).toBe(true)
  })

  it('refuses a path that is not a polygon', () => {
    expect(() => strokedPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.2)).toThrow()
  })
})

describe('filledPolygon', () => {
  it('is a fan: one centre vertex, one triangle per edge', () => {
    const diamond = filledPolygon(regularPolygon(4))
    expect(positionsOf(diamond)).toHaveLength((4 + 1) * 3)
    expect(diamond.getIndex()?.count).toBe(4 * 3)
  })

  it('puts the centre at the origin, which is what closes the shape', () => {
    // The whole reason this exists: a heavily stroked outline hits the mitre limit and becomes a ring with a
    // hole in it, which is how the geoms spent a while looking like square doughnuts.
    const p = positionsOf(filledPolygon(regularPolygon(6)))
    expect(p[0]).toBe(0)
    expect(p[1]).toBe(0)
  })

  it('keeps the corners exactly where they were given', () => {
    const points = regularPolygon(5, Math.PI / 2)
    const p = positionsOf(filledPolygon(points))
    for (let i = 0; i < points.length; i++) {
      expect(p[(i + 1) * 3 + 0]).toBeCloseTo(points[i].x)
      expect(p[(i + 1) * 3 + 1]).toBeCloseTo(points[i].y)
    }
  })

  it('refuses a path that is not a polygon', () => {
    expect(() => filledPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toThrow()
  })
})

describe('regularPolygon', () => {
  it('is at unit radius, so the instance scale is the collision radius', () => {
    for (const point of regularPolygon(9)) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(1)
    }
  })

  it('respects the phase', () => {
    const [first] = regularPolygon(4, Math.PI / 2)
    expect(first.x).toBeCloseTo(0)
    expect(first.y).toBeCloseTo(1)
  })
})

describe('star', () => {
  it('alternates outer and inner corners', () => {
    const points = star(5, 0.4)
    expect(points).toHaveLength(10)
    expect(Math.hypot(points[0].x, points[0].y)).toBeCloseTo(1)
    expect(Math.hypot(points[1].x, points[1].y)).toBeCloseTo(0.4)
  })
})

describe('irregular', () => {
  it('perturbs the radii deterministically', () => {
    // One geometry is instanced across every rock on screen, so a "random" rock is the same random rock
    // ninety times. Better that this is a decision than a surprise.
    const once = irregular(regularPolygon(9), [0.1, -0.2])
    const again = irregular(regularPolygon(9), [0.1, -0.2])
    expect(once).toEqual(again)
    expect(Math.hypot(once[0].x, once[0].y)).toBeCloseTo(1.1)
    expect(Math.hypot(once[1].x, once[1].y)).toBeCloseTo(0.8)
  })
})
