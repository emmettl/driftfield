import type { Song } from '@driftbox/engine'
import { singularitySong } from './singularity'
import { swarmSong } from './swarm'
import { vectorSong } from './vector'

// The soundtrack: three songs, written for this game, played by `@driftbox/engine`.
//
// They live here rather than in the engine's own `SONGS`, and that is worth explaining because the engine does
// ship a set of its own and one of them — Light Cycles — is electro for a neon grid and would not be a silly
// choice. Two reasons it is the wrong one:
//
// The engine's songs are written to be *listened to*. They have long intros, sections that
// drop to nothing, and arrangements that arrive somewhere after ninety seconds. Under a
// shooter that is a soundtrack which is thin exactly when the arena is worst, because the two
// are not related. These three are written the other way round: the arrangement is dense in
// the middle, has no intro to speak of, and every section is long enough to be survived.
//
// And a song here can be tuned against the game. Swarm has no sub because the bomb owns the
// bottom end; Singularity hands the kick over to the 808 because that is the audible tell
// that the wave has changed. Neither decision makes sense for a song in a drum machine, and
// making them in the engine would be pushing game design into a library.
//
// The engine's presets remain available and are worth reaching for on a whim — `songPresetById`
// takes any of their ids. Nothing here forecloses that.

export interface GameSong {
  id: SongId
  /** Shown nowhere yet. Kept because a song without a name is hard to talk about, and the
   *  sound test that will eventually want it should not have to invent one. */
  name: string
  build: () => Song
}

export type SongId = 'vector' | 'swarm' | 'singularity'

export const SONGS: GameSong[] = [
  { id: 'vector', name: 'Vector Lock', build: vectorSong },
  { id: 'swarm', name: 'Swarm', build: swarmSong },
  { id: 'singularity', name: 'Singularity', build: singularitySong },
]

export function songById(id: SongId): GameSong | undefined {
  return SONGS.find((song) => song.id === id)
}

export { singularitySong, swarmSong, vectorSong }
