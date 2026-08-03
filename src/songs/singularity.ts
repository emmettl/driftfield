import { ALL_VOICES, clonePatterns, defaultFx, defaultKit, pattern, type Song } from '@driftbox/engine'

// Singularity. The wells.
//
// The one song in the game that is allowed to be unpleasant. A singularity wave puts two or
// three gravity wells in a bounded arena, bends your own bullets past them, and drags the
// grid into a funnel; the music's job is to agree with all of that rather than to keep the
// party going, which is why it is the only thing here built on a minor second.
//
// That interval is the whole idea. The line moves between the root and one semitone above it
// — 0 and 1 in the notation, and 12 and 13 an octave up — which is the most dissonant pair
// available and sounds wrong in a way people recognise without being able to name. Every acid
// record that ever unsettled anybody did this. Against it, the second 303 sits on the root two
// octaves down and never moves, so the tension has something to be tense against.
//
// An 808 kick rather than the 909 the wave music uses, and that is a deliberate handover: the
// 808's long boom is the one thing the mix has no room for at 148bpm, so hearing it means the
// game has changed. It is also the closest thing two drum machines have to the sound of
// something very large a long way away.

// The well arrives. Kick on the one and the three, hats, and the line stating the semitone.
const event = pattern(
  'event',
  'Event',
  {
    '808.bd': 'X... .... X... .... ',
    '909.ch': 'x.x. x.x. x.x. x.x. ',
  },
  { '303.a': '0 . 0 12 | . 0 . 13 | 0 . 0 12 | . 0 . 18' },
)

// The body of the wave. The line climbs a semitone in the third bar and stays there, which is
// the trick that makes eight bars of it feel like it is getting worse.
const horizon = pattern(
  'horizon',
  'Horizon',
  {
    '808.bd': 'X... ..x. X... ..x. ',
    '909.sd': '.... X... .... X... ',
    '909.ch': 'x.xx x.xx x.xx x.xx ',
    '808.cb': '..x. .... ..x. .... ',
  },
  {
    '303.a': '0 12 13 12 | 0 12 18 12 | 1 13 14 13 | 0 12 18 24',
    '303.b': '0a . . . | . . . . | 1a . . . | . . . .',
  },
)

// Slides everywhere: every other note runs into the next one on the same envelope, so the
// line stops articulating and starts sliding around. The sound of something being pulled.
const spaghetti = pattern(
  'spaghetti',
  'Spaghetti',
  {
    '808.bd': 'X..x ..x. X... ..xx ',
    '909.ch': 'x.xx x.xx xxxx x.xx ',
    '909.oh': '..x. ..x. ..x. ..x. ',
  },
  {
    '303.a': '0s . 12s . | 13s . 12 . | 0s . 18s . | 24 . 12 .',
    // Two octaves down and accented, so the drone is felt rather than heard. On a phone
    // speaker this is inaudible and the song still works, which is the test it was written to.
    '303.b': '-12a . . . | . . . . | -12a . . . | -5 . . .',
  },
)

// Collapse. Everything at once, sixteenth kicks, the line spanning three octaves. Placed
// where a section ends, so a well going up has something to go up over.
const collapse = pattern(
  'collapse',
  'Collapse',
  {
    '808.bd': 'X.xx X.xx X.xx X.xx ',
    '909.sd': '..x. ..x. ..x. ..xx ',
    '909.ch': 'xxxx xxxx xxxx xxxx ',
    '909.cr': 'x... .... x... .... ',
  },
  {
    '303.a': '0a 12 24 12 | 13a 25 13 25 | 0a 12 24 12 | 18a 24 30 24',
    '303.b': '0a . . . | 1a . . . | 0a . . . | -5a . . .',
  },
)

export function singularitySong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // The 808 kick with the decay near the top: a boom with a long tail, which at 162bpm means
  // consecutive kicks overlap. That overlap is the point — it is what makes the low end feel
  // like a continuous pressure rather than a series of hits.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.78, tune: 0.24, colour: 0.4, level: 0.82 }
  kit.params['909.sd'] = { ...kit.params['909.sd'], decay: 0.3, tune: 0.58, colour: 0.7, level: 0.5 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.08, tone: 0.78, level: 0.3, pan: 0.48 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.26, tone: 0.7, level: 0.3, pan: 0.56 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.28, tune: 0.66, level: 0.24, pan: 0.64 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.7, tone: 0.56, level: 0.3 }

  if (kit.bass) {
    // Resonance past the point of politeness and the envelope fast, so the filter slams shut
    // between notes and every one of them squelches. This is the 303 doing the thing it is
    // famous for, and the semitone line is the reason it is unpleasant rather than fun.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.5,
      wave: 0,
      cutoff: 0.3,
      resonance: 0.9,
      envMod: 0.8,
      decay: 0.3,
      accent: 0.82,
      level: 0.54,
    }
    // The anchor. Two octaves below the line, filter shut, no envelope to speak of.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.04,
      wave: 1,
      cutoff: 0.08,
      resonance: 0.3,
      envMod: 0.12,
      decay: 0.7,
      accent: 0.4,
      level: 0.62,
    }
  }

  kit.sends = {
    '909.sd': { delay: 0.2, reverb: 0.3 },
    '909.oh': { delay: 0.16, reverb: 0.26 },
    '808.cb': { delay: 0.44, reverb: 0.3 },
    '909.cr': { delay: 0.1, reverb: 0.42 },
    '303.a': { delay: 0.3, reverb: 0.2 },
  }

  return {
    bpm: 162,
    swing: 0,
    patterns: clonePatterns([event, horizon, spaghetti, collapse]),
    chain: [
      { pattern: 'event', repeat: 2 },
      { pattern: 'horizon', repeat: 8 },
      { pattern: 'spaghetti', repeat: 4 },
      { pattern: 'collapse', repeat: 8 },
      { pattern: 'horizon', repeat: 4 },
      { pattern: 'spaghetti', repeat: 4 },
      { pattern: 'collapse', repeat: 8 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A triplet-ish delay with the feedback high and the tone dark, so the repeats pile up
      // behind the line without adding any brightness. The room is small and dead: a big
      // reverb on a song this fast would turn the semitone into a wash and lose the interval,
      // which is the only thing here worth keeping.
      delayTime: 0.3,
      delayFeedback: 0.52,
      delayTone: 0.3,
      reverbSize: 0.24,
      reverbDamping: 0.7,
    },
  }
}
