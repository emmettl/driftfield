import { isTouch } from '../game/device'
import { useGameStore } from '../game/useGameStore'

// The readouts.
//
// Every value here comes from the store, and the store is only written when one of them changes (see
// `publishHud`) — so this component re-renders when the score does, not when the arena does. That is the
// entire reason the world is not in the store.
//
// Two layouts, and the difference is not cosmetic.
//
// On a **desktop** the HUD sits in the four corners of the window, and the arena is inset from those corners by
// whatever margin its shape leaves — so the readouts are next to the playfield rather than on it.
//
// On **touch** there is no such margin: the stage *is* the arena (see `layout.ts`), so a corner of the stage is a
// corner of the playfield. The four-corner layout put "SHIPS ▲▲▲" on the grid a couple of centimetres from where
// the ship spends most of its life. So everything collapses into a single row along the top edge, which is the one
// band of the arena a player is rarely flying through — and the bottom, where they are, stays clear.

export function Hud() {
  const status = useGameStore((s) => s.status)
  const score = useGameStore((s) => s.score)
  const highScore = useGameStore((s) => s.highScore)
  const multiplier = useGameStore((s) => s.multiplier)
  const lives = useGameStore((s) => s.lives)
  const bombs = useGameStore((s) => s.bombs)
  const wave = useGameStore((s) => s.wave)
  const soundOn = useGameStore((s) => s.soundOn)
  const toggleSound = useGameStore((s) => s.toggleSound)

  // Hidden on the attract screen, where there is nothing to report and the title needs the space.
  const playing = status !== 'menu'

  const ships = '▲'.repeat(Math.max(0, Math.min(9, lives)))
  const bombPips = bombs > 0 ? '◈'.repeat(Math.min(9, bombs)) : '—'

  if (isTouch) {
    return (
      <div className="hud hud-compact">
        <div className="hud-strip">
          {playing ? (
            <>
              <span className="hud-score">{score.toLocaleString('en-GB')}</span>
              <span className={multiplier > 8 ? 'hud-multiplier hud-multiplier-hot' : 'hud-multiplier'}>
                ×{multiplier}
              </span>
              <span className="hud-pips">{ships}</span>
              <span className="hud-pips hud-pips-bomb">{bombPips}</span>
              <span className="hud-label">W{wave}</span>
            </>
          ) : (
            <span className="hud-label">BEST {highScore.toLocaleString('en-GB')}</span>
          )}
          <button
            type="button"
            className="hud-sound"
            onClick={toggleSound}
            aria-label={soundOn ? 'Mute' : 'Unmute'}
          >
            {soundOn ? '♪' : '✕'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="hud">
      <div className="hud-corner hud-top-left">
        {playing ? (
          <>
            <div className="hud-score">{score.toLocaleString('en-GB')}</div>
            {/* The multiplier is the only number that grows visibly during a wave, so it is the only one
                that gets to change size. Above ×8 it is doing something worth protecting, and the class
                switch is what tells the player that. */}
            <div className={multiplier > 8 ? 'hud-multiplier hud-multiplier-hot' : 'hud-multiplier'}>
              ×{multiplier}
            </div>
          </>
        ) : null}
      </div>

      <div className="hud-corner hud-top-right">
        <div className="hud-label">BEST</div>
        <div className="hud-best">{highScore.toLocaleString('en-GB')}</div>
        <button
          type="button"
          className="hud-sound"
          onClick={toggleSound}
          aria-label={soundOn ? 'Mute' : 'Unmute'}
        >
          {soundOn ? 'SOUND ON' : 'SOUND OFF'}
        </button>
      </div>

      {playing ? (
        <>
          <div className="hud-corner hud-bottom-left">
            <div className="hud-row">
              <span className="hud-label">SHIPS</span>
              {/* Drawn as glyphs rather than as a number. A count of lives is something to be seen
                  rather than read — losing one should register in peripheral vision. */}
              <span className="hud-pips">{ships}</span>
            </div>
            <div className="hud-row">
              <span className="hud-label">BOMBS</span>
              <span className="hud-pips hud-pips-bomb">{bombPips}</span>
            </div>
          </div>

          <div className="hud-corner hud-bottom-right">
            <div className="hud-label">WAVE</div>
            <div className="hud-wave">{wave}</div>
          </div>
        </>
      ) : null}
    </div>
  )
}
