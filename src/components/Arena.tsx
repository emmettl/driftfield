import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { beatPulse } from '../game/beat'
import { ARENA } from '../game/constants'
import { quality } from '../game/device'
import { getWorld } from '../game/useGameStore'
import { wellStress } from '../game/wells'
import { fixedBounds } from '../render/bounds'
import { shipWarp } from '../render/warp'
import { wallGeometry } from '../render/shapes'
import { useField } from './Field'

// The floor: a lattice of neon lines that the fluid bends.
//
// This is the single most important thing on screen after the ship, and it is the one effect that
// cannot be faked. Every game in this genre has a warping grid, and they mostly do it with a ripple
// function — a sine wave expanding from each explosion, summed. That looks fine in isolation and wrong
// next to smoke, because the ripple and the smoke are two different approximations of the same event
// and they disagree about where the energy went.
//
// Here the grid samples the fluid's velocity field and displaces its vertices by it. So the floor bends
// because the fluid pushed it, in the same direction the smoke went and the sparks flew, and a vortex
// that curls in the dye curls the grid with it. Nothing had to be tuned to match, because there is
// nothing to match: it is one field with three consumers.
//
// The wells are handled separately, as a short uniform array, and that is not an inconsistency. A well
// pulls constantly and reaches 34 units; putting that into the fluid would mean splatting an inward
// velocity every frame and fighting the pressure solve, which cancels exactly the kind of steady
// convergent flow a black hole is. Gravity is a field the game owns and the fluid does not know about.

/** Most wells the shader will bend for. `wellLimit` caps the game at three; the fourth slot is there
 *  so that a bug in the cap is a missing funnel rather than a shader that fails to compile. */
const MAX_WELLS = 4

/**
 * World units of displacement per unit of fluid velocity.
 *
 * The velocity field is in uv per second and a kill's shove peaks around 0.15, so this puts a kill's
 * ripple at a couple of world units — clearly visible, and about a cell. A bomb reaches nearer 0.7 and
 * hits the ceiling below.
 */
const WARP = 14

/**
 * Most a grid vertex may be displaced, in world units.
 *
 * A cell is about 2.7 units across, so this is a bit under two cells: enough that a bomb visibly tears at the
 * floor, little enough that the lattice still reads as a lattice. Raised when the kill blasts were made
 * stronger — a kill now displaces the grid by about 3.3 units, and a ceiling below that would have meant
 * every kill slamming into the clamp with no headroom left to make a bomb look different. See the note in the vertex shader —
 * the grid is the player's only sense of scale, and a grid that comes apart takes that with it.
 */
const MAX_SHIFT = 4.6

/**
 * Displacement below which the grid does not move at all, in world units.
 *
 * See the note in the vertex shader: this is what keeps a resting arena flat. Roughly a fifth of a cell —
 * far below anything an explosion produces, comfortably above the field's idle residue.
 */
const QUIET = 0.4

/** How far a well drags the nearest grid vertices, in world units, at full stress. */
const WELL_PULL = 5.5

