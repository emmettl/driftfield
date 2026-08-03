import type { DriftboxEngine } from '@driftbox/engine'
import { getAudioContext } from './audio'
import { bpmForWave, type MusicCue, type MusicPlan } from './musicCue'

// The soundtrack, played by @driftbox/engine — a TR-808, a TR-909 and two TB-303s synthesised
// from the circuit topology, the same way the effects in `audio.ts` are. No audio assets, which
// is why a browser game can have a soundtrack at all without a download in front of it.
//
// Everything here is imperative and lives outside React. The state that drives it changes on
// wave boundaries, but the engine is scheduling audio a bar ahead against its own clock and
// must not be torn down and rebuilt because a component re-rendered.

/**
 * Master level for the music, well under the engine's own 0.7 default.
 *
 * The music is a bed and the game is the thing on top of it. A bomb, a well collapsing, or the
 * death sweep has to cut through, and those go through the effects compressor at gains around
 * 0.2. At the engine's default the drums win every exchange and the game sounds like it is
 * happening in the next room.
 */
const MUSIC_GAIN = 0.3

/**
 * Where the performance filter goes while the mix is ducked, as a position on the engine's XY
 * pad: a lowpass around 500Hz with enough resonance that the sweep reads as a move rather than
 * as a mute.
 *
 * Low enough to take the hats and the top of the 303 with it and leave the kick, which is the
 * point — the seconds between waves should sound like the record is still playing behind a
 * door, not like somebody reached for the volume.
 */
const DUCK_X = 0.16
const DUCK_Y = 0.18

type EngineModule = typeof import('@driftbox/engine')
type SongsModule = typeof import('../songs')

/**
 * The module loads, kept as the latch so concurrent callers all wait on the same import.
 *
 * Both are dynamic, and both have to be: the songs import the engine at the top level, so a
 * static import of the song list would drag the whole drum machine into the initial bundle and
 * the first thing a browser parsed on the way to the title screen would be a synthesiser that
 * may never be unmuted. Resolving null rather than rejecting means a browser that cannot load
 * them still gets a game.
 */
let loading: Promise<{ engine: EngineModule; songs: SongsModule } | null> | null = null

function modules(): Promise<{ engine: EngineModule; songs: SongsModule } | null> {
  loading ??= Promise.all([import('@driftbox/engine'), import('../songs')])
    .then(([engine, songs]) => ({ engine, songs }))
    .catch(() => null)
  return loading
}

let engine: DriftboxEngine | null = null
/** What is actually playing, as opposed to what has been asked for. */
let playing: MusicCue = null
/** The song's own tempo, kept so a wave change can re-derive the lift. `engine.bpm` is the
 *  lifted value already, and deriving the next lift from it would compound. */
let baseBpm = 0

let wanted: MusicPlan = { cue: null, wave: 1, duck: false }
let enabled = true
let ducked = false

/** Serialises applies. Two cue changes a frame apart must not both build a song and race to
 *  assign it — the loser would leave `playing` naming the song that is not playing. */
let settling: Promise<void> = Promise.resolve()

async function settle(): Promise<void> {
  // Silence is answerable without loading anything, which matters on the attract screen of a
  // machine whose owner has the sound off.
  if (!enabled || wanted.cue === null) {
    if (engine?.running) {
      engine.stop()
      engine.silenceTails()
    }
    playing = null
    return
  }

  const mod = await modules()
  if (!mod) return

  // The plan may have moved on while the modules were loading — a player who hits START before
  // the first bar is scheduled is the normal case, not the edge one.
  const plan = wanted
  if (!enabled || plan.cue === null) return

  if (!engine || playing !== plan.cue) {
    const song = mod.songs.songById(plan.cue)
    if (!song) return

    if (!engine) {
      const ctx = getAudioContext()
      if (!ctx) return
      try {
        engine = new mod.engine.DriftboxEngine(song.build(), { context: ctx, gain: MUSIC_GAIN })
      } catch {
        return
      }
      // The engine ships its analyser at 0.75 smoothing, which is right for drawing a waveform and wrong for
      // detecting a transient: three quarters of every reading is the previous one, so a kick's attack arrives
      // spread over a dozen frames and the arena's pulse becomes a slow swell. Lowered here rather than in the
      // engine because this is a property of what *this* game wants from it — the sequencer's oscilloscope is
      // still better off smooth. See `beat.ts`.
      engine.analyser.smoothingTimeConstant = 0.25
    } else {
      // A replaced record must not still be audible over the one that replaced it. A stopped
      // one is allowed to ring out, which is why this is not part of `stop()`.
      if (engine.running) engine.silenceTails()
      engine.song = song.build()
    }

    baseBpm = engine.song.bpm
    playing = plan.cue
  }

  // Assigning `song` does not move the transport, and the delay is tempo-synced — so the tempo
  // goes through the engine even on the bars where it has not changed.
  engine.bpm = bpmForWave(baseBpm, plan.wave)

  if (ducked !== plan.duck) {
    if (plan.duck) engine.kaoss.set(DUCK_X, DUCK_Y, 0.09)
    else engine.kaoss.release(0.25)
    ducked = plan.duck
  }

  if (!engine.running) await engine.start()
}

function apply(): void {
  // Failures are swallowed rather than chained onto: one cue that could not be honoured must
  // not poison every cue after it.
  settling = settling.then(settle, () => {})
}

/** Point the soundtrack at a plan. Idempotent — this is called on every store change, and
 *  doing nothing because nothing moved is the common path. */
export function setMusicPlan(plan: MusicPlan): void {
  if (plan.cue === wanted.cue && plan.wave === wanted.wave && plan.duck === wanted.duck) return
  wanted = plan
  apply()
}

/** Follow the sound toggle. Off stops the transport rather than turning the gain down: the
 *  engine schedules voices a bar ahead and there is no reason to pay for silence. */
export function setMusicEnabled(on: boolean): void {
  if (enabled === on) return
  enabled = on
  apply()
}

/**
 * Have another go at whatever the current plan asks for.
 *
 * For the interruption watchdog. `settle` is idempotent, so on a transport that is already
 * running this costs a comparison — but if a start failed because the context was interrupted
 * at the time, nothing else would ever retry it: the plan has not changed, so no cue change is
 * coming to notice.
 */
export function retryMusic(): void {
  apply()
}

/** The engine's analyser, for anything that wants to draw the music. Null until the first
 *  song has actually been built, which is why callers poll it rather than being handed it. */
export function musicAnalyser(): AnalyserNode | null {
  return engine?.analyser ?? null
}

/** Drop the soundtrack for good. */
export function disposeMusic(): void {
  engine?.dispose()
  engine = null
  playing = null
  ducked = false
  baseBpm = 0
}

// Without this, editing anything the module graph reaches leaves the previous engine playing
// and starts a second one over the top of it — two transports, drifting, and no way back short
// of a reload.
import.meta.hot?.dispose(disposeMusic)
