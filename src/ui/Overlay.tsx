import { useEffect } from 'react'
import { isTouch } from '../game/device'
import { useGameStore } from '../game/useGameStore'

// The title screen and the game-over card.
//
// Both are the same component because they are the same moment from the player's point of view: the game
// is not running and there is one thing to do about it. The arena behind them is live in both cases — the
// attract screen is the real simulation with nobody flying (see `stepAttract`), which is why the overlay
// is transparent and sits over it rather than replacing it.

export function Overlay() {
  const status = useGameStore((s) => s.status)
  const score = useGameStore((s) => s.score)
  const highScore = useGameStore((s) => s.highScore)
  const start = useGameStore((s) => s.start)

  const idle = status === 'menu' || status === 'gameover'

  // Start on any key or click, not just the button. An arcade game asks to be started by whatever is
  // under your hand, and the button is there for a first-time player who does not know that yet.
  useEffect(() => {
    if (!idle) return
    const onKey = (event: KeyboardEvent) => {
      // Not on tab or a modifier — those are somebody navigating the page, and starting a game because
      // they pressed tab would take the focus away from whatever they were reaching for.
      if (event.key === 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return
      event.preventDefault()
      start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idle, start])

  if (!idle) return null

  const beaten = status === 'gameover' && score >= highScore && score > 0

  return (
    <div className="overlay" onPointerDown={start}>
      {status === 'menu' ? (
        <div className="overlay-card">
          <h1 className="overlay-title">DRIFTFIELD</h1>
          <p className="overlay-tagline">Neon geometry, in a fluid.</p>
          <div className="overlay-controls">
            {isTouch ? (
              <>
                <p>
                  <strong>LEFT STICK</strong> move
                </p>
                <p>
                  <strong>RIGHT STICK</strong> aim &amp; fire
                </p>
                {/* Where the bomb is depends on the arrangement — between the sticks in a band, under the move stick
                    on rails (see `TouchRail`) — so it is described by what it looks like rather than by where it is.
                    An instruction that points at the wrong corner of the screen is worse than no instruction. */}
                <p>
                  <strong>BOMB</strong> the gold button
                </p>
                <p className="overlay-dim">Move and aim are independent — that is the game.</p>
              </>
            ) : (
              <>
                <p>
                  <strong>WASD</strong> move
                </p>
                <p>
                  <strong>MOUSE</strong> aim &amp; hold to fire
                </p>
                <p>
                  <strong>ARROWS</strong> aim and fire, if you prefer
                </p>
                <p>
                  <strong>SHIFT / SPACE</strong> bomb
                </p>
                <p className="overlay-dim">A gamepad works too — both sticks.</p>
              </>
            )}
          </div>
          <button type="button" className="overlay-start">
            PRESS ANYTHING TO START
          </button>
        </div>
      ) : (
        <div className="overlay-card">
          <h1 className="overlay-title overlay-over">GAME OVER</h1>
          <div className="overlay-score">{score.toLocaleString('en-GB')}</div>
          {beaten ? <p className="overlay-best">NEW BEST</p> : <p className="overlay-dim">BEST {highScore.toLocaleString('en-GB')}</p>}
          <button type="button" className="overlay-start">
            AGAIN
          </button>
        </div>
      )}
    </div>
  )
}
