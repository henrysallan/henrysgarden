import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Multi-target camera cutscene.
 *
 * Accepts `targets` — an array of world-space positions to visit in order.
 * The camera lerps to each target, holds briefly, then lerps to the next.
 * After the last target it lerps back to the original saved position.
 *
 * Internal phase encoding:
 *   0         → idle
 *   odd  (1, 3, 5 …) → lerping toward a destination
 *   even (2, 4, 6 …) → holding at that destination
 *   final odd         → lerping back to saved position
 */

function easeInOut(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function CameraCutscene({
  /** Array of world-space positions to visit (or a single Vector3 for back-compat) */
  targets,
  /** @deprecated — use `targets` instead */
  targetPos,
  lerpDuration = 1.2,
  holdDuration = 1.0,
  lookAtYOffset = 0.5,
  zoomAmount = 0.85,
  onComplete,
  active = false,
}) {
  const { camera } = useThree()
  const phaseRef = useRef(0)       // current phase index
  const timerRef = useRef(0)
  const controlsRef = useRef(null)
  const prevActiveRef = useRef(false)

  // Saved original camera state
  const savedRef = useRef({ pos: new THREE.Vector3(), tgt: new THREE.Vector3() })

  // Per-stop computed camera destinations: [{ pos, tgt }, …]
  const stopsRef = useRef([])
  // Total number of phases: (stops * 2) lerp+hold per stop, +1 final lerp back
  const totalPhasesRef = useRef(0)

  // Scratch vectors
  const _fromPos = useRef(new THREE.Vector3())
  const _fromTgt = useRef(new THREE.Vector3())
  const _toPos = useRef(new THREE.Vector3())
  const _toTgt = useRef(new THREE.Vector3())

  useFrame((state, delta) => {
    if (!controlsRef.current) controlsRef.current = state.controls
    const controls = controlsRef.current

    // ── Detect rising edge of `active` ──
    if (active && !prevActiveRef.current && controls) {
      // Normalise targets (support legacy single targetPos prop too)
      const raw = targets ?? (targetPos ? [targetPos] : [])
      if (raw.length === 0) { prevActiveRef.current = active; return }

      savedRef.current.pos.copy(camera.position)
      savedRef.current.tgt.copy(controls.target)

      // Build camera destination for each stop
      const baseOffset = camera.position.clone().sub(controls.target)
      const stops = raw.map((wp) => {
        const tgt = new THREE.Vector3(wp.x, lookAtYOffset + 0.5, wp.z)
        const off = baseOffset.clone().multiplyScalar(zoomAmount)
        off.y -= 1.5
        const pos = tgt.clone().add(off)
        if (pos.y < 0.5) pos.y = 0.5
        return { pos, tgt }
      })

      stopsRef.current = stops
      // phases: for N stops → lerp1 hold1 lerp2 hold2 … lerpN holdN lerpBack
      totalPhasesRef.current = stops.length * 2 + 1
      phaseRef.current = 1
      timerRef.current = 0
      controls.enabled = false
    }
    prevActiveRef.current = active

    const phase = phaseRef.current
    if (phase === 0 || !controls) return

    timerRef.current += Math.min(delta, 0.033)

    const stops = stopsRef.current
    const totalPhases = totalPhasesRef.current
    const isLastLerp = phase === totalPhases // final lerp back to saved
    const isLerp = phase % 2 === 1
    const isHold = phase % 2 === 0

    if (isLerp) {
      const duration = isLastLerp ? lerpDuration : lerpDuration * 0.7
      const t = Math.min(1, timerRef.current / duration)
      const e = easeInOut(t)

      // Determine from/to for this lerp
      if (isLastLerp) {
        // Lerping back to saved from the last stop
        const lastStop = stops[stops.length - 1]
        _fromPos.current.copy(lastStop.pos)
        _fromTgt.current.copy(lastStop.tgt)
        _toPos.current.copy(savedRef.current.pos)
        _toTgt.current.copy(savedRef.current.tgt)
      } else {
        const stopIdx = Math.floor(phase / 2) // which stop we're heading toward
        const stop = stops[stopIdx]
        _toPos.current.copy(stop.pos)
        _toTgt.current.copy(stop.tgt)
        if (stopIdx === 0) {
          _fromPos.current.copy(savedRef.current.pos)
          _fromTgt.current.copy(savedRef.current.tgt)
        } else {
          _fromPos.current.copy(stops[stopIdx - 1].pos)
          _fromTgt.current.copy(stops[stopIdx - 1].tgt)
        }
      }

      camera.position.lerpVectors(_fromPos.current, _toPos.current, e)
      controls.target.lerpVectors(_fromTgt.current, _toTgt.current, e)
      camera.lookAt(controls.target)

      if (t >= 1) {
        if (isLastLerp) {
          // Done
          camera.position.copy(savedRef.current.pos)
          controls.target.copy(savedRef.current.tgt)
          controls.enabled = true
          phaseRef.current = 0
          timerRef.current = 0
          onComplete?.()
        } else {
          // Advance to the hold phase
          phaseRef.current = phase + 1
          timerRef.current = 0
        }
      }
    } else if (isHold) {
      if (timerRef.current >= holdDuration) {
        phaseRef.current = phase + 1
        timerRef.current = 0
      }
    }
  })

  return null
}