const GRID_VERTEX = /* glsl */ `
attribute float aEdge;

uniform sampler2D uVelocity;
uniform vec2 uHalfExtent;
uniform float uWarp;
uniform float uMaxShift;
uniform float uQuiet;
uniform float uHasFluid;
uniform vec3 uWells[${MAX_WELLS}];
uniform int uWellCount;
/* xy: where the ship is. z: how hard it pushes, in world units. See shipWarp in render/warp.ts. */
uniform vec3 uShip;
uniform float uShipReach;

varying float vHeat;
varying float vEdge;

void main() {
  vec3 world = position;
  vec2 uv = vec2(
    world.x / uHalfExtent.x * 0.5 + 0.5,
    world.y / uHalfExtent.y * 0.5 + 0.5
  );

  // Sampled in the vertex shader, which needs the texture to be readable there — it is, in WebGL2, for
  // any texture with no mipmaps and nearest or linear filtering. (In WebGL1 this was a
  // per-driver lottery, which is part of why this technique used to be done on the CPU.)
  vec2 flow = texture2D(uVelocity, uv).xy * uHasFluid;

  // Clamped, and this is not belt-and-braces — it is what keeps the floor legible.
  //
  // The grid is the player's frame of reference: it is how they judge distance, and it is the only thing
  // on screen that says where the walls are relative to where they are. A vertex displaced further than a
  // cell or two stops being part of a grid and becomes a stray line, and a field of those is
  // unreadable — which is exactly what a runaway velocity field produces. So the warp is expressive up to
  // a ceiling and then simply stops, whatever the fluid is doing.
  vec2 offset = flow * uWarp;
  float shift = length(offset);
  if (shift > uMaxShift) offset *= uMaxShift / shift;

  // ...and a floor as well as a ceiling. A solver with vorticity confinement in it never truly settles:
  // there is always a low-amplitude residue everywhere, which is what keeps the smoke alive and is the
  // whole point of the confinement term. But multiplied by the warp, a residue of a few hundredths becomes
  // most of a world unit at every vertex, and the floor reads as crumpled tin rather than as a grid at
  // rest. So the warp fades in over a threshold: the arena is flat until something actually happens to it.
  offset *= smoothstep(uQuiet, uQuiet * 3.0, shift);
  shift = length(offset);

  world.xy += offset;
  // Pushed away from the camera by the *amount actually shifted*, so a shockwave dents the floor as well
  // as sliding it — and so the dent is clamped along with everything else. Without any of this the grid
  // stays perfectly flat and the warp reads as a texture scroll rather than as a surface being hit.
  world.z -= min(shift, uMaxShift) * 0.55;

  for (int i = 0; i < ${MAX_WELLS}; i++) {
    if (i >= uWellCount) break;
    vec2 toWell = uWells[i].xy - world.xy;
    float distance = length(toWell) + 0.001;
    // Softened, like the gravity in wells.ts and for the same reason: an unsoftened 1/r2 sends the
    // vertices nearest the centre to infinity, and a vertex at infinity takes the whole line with it.
    float pull = uWells[i].z / (1.0 + distance * distance * 0.018);
    world.xy += (toWell / distance) * pull;
    world.z -= pull * 1.5;
  }

  // The ship's own dome, applied after the wells so the two compose: flying into a well genuinely fights it,
  // the outward push partly cancelling the inward pull, which is a nicer thing to look at than either alone.
  //
  // Outward, and away from the camera's *near* side — a bulge where a well is a funnel. Opposite signs on both
  // axes, so a player can never mistake the thing they are carrying for the thing that eats them.
  if (uShip.z > 0.0) {
    vec2 fromShip = world.xy - uShip.xy;
    float shipDistance = length(fromShip) + 0.001;
    // Smoothstep rather than an inverse power: this one wants a definite edge. A 1/r falloff has a tail that
    // reaches the whole arena, and a floor that is very slightly domed everywhere is just a floor.
    float dome = 1.0 - smoothstep(0.0, uShipReach, shipDistance);
    world.xy += (fromShip / shipDistance) * uShip.z * dome;
    world.z += uShip.z * dome * 0.8;
  }

  vHeat = length(flow);
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

const GRID_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uPulse;

varying float vHeat;
varying float vEdge;

void main() {
  // Lines that are moving are brighter, and they go towards white rather than towards their own hue —
  // a moving grid line is being hit, and things that are being hit go white.
  float heat = clamp(vHeat * 2.4, 0.0, 1.0);
  vec3 colour = mix(uColor, uHot, heat);
  // Every fourth line is brighter, which gives the floor a readable scale. Without it a 64-column grid
  // is a texture; with it, it is a grid you can count cells across.
  float weight = mix(1.0, 2.1, vEdge);
  // The beat, and it has to stay small: the floor is a reference the player reads distance against, and a
  // reference that flashes is one they stop trusting. A fifth of the base brightness is felt without being
  // watched — see game/beat.ts.
  float lift = 1.0 + uPulse * 0.22;
  gl_FragColor = vec4(colour * weight * (uOpacity + heat * 0.9) * lift, 1.0);
}
`

/**
 * The lattice, as indexed line segments.
 *
 * Indexed, so the vertex shader runs once per grid point rather than twice per segment — the shader
 * does a texture fetch and a loop over the wells, so halving the invocations is worth the index buffer.
 * A 64×36 grid is 2,405 points and 4,708 segments, which is nothing to draw and just enough resolution
 * that a displaced line looks like a curve instead of a corner.
 */
