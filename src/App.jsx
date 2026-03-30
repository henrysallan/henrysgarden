import { useState, useEffect, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { Leva } from 'leva'
import { Scene } from './Scene'
import { CustomCursor } from './CustomCursor'
import { BackpackIcon } from './BackpackIcon'
import { TitleBlock } from './TitleBlock'
import { LoadingScreen } from './LoadingScreen'

export default function App() {
  const [levaHidden, setLevaHidden] = useState(true)
  const [loading, setLoading] = useState(true)

  const handleLoadingComplete = useCallback(() => setLoading(false), [])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'l' || e.key === 'L') setLevaHidden((h) => !h)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <>
      {loading && <LoadingScreen onComplete={handleLoadingComplete} />}
      <Leva hidden={levaHidden} />
      <CustomCursor />
      <TitleBlock />
      <div className="canvas-wrapper">
        <Canvas camera={{ position: [0, 18, 12], fov: 60 }} shadows>
          <Scene />
        </Canvas>
      </div>
      <BackpackIcon />
    </>
  )
}
