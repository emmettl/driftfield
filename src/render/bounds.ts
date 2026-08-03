import { Sphere, Vector3, type BufferGeometry } from 'three'

// Honest bounds for geometry that moves in its vertex shader.
//
// Two things in this game are positioned entirely on the GPU: the grid, whose vertices are displaced by
// the fluid's velocity field, and the particle field, whose positions come out of a data texture. For
// both, the bounding sphere three computes from the authored vertex positions is a lie — the grid's real
// extent is larger than its lattice, and the particles' authored positions are all zero.
//
// The tempting fix is `geometry.boundingSphere = null` plus a no-op `computeBoundingSphere`, on the
// theory that an object with no bounds cannot be culled. It is worth writing down why that is wrong,
// because it cost an afternoon: `Frustum.intersectsObject` calls `computeBoundingSphere()` when the
// sphere is null and then does `_sphere.copy( geometry.boundingSphere )` regardless — so a stubbed
// compute leaves it copying null, which throws a TypeError *inside* `WebGLRenderer.render`. That aborts
// the render of the whole scene, every frame, from the first frame. The symptom is a completely black
// canvas with a simulation that is demonstrably running, and — because the throw happens inside
// postprocessing's RenderPass — a stack trace that points at three rather than at the geometry.
//
// So: give it real bounds that are generous enough to cover what the shader can do, and keep culling
// working. `computeBoundingSphere` is overridden to reinstate them rather than to do nothing, so that
// anything which recomputes bounds later — a raycaster, a helper — cannot quietly shrink them back to
// the authored positions and start culling the object at the edges of the screen.

export function fixedBounds(geometry: BufferGeometry, radius: number): void {
  const sphere = new Sphere(new Vector3(0, 0, 0), radius)
  geometry.boundingSphere = sphere
  geometry.computeBoundingSphere = () => {
    geometry.boundingSphere = sphere
  }
}
