import type { SoundCue } from './types'

// The sound effects: Web Audio oscillators and generated noise, no files.
//
// The same argument the music makes, on a smaller scale. A shooter needs a dozen sounds and they all want to be
// tuned by ear against the music, which is much easier when a sound is four numbers in a file than when it is a
// wav somebody has to re-export. It also means the game has no audio assets at all: nothing to download,
// nothing to wait for, nothing to get out of sync with the code that plays it.
//
// Everything here is a no-op until the first user gesture unlocks the context.
//
// ---- what makes an impact sound like one -----------------------------------------------------------------
//
// Worth writing down, because two attempts at these sounded weak and none of the reasons were the obvious one
// (which is "make them louder" — that was tried, and it made them worse).
//
// An impact is three layers, and leaving any of them out is what "no punch" means:
//
//   * a **click** — a dozen milliseconds of bright, high-passed noise. This is the part the ear reads as impact
//     rather than as volume, and the first versions had none of it at all.
//   * a **body** — a tone dropping in pitch over a tenth of a second. This is what makes a small explosion
//     sound small and a big one big.
//   * a **sub** — energy below 80Hz. This is what you feel rather than hear, and a lowpassed noise burst with
//     nothing under 150Hz in it is weightless by construction, however loud it is made.
//
// Two things about the *envelope*, which matter more than the levels:
//
//   * the attack must be **immediate**. A ramp over 8ms — which is what these had — is audible as a soft onset
//     and turns a hit into a thud. Percussive layers here reach full gain in a millisecond.
//   * the decay must be **exponential**, not linear. Exponential piles the energy at the front, which is what a
//     transient *is*; a linear fade spreads it evenly and sounds like a rumble.
//
// And one thing that is not in the sounds at all — see `bus`. The limiter was set up as a leveller with a 3ms
// attack, which caught and flattened the transient of every hit. That was the single biggest cause, and it is
// why raising the gains had made things worse rather than better: it just squashed them harder.

let ctx: AudioContext | null = null

/**
 * The safety limiter every voice passes through — and the setting that mattered most for punch.
 *
 * It exists so a bomb landing in a rock field cannot sum a dozen simultaneous hits past full scale. But the
 * first version was set up as a *leveller*: threshold -16, ratio 6, attack 3ms. A compressor with a 3ms attack
 * and a ratio of 6 catches the transient of every single hit and flattens precisely the part of the sound that
 * carries the impact.
 *
 * So: an attack slow enough to let the first 20ms through untouched, a gentle ratio, and a threshold high
 * enough that it does nothing at all until several things happen at once. A seatbelt, not a mix decision.
 */
let bus: DynamicsCompressorNode | null = null

/** Where a voice's reverb send connects. One room for everything, at different distances — which is what makes
 *  the arena sound like a place rather than a set of unrelated noises. */
let reverbSend: GainNode | null = null

/**
 * A generated impulse response.
 *
 * Generated rather than recorded, for the same reason nothing else here is sampled. Independent noise per
 * channel, which decorrelates the two and gives the tail its width for free, run through a one-pole lowpass so
 * it is a dark room rather than a fizzy one.
 */
function impulseResponse(ac: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(ac.sampleRate * seconds))
  const buffer = ac.createBuffer(2, frames, ac.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let last = 0
    for (let i = 0; i < frames; i++) {
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28
      data[i] = last * Math.pow(1 - i / frames, decay)
    }
  }
  return buffer
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -8
    compressor.knee.value = 6
    compressor.ratio.value = 3.5
    // 20ms, not 3. See the note on `bus`: this is the number that decides whether an explosion has a transient.
    compressor.attack.value = 0.02
    compressor.release.value = 0.2
    compressor.connect(ctx.destination)
    bus = compressor

    // A short, bright room. Long enough to put the hits in a space, short enough that a busy wave does not turn
    // into a wash — and it returns *into* the limiter rather than past it, so a long tail under a bomb cannot be
    // the thing that pushes the output over full scale.
    const convolver = ctx.createConvolver()
    convolver.buffer = impulseResponse(ctx, 1.1, 2.6)
    // Rolls the very top off the tail, so the reverb sits behind the dry hit instead of competing with its click
    // for the same few kilohertz.
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 4200
    const send = ctx.createGain()
    send.gain.value = 1
    send.connect(convolver).connect(damp).connect(compressor)
    reverbSend = send
  }
  // Not `=== 'suspended'`. Safari reports a non-standard 'interrupted' when a call or another app takes the
  // audio, and checking for the one state we expected meant every effect fired after an interruption quietly
  // built its nodes into a dead context.
  if (ctx.state !== 'running') void ctx.resume()
  return ctx
}

