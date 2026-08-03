import { useEffect, useState } from 'react'
import { unlockAudio } from './audio'
import { setMusicEnabled, setMusicPlan } from './music'
import { musicPlan } from './musicCue'
import { useGameStore } from './useGameStore'

/**
 * Keep the soundtrack pointed at whatever the game is doing.
 *
 * Mounted once, at the top of the app. It reads the four bits of state the music cares about
 * and nothing else, so a wave's worth of enemies moving does not re-run it.
 */
export function useMusic(): void {
  const status = useGameStore((s) => s.status)
  const waveMode = useGameStore((s) => s.waveMode)
  const wave = useGameStore((s) => s.wave)
  const soundOn = useGameStore((s) => s.soundOn)

  // Nothing may make a sound until the page has been interacted with, and an AudioContext built
  // before that starts suspended and stays that way. So the music waits for the first gesture
  // anywhere rather than for the START button specifically — the attract screen then has its own
  // music from the first click, whatever was clicked.
  const [unlocked, setUnlocked] = useState(false)
  useEffect(() => {
    if (unlocked) return
    const onGesture = () => {
      unlockAudio()
      setUnlocked(true)
    }
    window.addEventListener('pointerdown', onGesture, { once: true })
    window.addEventListener('keydown', onGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [unlocked])

  // The transport runs off a Worker so that a background tab cannot make the beat stutter —
  // which also means it keeps playing in a tab nobody is looking at. A game whose music follows
  // you to another tab is a game people mute once and for good.
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    setMusicEnabled(soundOn && unlocked && visible)
  }, [soundOn, unlocked, visible])

  useEffect(() => {
    setMusicPlan(musicPlan(status, waveMode, wave))
  }, [status, waveMode, wave])
}
