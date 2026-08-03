import { ALL_VOICES, BASS_VOICES } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import { SONGS, songById } from './index'

// The soundtrack's tests.
//
// Most of the value here is in `build()` being called at all. The engine's `pattern()` helper counts the
// steps in every line it is given and throws if one is short — and a drum line one character short is
// invisible by eye, because the whole point of the notation is that it reads as a picture and a picture
// does not tell you it is fifteen wide when it should be sixteen. Left unchecked it silently becomes a
// track shorter than its pattern, which the loader then pads, so the song plays subtly differently from
// how it reads.
//
// The rest checks the things a typo produces: a voice id that does not exist (which is silence, not an
// error), a chain entry naming a pattern that was renamed, a bass note miles out of range.

const VOICE_IDS = new Set(ALL_VOICES.map((voice) => voice.id))
const BASS_IDS = new Set(BASS_VOICES.map((voice) => voice.id))

describe('the song list', () => {
  it('has the three the game cues', () => {
    expect(SONGS.map((song) => song.id)).toEqual(['vector', 'swarm', 'singularity'])
  })

  it('can be looked up by id', () => {
    expect(songById('swarm')?.name).toBe('Swarm')
    expect(songById('nope' as never)).toBeUndefined()
  })

  it('builds a fresh song each time, so one run cannot edit the next', () => {
    const first = songById('swarm')!.build()
    const second = songById('swarm')!.build()
    expect(first).not.toBe(second)
    expect(first.patterns[0]).not.toBe(second.patterns[0])
  })
})

describe.each(SONGS)('$name', (preset) => {
  const song = preset.build()

  it('builds, with every notated line the length it claims to be', () => {
    // `pattern()` throws on a miscount, so reaching here is the assertion.
    expect(song.patterns.length).toBeGreaterThan(0)
    for (const pattern of song.patterns) {
      for (const [voice, steps] of Object.entries(pattern.tracks)) {
        expect(steps, `${pattern.id}/${voice}`).toHaveLength(pattern.length)
      }
      for (const [voice, line] of Object.entries(pattern.bass ?? {})) {
        expect(line, `${pattern.id}/${voice}`).toHaveLength(pattern.length)
      }
    }
  })

  it('only plays voices the machines actually have', () => {
    // A voice id with a typo in it is not an error anywhere — it is simply a track that never fires. The
    // engine looks it up, gets nothing, and moves on.
    for (const pattern of song.patterns) {
      for (const voice of Object.keys(pattern.tracks)) {
        expect(VOICE_IDS.has(voice), `${pattern.id} plays unknown voice ${voice}`).toBe(true)
      }
      for (const voice of Object.keys(pattern.bass ?? {})) {
        expect(BASS_IDS.has(voice), `${pattern.id} plays unknown bass ${voice}`).toBe(true)
      }
    }
  })

  it('has an arrangement that names patterns that exist', () => {
    // An unknown id in the chain does not error either: `patternForBar` falls back to the first pattern,
    // so the song just quietly plays the wrong bar.
    const ids = new Set(song.patterns.map((pattern) => pattern.id))
    expect(song.chain.length).toBeGreaterThan(0)
    for (const step of song.chain) {
      expect(ids.has(step.pattern), `chain names missing pattern ${step.pattern}`).toBe(true)
      expect(step.repeat).toBeGreaterThanOrEqual(1)
    }
  })

  it('uses every pattern it defines', () => {
    // A pattern nobody plays is either a mistake in the chain or dead weight in the file.
    const played = new Set(song.chain.map((step) => step.pattern))
    for (const pattern of song.patterns) {
      expect(played.has(pattern.id), `${pattern.id} is never played`).toBe(true)
    }
  })

  it('sits at a plausible tempo', () => {
    expect(song.bpm).toBeGreaterThanOrEqual(60)
    expect(song.bpm).toBeLessThanOrEqual(200)
  })

  it('keeps every bass note inside a playable range', () => {
    // Two octaves either side of the root. Further and the 303 is either inaudible or a whistle, and
    // either way it is a typo in the notation rather than a musical decision.
    for (const pattern of song.patterns) {
      for (const line of Object.values(pattern.bass ?? {})) {
        for (const step of line) {
          if (step.note === null) continue
          expect(step.note).toBeGreaterThanOrEqual(-24)
          expect(step.note).toBeLessThanOrEqual(36)
        }
      }
    }
  })

  it('has a kit with parameters for the voices it plays', () => {
    const used = new Set(song.patterns.flatMap((pattern) => Object.keys(pattern.tracks)))
    for (const voice of used) {
      expect(song.kit.params[voice], `${voice} has no kit entry`).toBeDefined()
    }
  })
})

describe('the set as a whole', () => {
  it('gives the two play songs different tempos and different kicks', () => {
    // Singularity handing the kick to the 808 is the audible tell that the wave has changed. If both play
    // songs used the same machine the handover would be inaudible, which is most of its job gone.
    const swarm = songById('swarm')!.build()
    const singularity = songById('singularity')!.build()
    expect(singularity.bpm).toBeGreaterThan(swarm.bpm)

    const kicks = (song: typeof swarm) =>
      new Set(
        song.patterns.flatMap((pattern) =>
          Object.keys(pattern.tracks).filter((voice) => voice.endsWith('.bd')),
        ),
      )
    expect([...kicks(swarm)]).toEqual(['909.bd'])
    expect([...kicks(singularity)]).toEqual(['808.bd'])
  })

  it('makes the title song the only swung one', () => {
    // A title screen is allowed to breathe; a wave is not.
    expect(songById('vector')!.build().swing).toBeGreaterThan(0)
    expect(songById('swarm')!.build().swing).toBe(0)
    expect(songById('singularity')!.build().swing).toBe(0)
  })

  it('makes the title song the slowest', () => {
    const tempos = SONGS.map((song) => song.build().bpm)
    expect(Math.min(...tempos)).toBe(songById('vector')!.build().bpm)
  })
})
