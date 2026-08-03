import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  NearestFilter,
  Points,
  RGBAFormat,
  RawShaderMaterial,
  ShaderMaterial,
  Vector2,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { fixedBounds } from '../render/bounds'
import { PASS_VERTEX } from './fluidShaders'
import { PassRunner, PingPong } from './pass'
import {
  PARTICLE_FRAGMENT,
  PARTICLE_INJECT_FRAGMENT,
  PARTICLE_UPDATE_FRAGMENT,
  PARTICLE_VERTEX,
} from './particleShaders'

// Tens of thousands of tracers in the fluid, kept entirely on the GPU.
//
// The state lives in a texture and is updated by a shader; the draw reads that texture in its vertex
// shader. Nothing about an individual particle ever crosses back to JavaScript, which is what makes
// 65,536 of them free — the CPU's whole involvement per frame is setting four uniforms.
//
// The interesting part is `burst`. Ordinary particle systems allocate from a free list, which needs
// the CPU to know which particles are dead; a GPU pool cannot know that without reading the texture
// back, and reading a texture back stalls the pipeline for a millisecond or more. So instead the pool
// is treated as a ring: a burst claims the next N particles by index, whatever they were doing, and
// overwrites them with a scissored draw into their rows of the state texture. Claiming a live
// particle occasionally is invisible; a pipeline stall on every explosion is not.

/** Seconds a particle lives, before its own jitter. */
const LIFE = 3.4

/** How closely a particle follows the fluid. Under one, so they lag the field slightly and the
 *  leading edge of a shockwave outruns its own sparks. */
const FOLLOW = 0.85

/**
 * World-unit size of a particle at the seed's midpoint.
 *
 * Small, and it has to be: these are additive with no depth test, so a hundred of them inside a couple of
 * units sum straight past white and a kill's sparks become an opaque blob with no colour in it. Between
 * this, the spread of the burst and the tint in the fragment shader, the constraint is that a burst reads
 * as *sparks* rather than as a flash.
 */
const SIZE = 0.42

export interface ParticleOptions {
  /** Side of the square state texture. The particle count is its square. */
  textureSize: number
  /** Arena half-extents, for turning uv back into world space. */
  halfWidth: number
  halfHeight: number
}

export class ParticleField {
  /** The drawable. Added to the scene by the component that owns it. */
  readonly points: Points

  private readonly runner: PassRunner
  private readonly state: PingPong
  private readonly updateMaterial: RawShaderMaterial
  private readonly injectMaterial: RawShaderMaterial
  private readonly drawMaterial: ShaderMaterial
  private readonly size: number
  /** Next row of the state texture a burst will claim. */
  private cursor = 0
  private time = 0

  constructor(
    private readonly renderer: WebGLRenderer,
    options: ParticleOptions,
  ) {
    this.size = Math.max(8, Math.round(options.textureSize))
    const count = this.size * this.size

    this.runner = new PassRunner(renderer)
    this.state = new PingPong(this.size, this.size, 'rgba', false)

    // Seeded on the CPU, once. Every particle needs a random seed and a starting position, and doing
    // it here rather than in a shader means the first frame is already a populated arena rather than
    // everything sitting at the origin waiting to be respawned.
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      seed[i * 4 + 0] = Math.random()
      seed[i * 4 + 1] = Math.random()
      // Ages are spread across the whole lifespan, so the field is in a steady state from the first
      // frame instead of every particle dying at the same moment three seconds in.
      seed[i * 4 + 2] = Math.random() * LIFE
      seed[i * 4 + 3] = Math.random()
    }
    const initial = new DataTexture(seed, this.size, this.size, RGBAFormat, FloatType)
    initial.minFilter = NearestFilter
    initial.magFilter = NearestFilter
    initial.needsUpdate = true

