import { ARENA } from './constants'

// Broad-phase collision, as a uniform grid.
//
// The naive version — every bullet against every enemy — is what the first draft does and
// it is fine until it is not. A bad singularity wave is around 200 enemies and 250 live
// bullets, which is 50,000 distance checks a frame, sixty times a second, on top of
// everything else; on a phone that is the frame budget gone on arithmetic nobody asked for.
//
// A uniform grid is the right structure here rather than a quadtree or a BVH, because the
// arena is a fixed rectangle, entities are all roughly the same size, and they are spread
// fairly evenly across it — the exact conditions a hash grid is best at, and it rebuilds
// from scratch every frame in linear time with no allocation.

/**
 * Cell size, in world units.
 *
 * The correctness condition for querying a 3×3 block of cells around a point is that the
 * sum of any two colliding radii is no larger than one cell. The largest such sum in the
 * game is the ship against a big rock, 1.5 + 4.2, so 12 leaves better than a factor of two
 * in hand — and a bigger cell only costs a few more candidates per query, whereas one that
 * is too small silently misses collisions at the exact moment the arena is busiest.
 */
export const CELL_SIZE = 12

const COLUMNS = Math.ceil((ARENA.halfWidth * 2) / CELL_SIZE) + 2
const ROWS = Math.ceil((ARENA.halfHeight * 2) / CELL_SIZE) + 2

/**
 * A grid of entity indices, rebuilt each frame.
 *
 * Indices rather than the entities themselves: the caller owns the arrays and knows what
 * is in them, and handing back numbers keeps this file free of every entity type in the
 * game. Cells are reused between frames — `clear` truncates them rather than dropping
 * them, so after the first few frames the grid never allocates again, which is the whole
 * reason to have written it rather than reaching for a library.
 */
export class SpatialGrid {
  private readonly cells: number[][]

  constructor() {
    this.cells = Array.from({ length: COLUMNS * ROWS }, () => [])
  }

  clear(): void {
    for (const cell of this.cells) cell.length = 0
  }

  private indexAt(x: number, y: number): number {
    // Clamped rather than wrapped or rejected: something a little outside the arena — a
    // bullet on the frame it leaves, a rock mid-bounce — belongs in the edge cell, not
    // nowhere. Dropping it would mean a bullet that cannot hit anything for one frame.
    const column = Math.min(
      COLUMNS - 1,
      Math.max(0, Math.floor((x + ARENA.halfWidth) / CELL_SIZE) + 1),
    )
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor((y + ARENA.halfHeight) / CELL_SIZE) + 1))
    return row * COLUMNS + column
  }

  insert(index: number, x: number, y: number): void {
    this.cells[this.indexAt(x, y)].push(index)
  }

  /**
   * Every index in the 3×3 block of cells around a point, appended to `out`.
   *
   * `out` is supplied and reused by the caller for the same reason the cells are: this is
   * called once per bullet per frame, and a fresh array each time is hundreds of
   * short-lived objects a frame for the garbage collector to deal with mid-wave.
   */
  query(x: number, y: number, out: number[]): number[] {
    out.length = 0
    const centre = this.indexAt(x, y)
    const column = centre % COLUMNS
    const row = Math.floor(centre / COLUMNS)

    for (let r = Math.max(0, row - 1); r <= Math.min(ROWS - 1, row + 1); r++) {
      for (let c = Math.max(0, column - 1); c <= Math.min(COLUMNS - 1, column + 1); c++) {
        const cell = this.cells[r * COLUMNS + c]
        for (let i = 0; i < cell.length; i++) out.push(cell[i])
      }
    }
    return out
  }
}

/** Whether two circles overlap. The one place the collision rule lives, so that "you can
 *  hit what you can see" is a single line rather than a convention. */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx
  const dy = ay - by
  const reach = ar + br
  return dx * dx + dy * dy <= reach * reach
}
