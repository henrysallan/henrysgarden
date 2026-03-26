import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const _intersect = new THREE.Vector3()
const _raycaster = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _panDir = new THREE.Vector3()

/**
 * Wireframe cube that hovers at a fixed height and tracks the cursor.
 *
 * • Snaps (soft-lock) toward the nearest letter when within `lockRadius`.
 * • Unlocking requires pulling past `unlockRadius` (resistance feel).
 * • When locked, a left-click fires `onLockedClick(id)`.
 * • When the NDC pointer nears the viewport edge, the OrbitControls target
 *   is panned in that direction at `panSpeed`.
 */
export function CursorCube({
  height = 1.5,
  cubeSize = 0.35,
  color = '#ffffff',
  sensitivity = 2.5,
  lerpSpeed = 0.12,
  lockRadius = 0.8,
  unlockRadius = 1.4,
  lockStrength = 0.7,
  lockedScale = 0.75,
  panSpeed = 3.0,
  panEdge = 0.85,
  panZone = 0.8,
  inputDisabled = false,
  letterPositions = [],
  onLockedClick,              // (id) => void — fired on left-click while locked
  onLockedIdChange,
}) {
  const groupRef = useRef()
  const scaleRef = useRef(1)
  const lockedIdRef = useRef(null)
  const hasMovedRef = useRef(false)
  const panVelRef = useRef({ x: 0, z: 0 })
  const wasDisabledRef = useRef(false)
  const reentryRef = useRef(1)          // 0→1 ramp after cutscene ends
  const { camera, gl } = useThree()

  // Grab the OrbitControls instance from the drei store
  const controlsRef = useRef(null)
  useFrame((state) => {
    if (!controlsRef.current) {
      controlsRef.current = state.controls
    }
  })

  // ── Click handler — only fires if pointer didn't drag ──
  useEffect(() => {
    const canvas = gl.domElement
    let downX = 0, downY = 0, maxDist2 = 0

    const onDown = (e) => { downX = e.clientX; downY = e.clientY; maxDist2 = 0 }
    const onMove = (e) => {
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      const d2 = dx * dx + dy * dy
      if (d2 > maxDist2) maxDist2 = d2
    }
    const onUp = () => {
      if (maxDist2 > 25) return                    // moved > 5px at any point → drag
      if (inputDisabled) return
      if (lockedIdRef.current !== null) {
        onLockedClick?.(lockedIdRef.current)
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
    }
  }, [gl, onLockedClick])

  // EdgesGeometry gives us the 12-edge wireframe of a box
  const edgesGeo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize)),
    [cubeSize],
  )
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color }), [color])

  _plane.constant = -height

  useFrame((state, delta) => {
    const g = groupRef.current
    if (!g) return

    // When input is disabled (cutscene), skip all cursor logic
    if (inputDisabled) {
      wasDisabledRef.current = true
      return
    }

    // Detect transition from disabled → enabled: start slow reentry ramp
    if (wasDisabledRef.current) {
      wasDisabledRef.current = false
      reentryRef.current = 0
    }
    // Ramp reentry factor 0→1 over ~0.8s (ease-out feel)
    if (reentryRef.current < 1) {
      reentryRef.current = Math.min(1, reentryRef.current + delta * 1.25)
    }

    // ── 1. Raw cursor target in world-space ──
    _ndc.set(state.pointer.x, state.pointer.y)
    _raycaster.setFromCamera(_ndc, camera)
    const hit = _raycaster.ray.intersectPlane(_plane, _intersect)
    if (!hit) return

    // Show on first pointer interaction
    if (!hasMovedRef.current) {
      hasMovedRef.current = true
      g.visible = true
    }

    // Re-center around OrbitControls target so sensitivity only scales the delta
    const controls = controlsRef.current
    const cx = controls?.target?.x ?? 0
    const cz = controls?.target?.z ?? 0
    const rawX = cx + (hit.x - cx) * sensitivity
    const rawZ = cz + (hit.z - cz) * sensitivity

    // ── 2. Find nearest letter (XZ only) ──
    let nearestDist = Infinity
    let nearestId = null

    for (const lp of letterPositions) {
      const dx = lp.worldPos.x - rawX
      const dz = lp.worldPos.z - rawZ
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < nearestDist) {
        nearestDist = d
        nearestId = lp.id
      }
    }

    // ── 3. Lock / unlock logic ──
    if (lockedIdRef.current !== null) {
      const locked = letterPositions.find((l) => l.id === lockedIdRef.current)
      if (locked) {
        const dx = locked.worldPos.x - rawX
        const dz = locked.worldPos.z - rawZ
        const d = Math.sqrt(dx * dx + dz * dz)
        if (d > unlockRadius) {
          lockedIdRef.current = null
          onLockedIdChange?.(null)
        }
      } else {
        lockedIdRef.current = null
        onLockedIdChange?.(null)
      }
    }

    if (lockedIdRef.current === null && nearestDist < lockRadius) {
      lockedIdRef.current = nearestId
      onLockedIdChange?.(nearestId)
    }

    // ── 4. Compute effective target ──
    let tx = rawX
    let ty = height
    let tz = rawZ
    const isLocked = lockedIdRef.current !== null

    if (isLocked) {
      const locked = letterPositions.find((l) => l.id === lockedIdRef.current)
      if (locked) {
        tx = rawX + (locked.worldPos.x - rawX) * lockStrength
        ty = height + (locked.worldPos.y - height) * lockStrength
        tz = rawZ + (locked.worldPos.z - rawZ) * lockStrength
      }
    }

    // ── 5. Lerp position (snappy, with reentry ramp after cutscene) ──
    const baseSpeed = isLocked ? 0.25 : lerpSpeed
    const eased = reentryRef.current * reentryRef.current   // quadratic ease-in
    const speed = baseSpeed * (0.02 + 0.98 * eased)         // floor of 2% so it starts moving immediately
    g.position.x += (tx - g.position.x) * speed
    g.position.y += (ty - g.position.y) * speed
    g.position.z += (tz - g.position.z) * speed

    // ── 6. Lerp scale (shrink when locked) ──
    const targetScale = isLocked ? lockedScale : 1
    scaleRef.current += (targetScale - scaleRef.current) * 0.1
    g.scale.setScalar(scaleRef.current)

    // ── 7. Edge-pan: DISABLED ──
    // (panning is now handled by OrbitControls left-drag)
  })

  return (
    <group ref={groupRef} position={[0, height, 0]} visible={false}>
      <group rotation={[0, Math.PI / 4, 0]}>
        {/* Wireframe edges */}
        <lineSegments geometry={edgesGeo} material={lineMat} />

        {/* Shadow-only mesh */}
        <mesh castShadow userData={{ isCursor: true }}>
          <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
          <meshBasicMaterial colorWrite={false} />
        </mesh>
      </group>
    </group>
  )
}
