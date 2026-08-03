import { describe, expect, it } from 'vitest'
import { ARENA, BLAST, ENEMY } from '../game/constants'
import type { Blast } from '../game/types'
import { hueToRgb, particlesForBlast, splatForBlast, splatForWake } from './blasts'

function blast(overrides: Partial<Blast> = {}): Blast {
  return { x: 0, y: 0, radius: 4, strength: 1, hue: 0.5, ...overrides }
}

describe('hueToRgb', () => {
  it('hits the primaries', () => {
    // Channel by channel and approximately: a third of a turn is not representable, so the green
    // primary comes out with about 4e-16 of red in it.
    const near = (hue: number, expected: [number, number, number]) => {
      const rgb = hueToRgb(hue)
      for (let i = 0; i < 3; i++) expect(rgb[i]).toBeCloseTo(expected[i], 6)
    }
    near(0, [1, 0, 0])
    near(1 / 3, [0, 1, 0])
    near(2 / 3, [0, 0, 1])
  })

  it('wraps rather than going black', () => {
    expect(hueToRgb(1)).toEqual(hueToRgb(0))
    expect(hueToRgb(1.25)).toEqual(hueToRgb(0.25))
    for (const [i, channel] of hueToRgb(-0.25).entries()) {
      expect(channel).toBeCloseTo(hueToRgb(0.75)[i], 6)
    }
  })

  it('is fully saturated everywhere, with one channel at zero', () => {
    for (let hue = 0; hue < 1; hue += 0.01) {
      const rgb = hueToRgb(hue)
      expect(Math.max(...rgb)).toBeCloseTo(1)
      expect(Math.min(...rgb)).toBeCloseTo(0)
    }
  })

  it('covers every enemy hue without producing anything strange', () => {
    for (const spec of Object.values(ENEMY)) {
      for (const channel of hueToRgb(spec.hue)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('splatForBlast', () => {
  it('puts the centre of the arena at the centre of the field', () => {
    const splat = splatForBlast(blast())
    expect(splat.u).toBeCloseTo(0.5)
    expect(splat.v).toBeCloseTo(0.5)
  })

  it('maps the corners to the corners', () => {
    const corner = splatForBlast(blast({ x: ARENA.halfWidth, y: -ARENA.halfHeight }))
    expect(corner.u).toBeCloseTo(1)
    expect(corner.v).toBeCloseTo(0)
  })

  it('pushes outward rather than in a direction', () => {
    // A detonation has no single direction. The first version of this splatted a constant vector and every
    // explosion looked like a gust of wind.
    const splat = splatForBlast(blast())
    expect(splat.vx).toBe(0)
    expect(splat.vy).toBe(0)
    expect(splat.radial).toBeGreaterThan(0)
  })

  it('scales the push with strength', () => {
    const gentle = splatForBlast(blast({ strength: 0.5 }))
    const hard = splatForBlast(blast({ strength: 2.5 }))
    expect(hard.radial).toBeCloseTo(gentle.radial * 5)
  })

  it('keeps the radius in units the shader can use', () => {
    // Sigma in units of the arena's height, which is what the aspect-corrected offset in the splat shader
    // is measured in. A radius in world units here would make every splat 68 times too big.
    const splat = splatForBlast(blast({ radius: ARENA.halfHeight * 2 }))
    expect(splat.radius).toBeLessThan(1)
    expect(splat.radius).toBeGreaterThan(0.1)
  })

  it('takes its colour from the hue and its brightness from the strength', () => {
    const green = splatForBlast(blast({ hue: 1 / 3, strength: 1 }))
    expect(green.g).toBeGreaterThan(green.r)
    expect(green.g).toBeGreaterThan(green.b)
    const brighter = splatForBlast(blast({ hue: 1 / 3, strength: 2 }))
    expect(brighter.g).toBeCloseTo(green.g * 2)
  })
})

describe('particlesForBlast', () => {
  it('scales with area, not radius', () => {
    // A bomb is not four times the event a kill is, it is the whole arena — and a linear count makes it
    // look like a slightly bigger kill.
    const small = particlesForBlast(blast({ radius: 4 }))
    const twice = particlesForBlast(blast({ radius: 8 }))
    expect(twice).toBeGreaterThan(small * 3)
  })

  it('caps, so one frame cannot ask for more pool than exists', () => {
    const enormous = particlesForBlast(blast({ radius: 1000, strength: 50 }))
    expect(enormous).toBeLessThanOrEqual(12_000)
  })

  it('gives a kill enough particles to read as sparks rather than dust', () => {
    // The first pass at this was 90 particles for a kill, which at the size they are drawn is a faint puff.
    // The pool is a fixed 65,536 whatever happens, so a bigger burst costs nothing but overwriting more of it.
    const kill = particlesForBlast(blast({ radius: BLAST.killRadius, strength: BLAST.killStrength }))
    expect(kill).toBeGreaterThan(500)
  })

  it('gives a bomb far more than a kill, and a kill more than a spawn', () => {
    const spawn = particlesForBlast(blast({ radius: BLAST.spawnRadius, strength: BLAST.spawnStrength }))
    const kill = particlesForBlast(blast({ radius: BLAST.killRadius, strength: BLAST.killStrength }))
    const bomb = particlesForBlast(blast({ radius: BLAST.bombRadius, strength: BLAST.bombStrength }))
    expect(spawn).toBeLessThan(kill)
    expect(kill).toBeLessThan(bomb)
  })
})

describe('splatForWake', () => {
  const frame = 1 / 60

  it('is directional, not radial', () => {
    const wake = splatForWake(0, 0, 40, 0, frame)
    expect(wake.radial).toBe(0)
    expect(wake.vx).toBeGreaterThan(0)
  })

  it('scales with the delta, because it is a source rather than an event', () => {
    // The bug this pins: a splat accumulates into the field, and the wake is splatted on every frame the
    // ship is moving. The first version passed the ship's velocity in unscaled — 0.17 of a domain *per
    // frame* against a dissipation of 0.22 per second — so the field grew without bound, the grid was
    // displaced further than the arena is wide, and the screen tore into white ribbons within ten
    // seconds of flying. Anything continuous has to be integrated.
    const short = splatForWake(0, 0, 40, 0, frame)
    const long = splatForWake(0, 0, 40, 0, frame * 3)
    expect(long.vx).toBeCloseTo(short.vx * 3)
    expect(long.g).toBeCloseTo(short.g * 3)
  })

  it('keeps a frame of wake far below what one kill injects', () => {
    // The safety property behind the arithmetic: at 42 units per second — the ship's top speed — one
    // frame of wake must be a small fraction of a single kill's push, or holding a direction for a second
    // outweighs an explosion.
    const wake = splatForWake(0, 0, 42, 0, frame)
    const kill = splatForBlast(blast({ radius: BLAST.killRadius, strength: BLAST.killStrength }))
    expect(Math.abs(wake.vx)).toBeLessThan(kill.radial * 0.2)
  })

  it('scales the two axes differently, because uv is not square', () => {
    // The arena is 120 × 68, so the same world velocity is a different fraction of the domain on each
    // axis. Treating them the same is a wake that visibly leans.
    const horizontal = splatForWake(0, 0, 40, 0, frame)
    const vertical = splatForWake(0, 0, 0, 40, frame)
    expect(vertical.vy).toBeGreaterThan(horizontal.vx)
    expect(vertical.vy / horizontal.vx).toBeCloseTo(ARENA.halfWidth / ARENA.halfHeight, 3)
  })

  it('is much fainter than any detonation', () => {
    const wake = splatForWake(0, 0, 40, 0, frame)
    const kill = splatForBlast(blast({ radius: BLAST.killRadius, strength: BLAST.killStrength }))
    expect(wake.r + wake.g + wake.b).toBeLessThan(kill.r + kill.g + kill.b)
  })
})
