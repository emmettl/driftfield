import { describe, expect, it } from 'vitest'
import { ENEMY, GEOM, SCORE, rockTier } from './constants'
import { addPoints, collectGeom, freshScore, loseLife, scoreForEnemy } from './score'
import { makeRock } from './enemies'
import { mulberry32 } from './rng'

const rng = mulberry32(5)

describe('addPoints', () => {
  it('multiplies', () => {
    const state = freshScore()
    state.multiplier = 7
    addPoints(state, 100)
    expect(state.score).toBe(700)
  })

  it('awards an extra life on crossing the threshold', () => {
    const state = freshScore()
    const result = addPoints(state, SCORE.firstExtraLife)
    expect(result.lives).toBe(1)
    expect(state.lives).toBe(SCORE.startLives + 1)
  })

  it('awards two lives when one lump crosses two thresholds', () => {
    // The bug this exists for: points arrive multiplied, so a ×40 kill on a well can be worth several
    // hundred thousand. A check that only asks "am I past the next threshold" swallows every award but
    // the first, and the player is quietly cheated at exactly their best moment.
    const state = freshScore()
    const two = SCORE.firstExtraLife + SCORE.extraLifeStep
    const result = addPoints(state, two)
    expect(result.lives).toBe(2)
    expect(state.lives).toBe(SCORE.startLives + 2)
  })

  it('widens the gap between extra lives', () => {
    const state = freshScore()
    addPoints(state, SCORE.firstExtraLife)
    expect(state.nextExtraLife).toBe(SCORE.firstExtraLife + SCORE.extraLifeStep)
  })

  it('awards a bomb per hundred thousand, including several at once', () => {
    const state = freshScore()
    expect(addPoints(state, SCORE.bombEvery).bombs).toBe(1)
    expect(addPoints(state, SCORE.bombEvery * 3).bombs).toBe(3)
    expect(state.bombs).toBe(4)
  })

  it('does not award a bomb for points that stay inside one band', () => {
    const state = freshScore()
    addPoints(state, 10)
    expect(addPoints(state, 10).bombs).toBe(0)
  })
})

describe('collectGeom', () => {
  it('steps the multiplier every fourth geom', () => {
    const state = freshScore()
    for (let i = 0; i < GEOM.perMultiplier - 1; i++) expect(collectGeom(state)).toBe(false)
    expect(collectGeom(state)).toBe(true)
    expect(state.multiplier).toBe(2)
    expect(state.geomsHeld).toBe(0)
  })

  it('stops at the cap', () => {
    const state = freshScore()
    state.multiplier = GEOM.maxMultiplier
    for (let i = 0; i < GEOM.perMultiplier * 3; i++) collectGeom(state)
    expect(state.multiplier).toBe(GEOM.maxMultiplier)
  })
})

describe('loseLife', () => {
  it('takes the multiplier with the life', () => {
    // The harshest rule in the game and the one that makes it a game: with the multiplier kept, the
    // optimal play is to trade lives for position.
    const state = freshScore()
    state.multiplier = 32
    state.geomsHeld = 3
    loseLife(state)
    expect(state.lives).toBe(SCORE.startLives - 1)
    expect(state.multiplier).toBe(1)
    expect(state.geomsHeld).toBe(0)
  })

  it('never goes below zero lives', () => {
    const state = freshScore()
    state.lives = 0
    loseLife(state)
    expect(state.lives).toBe(0)
  })
})

describe('scoreForEnemy', () => {
  it('pays more for a smaller rock', () => {
    // The Asteroids bargain: breaking one up is a bet, so the pieces have to be worth more than the
    // whole was.
    const big = makeRock(1, 0, 0, 2, rng)
    const small = makeRock(2, 0, 0, 0, rng)
    expect(scoreForEnemy(small)).toBeGreaterThan(scoreForEnemy(big))
    expect(scoreForEnemy(big)).toBe(rockTier(2).score)
  })

  it('uses the kind table for everything else', () => {
    const drifter = { kind: 'drifter', tier: 0 } as never
    expect(scoreForEnemy(drifter)).toBe(ENEMY.drifter.score)
  })

  it('pays most for a well', () => {
    const well = { kind: 'well', tier: 0 } as never
    for (const kind of ['drifter', 'wanderer', 'weaver', 'snake'] as const) {
      expect(scoreForEnemy(well)).toBeGreaterThan(ENEMY[kind].score)
    }
  })
})
