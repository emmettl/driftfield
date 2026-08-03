// The fluid solver's shaders.
//
// This is Stam's stable fluids, in the form every WebGL implementation of it has settled on: a
// semi-Lagrangian advection, a Jacobi pressure solve, and a projection that removes whatever
// divergence the advection introduced. Written out here rather than pulled in as a dependency,
// because the interesting part of a fluid in a game is not the solver — it is what gets splatted
// into it and what reads out of it, and that is much easier to get right when the solve is not a
// black box behind an API.
//
// Conventions, stated once because every bug in a fluid solver is a units bug:
//
//   * The domain is the unit square. Every field is sampled with `vUv` in 0..1.
//   * Velocity is stored in **uv per second** — the fraction of the domain a parcel crosses in a
//     second. That makes advection `pos -= vel * dt` with no scale factor anywhere, which is
//     worth more than the small anisotropy it costs: the arena is 120×68, so a physically
//     circular swirl is very slightly oval in uv space. At the resolutions here that is invisible
//     and the alternative is an aspect correction in five shaders instead of one.
//   * The splat shape *is* aspect-corrected, because a splat is a circle you can see, and an oval
//     explosion is not invisible at all.
//   * Neighbour offsets come in as `uTexel`, the size of one texel in uv. Each field has its own,
//     since the dye grid is finer than the velocity grid.

/**
 * The vertex shader every pass shares.
 *
 * No matrices: the quad is already in clip space (see `PassRunner`), so the position attribute
 * passes straight through and doubles as the texture coordinate.
 */
export const PASS_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** Most splats one pass can apply. Every explosion in a frame has to fit, or be dropped — see
 *  the note on batching in `fluid.ts`. */
export const MAX_SPLATS = 12

/**
 * Splatting, batched.
 *
 * The obvious implementation is one pass per splat, and it is what every fluid demo does because
 * a demo has one splat per frame — a mouse. A bomb here kills eighty things at once, and eighty
 * full-screen passes over two fields is a dropped frame every time the player does the most
 * dramatic thing available to them. So the points arrive as uniform arrays and one pass sums
 * them, which turns the worst frame in the game from 160 passes into two.
 *
 * The loop bound is the constant, with an early break on the real count: GLSL ES 1.0 requires a
 * constant loop condition, and this is the standard way to have a dynamic count anyway.
 */
export const SPLAT_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uTarget;
uniform float uAspect;
uniform int uCount;
uniform vec2 uPoints[${MAX_SPLATS}];
uniform vec3 uColors[${MAX_SPLATS}];
uniform float uRadii[${MAX_SPLATS}];
/** Outward push, per splat. Only read on the velocity pass — see uRadialMode. */
uniform float uRadial[${MAX_SPLATS}];
/** 1 on the velocity pass, 0 on the dye pass. The two passes are the same shader with different
 *  colour arrays, and only one of them has a direction to speak of. */
uniform float uRadialMode;

void main() {
  vec3 total = vec3(0.0);

  for (int i = 0; i < ${MAX_SPLATS}; i++) {
    if (i >= uCount) break;
    vec2 offset = vUv - uPoints[i];
    // Aspect-corrected, which puts this in units of the arena's *height*: the same distance in x
    // and in y is the same number here, so the falloff is a circle in the world rather than in uv.
    offset.x *= uAspect;
    // Gaussian rather than a disc. A hard-edged splat puts a step into the velocity field, and the
    // projection turns a step into a ring artefact that outlives the explosion by seconds.
    float gaussian = exp(-dot(offset, offset) / uRadii[i]);
    total += gaussian * uColors[i];

    if (uRadialMode > 0.5 && uRadial[i] > 0.0) {
      // An explosion pushes *outward*, which a single vector cannot express — the first version of
      // this splatted a constant direction and every detonation looked like a gust of wind. So the
      // direction is derived per fragment from the offset, which makes one pass a genuine radial
      // impulse.
      vec2 direction = offset / (length(offset) + 1e-4);
      // Back out of the aspect correction: the field is stored in uv per second, so a push that is
      // isotropic in world units is anisotropic here by exactly this factor.
      direction.x /= uAspect;
      total.xy += direction * uRadial[i] * gaussian;
    }
  }

  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + total, 1.0);
}
`

/**
 * Semi-Lagrangian advection: what is here now is whatever was upstream a moment ago.
 *
 * Stable at any timestep, which is the whole reason to do it backwards — a forward
 * (particle-pushing) advection blows up the moment `vel * dt` exceeds a cell, and an explosion is
 * exactly that. The cost is that it diffuses: each step interpolates between texels, so the field
 * smooths a little every frame. For smoke that is a feature.
 */
export const ADVECT_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
/** Per-second decay. 0 keeps the field forever, which for dye means the arena never clears. */
uniform float uDissipation;

void main() {
  vec2 from = vUv - uDt * texture2D(uVelocity, vUv).xy;
  // Clamped, not wrapped. Smoke driven into a wall must pile up against it, not reappear on the
  // far side of the arena — and the arena's walls are solid, so wrapping would be a lie the
  // player can see.
  from = clamp(from, vec2(0.0), vec2(1.0));
  gl_FragColor = texture2D(uSource, from) / (1.0 + uDissipation * uDt);
}
`

