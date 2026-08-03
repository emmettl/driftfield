import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useField } from './Field'

// The particle field's presence in the scene graph.
//
// Deliberately thin: the field owns its own `Points` object and is stepped by `GameLoop`, so all this
// does is put the object in the scene and take it out again. It is imperative rather than declarative —
// `<primitive object={...} />` would do the same job — because the field is constructed outside React's
// tree (it needs the renderer) and attaching it by hand makes the ownership obvious rather than making
// it look like React created it.

export function Particles() {
  const scene = useThree((state) => state.scene)
  const field = useField()

  useEffect(() => {
    scene.add(field.particles.points)
    return () => {
      scene.remove(field.particles.points)
    }
  }, [scene, field])

  return null
}