/** Call from a user gesture (click, key) to satisfy autoplay policies. */
export function unlockAudio(): void {
  ensureCtx()
}

/**
 * The context the effects run on, for the music engine to share.
 *
 * One context rather than two. A second one is a second hardware output stream with its own clock that drifts
 * against this one, and — the part that actually bites — the gesture that unlocks one does not unlock the
 * other, so the music would stay silent until something happened to touch it.
 */
export function getAudioContext(): AudioContext | null {
  return ensureCtx()
}

/**
 * The context if there is one, without building one.
 *
 * For the interruption watchdog, which runs from the moment the app mounts and must not be the thing that
 * creates the context — one built before the player has touched the page starts suspended, and on some browsers
 * counts against ever being allowed to run.
 */
export function peekAudioContext(): AudioContext | null {
  return ctx
}

/** Route a voice to the dry bus and, if it asked for any, to the shared room. */
function route(output: AudioNode, send: number): void {
  if (bus) output.connect(bus)
  if (send > 0 && reverbSend && ctx) {
    const tap = ctx.createGain()
    tap.gain.value = send
    output.connect(tap).connect(reverbSend)
  }
}

interface ToneOpts {
  freq: number
  toFreq?: number
  duration: number
  type?: OscillatorType
  gain?: number
  /** Seconds to wait before this one starts, for the two-note flourishes. Scheduled on the audio clock rather
   *  than with setTimeout, so the interval is exact even on a frame that takes 40ms. */
  delay?: number
  /** Attack, in seconds. Percussive layers leave this at its default millisecond; anything meant to swell
   *  rather than strike asks for more. */
  attack?: number
  /** How much goes to the shared room, 0..1. */
  send?: number
}

function tone({
  freq,
  toFreq,
  duration,
  type = 'sine',
  gain = 0.2,
  delay = 0,
  attack = 0.001,
  send = 0,
}: ToneOpts): void {
  const ac = ensureCtx()
  if (!ac || !bus) return
  const now = ac.currentTime + delay
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  if (toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), now + duration)
  }
  g.gain.setValueAtTime(0.0001, now)
  // Linear, not exponential, for the attack. An exponential ramp from near-silence spends most of its time
  // quiet, which is a fade-in however short it is set to.
  g.gain.linearRampToValueAtTime(gain, now + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.connect(g)
  route(g, send)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

interface NoiseOpts {
  duration: number
  gain?: number
  /** Lowpass, swept from `cutoff` to `sweepTo` across the burst. */
  cutoff?: number
  sweepTo?: number
  /** Highpass, for a crack layer: everything below this is thrown away, which is what leaves only the bite. */
  highpass?: number
  /** Decay curve exponent. Above 1 the energy piles up at the front, which is what a transient is; 1 is a
   *  linear fade and sounds like a rumble. */
  shape?: number
  send?: number
  delay?: number
}

function noiseBurst({
  duration,
  gain = 0.25,
  cutoff = 900,
  sweepTo = cutoff,
  highpass = 0,
  shape = 2.4,
  send = 0,
  delay = 0,
}: NoiseOpts): void {
  const ac = ensureCtx()
  if (!ac || !bus) return
  const now = ac.currentTime + delay
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration))
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  // Shaped on the way in rather than by an envelope, so the decay is inside the sample and there is one fewer
  // node per hit — these fire dozens at a time.
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, shape)
  }

  const src = ac.createBufferSource()
  src.buffer = buffer
  let node: AudioNode = src

  const low = ac.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(cutoff, now)
  if (sweepTo !== cutoff) {
    low.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), now + duration)
  }
  node = node.connect(low)

  if (highpass > 0) {
    const high = ac.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = highpass
    node = node.connect(high)
  }

  const g = ac.createGain()
  // Straight to full gain: the sample already carries its own decay, so any ramp here would be an attack that
  // should not exist.
  g.gain.setValueAtTime(gain, now)
  node.connect(g)
  route(g, send)
  src.start(now)
  src.stop(now + duration + 0.02)
}

/**
 * The crack at the front of an impact.
 *
 * Fourteen milliseconds of noise with everything below 2kHz thrown away. On its own it is a tick you would
 * barely notice; layered under the body of an explosion it is the entire difference between a hit that lands and
 * one that does not, and it is what the first two versions of these sounds were missing.
 */
