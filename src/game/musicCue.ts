import type { SongId } from '../songs'
import type { GameStatus, WaveMode } from './types'

// What the soundtrack should be doing, as a pure function of game state.
//
// Separated from the engine that plays it for the same reason the rest of `src/game` is
// separated from the renderer: "a singularity wave gets the semitone one" is a decision worth
// pinning in a test, and it is only testable at all if deciding it never touches an
// AudioContext.

/** A song id, or null for silence. */
export type MusicCue = SongId | null

export interface MusicPlan {
  cue: MusicCue
  /**
   * The wave the tempo lift is taken from. 1 on the attract screen, which has no wave — so
   * the title music always plays at the tempo it was written at.
   */
  wave: number
  /** Sweep the mix shut, under the wave-cleared card. */
  duck: boolean
}

/**
 * The song each part of the game gets.
 *
 * Two play songs for three wave modes, which is deliberate rather than unfinished. A belt wave
 * is a swarm wave with the furniture rearranged — same threat, same speed, same thing being
 * asked of the player — and giving it its own song would mean a soundtrack that changes every
 * third wave and is therefore never around long enough to be recognised. A singularity wave
 * is a genuinely different game, and it is the only one that earns a handover.
 */
export function musicPlan(status: GameStatus, waveMode: WaveMode, wave: number): MusicPlan {
  if (status === 'menu') return { cue: 'vector', wave: 1, duck: false }

  // Silence, deliberately. The death sweep needs somewhere to land, and the attract screen
  // brings the title music back on its own a few seconds later.
  if (status === 'gameover') return { cue: null, wave, duck: false }

  const cue: MusicCue = waveMode === 'singularity' ? 'singularity' : 'swarm'

  // 'wave-clear' keeps the wave's own song playing and ducks it instead of stopping it — the
  // couple of seconds before the next wave are a breath in the same track, not a gap.
  //
  // 'respawning' does not duck. Dying already takes the arena away; taking the music with it
  // makes the pause feel like a crash, and the song coming back is the cue that you are about
  // to be in control again.
  return { cue, wave, duck: status === 'wave-clear' }
}

/** Most a wave can add to a song's own tempo. Past about this the patterns stop being the
 *  thing they were written as and start being the same thing played too fast. */
const MAX_LIFT = 14
const LIFT_PER_WAVE = 1.6

/**
 * The tempo a song plays at on a given wave: its own, nudged up as the game gets harder and
 * then held there. Wave 1 is always the song exactly as written.
 *
 * The lift is the whole reason the soundtrack does not need more songs than it has. Swarm at
 * 148 and Swarm at 162 are recognisably the same record and unmistakably different situations,
 * which is a better use of fourteen beats a minute than a fourth arrangement would be.
 */
export function bpmForWave(base: number, wave: number): number {
  return Math.round(base + Math.min(MAX_LIFT, Math.max(0, wave - 1) * LIFT_PER_WAVE))
}