    this.updateMaterial = new RawShaderMaterial({
      vertexShader: PASS_VERTEX,
      fragmentShader: PARTICLE_UPDATE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uState: { value: null },
        uVelocity: { value: null },
        uDt: { value: 0 },
        uTime: { value: 0 },
        uLife: { value: LIFE },
        uFollow: { value: FOLLOW },
      },
    })

    this.injectMaterial = new RawShaderMaterial({
      vertexShader: PASS_VERTEX,
      fragmentShader: PARTICLE_INJECT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPoint: { value: new Vector2() },
        uRadius: { value: 0.02 },
        uTime: { value: 0 },
      },
    })

    // Prime both halves from the seeded texture. Both, because the update pass reads one and writes
    // the other — leaving the second half black would put every particle at the origin for one frame,
    // which on a bloomed additive field is a very visible flash on the first frame of the page.
    const copy = new RawShaderMaterial({
      vertexShader: PASS_VERTEX,
      fragmentShader: `
precision highp float;
varying vec2 vUv;
uniform sampler2D uState;
void main() { gl_FragColor = texture2D(uState, vUv); }
`,
      uniforms: { uState: { value: initial } },
      depthTest: false,
      depthWrite: false,
    })
    this.runner.run(copy, this.state.read)
    this.runner.run(copy, this.state.write)
    copy.dispose()
    initial.dispose()

    // One vertex per particle. `position` is required by three for the draw count and is never read
    // by the shader; `aRef` is where in the state texture this vertex's particle lives.
    const geometry = new BufferGeometry()
    const positions = new Float32Array(count * 3)
    const refs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      // Texel centres, not corners. Sampling a corner with nearest filtering is a coin flip between
      // two texels, and the coin comes up differently on different drivers.
      refs[i * 2 + 0] = ((i % this.size) + 0.5) / this.size
      refs[i * 2 + 1] = (Math.floor(i / this.size) + 0.5) / this.size
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aRef', new BufferAttribute(refs, 2))
    // Every authored position is zero — the real ones come out of the state texture in the vertex shader
    // — so the sphere three would compute is a point at the origin, and the whole field gets culled the
    // moment the camera is not looking at it. The honest bound is the arena. See `fixedBounds`.
    fixedBounds(geometry, Math.hypot(options.halfWidth, options.halfHeight) * 1.1)

    this.drawMaterial = new ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      // No depth write and no depth test: an additive field has no meaningful order, and testing
      // against the grid would make particles disappear behind lines they should be glowing through.
      depthWrite: false,
      depthTest: false,
      // The colours here are already the values the bloom pass should see; letting three's tone
      // mapping at them would flatten exactly the highlights the bloom exists to catch.
      toneMapped: false,
      uniforms: {
        uState: { value: this.state.read.texture },
        uDye: { value: null },
        uHalfExtent: { value: new Vector2(options.halfWidth, options.halfHeight) },
        uLife: { value: LIFE },
        uSize: { value: SIZE },
        uScale: { value: 500 },
        uAmbient: { value: new Color(0.22, 0.55, 1.0) },
      },
    })

    this.points = new Points(geometry, this.drawMaterial)
    this.points.frustumCulled = false
    // Drawn after the grid and the enemies. Additive sprites do not care about order among
    // themselves, but they must not be the thing that establishes depth for anything else.
    this.points.renderOrder = 10
  }

  /**
   * Claim `count` particles and put them at a point.
   *
   * Rounded up to whole rows of the state texture, because the claim is made with a scissor
   * rectangle and a scissor rectangle is in pixels. That granularity is why the row count is the
   * natural burst size: on desktop a row is 256 particles.
   */
  burst(u: number, v: number, radius: number, count: number): void {
    const rows = Math.max(1, Math.min(this.size, Math.ceil(count / this.size)))

    this.injectMaterial.uniforms.uPoint.value.set(u, v)
    this.injectMaterial.uniforms.uRadius.value = radius
    this.injectMaterial.uniforms.uTime.value = this.time

    // Written into the *read* target, not the write one. The inject shader reads no state, so there
    // is no feedback to avoid — and writing into the live half means the burst is visible on this
    // frame rather than on the next, which matters when it is meant to coincide with a bang.
    const target = this.state.read
    let start = this.cursor
    let remaining = rows

    this.renderer.setScissorTest(true)
    while (remaining > 0) {
      // A claim that runs off the top of the texture wraps, and the wrap is drawn as a second
      // rectangle rather than being clipped — dropping it would quietly halve the size of one burst
      // in every `size / rows`.
      const band = Math.min(remaining, this.size - start)
      this.renderer.setScissor(0, start, this.size, band)
      this.runner.run(this.injectMaterial, target)
      remaining -= band
      start = (start + band) % this.size
    }
    this.renderer.setScissorTest(false)
    this.cursor = start
  }

  /**
   * Move every particle.
   *
   * `velocity` and `dye` are passed in each frame rather than held, because the fluid ping-pongs its
   * fields — the texture object that is current changes every frame, and a reference taken at
   * construction would be the wrong half of the buffer half the time.
   */
  update(dt: number, velocity: Texture | null, dye: Texture | null): void {
    this.time += dt

    const uniforms = this.updateMaterial.uniforms
    uniforms.uState.value = this.state.read.texture
    uniforms.uVelocity.value = velocity
    uniforms.uDt.value = dt
    uniforms.uTime.value = this.time
    this.runner.run(this.updateMaterial, this.state.write)
    this.state.swap()

    this.drawMaterial.uniforms.uState.value = this.state.read.texture
    this.drawMaterial.uniforms.uDye.value = dye
  }

  /**
   * Update the point-size scale for the current canvas and camera.
   *
   * `gl_PointSize` is in device pixels, so a particle with a fixed world size has to be told how many
   * pixels a world unit is worth — which depends on the drawing buffer's height and the camera's
   * field of view, both of which change (the buffer whenever the adaptive render scale moves). Get
   * this wrong and the particles are the right size in one window and dots or blobs in another.
   */
  setProjection(drawingBufferHeight: number, fovDegrees: number): void {
    const halfFov = (fovDegrees * Math.PI) / 360
    this.drawMaterial.uniforms.uScale.value = (drawingBufferHeight * 0.5) / Math.tan(halfFov)
  }

  dispose(): void {
    this.state.dispose()
    this.runner.dispose()
    this.points.geometry.dispose()
    this.updateMaterial.dispose()
    this.injectMaterial.dispose()
    this.drawMaterial.dispose()
  }
}
