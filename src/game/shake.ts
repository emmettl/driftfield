// Camera shake, as a single decaying scalar the camera reads once a frame.
//
// Module state rather than store state, for the reason most of the presentation-side state
// here is: it changes every frame and no component needs to re-render when it does. The
// camera samples it, and the only thing anything else does is add to it.

let energy = 0

/** How fast shake bleeds off, as the fraction remaining per second. Fast — an arcade shake
 *  is a punch, and anything that rings for longer than about a third of a second stops
 *  reading as impact and starts reading as a loose camera mount. */
const DECAY = 0.0016

/** Most shake that can accumulate. A bomb into a rock field can add half a dozen impacts on
 *  one frame, and without a ceiling the screen is unreadable for the next half second —
 *  which is precisely when the player most needs to see. */
const CEILING = 2.2

export function addShake(amount: number): void {
  energy = Math.min(CEILING, energy + amount)
}

/** Decay, then hand back the current amount. Called once a frame by the camera rig; calling
 *  it twice in a frame would halve the shake, which is why nothing else may call it. */
export function stepShake(dt: number): number {
  energy *= Math.pow(DECAY, dt)
  if (energy < 0.0008) energy = 0
  return energy
}

export function peekShake(): number {
  return energy
}

/** Drop it. For a status change that should not inherit the last frame's violence — coming
 *  back to the attract screen after a death, for instance. */
export function resetShake(): void {
  energy = 0
}
