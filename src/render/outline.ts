import { BufferAttribute, BufferGeometry } from 'three'

// Neon outlines, as real geometry.
//
// Everything in the arena is drawn as a glowing stroked shape, and the obvious way to do that is
// `LineSegments` — which is wrong here for one specific reason: WebGL's line width is one pixel on
// every platform that matters, because `lineWidth` above 1 has been unimplemented in every browser
// for years. A one-pixel line looks thin, does not survive the adaptive render scale (see
// `renderScale.ts`) and gives the bloom pass almost nothing to catch, which for a game whose whole
// look is bloom is the difference between neon and a wireframe.
//
// So an outline is built as a ribbon of triangles: two vertices per corner, offset either side of the
// path along the mitred normal. That is an ordinary mesh, which means it can be instanced — a hundred
// drifters are one draw call — it can be scaled by the instance matrix, and it has a real width in
// world units that a bloom pass can find.

export interface Point {
  x: number
  y: number
}

/**
 * The mitre limit, as a multiple of the stroke half-width.
 *
 * At a sharp corner the mitred offset runs away towards infinity — the join of two nearly-opposite
 * segments is a spike whose length goes as 1/sin(θ/2). The pinwheel shape has corners under 30°, so
 * without a limit it grows spikes several times longer than the shape itself. Clamping produces a
 * slightly bevelled corner instead, which at these sizes is invisible.
 */
const MITRE_LIMIT = 2.6

/**
 * A closed stroked outline of a polygon, centred on the origin.
 *
 * Vertices come in pairs — outer then inner for each corner — and the ribbon is stitched as two
 * triangles per segment, wrapping at the end. So a shape with `n` corners is `2n` vertices and `6n`
 * indices, which the test pins: an off-by-one in the wrap is invisible on a shape with rotational
 * symmetry and obvious on nothing else.
 *
 * @param points corners in order, without repeating the first
 * @param width stroke width in world units
 */
export function strokedPolygon(points: Point[], width: number): BufferGeometry {
  if (points.length < 3) throw new Error('a stroked polygon needs at least three corners')

  const half = width / 2
  const count = points.length
  const positions = new Float32Array(count * 2 * 3)

  for (let i = 0; i < count; i++) {
    const previous = points[(i - 1 + count) % count]
    const current = points[i]
    const next = points[(i + 1) % count]

    // Unit normals of the two segments meeting here, taken as the perpendicular of each segment
    // direction. Their sum, normalised, is the mitre direction.
    const inNormal = perpendicular(current.x - previous.x, current.y - previous.y)
    const outNormal = perpendicular(next.x - current.x, next.y - current.y)

    let mx = inNormal.x + outNormal.x
    let my = inNormal.y + outNormal.y
    const mLength = Math.hypot(mx, my)
    if (mLength < 1e-6) {
      // A perfect reversal — the two segments are collinear and opposite. There is no mitre
      // direction, so fall back to one segment's normal rather than dividing by zero.
      mx = inNormal.x
      my = inNormal.y
    } else {
      mx /= mLength
      my /= mLength
    }

    // Scale so the stroke keeps its width through the corner: the offset along the mitre has to be
    // half / cos(half the turn), and the dot with either segment normal is exactly that cosine.
    const cosine = Math.max(1e-3, mx * inNormal.x + my * inNormal.y)
    const offset = Math.min(half / cosine, half * MITRE_LIMIT)

    const outer = i * 6
    positions[outer + 0] = current.x + mx * offset
    positions[outer + 1] = current.y + my * offset
    positions[outer + 2] = 0
    positions[outer + 3] = current.x - mx * offset
    positions[outer + 4] = current.y - my * offset
    positions[outer + 5] = 0
  }

  const indices = new Uint16Array(count * 6)
  for (let i = 0; i < count; i++) {
    const a = i * 2
    const b = a + 1
    const c = ((i + 1) % count) * 2
    const d = c + 1
    const at = i * 6
    indices[at + 0] = a
    indices[at + 1] = b
    indices[at + 2] = c
    indices[at + 3] = b
    indices[at + 4] = d
    indices[at + 5] = c
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/**
 * A solid polygon, as a triangle fan from the centre.
 *
 * The stroked builder above cannot make one: a ribbon with a stroke wider than the shape's radius does not
 * close into a disc, it hits the mitre limit and turns into a ring with a hole in the middle — which is how
 * the geoms spent a while looking like little square doughnuts. Everything hostile is drawn as an outline and
 * everything of the player's is drawn solid, so both builders are needed.
 */
export function filledPolygon(points: Point[]): BufferGeometry {
  if (points.length < 3) throw new Error('a filled polygon needs at least three corners')

  const count = points.length
  // The centre is vertex 0, and the fan goes round from there.
  const positions = new Float32Array((count + 1) * 3)
  for (let i = 0; i < count; i++) {
    positions[(i + 1) * 3 + 0] = points[i].x
    positions[(i + 1) * 3 + 1] = points[i].y
  }

  const indices = new Uint16Array(count * 3)
  for (let i = 0; i < count; i++) {
    indices[i * 3 + 0] = 0
    indices[i * 3 + 1] = i + 1
    indices[i * 3 + 2] = ((i + 1) % count) + 1
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

function perpendicular(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return { x: 0, y: 0 }
  // Left-hand perpendicular. Which hand does not matter — the ribbon is symmetric about the path —
  // but it has to be the same one at both ends of a segment or the quad is a bowtie.
  return { x: -dy / length, y: dx / length }
}

/** A regular polygon's corners, at radius 1, with the first corner at `phase` radians. Radius 1 so
 *  that the instance matrix's scale is the enemy's collision radius and nothing has to remember a
 *  conversion factor. */
export function regularPolygon(sides: number, phase = 0): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = phase + (i / sides) * Math.PI * 2
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })
}

/**
 * A star, as alternating outer and inner corners.
 *
 * `inner` under about 0.4 gives corners sharp enough to hit the mitre limit, which is fine — see the
 * note on it above — and is what makes a pinwheel read as something with edges rather than as a
 * cog.
 */
export function star(points: number, inner: number, phase = 0): Point[] {
  const corners: Point[] = []
  for (let i = 0; i < points * 2; i++) {
    const angle = phase + (i / (points * 2)) * Math.PI * 2
    const radius = i % 2 === 0 ? 1 : inner
    corners.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  }
  return corners
}

/** Perturb a polygon's radii, deterministically. For the rocks, which should look chipped rather
 *  than machined — and which must look the same every time, since one geometry is instanced across
 *  every rock on screen. */
export function irregular(points: Point[], amounts: number[]): Point[] {
  return points.map((point, i) => {
    const scale = 1 + amounts[i % amounts.length]
    return { x: point.x * scale, y: point.y * scale }
  })
}
