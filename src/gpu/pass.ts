import {
  Camera,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  RGFormat,
  RedFormat,
  Scene,
  WebGLRenderTarget,
  type Material,
  type WebGLRenderer,
} from 'three'

// The plumbing every GPGPU pass needs: a full-screen quad, somewhere to draw it, and a pair of
// render targets to ping-pong between.
//
// Its own file because both the fluid and the particles need all three, and because the details
// are the sort that are wrong once and then never looked at again — a target with a depth buffer
// nobody uses, a texture with mipmap filtering that silently costs a mip chain every frame, a
// quad that needs a projection matrix it does not have.

/**
 * The full-screen quad, and the scene that holds it.
 *
 * One instance, shared by every pass. The geometry is a 2×2 plane centred on the origin, which
 * covers clip space exactly — so the vertex shader can write `gl_Position = vec4(position.xy, 0,
 * 1)` and never touch a matrix. That is why every pass material here is a `RawShaderMaterial`:
 * three's `ShaderMaterial` would inject a projection and a model-view matrix, uniforms for both,
 * and a pile of `#define`s, none of which a screen-space pass has any use for.
 */
export class PassRunner {
  private readonly scene = new Scene()
  private readonly camera = new Camera()
  private readonly mesh: Mesh

  constructor(private readonly renderer: WebGLRenderer) {
    this.mesh = new Mesh(new PlaneGeometry(2, 2))
    // Nothing is ever outside the frame and nothing is ever behind anything, so the whole
    // frustum-culling and sorting apparatus is dead weight per pass.
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /**
   * Draw one pass.
   *
   * `target` of null means the canvas, which no pass here uses — it is accepted so that
   * debugging a stage by putting it on screen is a one-character change rather than a rewrite.
   */
  run(material: Material, target: WebGLRenderTarget | null): void {
    this.mesh.material = material
    this.renderer.setRenderTarget(target)
    // No blending anywhere in the solver: every pass computes the whole value of its output
    // texel from its inputs. A stray `autoClear` is therefore harmless, and clearing would just
    // be work — but the depth buffer has to be off or the second pass to the same target fails
    // the depth test against the first, which presents as a solver that works for one frame.
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
  }
}

export type PassFormat = 'r' | 'rg' | 'rgba'

function formatFor(format: PassFormat) {
  switch (format) {
    case 'r':
      return RedFormat
    case 'rg':
      return RGFormat
    case 'rgba':
      return RGBAFormat
  }
}

/**
 * A render target for a simulation field.
 *
 * Half float rather than float, everywhere. The fields here are velocities under 10, pressures
 * under 1 and colours under 4 — half's three-and-a-bit significant digits are plenty, and it
 * halves the bandwidth of every pass, which for a solver that reads five textures per fragment
 * is the difference between affordable and not on integrated graphics.
 *
 * `linear` is a real choice, not a default. Advection and the particle lookup both sample at
 * arbitrary positions and want the hardware to interpolate; the pressure solve samples exact
 * texel centres and does not care. Where it does not care, nearest is left off the table anyway
 * — mixing filters between the ping and the pong of the same field is the kind of asymmetry that
 * produces a solver that drifts in one direction.
 */
export function createTarget(
  width: number,
  height: number,
  format: PassFormat,
  linear = true,
): WebGLRenderTarget {
  const filter = linear ? LinearFilter : NearestFilter
  return new WebGLRenderTarget(width, height, {
    format: formatFor(format),
    type: HalfFloatType,
    minFilter: filter,
    magFilter: filter,
    // Clamped, so a sample past the edge reads the edge. That is also the fluid's boundary
    // condition: it makes the walls free-slip for free, which for an arena the player cannot
    // leave is both correct enough and cheaper than a boundary pass.
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    // Off, both of them. A simulation target with a depth buffer allocates one, clears it, and
    // then fails the depth test on the second draw to the same target in a frame.
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
}

/** A field that is read and written in the same pass, which no GPU allows — so there are two of
 *  them and they take turns. */
export class PingPong {
  read: WebGLRenderTarget
  write: WebGLRenderTarget

  constructor(width: number, height: number, format: PassFormat, linear = true) {
    this.read = createTarget(width, height, format, linear)
    this.write = createTarget(width, height, format, linear)
  }

  swap(): void {
    const temp = this.read
    this.read = this.write
    this.write = temp
  }

  dispose(): void {
    this.read.dispose()
    this.write.dispose()
  }
}

/**
 * Whether this machine can render to a floating-point texture at all.
 *
 * WebGL2 makes half-float textures core but *rendering* to them needs
 * `EXT_color_buffer_float` (or the half-float variant), and there are real devices in the wild —
 * older Android GPUs, and anything running WebGL1 — where it is missing. Every one of the
 * simulation's fields is a float target, so without it there is no fluid, and the honest thing
 * is to detect that and let the caller fall back rather than to render a screen of black and
 * hope nobody notices.
 */
export function supportsFloatTargets(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext()
  const has = (name: string) => gl.getExtension(name) !== null
  return has('EXT_color_buffer_float') || has('EXT_color_buffer_half_float')
}
