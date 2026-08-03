import { ALL_VOICES, clonePatterns, defaultFx, defaultKit, pattern, type Song } from '@driftbox/engine'

// Swarm. The wave music, and the song most of a run is spent inside.
//
// Everything about it is chosen for durability rather than for impact. It plays for as long as
// somebody stays alive, the tempo is lifted as the waves climb (see `musicCue.ts`), and it has
// to survive a hundred simultaneous sound effects on top of it — so it is dense in the middle
// and deliberately thin at both ends of the spectrum. There is no sub and no cymbal wash: the
// bottom belongs to the bomb and the top belongs to the shooting.
//
// A 909 four on the floor, which is not a fashionable choice and is the correct one. The
// arena is a bounded box you cannot stop moving in, and the kick is what the movement is
// measured against — the moment it syncopates, dodging stops feeling like it is on the beat.
// The interest is put in the 303 instead, which plays straight sixteenths that only move by
// leaps and never resolves to the root on a downbeat.
//
// Written to be transposable rather than to be pretty: the line works at 148 and it still
// works at 160, because a run that reaches wave twelve is playing this at 160.

// Kick and line only. The wave banner is up for the first bars of this.
const push = pattern(
  'push',
  'Push',
  {
    '909.bd': 'X... X... X... X... ',
    '909.ch': '..x. ..x. ..x. ..x. ',
  },
  { '303.a': '0 0 12 0 | 7 0 12 0 | 0 0 15 0 | 10 0 7 0' },
)

// The main body. Clap on the backbeat, open hat on the offbeat, sixteenth line.
const press = pattern(
  'press',
  'Press',
  {
    '909.bd': 'X... X... X... X... ',
    '909.cp': '.... X... .... X... ',
    '909.ch': 'x.x. x.x. x.x. x.x. ',
    '909.oh': '..x. ..x. ..x. ..x. ',
  },
  {
    '303.a': '0 12 7 12 | 0 12 15 12 | 0 12 7 12 | 19 15 12 7',
    // The second 303 answers on the "and" of the third beat rather than doubling the first.
    // Two 303s playing together is one thick 303; two taking turns is a conversation.
    '303.b': '0a . . . | . . 0 . | 0a . . . | . . -5 .',
  },
)

// Everything on. Snare instead of clap, sixteenth hats, a crash on the downbeat — the bars
// where a wave is at its worst.
const peak = pattern(
  'peak',
  'Peak',
  {
    '909.bd': 'X..x X... X..x X... ',
    '909.sd': '.... X... .... X..x ',
    '909.ch': 'x.xx x.xx x.xx x.xx ',
    '909.oh': '..x. ..x. ..x. ..x. ',
    '909.cr': 'x... .... .... .... ',
  },
  {
    // Up an octave and climbing, then all the way back down in one bar. The descent is the
    // part that matters: a line that only rises has nowhere left to go by the fourth repeat.
    '303.a': '0 12 7 12 | 15 12 19 12 | 22 19 15 12 | 10 7 3 0',
    '303.b': '0a . . . | 3a . . . | -5a . . . | . . . .',
  },
)

// One bar, no kick, a snare roll and an accent at the end. Placed where a section turns, so
// the music arrives at the same moment the wave does.
const surge = pattern(
  'surge',
  'Surge',
  {
    '909.sd': 'x.x. x.x. x.xx xxxx ',
    '909.cr': '.... .... .... x... ',
  },
  { '303.a': '. . . . | . . . . | . . . . | 0a . . .' },
)

// Two bars with the drums stripped out, for the gap between waves. The mix is also ducked
// under this by the engine's performance filter — see `music.ts` — so it is quieter than it
// reads, and the wave-cleared card lands in the hole.
const lull = pattern(
  'lull',
  'Lull',
  {
    '909.ch': '..x. ..x. ..x. ..x. ',
    '909.rim': 'x... ..x. x... ..x. ',
  },
  { '303.a': '0 . 12 . | 7 . 12 . | 0 . 15 . | 10 . 7 .' },
)

export function swarmSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // Punchy and short. The decay is well down from the default: a long 909 kick at 148bpm
  // fills the space the 303 needs, and the two of them fighting is what makes a dense mix
  // turn to mud.
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.34, tune: 0.4, colour: 0.55, level: 0.8 }
  kit.params['909.sd'] = { ...kit.params['909.sd'], decay: 0.36, tune: 0.5, colour: 0.62, level: 0.52 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.44, level: 0.46, pan: 0.54 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.1, tone: 0.72, level: 0.3, pan: 0.45 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.3, tone: 0.66, level: 0.32, pan: 0.58 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], decay: 0.18, tune: 0.6, level: 0.24, pan: 0.4 }
  // The crash is the loudest single thing in the song and it happens twice a section. Held
  // well down, because it is a punctuation mark and not an event.
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.6, tone: 0.5, level: 0.26 }

  if (kit.bass) {
    // Bright, hard, and short, with no slide anywhere in the pattern. Each sixteenth is a
    // separate event — this is an arpeggiator standing in for a lead, and any legato at all
    // rounds the corners off and turns it into a pad.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.58,
      wave: 1,
      cutoff: 0.4,
      resonance: 0.6,
      envMod: 0.52,
      decay: 0.2,
      accent: 0.66,
      level: 0.5,
    }
    // The answering voice, an octave down and darker, so the two never occupy the same band
    // even when they land on the same step.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.2,
      wave: 0,
      cutoff: 0.2,
      resonance: 0.4,
      envMod: 0.44,
      decay: 0.4,
      accent: 0.5,
      level: 0.46,
    }
  }

  kit.sends = {
    '909.cp': { delay: 0.14, reverb: 0.24 },
    '909.oh': { delay: 0.1, reverb: 0.2 },
    '909.sd': { delay: 0.12, reverb: 0.26 },
    '909.rim': { delay: 0.34, reverb: 0.22 },
    '909.cr': { delay: 0.06, reverb: 0.34 },
    '303.a': { delay: 0.2, reverb: 0.14 },
  }

  return {
    bpm: 148,
    // Dead straight. The game is a machine and so is this.
    swing: 0,
    patterns: clonePatterns([push, press, peak, surge, lull]),
    // Long sections. A song that changes every four bars is exhausting to play a shooter
    // over — the point is that it goes somewhere, not that it keeps arriving.
    chain: [
      { pattern: 'push', repeat: 4 },
      { pattern: 'press', repeat: 8 },
      { pattern: 'peak', repeat: 8 },
      { pattern: 'surge', repeat: 1 },
      { pattern: 'press', repeat: 4 },
      { pattern: 'peak', repeat: 8 },
      { pattern: 'lull', repeat: 2 },
      { pattern: 'press', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A sixteenth delay with the feedback low. Anything longer smears across the sixteenth
      // line, and anything with more feedback competes with the sound effects for the same
      // few hundred milliseconds of space.
      delayTime: 0.16,
      delayFeedback: 0.26,
      delayTone: 0.6,
      reverbSize: 0.34,
      reverbDamping: 0.55,
    },
  }
}