function buildLattice(columns: number, rows: number): BufferGeometry {
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3)
  const edges = new Float32Array((columns + 1) * (rows + 1))
  const indices: number[] = []

  const at = (column: number, row: number) => row * (columns + 1) + column

  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const index = at(column, row)
      positions[index * 3 + 0] = -ARENA.halfWidth + (column / columns) * ARENA.halfWidth * 2
      positions[index * 3 + 1] = -ARENA.halfHeight + (row / rows) * ARENA.halfHeight * 2
      positions[index * 3 + 2] = 0
      // A vertex on a major line. Carried per vertex rather than per segment because line segments have
      // no faces to attach anything to — so a segment between two major vertices is fully bright and
      // one crossing from major to minor fades, which is a happier accident than it sounds.
      edges[index] = column % 4 === 0 || row % 4 === 0 ? 1 : 0
    }
  }

  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column < columns; column++) {
      indices.push(at(column, row), at(column + 1, row))
    }
  }
  for (let column = 0; column <= columns; column++) {
    for (let row = 0; row < rows; row++) {
      indices.push(at(column, row), at(column, row + 1))
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aEdge', new BufferAttribute(edges, 1))
  geometry.setIndex(indices)
  // The grid displaces itself in the vertex shader, so its real extent is larger than its authored one —
  // three would otherwise cull it exactly when a bomb has thrown it furthest. The margin covers the
  // largest displacement the shader can produce: the warp, plus a well's pull. See `fixedBounds` for why
  // this is a generous sphere rather than no sphere at all.
  fixedBounds(geometry, Math.hypot(ARENA.halfWidth, ARENA.halfHeight) + WARP * 2 + WELL_PULL + 4)
  return geometry
}

export function Arena() {
  const field = useField()
  const grid = useRef<LineSegments>(null)

  const { geometry, material } = useMemo(() => {
    const rows = Math.max(8, Math.round(quality.gridColumns / (ARENA.halfWidth / ARENA.halfHeight)))
    return {
      geometry: buildLattice(quality.gridColumns, rows),
      material: new ShaderMaterial({
        vertexShader: GRID_VERTEX,
        fragmentShader: GRID_FRAGMENT,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uVelocity: { value: null },
          uHalfExtent: { value: new Vector2(ARENA.halfWidth, ARENA.halfHeight) },
          uWarp: { value: WARP },
          uMaxShift: { value: MAX_SHIFT },
          uQuiet: { value: QUIET },
          uHasFluid: { value: field.fluid.available ? 1 : 0 },
          uWells: { value: Array.from({ length: MAX_WELLS }, () => new Vector3()) },
          uWellCount: { value: 0 },
          uShip: { value: new Vector3() },
          uShipReach: { value: 13 },
          uColor: { value: new Color(0.06, 0.16, 0.4) },
          uHot: { value: new Color(0.7, 0.95, 1.0) },
          uOpacity: { value: 0.55 },
          uPulse: { value: 0 },
        },
      }),
    }
  }, [field])

  useFrame(() => {
    const uniforms = material.uniforms
    // Reassigned every frame: the fluid ping-pongs, so which texture object is current changes.
    if (field.fluid.available) uniforms.uVelocity.value = field.fluid.velocityTexture

    // The ship's dome, sized by the multiplier — see `shipWarp` for why that is the right number.
    const world = getWorld()
    const warp = shipWarp(world.multiplier, world.ship.present)
    ;(uniforms.uShip.value as Vector3).set(world.ship.pos.x, world.ship.pos.y, warp.strength)
    uniforms.uShipReach.value = warp.reach

    uniforms.uPulse.value = beatPulse()

    const wells = uniforms.uWells.value as Vector3[]
    let count = 0
    for (const enemy of world.enemies) {
      if (enemy.kind !== 'well' || !enemy.alive) continue
      if (count >= MAX_WELLS) break
      // The pull grows as the well approaches collapse, so the floor is the tell for how much more fire
      // it needs — which is the only progress indicator a well has, and it is a better one than a bar.
      wells[count].set(enemy.pos.x, enemy.pos.y, WELL_PULL * (0.55 + 0.65 * wellStress(enemy)))
      count++
    }
    uniforms.uWellCount.value = count
  })

  return (
    <group>
      {/* Below everything, and far enough below that the vertical dent has room to move without
          intersecting the entities, which all sit at z = 0. */}
      <lineSegments ref={grid} geometry={geometry} material={material} position={[0, 0, -2.2]} />
      <Walls />
    </group>
  )
}

/**
 * The arena boundary.
 *
 * Drawn as a stroked rectangle rather than as part of the lattice, because it is not a grid line — it is
 * the one piece of geometry in the game that never moves, and having it hold still while the floor
 * inside it is thrown about is most of what makes the warp read as violence rather than as drift.
 */
function Walls() {
  const material = useRef<MeshBasicMaterial>(null)
  const geometry = useMemo(() => wallGeometry(ARENA.halfWidth, ARENA.halfHeight, 0.45), [])

  useFrame(() => {
    // A little more than the grid gets. The walls are a frame rather than a measuring device, so brightening
    // them costs nothing in readability — and it is the boundary of the arena breathing, which is a better
    // place to put the beat than anything the player is aiming at.
    if (material.current) material.current.opacity = 0.9 + beatPulse() * 0.5
  })

  return (
    <mesh geometry={geometry} position={[0, 0, -0.4]}>
      <meshBasicMaterial
        ref={material}
        color="#7fd4ff"
        transparent
        opacity={0.9}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}
