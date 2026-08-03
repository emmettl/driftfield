import { ALL_VOICES, clonePatterns, defaultFx, defaultKit, pattern, type Song } from '@driftbox/engine'

// Vector Lock. The attract screen.
//
// Written for a screen nobody is playing yet, which is a genuine constraint rather than an
// excuse to write less: it has to be interesting for thirty seconds and then bearable for
// ten minutes, because a cabinet left alone plays it on a loop and the person in the room
// did not choose it. So there is no backbeat and almost no bottom end — a 909 kick on the
// one, a rim on the "and", and a closed hat on every offbeat, which is a pulse rather than a
// groove. Nothing here demands to be danced to.
//
// The 303 does the whole job. It plays a minor arpeggio with the filter mostly shut and the
// envelope slow, so each note opens rather than snaps — the machine is warming up, not
// running. The second 303 is a held root two octaves down with a slide on it, which is the
// nearest a monosynth gets to a drone, and it is what makes the sparse version sound
// deliberate instead of unfinished.
//
// Deliberately at odds with the two play songs: it is the only thing here with any swing on
// it, and the only one where the 303 is legato. Pressing START should feel like a change of
// state, and it cannot if the title music is already the wave music.

// The machine idling. Almost nothing, and it holds for four bars.
const standby = pattern(
  'standby',
  'Standby',
  {
    '909.bd': 'x... .... .... .... ',
    '909.ch': '..x. ..x. ..x. ..x. ',
    '909.rim': '.... ..x. .... ..x. ',
  },
  { '303.b': '0as . . . | . . . . | . . . . | . . . .' },
)

// The line comes up: root, fifth, octave, and the minor third under it. A shape, played
// slowly enough to be heard as one.
const trace = pattern(
  'trace',
  'Trace',
  {
    '909.bd': 'x... .... ..x. .... ',
    '909.ch': '..x. ..x. ..x. ..x. ',
    '909.rim': '.... ..x. .... ..x. ',
    '909.oh': '.... .... .... ..x. ',
  },
  {
    '303.a': '0 . 7 . | 12 . 7 . | -5 . 3 . | 7 . 12 .',
    '303.b': '0as . . . | . . . . | -5as . . . | . . . .',
  },
)

// Locked on. The first bar with a clap in it, and the line fills in to eighths — this is as
// busy as the title screen ever gets.
const lock = pattern(
  'lock',
  'Lock',
  {
    '909.bd': 'x... .... ..x. .x.. ',
    '909.cp': '.... x... .... x... ',
    '909.ch': 'x.x. x.x. x.x. x.x. ',
    '909.rim': '..x. ..x. ..x. ..x. ',
  },
  {
    '303.a': '0 . 7 12 | 15 . 12 7 | -5 . 3 7 | 12 . 7 3',
    '303.b': '0as . . . | . . . . | -5as . . . | . . . .',
  },
)

// Two bars of hat and line. The breath that stops the loop from being a loop.
const idle = pattern(
  'idle',
  'Idle',
  { '909.ch': '..x. ..x. ..x. ..x. ' },
  { '303.a': '0 . . . | 12 . . . | -5 . . . | 3 . . .' },
)

export function vectorSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // A 909 kick with the decay short and the tune low: a thud with no tail, so it marks the
  // bar without becoming the bassline. The 303 drone is the low end here.
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.3, tune: 0.34, colour: 0.2, level: 0.6 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.42, level: 0.34, pan: 0.55 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.12, tone: 0.7, level: 0.26, pan: 0.44 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.5, tone: 0.6, level: 0.3, pan: 0.6 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], decay: 0.2, tune: 0.62, level: 0.26, pan: 0.36 }

  if (kit.bass) {
    // The arpeggio. Cutoff low and envMod high, so the filter opens on each note rather than
    // sitting open — that opening is the sound of the whole song. Decay long enough that the
    // sweep is still moving when the next note arrives, which is what stops it being a bleep.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.52,
      wave: 0,
      cutoff: 0.14,
      resonance: 0.66,
      envMod: 0.72,
      decay: 0.62,
      accent: 0.5,
      level: 0.5,
    }
    // The drone. Two octaves down, filter nearly shut, envelope barely moving — a 303 asked
    // to be a sub. It is the only continuous sound in the song and everything else is timed
    // against it.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.06,
      wave: 0,
      cutoff: 0.1,
      resonance: 0.22,
      envMod: 0.08,
      decay: 0.9,
      accent: 0.2,
      level: 0.6,
    }
  }

  kit.sends = {
    '909.rim': { delay: 0.42, reverb: 0.3 },
    '909.ch': { delay: 0.14, reverb: 0.22 },
    '909.oh': { delay: 0.2, reverb: 0.4 },
    '909.cp': { delay: 0.3, reverb: 0.44 },
    '303.a': { delay: 0.36, reverb: 0.26 },
  }

  return {
    bpm: 124,
    // The only swung thing in the game. A title screen is allowed to breathe; a wave is not.
    swing: 0.12,
    patterns: clonePatterns([standby, trace, lock, idle]),
    chain: [
      { pattern: 'standby', repeat: 4 },
      { pattern: 'trace', repeat: 8 },
      { pattern: 'lock', repeat: 8 },
      { pattern: 'idle', repeat: 2 },
      { pattern: 'lock', repeat: 8 },
      { pattern: 'trace', repeat: 4 },
      { pattern: 'idle', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A dotted-eighth delay on the rim, which is what puts the ticking cross-rhythm over a
      // pattern that has almost nothing in it, and a big damp room for everything to sit in.
      delayTime: 0.37,
      delayFeedback: 0.44,
      delayTone: 0.4,
      reverbSize: 0.72,
      reverbDamping: 0.62,
    },
  }
}
