import { useEffect, useRef } from 'react'

/**
 * White dot cursor with a dark-green stroke, rendered as an HTML overlay.
 * Hides itself when the pointer leaves the window.
 */
export function CustomCursor({ size = 10, strokeColor = '#2d5a2d', strokeWidth = 0.8 }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onMove = (e) => {
      el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      el.style.opacity = '1'
    }

    const onLeave = () => {
      el.style.opacity = '0'
    }

    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  const half = size / 2

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        position: 'fixed',
        top: -half,
        left: -half,
        pointerEvents: 'none',
        zIndex: 9999,
        willChange: 'transform',
        opacity: 0,
      }}
    >
      <circle
        cx={half}
        cy={half}
        r={half - strokeWidth}
        fill="white"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    </svg>
  )
}
