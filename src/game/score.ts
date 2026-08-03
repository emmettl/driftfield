import { ENEMY, GEOM, SCORE, rockTier } from './constants'
import type { Enemy } from './types'

// Scoring, the multiplier, and what the score buys you.
//
// Its own file, and pure, because scoring is where a shooter's economy lives and the
// economy is the thing most worth being able to reason about: whether a run can farm lives
// faster than it spends them is a question with an answer, and the answer should not
// require playing for twenty minutes to find out.

/** The slice of the world this file touches. A structural subset of `World`, so the world
 *  can be passed straight in without anything being copied or wrapped. */
export interface ScoreState {
  score: number
  multiplier: number
  geomsHeld: number
  lives: number
  bombs: number
  nextExtraLife: number
}

/** What an enemy is worth, before the multiplier. Rocks are worth more as they get
 *  smaller, so breaking one up is a bet rather than a chore. */
export function scoreForEnemy(enemy: Enemy): number {
  if (enemy.kind === 'rock') return rockTier(enemy.tier).score
  return ENEMY[enemy.kind].score
}

/**
 * Add points, and hand out whatever they earned.
 *
 * Both awards are decided by *crossing a boundary* rather than by a running counter, which
 * matters because points arrive in multiplied lumps: a x40 kill can be worth 200,000 and
 * must give you two bombs, not one. A counter that only ever checks "am I past the next
 * threshold" quietly swallows the second.
 */
export function addPoints(state: ScoreState, base: number): { lives: number; bombs: number } {
  const before = state.score
  state.score += base * state.multiplier

  let lives = 0
  while (state.score >= state.nextExtraLife) {
    lives++
    state.lives++
    // The gap widens each time, so lives do not compound into an unloseable run.
    state.nextExtraLife += SCORE.extraLifeStep
  }

  const bombs =
    Math.floor(state.score / SCORE.bombEvery) - Math.floor(before / SCORE.bombEvery)
  state.bombs += bombs

  return { lives, bombs }
}

/**
 * Collect one geom. Returns true if the multiplier stepped.
 *
 * Four geoms per step rather than one, which is the difference between a multiplier that
 * climbs to x100 in a wave and one that has to be worked for across a run. The cap is
 * there so the arithmetic stays inside a comfortable integer range even in a long game —
 * x100 on a well is 150,000 points, and there is no interesting play beyond that.
 */
export function collectGeom(state: ScoreState): boolean {
  state.geomsHeld++
  if (state.geomsHeld < GEOM.perMultiplier) return false
  state.geomsHeld = 0
  if (state.multiplier >= GEOM.maxMultiplier) return false
  state.multiplier++
  return true
}

/**
 * What dying costs.
 *
 * The multiplier goes with the life. It is the harshest rule in the game and it is the one
 * that makes the game a game: with the multiplier kept, death is a minor inconvenience and
 * the optimal play is to trade lives for position. Losing it means a good run is a *long*
 * run, which is the only score anybody remembers.
 */
export function loseLife(state: ScoreState): void {
  state.lives = Math.max(0, state.lives - 1)
  state.multiplier = 1
  state.geomsHeld = 0
}

/** A fresh economy, for the start of a run. */
export function freshScore(): ScoreState {
  return {
    score: 0,
    multiplier: 1,
    geomsHeld: 0,
    lives: SCORE.startLives,
    bombs: 0,
    nextExtraLife: SCORE.firstExtraLife,
  }
}
