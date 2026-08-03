// Ask for landscape, on the one class of device where portrait genuinely does not work.
//
// The arena is 1.76:1 and cannot be reshaped — it is the level, and a player on one device must not be able to see
// enemies a player on another cannot. A phone in portrait is around 0.46:1, so the arena ends up a thin strip
// across the middle of a tall screen with the ship a few pixels across. That is not hard, it is just not the game.
//
// Only phones, and only portrait — see `Layout.rotate`. A tablet in portrait is 0.7:1, which wastes space and
// plays perfectly well, and telling somebody to rotate a device that works is worse than a slightly empty screen.

export function RotateHint() {
  return (
    <div className="rotate">
      <div className="rotate-card">
        <div className="rotate-glyph" aria-hidden="true">
          ⟲
        </div>
        <p className="rotate-title">TURN SIDEWAYS</p>
        <p className="rotate-note">The arena is wider than it is tall.</p>
      </div>
    </div>
  )
}
