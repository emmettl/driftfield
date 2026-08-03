import { describe, expect, it } from 'vitest'
import { bpmForWave, musicPlan } from './musicCue'

describe('musicPlan', () => {
  it('gives the attract screen the title music at its own tempo', () => {
    expect(musicPlan('menu', 'swarm', 9)).toEqual({ cue: 'vector', wave: 1, duck: false })
  })

  it('hands the wells their own song', () => {
    expect(musicPlan('playing', 'singularity', 5).cue).toBe('singularity')
  })

  it('gives a belt wave the same song as a swarm wave', () => {
    // Two play songs for three modes, deliberately: a belt wave asks the same thing of the player as a
    // swarm wave, and a soundtrack that changed every third wave would never be recognised.
    expect(musicPlan('playing', 'belt', 3).cue).toBe('swarm')
    expect(musicPlan('playing', 'swarm', 4).cue).toBe('swarm')
  })

  it('ducks between waves rather than stopping', () => {
    const plan = musicPlan('wave-clear', 'swarm', 4)
    expect(plan.cue).toBe('swarm')
    expect(plan.duck).toBe(true)
  })

  it('does not duck while respawning', () => {
    // Dying already takes the arena away. Taking the music with it makes the pause feel like a crash.
    expect(musicPlan('respawning', 'swarm', 4).duck).toBe(false)
    expect(musicPlan('respawning', 'swarm', 4).cue).toBe('swarm')
  })

  it('goes silent on a game over, to leave the sweep somewhere to land', () => {
    expect(musicPlan('gameover', 'swarm', 7).cue).toBeNull()
  })

  it('carries the wave through, so the tempo can follow it', () => {
    expect(musicPlan('playing', 'swarm', 11).wave).toBe(11)
  })
})

describe('bpmForWave', () => {
  it('plays wave one exactly as written', () => {
    expect(bpmForWave(148, 1)).toBe(148)
  })

  it('lifts the tempo as the waves climb', () => {
    expect(bpmForWave(148, 5)).toBeGreaterThan(148)
    expect(bpmForWave(148, 9)).toBeGreaterThan(bpmForWave(148, 5))
  })

  it('stops lifting before the patterns stop being themselves', () => {
    const capped = bpmForWave(148, 200)
    expect(capped).toBe(bpmForWave(148, 50))
    expect(capped - 148).toBeLessThanOrEqual(14)
  })

  it('never drops below the song for a nonsense wave', () => {
    expect(bpmForWave(148, 0)).toBe(148)
    expect(bpmForWave(148, -5)).toBe(148)
  })

  it('returns whole numbers, because the transport wants one', () => {
    for (let wave = 1; wave < 30; wave++) {
      expect(Number.isInteger(bpmForWave(162, wave))).toBe(true)
    }
  })
})
