import { useEffect, useState } from 'react'
import { useGameStore } from '../game/useGameStore'
import type { WaveMode } from '../game/types'

// The cards that flash over the arena.
//
// Keyed off the counters the store bumps (`waveBannerId`) rather than off the values themselves, because
// the interesting event is "a wave started" and not "the wave number changed" — those are the same thing
// except on the first wave of a second run, which is exactly the case a value comparison misses.

/** What each wave mode is announced as. The mode is the one thing about a wave a player can act on before
 *  it arrives — a belt wave wants you near the middle, a singularity wave wants you nowhere near it — so
 *  it is worth naming rather than leaving to be inferred from what shows up. */
const MODE_NAME: Record<WaveMode, string> = {
  swarm: 'SWARM',
  belt: 'BELT',
  singularity: 'SINGULARITY',
}

export function WaveBanner() {
  const wave = useGameStore((s) => s.wave)
  const mode = useGameStore((s) => s.waveMode)
  const bannerId = useGameStore((s) => s.waveBannerId)
  const status = useGameStore((s) => s.status)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (bannerId === 0) return
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 1900)
    return () => window.clearTimeout(timer)
  }, [bannerId])

  if (!visible || status === 'menu' || status === 'gameover') return null

  return (
    <div className="banner" key={bannerId}>
      <div className="banner-wave">WAVE {wave}</div>
      <div className={`banner-mode banner-mode-${mode}`}>{MODE_NAME[mode]}</div>
    </div>
  )
}

/**
 * The between-waves card.
 *
 * Driven off the status rather than off a timer, so it is on screen for exactly as long as the world is in
 * `wave-clear` — which is also exactly as long as the music is ducked. One state, both consequences; a
 * separate timer here would drift out of step with the sweep on the mix, and a card that outlasts the duck
 * looks like the game has hung.
 */
export function WaveClear() {
  const status = useGameStore((s) => s.status)
  if (status !== 'wave-clear') return null
  return (
    <div className="banner banner-clear">
      <div className="banner-wave">WAVE CLEAR</div>
    </div>
  )
}

/** The respawn beat. Short, and it says what is about to happen rather than what just did — the player
 *  knows they died. */
export function Respawning() {
  const status = useGameStore((s) => s.status)
  const lives = useGameStore((s) => s.lives)
  if (status !== 'respawning') return null
  return (
    <div className="banner banner-respawn">
      <div className="banner-mode">{lives === 1 ? 'LAST SHIP' : `${lives} SHIPS LEFT`}</div>
    </div>
  )
}
