import {
  RawShaderMaterial,
  Vector2,
  Vector3,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'
import {
  ADVECT_FRAGMENT,
  CURL_FRAGMENT,
  DECAY_FRAGMENT,
  DIVERGENCE_FRAGMENT,
  GRADIENT_FRAGMENT,
  MAX_SPLATS,
  PASS_VERTEX,
  PRESSURE_FRAGMENT,
  SPLAT_FRAGMENT,
  VORTICITY_FRAGMENT,
} from './fluidShaders'
import { PassRunner, PingPong, createTarget, supportsFloatTargets } from './pass'

// The fluid simulation, and the reason this game looks the way it does.
//
// It is one velocity field, and everything reads from it:
//
//   * the dye advected through it is the smoke over the arena;
//   * the particle field is 65,000 tracers dropped into it (see `particles.ts`);
//   * the grid the arena is drawn on displaces its vertices by it, so explosions ripple the floor.
//
// That unification is the point, and it is worth stating plainly because the alternative is the
// usual thing: a particle system with its own forces, a screen-shake, and a grid that wobbles on
// a sine wave, all approximating the same event separately and none of them agreeing. Here there
// is one event, one push into one field, and three consumers of the result — so the smoke, the
// sparks and the floor all bend the same way because they are all reading the same numbers.

/** One push into the field. Positions and radii are in the simulation's uv space; use
 *  `arenaToUv` to get there from world coordinates. */
export interface Splat {
  u: number
  v: number
  /**
   * Radius as a Gaussian sigma, in units of the arena's height — the same units the shader's
   * aspect-corrected offset is in, so a radius here is a circle in the world. `worldToSplat` does
   * the conversion.
   */
  radius: number
  /** Directional velocity to inject, in uv per second. For a wake — the ship's trail. */
  vx: number
  vy: number
  /** Outward velocity to inject, in uv per second. For a detonation, which has no one direction. */
  radial: number
  /** Dye to inject. Unbounded and additive: two splats in one place are brighter than one. */
  r: number
  g: number
  b: number
}

export interface FluidOptions {
  /** Long edge of the velocity grid. The short edge follows from the aspect. */
  resolution: number
  /** Long edge of the dye grid, which is finer — the dye is what you look at. */
  dyeResolution: number
  /** Arena aspect, so cells are square and splats are round. */
  aspect: number
  pressureIterations: number
}

/**
 * Per-second decay of the velocity field.
 *
 * Low. The field is the game's memory of the last few seconds and a fast decay throws that away —
 * but zero is worse than either: with no dissipation, the energy from every explosion since the
 * run began is still in there, and by wave five the arena is a washing machine. 0.22 leaves a
 * shockwave visible for about four seconds, which is roughly how long anybody looks at one.
 */
const VELOCITY_DISSIPATION = 0.22

/** Dye decays much faster than the velocity carrying it, so the arena clears between waves while
 *  the currents that shaped the smoke are still turning. */
const DYE_DISSIPATION = 0.9

/**
 * How much of the previous frame's pressure the solve starts from.
 *
 * Not zero, which is what a from-scratch solve would use. The field changes little between frames,
 * so starting from a decayed version of the last answer is most of the way to this frame's — it is
 * worth several Jacobi iterations for the cost of one multiply, and it is why twenty iterations
 * looks like a converged solve rather than like a half-finished one.
 */
const PRESSURE_DECAY = 0.8

/**
 * Vorticity confinement strength.
 *
 * Above about 20 the field self-excites: the term feeds energy back into whatever rotation it finds, and
 * with nothing damping the small scales the whole domain settles into a permanent low-amplitude boil.
 * That is invisible in the dye and very visible in the grid, which multiplies velocity by 14 to get a
 * displacement — so the ceiling here is set by the floor, not by the smoke. Below about 8 the swirl is
 * gone within half a second of a kill and the smoke spreads like a bruise instead of curling.
 */
const CURL_STRENGTH = 13

/** Longest step the solver will take. Advection is stable at any timestep but the confinement term
 *  is not, and a tab returning from the background hands over a delta measured in seconds. */
const MAX_STEP = 1 / 30

export class Fluid {
  /**
   * Whether the simulation is actually running.
   *
   * False on a machine that cannot render to a float texture — see `supportsFloatTargets`. The
   * caller is expected to check: everything downstream has a documented behaviour without the
   * fluid (the backdrop goes flat, the grid warps from gravity only, the particles fall back to a
   * slow drift), and a black screen is not one of them.
   */
  readonly available: boolean

  private readonly runner: PassRunner
  private readonly velocity: PingPong
  private readonly dye: PingPong
  private readonly pressure: PingPong
  private readonly divergence: WebGLRenderTarget
  private readonly curl: WebGLRenderTarget

  /**
   * One texel of the velocity grid, in uv.
   *
   * Only the velocity grid's, and there is no dye equivalent because nothing needs one: every pass that
   * samples neighbours — divergence, curl, pressure, gradient — works on the velocity grid, and the dye
   * is only ever advected, which samples a position rather than a neighbourhood. That is the property
   * that lets the dye run at a different resolution from the field carrying it.
   */
  private readonly velocityTexel: Vector2

  private readonly splatMaterial: RawShaderMaterial
  private readonly advectMaterial: RawShaderMaterial
  private readonly divergenceMaterial: RawShaderMaterial
  private readonly curlMaterial: RawShaderMaterial
  private readonly vorticityMaterial: RawShaderMaterial
  private readonly pressureMaterial: RawShaderMaterial
  private readonly gradientMaterial: RawShaderMaterial
  private readonly decayMaterial: RawShaderMaterial

  private readonly queue: Splat[] = []
  private readonly iterations: number

  constructor(renderer: WebGLRenderer, options: FluidOptions) {
    this.runner = new PassRunner(renderer)
    this.iterations = options.pressureIterations
    this.available = supportsFloatTargets(renderer)

    const width = Math.max(16, Math.round(options.resolution))
    const height = Math.max(16, Math.round(options.resolution / options.aspect))
    const dyeWidth = Math.max(16, Math.round(options.dyeResolution))
    const dyeHeight = Math.max(16, Math.round(options.dyeResolution / options.aspect))

    this.velocity = new PingPong(width, height, 'rg')
    this.dye = new PingPong(dyeWidth, dyeHeight, 'rgba')
    // The pressure solve reads exact texel centres, so it gains nothing from interpolation — and
    // nearest filtering on it makes the one field where a wrong sample would be invisible into the
    // one field that is exactly reproducible.
    this.pressure = new PingPong(width, height, 'r', false)
    this.divergence = createTarget(width, height, 'r', false)
    this.curl = createTarget(width, height, 'r', false)

    this.velocityTexel = new Vector2(1 / width, 1 / height)

    const pass = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
      new RawShaderMaterial({ vertexShader: PASS_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false })

    this.splatMaterial = pass(SPLAT_FRAGMENT, {
      uTarget: { value: null },
      uAspect: { value: options.aspect },
      uCount: { value: 0 },
      // Allocated once and mutated in place. A fresh array of Vector2s per frame would be twelve
      // objects a frame for the garbage collector, for no reason at all.
      uPoints: { value: Array.from({ length: MAX_SPLATS }, () => new Vector2()) },
      uColors: { value: Array.from({ length: MAX_SPLATS }, () => new Vector3()) },
      uRadii: { value: new Float32Array(MAX_SPLATS) },
      uRadial: { value: new Float32Array(MAX_SPLATS) },
      uRadialMode: { value: 0 },
    })

    this.advectMaterial = pass(ADVECT_FRAGMENT, {
      uVelocity: { value: null },
      uSource: { value: null },
      uDt: { value: 0 },
      uDissipation: { value: 0 },
    })

    this.divergenceMaterial = pass(DIVERGENCE_FRAGMENT, {
      uVelocity: { value: null },
      uTexel: { value: this.velocityTexel },
    })

    this.curlMaterial = pass(CURL_FRAGMENT, {
      uVelocity: { value: null },
      uTexel: { value: this.velocityTexel },
    })

    this.vorticityMaterial = pass(VORTICITY_FRAGMENT, {
      uVelocity: { value: null },
      uCurl: { value: null },
      uTexel: { value: this.velocityTexel },
      uCurlStrength: { value: CURL_STRENGTH },
      uDt: { value: 0 },
    })

    this.pressureMaterial = pass(PRESSURE_FRAGMENT, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexel: { value: this.velocityTexel },
    })

    this.gradientMaterial = pass(GRADIENT_FRAGMENT, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexel: { value: this.velocityTexel },
    })

    this.decayMaterial = pass(DECAY_FRAGMENT, {
      uTarget: { value: null },
      uValue: { value: PRESSURE_DECAY },
    })
  }

  /** The velocity field, for the grid and the particles to sample. */
  get velocityTexture(): Texture {
    return this.velocity.read.texture
  }

  /** The dye field, for the backdrop and for tinting particles. */
  get dyeTexture(): Texture {
    return this.dye.read.texture
  }

  /**
   * Queue a push into the field.
   *
   * Queued rather than applied, so that everything happening on one frame lands in one pass. Past
   * `MAX_SPLATS` the extras are dropped rather than run as a second pass, which is a real decision
   * and not laziness: the frames that overflow are the frames where eighty things died at once, and
   * on those frames the arena is already saturated — a thirteenth splat is invisible, whereas the
   * two extra passes are not.
   */
  splat(splat: Splat): void {
    if (this.queue.length >= MAX_SPLATS) return
    this.queue.push(splat)
  }

  /** Drop the whole field. For a restart, so the new run does not open inside the old one's smoke. */
  clear(): void {
    this.queue.length = 0
    for (const field of [this.velocity, this.dye, this.pressure]) {
      this.decayMaterial.uniforms.uValue.value = 0
      this.decayMaterial.uniforms.uTarget.value = field.read.texture
      this.runner.run(this.decayMaterial, field.write)
      field.swap()
      // Both halves: the next advection reads one and writes the other, and a stale half would
      // come back on the following frame.
      this.decayMaterial.uniforms.uTarget.value = field.read.texture
      this.runner.run(this.decayMaterial, field.write)
      field.swap()
    }
    this.decayMaterial.uniforms.uValue.value = PRESSURE_DECAY
  }

  private applySplats(): void {
    if (this.queue.length === 0) return

    const uniforms = this.splatMaterial.uniforms
    const points = uniforms.uPoints.value as Vector2[]
    const colors = uniforms.uColors.value as Vector3[]
    const radii = uniforms.uRadii.value as Float32Array
    const radial = uniforms.uRadial.value as Float32Array

    for (let i = 0; i < this.queue.length; i++) {
      const splat = this.queue[i]
      points[i].set(splat.u, splat.v)
      // The shader divides by this, and it is compared against a squared distance — so what the
      // caller thinks of as a radius has to be squared here. Doing it on the CPU keeps a
      // multiplication out of every fragment of every splat pass.
      radii[i] = Math.max(1e-5, splat.radius * splat.radius)
      radial[i] = splat.radial
    }
    uniforms.uCount.value = this.queue.length

    // Velocity first, then dye, with only the colours changing between them. Two passes over two
    // different grids; the points are the same because the push and the mark are the same event.
    for (let i = 0; i < this.queue.length; i++) {
      const splat = this.queue[i]
      colors[i].set(splat.vx, splat.vy, 0)
    }
    uniforms.uRadialMode.value = 1
    uniforms.uTarget.value = this.velocity.read.texture
    this.runner.run(this.splatMaterial, this.velocity.write)
    this.velocity.swap()

    for (let i = 0; i < this.queue.length; i++) {
      const splat = this.queue[i]
      colors[i].set(splat.r, splat.g, splat.b)
    }
    uniforms.uRadialMode.value = 0
    uniforms.uTarget.value = this.dye.read.texture
    this.runner.run(this.splatMaterial, this.dye.write)
    this.dye.swap()

    this.queue.length = 0
  }

  /**
   * One step of the solver.
   *
   * The order is the whole algorithm and none of it is negotiable: splat, then swirl, then project
   * to remove the divergence the splat and the swirl introduced, and only then advect. Advecting
   * before the projection carries divergence into the transport, which shows up as fluid appearing
   * and disappearing — smoke that brightens where nothing happened.
   */
  update(rawDt: number): void {
    if (!this.available) return
    const dt = Math.min(Math.max(rawDt, 0), MAX_STEP)
    if (dt <= 0) return

    this.applySplats()

    // --- vorticity confinement ---
    this.curlMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.runner.run(this.curlMaterial, this.curl)

    this.vorticityMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.vorticityMaterial.uniforms.uCurl.value = this.curl.texture
    this.vorticityMaterial.uniforms.uDt.value = dt
    this.runner.run(this.vorticityMaterial, this.velocity.write)
    this.velocity.swap()

    // --- projection ---
    this.divergenceMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.runner.run(this.divergenceMaterial, this.divergence)

    this.decayMaterial.uniforms.uTarget.value = this.pressure.read.texture
    this.runner.run(this.decayMaterial, this.pressure.write)
    this.pressure.swap()

    this.pressureMaterial.uniforms.uDivergence.value = this.divergence.texture
    for (let i = 0; i < this.iterations; i++) {
      this.pressureMaterial.uniforms.uPressure.value = this.pressure.read.texture
      this.runner.run(this.pressureMaterial, this.pressure.write)
      this.pressure.swap()
    }

    this.gradientMaterial.uniforms.uPressure.value = this.pressure.read.texture
    this.gradientMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.runner.run(this.gradientMaterial, this.velocity.write)
    this.velocity.swap()

    // --- transport ---
    const advect = this.advectMaterial.uniforms
    advect.uDt.value = dt

    advect.uVelocity.value = this.velocity.read.texture
    advect.uSource.value = this.velocity.read.texture
    advect.uDissipation.value = VELOCITY_DISSIPATION
    this.runner.run(this.advectMaterial, this.velocity.write)
    this.velocity.swap()

    // The dye is advected by the velocity field it does not live on, which works because both are
    // addressed in the same uv space — the whole reason the solver is written in uv rather than in
    // texels. A texel-space solver needs the grids to match, and then the dye cannot be finer.
    advect.uVelocity.value = this.velocity.read.texture
    advect.uSource.value = this.dye.read.texture
    advect.uDissipation.value = DYE_DISSIPATION
    this.runner.run(this.advectMaterial, this.dye.write)
    this.dye.swap()
  }

  dispose(): void {
    this.velocity.dispose()
    this.dye.dispose()
    this.pressure.dispose()
    this.divergence.dispose()
    this.curl.dispose()
    this.runner.dispose()
    for (const material of [
      this.splatMaterial,
      this.advectMaterial,
      this.divergenceMaterial,
      this.curlMaterial,
      this.vorticityMaterial,
      this.pressureMaterial,
      this.gradientMaterial,
      this.decayMaterial,
    ]) {
      material.dispose()
    }
  }
}
