// What this machine can afford, resolved once at startup.
//
// The expensive things in this game are all fill rate: the fluid simulation is a dozen
// full-screen passes over its own grid every frame, the particles are tens of thousands of
// additive sprites with no depth test, and the bloom chain runs over the whole canvas
// afterwards. None of that is geometry, so the knobs that matter are resolutions and counts
// rather than triangle budgets.

function query(q: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(q).matches
    : false
}

const coarsePointer = query('(pointer: coarse)')
const smallScreen =
  typeof window !== 'undefined' ? Math.min(window.innerWidth, window.innerHeight) < 820 : false

/** Touch-first device on a phone or small-tablet screen. */
export const isMobile = coarsePointer && smallScreen

/** Touch input available at all, including large tablets — decides whether the on-screen
 *  sticks are drawn, which is a different question from how hard to push the GPU. */
export const isTouch = coarsePointer

export const quality = {
  /**
   * Velocity-field resolution for the fluid, as the long edge. The pressure solve is the
   * expensive part and it runs at this size every frame regardless of the window, so this
   * is the one number that decides whether the fluid is affordable at all.
   *
   * 192 on the long edge is about 20,000 cells — enough that a vortex has room to curl,
   * cheap enough that twenty Jacobi iterations over it are nothing on a desktop GPU.
   */
  fluidResolution: isMobile ? 96 : 192,
  /** Dye is advected at a higher resolution than the velocity that carries it, because the
   *  dye is what you actually look at and its edges are what read as smoke. Standard trick,
   *  and it costs one extra advection rather than a whole extra solve. */
  dyeResolution: isMobile ? 192 : 384,
  /**
   * Jacobi iterations for the pressure solve.
   *
   * The knob that decides whether the fluid *looks* like fluid. Under about eight,
   * divergence survives the solve and the field visibly loses mass — splats fade towards
   * grey instead of curling. Twenty is where it stops improving perceptibly.
   */
  pressureIterations: isMobile ? 8 : 20,
  /** Particles, as the side of a square data texture: 65,536 on desktop. They are points
   *  with no depth write, so the cost is almost entirely blend bandwidth. */
  particleTexture: isMobile ? 128 : 256,
  /** The softer half of the grade — grain and the lens bleed. Cheap per pixel, but they are
   *  extra full-screen work for the least visible part of the look. */
  richGrade: !isMobile,
  bloomIntensity: isMobile ? 0.9 : 1.35,
  /**
   * Grid lines across the arena's long edge. The grid is drawn as line segments, so this is the one budget
   * here that is geometry rather than fill.
   *
   * 44 puts a cell at about 2.7 world units — a little under twice the ship's radius. Finer than that and
   * the floor stops reading as a grid you can judge distance against and starts reading as graph paper,
   * which is a texture rather than a frame of reference.
   */
  gridColumns: isMobile ? 30 : 44,
}
