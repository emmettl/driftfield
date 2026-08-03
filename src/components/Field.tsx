import { useThree } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { ARENA_ASPECT } from '../game/arena'
import { ARENA } from '../game/constants'
import { quality } from '../game/device'
import { Fluid } from '../gpu/fluid'
import { ParticleField } from '../gpu/particles'

// The simulation fields, shared by everything that reads or writes them.
//
// A context rather than a module singleton, unlike the world: both of these own GPU resources and need
// the renderer to construct, so they cannot exist before the `Canvas` does — and they have to be
// disposed when it goes away, which a module-level object has no hook for. React's lifecycle is
// exactly the right shape for that, and the context is the cheapest way to get one instance to the
// eight components that want it.

export interface Field {
  fluid: Fluid
  particles: ParticleField
}

const FieldContext = createContext<Field | null>(null)

export function FieldProvider({ children }: { children: ReactNode }) {
  const gl = useThree((state) => state.gl)

  const field = useMemo<Field>(
    () => ({
      fluid: new Fluid(gl, {
        resolution: quality.fluidResolution,
        dyeResolution: quality.dyeResolution,
        aspect: ARENA_ASPECT,
        pressureIterations: quality.pressureIterations,
      }),
      particles: new ParticleField(gl, {
        textureSize: quality.particleTexture,
        halfWidth: ARENA.halfWidth,
        halfHeight: ARENA.halfHeight,
      }),
    }),
    [gl],
  )

  useEffect(() => {
    return () => {
      field.fluid.dispose()
      field.particles.dispose()
    }
  }, [field])

  return <FieldContext.Provider value={field}>{children}</FieldContext.Provider>
}

/**
 * The fields.
 *
 * Throws rather than returning null. Every caller is inside the provider by construction, and a
 * component that silently drew nothing because a context was missing would be a bug that presents as
 * "the smoke is gone" — which is a much longer afternoon than a stack trace.
 */
export function useField(): Field {
  const field = useContext(FieldContext)
  if (!field) throw new Error('useField outside a FieldProvider')
  return field
}
