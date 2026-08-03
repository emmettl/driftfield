import { smoothing } from './constants'

// The arena's heartbeat: one scalar, derived from what the music is actually doing.
//
// Shared rather than computed per consumer, in the same spirit as the fluid field. The grid's brightness, the
// wall glow, the bloom and a very small camera breath all read this one number, so they cannot disagree about
// where the beat is — and adding a fifth consumer costs a line rather than a second analysis.
//
// **Why the analyser and not the transport.** The engine knows its own tempo and step position, which would
// give a mathematically exact beat — and the wrong one. The transport schedules a bar ahead of what you can
// hear, so a visual driven from it leads the sound by up to a second. The analyser is downstream of everything
// audible (see `DriftboxEngine.analyser`), so a pulse taken from it lands when the kick lands, which is the
// only definition of "on the beat" that matters to somebody watching.
//
// It also means the effect is honest about silence: mute the music and the energy goes to zero, the pulse
// decays, and every consumer sits at its base value — which is exactly the game as it was before any of this.

/** The band a kick lives in, in Hz. Deliberately narrow and low: hats and the top of a 303 line would make
 *  this twitch on every sixteenth, and the point is the pulse, not the pattern. */
const LOW_HZ = { from: 30, to: 165 }

/**
 * How much louder than the running average counts as a beat.
 *
 * Above 1, so a steady tone produces nothing at all. This is what separates a *beat* from mere loudness: the
 * song's own level drifts as sections come and go, and a fixed threshold would pulse continuously through a
 * loud section and not at all through a quiet one.
 */
const THRESHOLD = 1.12

/** Per-second rate the running average follows the signal. Slow — it has to average over bars, not beats, or
 *  it rises to meet each kick and the excess vanishes. */
const AVERAGE_RATE = 0.7

/** Attack and release, per second. Attack is near-instant because a beat is a transient; release is what gives
 *  the visual its tail, and at 7 it decays in about 150ms, which reads as a thump rather than a flash. */
const ATTACK_RATE = 60
const RELEASE_RATE = 7

/** Floor under the average, so the excess is not divided by something approaching zero during silence — which
 *  would turn the faintest noise in an empty song into a full-scale pulse. */
const FLOOR = 0.035

export interface BeatState {
  /** Slow-moving average of the low band. What this song sounds like, over the last few bars. */
  average: number
  /** The pulse, 0..1. */
  pulse: number
}

export function freshBeat(): BeatState {
  return { average: 0, pulse: 0 }
}

/**
 * Mean energy of the low band, 0..1.
 *
 * Takes the bin width rather than assuming one, because the number of Hz a bin covers depends on the sample
 * rate — 44.1kHz and 48kHz devices are both common, and a hard-coded bin range would put the window in a
 * different place on each. Getting that wrong is not a crash; it is a pulse that works on the developer's
 * machine and not on the player's.
 */
export function lowBandEnergy(bins: Uint8Array, hzPerBin: number): number {
  if (bins.length === 0 || !(hzPerBin > 0)) return 0
  const from = Math.max(1, Math.floor(LOW_HZ.from / hzPerBin))
  const to = Math.min(bins.length - 1, Math.ceil(LOW_HZ.to / hzPerBin))
  if (to < from) return 0

  let total = 0
  for (let i = from; i <= to; i++) total += bins[i]
  return total / (to - from + 1) / 255
}

/**
 * Feed one frame of energy, and get the pulse back.
 *
 * An onset follower rather than a beat *tracker*: it does not know the tempo and does not try to predict the
 * next beat. That is deliberate — a tracker that has locked onto the wrong tempo is worse than useless, and
 * this only has to answer "is something hitting right now", which needs no memory beyond a running average.
 */
export function feedBeat(state: BeatState, energy: number, dt: number): number {
  if (dt <= 0) return state.pulse

  state.average += (energy - state.average) * smoothing(AVERAGE_RATE, dt)

  const excess = energy - state.average * THRESHOLD
  const target = Math.max(0, Math.min(1, excess / Math.max(FLOOR, state.average)))

  // Asymmetric: snap up, ease down. A symmetric follower either misses the transient or smears it into a wash.
  const rate = target > state.pulse ? ATTACK_RATE : RELEASE_RATE
  state.pulse += (target - state.pulse) * smoothing(rate, dt)
  if (state.pulse < 0.002) state.pulse = 0
  return state.pulse
}

// ---- the shared value ----------------------------------------------------------
//
// Module state, like `shake.ts` and for the same reason: it changes every frame and no component needs to
// re-render when it does. The loop writes it; the renderers read it.

let current = 0

export function setBeatPulse(pulse: number): void {
  current = pulse
}

/** The pulse, 0..1. Zero whenever the music is not playing. */
export function beatPulse(): number {
  return current
}
