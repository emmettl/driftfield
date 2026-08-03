import { create } from 'zustand'
import { clearFlashes } from '../render/flashes'
import { resetShake } from './shake'
import type { GameStatus, WaveMode, World } from './types'
import { freshWorld, returnToAttract, startRun } from './world'

// The store, which is deliberately not the world.
//
// The world — a few hundred enemies, their bullets and their geoms, all of it changing every
// frame — lives in a module-level object and is read directly by the components that draw it.
// The store holds the handful of scalars a human reads off the screen, and is written to only
// when one of them actually changes. That split is the difference between a React tree that
// re-renders when the score does and one that re-renders sixty times a second to say nothing.
//
// It is also why there is no `useFrame`-driven state in here at all: the game loop mutates the
// world and then calls `publishHud`, which is a no-op on most frames.

/**
 * The world. One per page, for the life of the page.
 *
 * A module singleton rather than a ref in a provider, because the alternative is threading it
 * through every instanced mesh and every effect hook — and because there is genuinely only
 * ever one. `startRun` mutates it in place rather than replacing it, so the references the
 * renderer took at mount stay valid across a restart.
 */
const world: World = freshWorld()

export function getWorld(): World {
  return world
}

const STORAGE_KEY = 'driftfield.best'

// Guarded so the store is usable under vitest and any future SSR, where there is no window.
const persistent: Storage | null =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
    ? window.localStorage
    : null

function loadHighScore(): number {
  const raw = persistent?.getItem(STORAGE_KEY)
  const value = raw === null || raw === undefined ? NaN : Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 0
}

interface GameState {
  status: GameStatus
  score: number
  highScore: number
  multiplier: number
  lives: number
  bombs: number
  wave: number
  waveMode: WaveMode
  soundOn: boolean
  /** Bumped when a wave begins, so the banner re-triggers even on a wave number the player
   *  has already seen — which happens on every new run. */
  waveBannerId: number
  /** Bumped on a game over, for the same reason. */
  gameOverId: number

  start: () => void
  attract: () => void
  toggleSound: () => void
  publishHud: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  status: 'menu',
  score: 0,
  highScore: loadHighScore(),
  multiplier: 1,
  lives: 3,
  bombs: 0,
  wave: 1,
  waveMode: 'swarm',
  soundOn: true,
  waveBannerId: 0,
  gameOverId: 0,

  start: () => {
    startRun(world)
    resetShake()
    clearFlashes()
    set({
      status: 'playing',
      score: 0,
      multiplier: 1,
      lives: world.lives,
      bombs: world.bombs,
      wave: 1,
      waveMode: world.waveMode,
      waveBannerId: get().waveBannerId + 1,
    })
  },

  attract: () => {
    returnToAttract(world)
    resetShake()
    clearFlashes()
    set({ status: 'menu', wave: 1, waveMode: world.waveMode })
  },

  toggleSound: () => set({ soundOn: !get().soundOn }),

  /**
   * Mirror whatever the world has become, if it has become anything.
   *
   * Called once per frame from the game loop. Every field is compared before being written:
   * zustand notifies on every `set` regardless of whether the value differs, so an
   * unconditional publish here would re-render the HUD on every frame of the game and undo
   * the whole reason the world is not in the store.
   */
  publishHud: () => {
    const state = get()
    const patch: Partial<GameState> = {}

    if (state.score !== world.score) patch.score = world.score
    if (state.multiplier !== world.multiplier) patch.multiplier = world.multiplier
    if (state.lives !== world.lives) patch.lives = world.lives
    if (state.bombs !== world.bombs) patch.bombs = world.bombs
    if (state.waveMode !== world.waveMode) patch.waveMode = world.waveMode

    if (state.wave !== world.wave) {
      patch.wave = world.wave
      patch.waveBannerId = state.waveBannerId + 1
    }

    if (state.status !== world.status) {
      patch.status = world.status
      if (world.status === 'gameover') {
        patch.gameOverId = state.gameOverId + 1
        if (world.score > state.highScore) {
          patch.highScore = world.score
          persistent?.setItem(STORAGE_KEY, String(world.score))
        }
      }
    }

    if (Object.keys(patch).length > 0) set(patch)
  },
}))