function click(gain: number, send = 0): void {
  noiseBurst({ duration: 0.014, gain, cutoff: 16_000, highpass: 2200, shape: 1.4, send })
}

const Sfx: Record<SoundCue, () => void> = {
  // Short, bright, and pitched *down* rather than up. An upward blip on every shot at eleven a second reads as
  // an alarm; a downward one sits under the music and disappears into the texture, which is what a weapon you
  // fire continuously has to do. Almost no reverb: eleven wet shots a second is a wash, not a gun.
  shoot: () => tone({ freq: 1300, toFreq: 420, duration: 0.05, type: 'square', gain: 0.05, send: 0.04 }),

  // Three layers and a room. The click is the impact, the noise is the debris, the sine is the weight.
  kill: () => {
    click(0.3, 0.2)
    noiseBurst({ duration: 0.2, gain: 0.34, cutoff: 7000, sweepTo: 380, shape: 2.6, send: 0.22 })
    tone({ freq: 300, toFreq: 46, duration: 0.17, type: 'sine', gain: 0.4, send: 0.18 })
  },

  // The same shape a class heavier: a harder crack, a longer and darker tail, a saw for the grinding, and a sub
  // that goes lower than anything short of a bomb.
  rockBreak: () => {
    click(0.4, 0.28)
    noiseBurst({ duration: 0.42, gain: 0.4, cutoff: 5200, sweepTo: 150, shape: 2.2, send: 0.34 })
    tone({ freq: 190, toFreq: 38, duration: 0.34, type: 'sawtooth', gain: 0.26, send: 0.24 })
    tone({ freq: 110, toFreq: 28, duration: 0.5, type: 'sine', gain: 0.42, send: 0.2 })
  },

  pickup: () => tone({ freq: 900, toFreq: 1500, duration: 0.06, type: 'triangle', gain: 0.07, send: 0.14 }),

  // The multiplier stepping is the only piece of good news the game gives you mid-wave, so it gets an interval
  // rather than a blip — a rising fourth, which reads as "up" at any pitch.
  multiplierUp: () => {
    tone({ freq: 880, duration: 0.07, type: 'triangle', gain: 0.09, attack: 0.004, send: 0.3 })
    tone({ freq: 1174, duration: 0.12, type: 'triangle', gain: 0.09, attack: 0.004, delay: 0.06, send: 0.3 })
  },

  bomb: () => {
    click(0.5, 0.5)
    noiseBurst({ duration: 1.1, gain: 0.42, cutoff: 9000, sweepTo: 60, shape: 1.8, send: 0.5 })
    // Two sines an octave apart rather than one. A single sub sweep is inaudible on a laptop speaker, which is
    // exactly the machine most people will play this on — the upper one carries the shape where there is no
    // bottom end to reproduce, and adds body where there is.
    tone({ freq: 130, toFreq: 24, duration: 1.2, type: 'sine', gain: 0.5, send: 0.3 })
    tone({ freq: 62, toFreq: 19, duration: 1.4, type: 'sine', gain: 0.44, send: 0.2 })
    tone({ freq: 380, toFreq: 44, duration: 0.7, type: 'sawtooth', gain: 0.2, send: 0.4 })
  },

  wellBurst: () => tone({ freq: 330, toFreq: 150, duration: 0.14, type: 'sawtooth', gain: 0.09, send: 0.24 }),

  // Rising, then a drop. A collapse that only falls sounds like a failure; the lift before it is what makes it
  // sound like something being paid out. The wettest thing in the game — it is the biggest single event.
  wellCollapse: () => {
    tone({ freq: 200, toFreq: 1700, duration: 0.34, type: 'sawtooth', gain: 0.16, attack: 0.02, send: 0.4 })
    click(0.45, 0.55)
    tone({ freq: 1700, toFreq: 55, duration: 0.8, type: 'square', gain: 0.2, delay: 0.34, send: 0.5 })
    noiseBurst({ duration: 0.8, gain: 0.32, cutoff: 8000, sweepTo: 90, shape: 2, send: 0.55, delay: 0.34 })
  },

  spawn: () =>
    tone({ freq: 240, toFreq: 660, duration: 0.09, type: 'sine', gain: 0.055, attack: 0.006, send: 0.2 }),

  // A hard, dry crack that falls fast. It has to cut through a busy arena from across it — a shot you did not
  // hear leave is a shot you did not know to dodge — so it is bright and short rather than loud, and drier than
  // anything else here so that it reads as *near* even when the thing that fired it is not.
  snipe: () => {
    click(0.26, 0.06)
    tone({ freq: 1600, toFreq: 260, duration: 0.12, type: 'square', gain: 0.14, send: 0.08 })
  },

  death: () => {
    click(0.4, 0.5)
    tone({ freq: 440, toFreq: 34, duration: 1.3, type: 'sawtooth', gain: 0.3, send: 0.45 })
    tone({ freq: 90, toFreq: 22, duration: 1.5, type: 'sine', gain: 0.4, send: 0.2 })
    noiseBurst({ duration: 0.9, gain: 0.3, cutoff: 6000, sweepTo: 80, shape: 2, send: 0.5 })
  },

  extraLife: () => {
    tone({ freq: 660, duration: 0.1, type: 'triangle', gain: 0.13, attack: 0.004, send: 0.35 })
    tone({ freq: 990, duration: 0.1, type: 'triangle', gain: 0.13, attack: 0.004, delay: 0.09, send: 0.35 })
    tone({ freq: 1320, duration: 0.24, type: 'triangle', gain: 0.13, attack: 0.004, delay: 0.18, send: 0.4 })
  },

  /**
   * A tritone, struck as a dyad.
   *
   * It was a rising fifth played as two notes — the most consonant interval there is, which says "well done,
   * that is over". A tritone says something much more useful: it is the one interval that refuses to resolve, so
   * it lands as *you survived, and something worse is coming*, which is exactly what clearing a wave means in a
   * game whose entire structure is escalation.
   *
   * It also rhymes with the soundtrack, which is built on unstable intervals on purpose — Singularity is a minor
   * second, and Defcon, the driftbox preset this game's title music grew out of, is built on the tritone.
   *
   * Both notes at once rather than in sequence, because an interval played one note at a time is a melody and an
   * interval played together is a *colour* — and it is the colour that carries the unease. The octave above
   * arrives a moment later and quietly, so the whole thing rings rather than clangs.
   */
  waveClear: () => {
    tone({ freq: 523.25, duration: 0.55, type: 'triangle', gain: 0.13, attack: 0.006, send: 0.5 })
    tone({ freq: 739.99, duration: 0.55, type: 'triangle', gain: 0.12, attack: 0.006, send: 0.5 })
    tone({ freq: 1046.5, duration: 0.4, type: 'triangle', gain: 0.05, attack: 0.01, delay: 0.1, send: 0.55 })
  },

  gameOver: () => {
    tone({ freq: 280, toFreq: 40, duration: 1.7, type: 'sawtooth', gain: 0.26, attack: 0.01, send: 0.55 })
    tone({ freq: 140, toFreq: 26, duration: 1.9, type: 'sine', gain: 0.3, send: 0.4 })
  },
}

