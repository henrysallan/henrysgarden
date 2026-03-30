import { useState, useEffect, useRef } from 'react'

const SVG_SRC = '/title.svg'

/* ── Timing (ms) ── */
const DRAW_DURATION = 9000   // stroke draws on
const FILL_OVERLAP  = 0.001  // fill starts at this fraction of stroke progress
const FILL_DURATION = 800    // fill CSS transition duration
const HOLD_DURATION = 600    // pause before fade-out
const FADE_DURATION = 800    // everything fades out

export function LoadingScreen({ onComplete }) {
  const strokeRef = useRef(null)
  const fillRef = useRef(null)
  const [pathD, setPathD] = useState(null)
  const [pathLen, setPathLen] = useState(0)
  const [phase, setPhase] = useState('drawing')
  const [showFill, setShowFill] = useState(false)

  /* 1. Fetch SVG, extract the fill-shape path data */
  useEffect(() => {
    fetch(SVG_SRC)
      .then((r) => r.text())
      .then((text) => {
        const m = text.match(/<mask[^>]*>[\s\S]*?<path\s[^>]*d="([^"]+)"/)
        if (m) setPathD(m[1])
      })
  }, [])

  /* 2. Once the <path> mounts, grab its total length & init dash */
  useEffect(() => {
    const el = strokeRef.current
    if (!el) return
    const len = el.getTotalLength()
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    setPathLen(len)
  }, [pathD])

  /* 3. rAF loop for stroke only — fill uses CSS transition */
  useEffect(() => {
    if (!pathLen) return
    const strokeEl = strokeRef.current
    if (!strokeEl) return

    let cancelled = false
    const start = performance.now()
    const fillStartTime = DRAW_DURATION * FILL_OVERLAP

    const tick = (now) => {
      if (cancelled) return
      const elapsed = now - start

      /* ── Stroke draw-on ── */
      const drawProgress = Math.min(elapsed / DRAW_DURATION, 1)
      strokeEl.style.strokeDashoffset = String(pathLen * (1 - drawProgress))

      if (drawProgress < 1) {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)

    /* Trigger fill via CSS transition */
    const fillTimer = setTimeout(() => setShowFill(true), fillStartTime)

    /* Phase: fading (after fill transition + hold) */
    const fadeTimer = setTimeout(
      () => setPhase('fading'),
      fillStartTime + FILL_DURATION + HOLD_DURATION
    )

    return () => {
      cancelled = true
      clearTimeout(fillTimer)
      clearTimeout(fadeTimer)
    }
  }, [pathLen])

  /* 4. Fade-out → done */
  useEffect(() => {
    if (phase !== 'fading') return
    const t = setTimeout(() => {
      setPhase('done')
      onComplete?.()
    }, FADE_DURATION)
    return () => clearTimeout(t)
  }, [phase, onComplete])

  if (phase === 'done' || !pathD) return null

  return (
    <div
      className="loading-screen"
      style={{
        opacity: phase === 'fading' ? 0 : 1,
        transition: phase === 'fading' ? `opacity ${FADE_DURATION}ms ease` : 'none',
      }}
    >
      <svg
        className="loading-svg"
        viewBox="0 0 603 243"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Stroke outline — draws on first */}
        <path
          ref={strokeRef}
          d={pathD}
          fill="none"
          stroke="#093315"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* Fill — CSS transition for smooth GPU-accelerated fade */}
        <path
          ref={fillRef}
          d={pathD}
          fill="#093315"
          style={{
            opacity: showFill ? 1 : 0,
            transition: `opacity ${FILL_DURATION}ms ease`,
          }}
        />
      </svg>
    </div>
  )
}
