// The particle field's shaders: one pass that moves them, one that seeds a burst, and the pair
// that draws them.
//
// The particles are tracers. They carry no forces of their own — they read the fluid's velocity
// field and go where it goes, and they take their colour from the dye at their own position. So a
// kill's smoke and a kill's sparks are not two effects that were tuned to look similar; they are
// one field, sampled twice.
//
// State per particle is one RGBA16F texel: position in uv, age in seconds, and a fixed random seed.
// Half float is enough for all four — a position in 0..1 resolves to about 1/2000 of the arena,
// which is a twentieth of a world unit, well under a pixel at any sane zoom.

/** A cheap 2D hash. Not uniform enough for anything statistical, entirely good enough for
 *  scattering particles inside a circle. */
const HASH = /* glsl */ `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`

export const PARTICLE_UPDATE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;
uniform sampler2D uVelocity;
uniform float uDt;
uniform float uTime;
uniform float uLife;
/** How hard a particle follows the fluid. Under 1 they lag, which reads as weight. */
uniform float uFollow;

${HASH}

void main() {
  vec4 state = texture2D(uState, vUv);
  vec2 pos = state.xy;
  float age = state.z;
  float seed = state.w;

  vec2 velocity = texture2D(uVelocity, pos).xy;
  pos += velocity * uDt * uFollow;
  age += uDt;

  // Lifespan is jittered per particle by its seed. Without the jitter the whole field respawns in
  // lockstep and the arena pulses once a lifetime — very obvious, and the sort of thing that looks
  // like a bug in the simulation rather than a choice about the particles.
  float life = uLife * (0.55 + 0.9 * seed);
  bool dead = age > life || pos.x < -0.02 || pos.x > 1.02 || pos.y < -0.02 || pos.y > 1.02;

  if (dead) {
    // Respawned uniformly, which is the ambient state: a thin dust over the arena that the
    // currents drag around. Bursts do not happen here — they are seeded directly into the state
    // texture, because a burst has to be thousands of particles *now* rather than the trickle that
    // happens to reach the end of its life this frame. See PARTICLE_INJECT_FRAGMENT.
    pos = vec2(hash(vUv + uTime), hash(vUv.yx - uTime * 1.37));
    age = 0.0;
  }

  gl_FragColor = vec4(pos, age, seed);
}
`

/**
 * Seed a burst.
 *
 * Drawn scissored to a band of rows of the state texture, so it overwrites a contiguous block of
 * particles and leaves the rest alone — the standard way to allocate from a GPU particle pool, and
 * the only way to get an instantaneous burst without a CPU-side free list.
 *
 * The distribution is deliberately not uniform in the disc: `sqrt` on the radius would give equal
 * area density, and this omits it, which concentrates particles towards the centre. An explosion is
 * brightest where it happened.
 */
export const PARTICLE_INJECT_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uPoint;
uniform float uRadius;
uniform float uTime;

${HASH}

void main() {
  float angle = hash(vUv + uTime) * 6.2831853;
  float distance = hash(vUv.yx + uTime * 2.11) * uRadius;
  vec2 pos = uPoint + vec2(cos(angle), sin(angle)) * distance;
  // The seed is regenerated with the particle rather than kept, so a block that is reused every few
  // seconds does not produce the same burst shape each time.
  gl_FragColor = vec4(pos, 0.0, hash(vUv * 3.7 - uTime));
}
`

/**
 * Drawing them.
 *
 * A `ShaderMaterial` rather than a raw one, because unlike the solver's passes this is a real object
 * in the scene and wants three's projection and model-view matrices. Position comes out of the state
 * texture in the vertex shader, so the geometry's own positions are never read — it exists to carry
 * the vertex count and one attribute, which is the index of each particle in the state texture.
 */
export const PARTICLE_VERTEX = /* glsl */ `
attribute vec2 aRef;

uniform sampler2D uState;
uniform sampler2D uDye;
uniform vec2 uHalfExtent;
uniform float uLife;
uniform float uSize;
/** Pixels per world unit at one unit of depth — the point-size scale. See particles.ts. */
uniform float uScale;

varying vec3 vTint;
varying float vFade;

void main() {
  vec4 state = texture2D(uState, aRef);
  vec2 uv = state.xy;
  float age = state.z;
  float seed = state.w;

  vec3 world = vec3((uv.x * 2.0 - 1.0) * uHalfExtent.x, (uv.y * 2.0 - 1.0) * uHalfExtent.y, 0.0);
  vec4 view = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;

  float life = uLife * (0.55 + 0.9 * seed);
  float t = clamp(age / life, 0.0, 1.0);
  // In fast, out slowly, and squared on the way out so most of the lifetime is spent faint. A
  // linear fade makes the field look like it is being switched off.
  vFade = smoothstep(0.0, 0.06, t) * (1.0 - t) * (1.0 - t);

  // The dye at the particle's own position. This is the whole trick: particles in the smoke of a
  // green kill are green, and the ones drifting in clean air fall back to the arena's own blue in
  // the fragment shader.
  vTint = texture2D(uDye, uv).rgb;

  gl_PointSize = uSize * (0.55 + seed * 0.9) * uScale / max(0.001, -view.z);
}
`

export const PARTICLE_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uAmbient;

varying vec3 vTint;
varying float vFade;

void main() {
  // Round, soft, and no depth write anywhere — these are additive sprites and the only thing that
  // matters is the falloff. Squaring it gives a tight core with a wide halo, which is what bloom
  // has something to work with.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float falloff = (1.0 - d) * (1.0 - d);

  // Where there is dye, the particle is the colour of the dye, brightened; where there is none it
  // is the arena's own cold blue. A min on the length rather than a threshold, so a particle
  // drifting out of the smoke fades between the two instead of snapping.
  float inSmoke = min(1.0, length(vTint) * 1.6);
  vec3 colour = mix(uAmbient, vTint * 1.5, inSmoke);

  gl_FragColor = vec4(colour * vFade * falloff, vFade * falloff);
}
`
