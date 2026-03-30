import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useControls } from 'leva'
import { applyDither } from './dither'

const GIF_SRC = '/backpackopen.gif'

// Animation phase durations (ms)
const PHASE_DOT = 150
const PHASE_LINE = 600
const PHASE_BOX = 600
const PHASE_TEXT = 500

export function BackpackIcon() {
  const [playing, setPlaying] = useState(false)
  const [firstFrame, setFirstFrame] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [collectedLetters, setCollectedLetters] = useState([])
  const [selectedLetter, setSelectedLetter] = useState(null)
  const [animPhase, setAnimPhase] = useState('closed') // closed | dot | line | box | text
  const animTimers = useRef([])
  const canvasRef = useRef(null)
  const gifFramesRef = useRef(null) // { frames: ImageBitmap[], delay: number }
  const rafRef = useRef(null)

  const ditherCtrl = useControls('Backpack Dither', {
    scale: { value: 2, min: 1, max: 8, step: 1 },
    threshold: { value: 0.6, min: 0.2, max: 3.0, step: 0.05 },
    brightness: { value: 0, min: -0.5, max: 0.5, step: 0.01 },
    contrast: { value: 2.3, min: 0.5, max: 3.0, step: 0.05 },
    inkColor: '#255c27',
  })

  const jpegCtrl = useControls('Modal JPEG', {
    blockSize: { value: 32, min: 2, max: 32, step: 1 },
    displacement: { value: 1, min: 0, max: 20, step: 0.5 },
    sharpenRadius: { value: 3, min: 0, max: 3, step: 0.1 },
    sharpenAmount: { value: 4, min: 1, max: 20, step: 0.1 },
    contrast: { value: 1.5, min: 1, max: 1.5, step: 0.01 },
  })

  // Generate a tiny random-color canvas, then tile it at blockSize to get blocky noise
  const blockNoiseUrl = useMemo(() => {
    const cols = Math.ceil(480 / jpegCtrl.blockSize)
    const rows = Math.ceil(480 / jpegCtrl.blockSize)
    const c = document.createElement('canvas')
    c.width = cols
    c.height = rows
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(cols, rows)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i]     = Math.random() * 256 | 0
      img.data[i + 1] = Math.random() * 256 | 0
      img.data[i + 2] = Math.random() * 256 | 0
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return c.toDataURL()
  }, [jpegCtrl.blockSize])

  // On mount, decode all GIF frames into ImageBitmaps for reliable playback
  useEffect(() => {
    let cancelled = false
    async function decodeGif() {
      const resp = await fetch(GIF_SRC)
      const buf = await resp.arrayBuffer()

      // Decode first frame for the static thumbnail
      const firstBmp = await createImageBitmap(new Blob([buf], { type: 'image/gif' }))
      if (cancelled) return
      setFirstFrame(firstBmp)

      // Decode all frames using ImageDecoder if available (not Safari)
      if ('ImageDecoder' in window) {
        try {
          const decoder = new ImageDecoder({ type: 'image/gif', data: buf.slice(0) })
          await decoder.completed
          const frames = []
          for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
            const result = await decoder.decode({ frameIndex: i })
            const bmp = await createImageBitmap(result.image)
            frames.push({ bmp, duration: result.image.duration / 1000 }) // µs → ms
            result.image.close()
          }
          if (!cancelled) {
            gifFramesRef.current = frames
          }
          decoder.close()
        } catch (e) {
          console.warn('ImageDecoder failed, falling back to static frame:', e)
        }
      }
    }
    decodeGif()
    return () => { cancelled = true }
  }, [])

  // Listen for card-dismissed events (carries letter data)
  useEffect(() => {
    const handler = (e) => {
      const { id, question, answer } = e.detail
      setCollectedLetters((prev) => {
        if (prev.some((l) => l.id === id)) return prev
        return [...prev, { id, question, answer }]
      })
      setPlaying(true)
    }
    window.addEventListener('card-dismissed', handler)
    return () => window.removeEventListener('card-dismissed', handler)
  }, [])

  // Revert GIF to frozen frame after animation plays
  useEffect(() => {
    if (!playing || !gifFramesRef.current) return
    const totalDuration = gifFramesRef.current.reduce((sum, f) => sum + f.duration, 0)
    const timer = setTimeout(() => setPlaying(false), totalDuration || 2667)
    return () => clearTimeout(timer)
  }, [playing])

  // ── Dithered canvas render loop ──
  const ditherRef = useRef(ditherCtrl)
  ditherRef.current = ditherCtrl

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let active = true

    const drawFrame = (source) => {
      if (!active) return
      const w = source.width
      const h = source.height
      if (!w || !h) return
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(source, 0, 0)
      applyDither(ctx, w, h, ditherRef.current)
    }

    if (playing && gifFramesRef.current && gifFramesRef.current.length > 0) {
      // Animate through decoded frames
      const frames = gifFramesRef.current
      const startTime = performance.now()
      const totalDuration = frames.reduce((sum, f) => sum + f.duration, 0)

      const loop = () => {
        if (!active) return
        const elapsed = performance.now() - startTime
        if (elapsed >= totalDuration) {
          // Show last frame and stop
          drawFrame(frames[frames.length - 1].bmp)
          return
        }
        // Find current frame
        let acc = 0
        let frameIdx = 0
        for (let i = 0; i < frames.length; i++) {
          acc += frames[i].duration
          if (elapsed < acc) { frameIdx = i; break }
        }
        drawFrame(frames[frameIdx].bmp)
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
      return () => {
        active = false
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    } else if (firstFrame) {
      // Static: draw dithered first frame
      drawFrame(firstFrame)
      // Keep a slow RAF for live dither param updates
      const slow = () => {
        if (!active) return
        drawFrame(firstFrame)
        rafRef.current = requestAnimationFrame(slow)
      }
      rafRef.current = requestAnimationFrame(slow)
      return () => {
        active = false
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    }
  }, [playing, firstFrame])

  const handleBackpackClick = () => {
    if (collectedLetters.length === 0) return
    setSelectedLetter(null)
    setModalOpen(true)
    setAnimPhase('dot')
    // Clear any pending timers
    animTimers.current.forEach(clearTimeout)
    animTimers.current = [
      setTimeout(() => setAnimPhase('line'), PHASE_DOT),
      setTimeout(() => setAnimPhase('box'), PHASE_DOT + PHASE_LINE),
      setTimeout(() => setAnimPhase('text'), PHASE_DOT + PHASE_LINE + PHASE_BOX),
    ]
  }

  const handleClose = () => {
    animTimers.current.forEach(clearTimeout)
    animTimers.current = []
    // Reverse the animation: text → box → line → dot → closed
    setAnimPhase('box')   // hide text, start collapsing height
    animTimers.current = [
      setTimeout(() => setAnimPhase('line'), PHASE_BOX),         // collapse to line
      setTimeout(() => setAnimPhase('dot'), PHASE_BOX + PHASE_LINE), // collapse to dot
      setTimeout(() => {
        setAnimPhase('closed')
        setModalOpen(false)
        setSelectedLetter(null)
      }, PHASE_BOX + PHASE_LINE + PHASE_DOT),
    ]
  }

  const handleBack = () => {
    setSelectedLetter(null)
  }

  if (!firstFrame) return null

  return (
    <>
      <div className="backpack-icon" onClick={handleBackpackClick}>
        <div className="backpack-badge">{collectedLetters.length}/10</div>
        {/* Dithered canvas output */}
        <canvas ref={canvasRef} draggable={false} />
      </div>

      {modalOpen && (
        <div className="backpack-modal-overlay" onClick={handleClose}>
          {/* SVG filter for JPEG-artifact + sharpening effect */}
          <svg style={{ position: 'absolute', width: 0, height: 0 }}>
            <defs>
              <filter id="jpeg-artifact" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                {/* Blocky noise: tiny random canvas nearest-neighbor scaled up */}
                <feImage
                  href={blockNoiseUrl}
                  x="0" y="0" width="100%" height="100%"
                  preserveAspectRatio="none"
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale={jpegCtrl.displacement}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="displaced"
                />
                {/* Unsharp mask: blur then subtract for sharpening */}
                <feGaussianBlur in="displaced" stdDeviation={jpegCtrl.sharpenRadius} result="blur" />
                <feComposite
                  in="displaced"
                  in2="blur"
                  operator="arithmetic"
                  k1="0"
                  k2={jpegCtrl.sharpenAmount}
                  k3={-(jpegCtrl.sharpenAmount - 1)}
                  k4="0"
                  result="sharpened"
                />
              </filter>
            </defs>
          </svg>
          <div
            className="backpack-modal"
            style={{
              filter: (animPhase === 'text' || animPhase === 'box') ? `url(#jpeg-artifact) contrast(${jpegCtrl.contrast})` : 'none',
              width: animPhase === 'dot' ? '4px' : '480px',
              maxHeight: animPhase === 'dot' || animPhase === 'line' ? '4px' : '70vh',
              transition: animPhase === 'closed'
                ? 'none'
                : `width ${PHASE_LINE}ms cubic-bezier(0.25, 0.1, 0.25, 1), max-height ${PHASE_BOX}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="backpack-modal-content"
              style={{
                opacity: animPhase === 'text' ? 1 : 0,
                transform: animPhase === 'text' ? 'translateY(0)' : 'translateY(8px)',
                transition: `opacity ${PHASE_TEXT}ms cubic-bezier(0.25, 0.1, 0.25, 1), transform ${PHASE_TEXT}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
                pointerEvents: animPhase === 'text' ? 'auto' : 'none',
              }}
            >
            {selectedLetter ? (
              /* ── Single letter view ── */
              <div className="backpack-letter-view">
                <button className="backpack-back" onClick={handleBack}>
                  ← back
                </button>
                <div className="backpack-letter-content">
                  <p className="backpack-label">To Henry,</p>
                  <p className="backpack-question">{selectedLetter.question}</p>
                  <p className="backpack-label">Best, Gemini</p>
                  <div className="backpack-divider" />
                  <p className="backpack-answer">{selectedLetter.answer}</p>
                </div>
              </div>
            ) : (
              /* ── Letter list view ── */
              <div className="backpack-list-view">
                <div className="backpack-header">
                  <span>Collected Letters</span>
                  <button className="backpack-close" onClick={handleClose}>
                    ✕
                  </button>
                </div>
                <div className="backpack-list">
                  {collectedLetters.map((letter, i) => (
                    <button
                      key={letter.id}
                      className="backpack-list-item"
                      onClick={() => setSelectedLetter(letter)}
                    >
                      <span className="backpack-item-num">{i + 1}.</span>
                      <span className="backpack-item-text">{letter.question}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
