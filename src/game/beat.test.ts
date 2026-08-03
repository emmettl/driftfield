import { describe, expect, it } from 'vitest'
import { beatPulse, feedBeat, freshBeat, lowBandEnergy, setBeatPulse } from './beat'

const FRAME = 1 / 60

/** A spectrum with `value` in every bin of a band, in Hz, and nothing anywhere else. */
function spectrum(bins: number, hzPerBin: number, band: { from: number; to: number }, value: number) {
  const data = new Uint8Array(bins)
  for (let i = 0; i < bins; i++) {
    const hz = i * hzPerBin
    if (hz >= band.from && hz <= band.to) data[i] = value
  }
  return data
}

/** Drive the follower for a stretch, returning the highest pulse it reached. */
function drive(state: ReturnType<typeof freshBeat>, energy: number, seconds: number): number {
  let peak = 0
  for (let t = 0; t < seconds; t += FRAME) peak = Math.max(peak, feedBeat(state, energy, FRAME))
  return peak
}

describe('lowBandEnergy', () => {
  const hzPerBin = 48000 / 2048

  it('hears a kick', () => {
    const kick = spectrum(1024, hzPerBin, { from: 40, to: 120 }, 220)
    expect(lowBandEnergy(kick, hzPerBin)).toBeGreaterThan(0.3)
  })

  it('ignores hats and the top of a 303 line', () => {
    // The whole point of the band being narrow and low. A follower that heard the hats would twitch on every
    // sixteenth, and the arena would shimmer rather than pulse.
    const hats = spectrum(1024, hzPerBin, { from: 6000, to: 12_000 }, 255)
    expect(lowBandEnergy(hats, hzPerBin)).toBeLessThan(0.02)
  })

  it('puts the window in the same place at either sample rate', () => {
    // A hard-coded bin range would land somewhere different on a 44.1kHz device than on a 48kHz one — a pulse
    // that works on the machine it was written on and not on the player's.
    const kick = { from: 40, to: 120 }
    const at48 = lowBandEnergy(spectrum(1024, 48000 / 2048, kick, 200), 48000 / 2048)
    const at44 = lowBandEnergy(spectrum(1024, 44100 / 2048, kick, 200), 44100 / 2048)
    expect(Math.abs(at48 - at44)).toBeLessThan(0.08)
  })

  it('survives an empty or nonsense spectrum', () => {
    expect(lowBandEnergy(new Uint8Array(0), hzPerBin)).toBe(0)
    expect(lowBandEnergy(new Uint8Array(64), 0)).toBe(0)
    expect(lowBandEnergy(new Uint8Array(64), -1)).toBe(0)
  })

  it('stays in 0..1', () => {
    const loudest = new Uint8Array(1024).fill(255)
    expect(lowBandEnergy(loudest, hzPerBin)).toBeLessThanOrEqual(1)
    expect(lowBandEnergy(loudest, hzPerBin)).toBeGreaterThan(0)
  })
})

describe('feedBeat', () => {
  it('does not pulse on a steady tone', () => {
    // A beat is an *onset*, not loudness. If a sustained pad pulsed, the arena would strobe through every drone
    // in the title music.
    const state = freshBeat()
    drive(state, 0.5, 3)
    expect(feedBeat(state, 0.5, FRAME)).toBeLessThan(0.05)
  })

  it('pulses when the low end jumps above its own average', () => {
    const state = freshBeat()
    drive(state, 0.2, 3)
    // One frame of a kick, four times the running level.
    expect(feedBeat(state, 0.8, FRAME)).toBeGreaterThan(0.5)
  })

  it('attacks fast and releases slowly', () => {
    const state = freshBeat()
    drive(state, 0.2, 3)
    const struck = feedBeat(state, 0.8, FRAME)

    // A frame later, back to quiet: still ringing, because the tail is what makes it read as a thump.
    const next = feedBeat(state, 0.2, FRAME)
    expect(next).toBeGreaterThan(struck * 0.5)

    // ...and gone within a fraction of a second.
    for (let t = 0; t < 0.5; t += FRAME) feedBeat(state, 0.2, FRAME)
    expect(state.pulse).toBeLessThan(0.05)
  })

  it('adapts to a quiet song and a loud one alike', () => {
    // The threshold is relative, so a quiet passage pulses on its own kicks rather than needing to be as loud
    // as the loudest part of the set.
    const quiet = freshBeat()
    drive(quiet, 0.06, 4)
    const quietPulse = feedBeat(quiet, 0.24, FRAME)

    const loud = freshBeat()
    drive(loud, 0.5, 4)
    const loudPulse = feedBeat(loud, 0.9, FRAME)

    expect(quietPulse).toBeGreaterThan(0.3)
    expect(loudPulse).toBeGreaterThan(0.3)
  })

  it('decays to exactly zero in silence, so nothing is left lit', () => {
    const state = freshBeat()
    drive(state, 0.2, 2)
    feedBeat(state, 0.9, FRAME)
    for (let t = 0; t < 4; t += FRAME) feedBeat(state, 0, FRAME)
    expect(state.pulse).toBe(0)
  })

  it('never leaves 0..1, whatever it is fed', () => {
    const state = freshBeat()
    for (const energy of [0, 0.5, 1, 5, -3, NaN]) {
      for (let t = 0; t < 0.5; t += FRAME) feedBeat(state, energy, FRAME)
      if (Number.isFinite(state.pulse)) {
        expect(state.pulse).toBeGreaterThanOrEqual(0)
        expect(state.pulse).toBeLessThanOrEqual(1)
      }
    }
  })

  it('ignores a zero or negative frame', () => {
    const state = freshBeat()
    state.pulse = 0.4
    expect(feedBeat(state, 1, 0)).toBe(0.4)
    expect(feedBeat(state, 1, -1)).toBe(0.4)
  })
})

describe('the shared pulse', () => {
  it('is what the renderers read', () => {
    setBeatPulse(0.42)
    expect(beatPulse()).toBe(0.42)
    setBeatPulse(0)
    expect(beatPulse()).toBe(0)
  })
})