/** Divergence of the velocity field: how much fluid each cell is gaining or losing. The thing the
 *  pressure solve exists to cancel. */
export const DIVERGENCE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uVelocity;
uniform vec2 uTexel;

void main() {
  float left = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float right = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float top = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;

  gl_FragColor = vec4(0.5 * ((right - left) + (top - bottom)), 0.0, 0.0, 1.0);
}
`

/** Curl: how much the field is rotating at each cell. Only used to feed it back in below. */
export const CURL_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uVelocity;
uniform vec2 uTexel;

void main() {
  float left = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float right = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float top = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;

  gl_FragColor = vec4(0.5 * ((right - left) - (top - bottom)), 0.0, 0.0, 1.0);
}
`

/**
 * Vorticity confinement: put back the swirl the solver threw away.
 *
 * Advection on a grid is diffusive and a Jacobi solve is a low-pass filter, so small vortices
 * die within a few frames of being created — which for a game is the difference between smoke
 * that curls and smoke that spreads out like a bruise. This finds where rotation is already
 * happening and pushes along the gradient of its magnitude, feeding energy back into exactly the
 * structures the grid was losing.
 *
 * It is not physical. It is a fudge from the graphics literature, and it is the single largest
 * contributor to this looking like fluid rather than like blur.
 */
export const VORTICITY_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlStrength;
uniform float uDt;

void main() {
  float left = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float right = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float top = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float here = texture2D(uCurl, vUv).x;

  // Gradient of |curl|, normalised: a direction, so the force does not scale with how strong the
  // rotation already is. Scaling it there sends the strongest vortex in the frame to infinity.
  vec2 force = vec2(abs(top) - abs(bottom), abs(right) - abs(left));
  force = force / (length(force) + 1e-5);
  force *= uCurlStrength * here;
  force.y *= -1.0;

  vec2 velocity = texture2D(uVelocity, vUv).xy + force * uDt;
  // Clamped hard, and the ceiling is low on purpose. One unit here is a whole domain per second — an
  // explosion peaks around 0.2 and a bomb around 0.7 — so 2.5 is already well past anything the game
  // means to produce. It is a backstop against two things: the confinement term, which is the one place
  // in the solver with a positive feedback path, and a caller splatting a continuous source without
  // integrating it, which is a mistake that is invisible for the first second and unmistakable after ten.
  velocity = clamp(velocity, vec2(-2.5), vec2(2.5));
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`

/**
 * One Jacobi iteration of the pressure solve.
 *
 * Jacobi rather than a multigrid or a conjugate gradient, because it is four texture reads and an
 * average, it needs no reductions, and twenty of them is still cheaper than the bookkeeping the
 * better methods need on a GPU at this grid size. Each iteration propagates information one cell,
 * which is why the iteration count is a *look* setting rather than an accuracy setting: too few
 * and pressure never reaches across a splat, so the splat behaves like a source rather than like
 * a push.
 */
export const PRESSURE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;

void main() {
  float left = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float right = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float top = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float divergence = texture2D(uDivergence, vUv).x;

  gl_FragColor = vec4((left + right + bottom + top - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`

/** Subtract the pressure gradient, which is the step that actually makes the field
 *  divergence-free — everything above is only working out by how much. */
export const GRADIENT_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;

void main() {
  float left = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float right = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float top = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;

  vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(right - left, top - bottom);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`

/** Multiply a field by a constant. Used to bleed the pressure field between frames — starting
 *  each solve from a decayed version of the last one converges much faster than starting from
 *  zero, and is why twenty iterations is enough. */
export const DECAY_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uTarget;
uniform float uValue;

void main() {
  gl_FragColor = texture2D(uTarget, vUv) * uValue;
}
`

/**
 * The dye field, drawn as the arena floor.
 *
 * Not a straight blit. The dye is stored as unbounded additive colour so that repeated splats in
 * the same place get brighter, and what looks good on screen is a tone-mapped version of that
 * with the faintest values pushed towards black — otherwise the whole arena sits at a dull grey
 * wash within a wave, which is exactly what neon must not do.
 */
export const DYE_DISPLAY_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uDye;
uniform float uIntensity;
uniform float uFloor;

void main() {
  vec3 dye = texture2D(uDye, vUv).rgb * uIntensity;
  // Reinhard, per channel. Per channel rather than on the luminance, deliberately: it lets a
  // channel saturate on its own, so a bright red splat goes towards orange and then white
  // instead of holding its hue all the way up. That is how film behaves and how neon reads.
  vec3 mapped = dye / (1.0 + dye);
  // Lift the black point: anything under the floor is nothing, and the gradient from nothing is
  // steep. Without this the arena never looks empty, and an arena that never looks empty has no
  // dynamic range left for the moment it is full.
  mapped = max(vec3(0.0), (mapped - uFloor) / (1.0 - uFloor));
  gl_FragColor = vec4(mapped, 1.0);
}
`
