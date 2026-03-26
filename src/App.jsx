import { Canvas } from '@react-three/fiber'
import { Scene } from './Scene'
import { CustomCursor } from './CustomCursor'
import { BackpackIcon } from './BackpackIcon'

export default function App() {
  return (
    <>
      <CustomCursor />
      <Canvas camera={{ position: [0, 18, 12], fov: 60 }} shadows>
        <Scene />
      </Canvas>
      <div className="site-frame" />
      <BackpackIcon />
    </>
  )
}
