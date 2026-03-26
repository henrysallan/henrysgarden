import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Phases:
 *   0 → idle (no cutscene)
 *   1 → lerping camera + target from A → B  (ease-in-out + zoom in)
 *   2 → holding at B
 *   3 → lerping camera + target from B → A  (ease-in-out + zoom out)
 *   then fires onComplete and resets to 0
 */

// Smooth ease-in-out (cubic)
function easeInOut(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function CameraCutscene({
  /** World-space XZ position of the new mailbox to look at */
  targetPos,
  /** How long to lerp in / out (seconds) */
  lerpDuration = 1.2,
  /** How long to hold at the destination (seconds) */
  holdDuration = 1.0,
  /** Y-offset for the look-at target above the mailbox */
  lookAtYOffset = 0.5,
  /** How much closer to zoom (multiplier — 0.85 = 15% closer) */
  zoomAmount = 0.85,
  /** Called when the full cutscene finishes */
  onComplete,
  /** Set to true to start, reset to false externally via onComplete */
  active = false,
}) {
  const { camera } = useThree()
  const phaseRef = useRef(0)
  const timerRef = useRef(0)
  const savedRef = useRef({ pos: new THREE.Vector3(), tgt: new THREE.Vector3() })
  const destPosRef = useRef(new THREE.Vector3())
  const destTgtRef = useRef(new THREE.Vector3())
  const controlsRef = useRef(null)
  const prevActiveRef = useRef(false)

  useFrame((state, delta) => {
    if (!controlsRef.current) controlsRef.current = state.controls
    const controls = controlsRef.current

    // ── Detect rising edge of `active` ──
    if (active && !prevActiveRef.current && targetPos && controls) {
      savedRef.current.pos.copy(camera.position)
      savedRef.current.tgt.copy(controls.target)

      // Destination target: keep the original look-at offset and slightly nudge it up
      destTgtRef.current.set(targetPos.x, lookAtYOffset + 0.5, targetPos.z)

      // Calculate new camera position
      const offset = camera.position.clone().sub(controls.target)
      
      // Keep the current angle but zoom in
      offset.multiplyScalar(zoomAmount)
      
      // Subtly lower the camera relative to its current angle
      offset.y -= 1.5 // Just drop a little vertically
      
      destPosRef.current.copy(destTgtRef.current).add(offset)
      if (destPosRef.current.y < 0.5) destPosRef.current.y = 0.5 // Prevent clipping the ground

      phaseRef.current = 1
      timerRef.current = 0
      controls.enabled = false
    }
    prevActiveRef.current = active

    const phase = phaseRef.current
    if (phase === 0 || !controls) return

    // Clamp delta to avoid a big jump if a frame spike occurs (e.g. React re-renders)
    timerRef.current += Math.min(delta, 0.033)

    if (phase === 1) {
      const t = Math.min(1, timerRef.current / lerpDuration)
      const e = easeInOut(t)

      camera.position.lerpVectors(savedRef.current.pos, destPosRef.current, e)
      controls.target.lerpVectors(savedRef.current.tgt, destTgtRef.current, e)
      camera.lookAt(controls.target)

      if (t >= 1) {
        phaseRef.current = 2
        timerRef.current = 0
      }
    } else if (phase === 2) {
      if (timerRef.current >= holdDuration) {
        phaseRef.current = 3
        timerRef.current = 0
      }
    } else if (phase === 3) {
      const t = Math.min(1, timerRef.current / lerpDuration)
      const e = easeInOut(t)

      camera.position.lerpVectors(destPosRef.current, savedRef.current.pos, e)
      controls.target.lerpVectors(destTgtRef.current, savedRef.current.tgt, e)
      camera.lookAt(controls.target)

      if (t >= 1) {
        camera.position.copy(savedRef.current.pos)
        controls.target.copy(savedRef.current.tgt)

        controls.enabled = true
        phaseRef.current = 0
        timerRef.current = 0
        onComplete?.()
      }
    }
  })

  return null
}
