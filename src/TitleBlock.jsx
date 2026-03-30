import { useEffect, useRef } from 'react'
import { applyDither } from './dither'

const SVG_SRC = '/title.svg'

// Dither settings tuned for the title (flat vector → high contrast)
const DITHER_OPTS = {
  scale: 2,
  threshold: 0.6,
  brightness: 0,
  contrast: 2.3,
  inkColor: '#093315',
}

export function TitleBlock() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      // Render at 2× the SVG's intrinsic size for crisp dithering
      const w = img.naturalWidth * 2
      const h = img.naturalHeight * 2
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      // White background so transparent areas become white
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      applyDither(ctx, w, h, DITHER_OPTS)
    }
    img.src = SVG_SRC

    return () => { cancelled = true }
  }, [])

  return (
    <div className="title-block">
      <canvas ref={canvasRef} className="title-svg" />
      <p className="title-description">
        This is a garden of people - friends, colleagues, teachers, mentors - and ideas, that shape how I make things.
        <br /><br />
        Use the cube to open the 10 letters. Click and drag to move around the garden.
        <br /><br />
        Enjoy!
      </p>
    </div>
  )
}
