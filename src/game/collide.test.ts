import { describe, expect, it } from 'vitest'
import { CELL_SIZE, SpatialGrid, circlesOverlap } from './collide'
import { ARENA, ENEMY, SHIP, rockTier } from './constants'

describe('CELL_SIZE', () => {
  it('is at least as large as the biggest pair of radii that can collide', () => {
    // The correctness condition for a 3×3 query. If a cell is smaller than the largest colliding pair,
    // two overlapping bodies can land two cells apart and the collision is silently missed — which
    // would show up as a rock you can fly through, but only sometimes, and only when the arena is busy.
    const biggest = Math.max(...Object.values(ENEMY).map((spec) => spec.radius), rockTier(2).radius)
    expect(CELL_SIZE).toBeGreaterThanOrEqual(biggest + SHIP.radius)
  })
})

describe('SpatialGrid', () => {
  it('finds a body in the same cell', () => {
    const grid = new SpatialGrid()
    grid.insert(7, 0, 0)
    expect(grid.query(0, 0, [])).toContain(7)
  })

  it('finds a body one cell away, which is what makes the 3×3 query correct', () => {
    const grid = new SpatialGrid()
    grid.insert(1, 0, 0)
    expect(grid.query(CELL_SIZE * 0.9, 0, [])).toContain(1)
    expect(grid.query(0, -CELL_SIZE * 0.9, [])).toContain(1)
  })

  it('does not return bodies from the far side of the arena', () => {
    const grid = new SpatialGrid()
    grid.insert(1, -ARENA.halfWidth, -ARENA.halfHeight)
    expect(grid.query(ARENA.halfWidth, ARENA.halfHeight, [])).toHaveLength(0)
  })

  it('keeps a body that has strayed outside the arena in the edge cell', () => {
    // A bullet on the frame it leaves, a rock mid-bounce. Dropping it would mean one frame in which it
    // cannot hit anything.
    const grid = new SpatialGrid()
    grid.insert(4, ARENA.halfWidth + 40, 0)
    expect(grid.query(ARENA.halfWidth - 1, 0, [])).toContain(4)
  })

  it('clears without dropping its cell arrays', () => {
    const grid = new SpatialGrid()
    grid.insert(1, 0, 0)
    grid.clear()
    expect(grid.query(0, 0, [])).toHaveLength(0)
    grid.insert(2, 0, 0)
    expect(grid.query(0, 0, [])).toEqual([2])
  })

  it('reuses the output array it is handed', () => {
    const grid = new SpatialGrid()
    grid.insert(1, 0, 0)
    const out: number[] = []
    expect(grid.query(0, 0, out)).toBe(out)
    grid.query(ARENA.halfWidth, ARENA.halfHeight, out)
    expect(out).toHaveLength(0)
  })
})

describe('circlesOverlap', () => {
  it('touches at exactly the sum of the radii', () => {
    expect(circlesOverlap(0, 0, 1, 3, 0, 2)).toBe(true)
    expect(circlesOverlap(0, 0, 1, 3.001, 0, 2)).toBe(false)
  })

  it('works on the diagonal', () => {
    expect(circlesOverlap(0, 0, 1, 2, 2, 2)).toBe(true)
    expect(circlesOverlap(0, 0, 1, 3, 3, 2)).toBe(false)
  })
})