/**
 * Shortest gap between two of the same cue, in seconds.
 *
 * The throttle is not a nicety. A bomb into a full arena kills eighty things on one frame, and eighty
 * overlapping impacts is not eighty times as loud — it is a click, because they sum past full scale and the
 * limiter slams shut. Rate-limiting per cue keeps the texture and costs nothing: the eighty-first kill in the
 * same millisecond carries no information the first one did not.
 *
 * Cues with no entry are unthrottled, which is right for the ones that can only happen once.
 */
const MIN_GAP: Partial<Record<SoundCue, number>> = {
  shoot: 0.05,
  // Longer than it was, and deliberately: the kill sound now has real weight, and thirty of them a second is
  // not thirty times as impressive — it is a wall of mush the limiter then flattens. Fewer and bigger is what
  // reads as powerful.
  kill: 0.055,
  rockBreak: 0.07,
  pickup: 0.03,
  spawn: 0.09,
  wellBurst: 0.1,
  snipe: 0.05,
}

const lastPlayed = new Map<SoundCue, number>()

/** Play one cue, if it has not just played. Everything the simulation emits comes through here — see the drain
 *  in `GameLoop`. */
export function playCue(cue: SoundCue): void {
  const ac = ensureCtx()
  if (!ac) return

  const gap = MIN_GAP[cue]
  if (gap !== undefined) {
    const last = lastPlayed.get(cue) ?? -Infinity
    if (ac.currentTime - last < gap) return
    lastPlayed.set(cue, ac.currentTime)
  }
  Sfx[cue]()
}
