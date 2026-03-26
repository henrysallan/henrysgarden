import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useControls } from 'leva'
import { FlowerField } from './FlowerField'
import { PostLines } from './PostLines'
import { BranchNetwork, generateBranchTree, getPathToNode, getChildNodeIds, LETTER_TEXT, ANSWER_TEXT } from './BranchNetwork'
import { CursorCube } from './CursorCube'
import { CameraCutscene } from './CameraCutscene'
import * as THREE from 'three'

function CameraRig() {
  const { fov, offsetX, offsetY, offsetZ } = useControls('Camera', {
    fov: { value: 11, min: 10, max: 120, step: 1 },
    offsetX: { value: 0.3, min: -20, max: 20, step: 0.1 },
    offsetY: { value: 0.9, min: -20, max: 20, step: 0.1 },
    offsetZ: { value: 0, min: -20, max: 20, step: 0.1 },
  })
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)

  useEffect(() => {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }, [camera, fov])

  // Translate both camera AND OrbitControls target so it's a true pan, not a rotation
  useEffect(() => {
    camera.position.set(0 + offsetX, 18 + offsetY, 12 + offsetZ)
    if (controls && controls.target) {
      controls.target.set(offsetX, offsetY, offsetZ)
      controls.update()
    }
  }, [camera, controls, offsetX, offsetY, offsetZ])

  return null
}

/* ── Growth animation driver ─────────────────────────────────── */

const GROWTH_DURATION = 6.0 // seconds for full grow animation

function GrowthDriver({ growthRef, growingEdges, grownEdges }) {
  // Each edge tracks its own animation start time
  const edgeStartTimes = useRef(new Map())
  const prevGrowingRef = useRef(new Set())

  useFrame((_, delta) => {
    const now = performance.now() / 1000

    // Detect newly added edges and set their start time
    for (const edgeIdx of growingEdges) {
      if (!edgeStartTimes.current.has(edgeIdx)) {
        edgeStartTimes.current.set(edgeIdx, now)
      }
    }

    // Compute per-edge growth and overall progress
    let allDone = true
    for (const edgeIdx of growingEdges) {
      const startTime = edgeStartTimes.current.get(edgeIdx)
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / GROWTH_DURATION)
      // Smooth ease-out
      const eased = 1 - (1 - t) * (1 - t)

      if (!growthRef.current.has(edgeIdx) || growthRef.current.get(edgeIdx) < eased) {
        growthRef.current.set(edgeIdx, eased)
      }
      if (t < 1) allDone = false
    }

    // Already-grown edges stay at 1
    for (const edgeIdx of grownEdges) {
      growthRef.current.set(edgeIdx, 1)
    }
  })

  return null
}

export function Scene() {
  const sun = useControls('Sun', {
    angle: { value: 16, min: 0, max: 360, step: 1 },
    height: { value: 61, min: 5, max: 90, step: 1 },
    intensity: { value: 0.9, min: 0, max: 5, step: 0.1 },
    ambient: { value: 0.6, min: 0, max: 2, step: 0.05 },
    shadowMapSize: { value: 2048, min: 512, max: 4096, step: 512 },
    floorColor: '#efeded',
  })

  const postLines = useControls('Post Lines', {
    enabled: true,
    scale: { value: 1.4, min: 0.1, max: 2, step: 0.01 },
    noiseScale: { value: 1.0, min: 0.1, max: 1, step: 0.01 },
    thickness: { value: 0.72, min: 0, max: 1, step: 0.01 },
    noisiness: { value: 0.001, min: 0, max: 0.02, step: 0.001 },
    angle: { value: 2.0, min: 0, max: 6.28, step: 0.01 },
    contour: { value: 0.2, min: 0, max: 5, step: 0.1 },
    divergence: { value: 1.0, min: 0, max: 3, step: 0.1 },
    inkColor: '#69936b',
    paperThreshold: { value: 0.23, min: 0, max: 1, step: 0.01 },
  })

  const { count } = useControls('Field', {
    count: { value: 8000, min: 1, max: 8000, step: 1 },
  })

  const stem = useControls('Stem', {
    lengthMin: { value: 0.1, min: 0.1, max: 3, step: 0.05 },
    lengthMax: { value: 0.3, min: 0.1, max: 3, step: 0.05 },
    segmentsMin: { value: 2, min: 2, max: 20, step: 1 },
    segmentsMax: { value: 3, min: 2, max: 20, step: 1 },
    noiseMin: { value: 0.02, min: 0, max: 0.5, step: 0.01 },
    noiseMax: { value: 0.01, min: 0, max: 0.5, step: 0.01 },
    radiusMin: { value: 0.005, min: 0.005, max: 0.1, step: 0.005 },
    radiusMax: { value: 0.005, min: 0.005, max: 0.1, step: 0.005 },
    tubularSegments: { value: 8, min: 2, max: 24, step: 1 },
    radialSegments: { value: 4, min: 3, max: 8, step: 1 },
  })

  const wind = useControls('Wind', {
    speed: { value: 0.4, min: 0, max: 3, step: 0.05 },
    strength: { value: 0.06, min: 0, max: 1, step: 0.01 },
    frequency: { value: 0.5, min: 0.5, max: 10, step: 0.1 },
  })

  const petals = useControls('Petals', {
    countMin: { value: 2, min: 2, max: 16, step: 1 },
    countMax: { value: 5, min: 3, max: 16, step: 1 },
    lengthMin: { value: 0.05, min: 0.05, max: 1, step: 0.01 },
    lengthMax: { value: 0.08, min: 0.05, max: 1, step: 0.01 },
    widthMin: { value: 0.03, min: 0.01, max: 0.3, step: 0.01 },
    widthMax: { value: 0.05, min: 0.01, max: 0.3, step: 0.01 },
    centerMin: { value: 0.01, min: 0.01, max: 0.2, step: 0.005 },
    centerMax: { value: 0.04, min: 0.01, max: 0.2, step: 0.005 },
  })

  const networkCtrl = useControls('Network', {
    height: { value: 0.0, min: 0, max: 5, step: 0.1 },
    branchLength: { value: 1.6, min: 0.5, max: 8, step: 0.1 },
    spreadAngle: { value: 0.5, min: 0.1, max: 1.5, step: 0.05 },
    decay: { value: 2.25, min: 0.3, max: 5, step: 0.05 },
    mailboxScale: { value: 0.15, min: 0.05, max: 1, step: 0.01 },
    letterScale: { value: 0.08, min: 0.02, max: 0.5, step: 0.01 },
    letterSpread: { value: 0.29, min: 0.05, max: 1, step: 0.01 },
    letterHeight: { value: 1.75, min: 0.1, max: 2, step: 0.05 },
    letterColor: '#ffffff',
    letterRotX: { value: -64, min: -180, max: 180, step: 1 },
    letterRotY: { value: 29, min: -180, max: 180, step: 1 },
    letterRotZ: { value: 15, min: -180, max: 180, step: 1 },
    clickRadius: { value: 0.3, min: 0.1, max: 2, step: 0.05 },
    color: '#559595',
    scatterWidthMin: { value: 0.05, min: 0.05, max: 3, step: 0.05 },
    scatterWidthMax: { value: 1.1, min: 0.05, max: 5, step: 0.05 },
  })

  const cursorCtrl = useControls('Cursor', {
    lockRadius: { value: 0.3, min: 0.1, max: 3, step: 0.05 },
    unlockRadius: { value: 1.0, min: 0.2, max: 5, step: 0.05 },
    lockStrength: { value: 1.0, min: 0, max: 1, step: 0.05 },
    sensitivity: { value: 1.5, min: 0.5, max: 6, step: 0.1 },
  })

  const orbitCtrl = useControls('Orbit', {
    minDistance: { value: 27, min: 1, max: 50, step: 0.5 },
    maxDistance: { value: 37, min: 5, max: 100, step: 0.5 },
    minPolarAngle: { value: 28, min: 0, max: 90, step: 1 },
    maxPolarAngle: { value: 76, min: 10, max: 90, step: 1 },
    minAzimuthAngle: { value: -43, min: -180, max: 0, step: 1 },
    maxAzimuthAngle: { value: 39, min: 0, max: 180, step: 1 },
  })

  // ── Generate tree data (stable unless params change) ──
  const treeData = useMemo(
    () => generateBranchTree(networkCtrl.branchLength, networkCtrl.spreadAngle, networkCtrl.decay),
    [networkCtrl.branchLength, networkCtrl.spreadAngle, networkCtrl.decay],
  )

  // ── Interaction state ──
  // visibleNodeIds: which platonic solids are currently shown
  // grownEdges: edges that are fully grown (flowers at growth=1)
  // growingEdges: edges currently animating
  const [visibleNodeIds, setVisibleNodeIds] = useState(() => new Set())
  const [grownEdges, setGrownEdges] = useState(() => new Set())
  const [growingEdges, setGrowingEdges] = useState(() => new Set())
  const lockedLetterRef = useRef(null)
  const expandedNodeRef = useRef(null)
  const [cardExpanded, setCardExpanded] = useState(false)
  const [dismissedLetters, setDismissedLetters] = useState(() => new Set())

  // growthRef: Map<edgeIdx, progress 0..1> updated per-frame by GrowthDriver
  const growthRef = useRef(new Map())

  // ── Build an array of letter world-positions for CursorCube locking ──
  const letterPositions = useMemo(() => {
    const { nodes } = treeData
    const result = []
    for (const node of nodes) {
      if (node.level === 0) continue
      if (!visibleNodeIds.has(node.id)) continue
      const children = nodes.filter((n) => n.parentId === node.id)
      children.forEach((child, i) => {
        if (dismissedLetters.has(child.id)) return // skip dismissed letters
        const ox = (i === 0 ? -1 : 1) * networkCtrl.letterSpread
        result.push({
          id: child.id,
          worldPos: new THREE.Vector3(
            node.pos.x + ox,
            networkCtrl.height + networkCtrl.letterHeight,
            node.pos.z,
          ),
        })
      })
    }
    return result
  }, [treeData, visibleNodeIds, networkCtrl.height, networkCtrl.letterHeight, networkCtrl.letterSpread, dismissedLetters])

  // Initialize: L1 mailboxes visible, L1-edge flowers already grown
  useEffect(() => {
    const l1Ids = new Set(treeData.nodes.filter((n) => n.level === 1).map((n) => n.id))
    setVisibleNodeIds(l1Ids)
    // Mark all L1 edges (origin → L1) as already grown
    const l1Edges = new Set(
      treeData.edges
        .map((e, idx) => ({ idx, to: e.to }))
        .filter(({ to }) => l1Ids.has(to))
        .map(({ idx }) => idx),
    )
    setGrownEdges(l1Edges)
    setGrowingEdges(new Set())
    // Pre-fill growthRef so flowers render at full size immediately
    const map = new Map()
    for (const eIdx of l1Edges) map.set(eIdx, 1)
    growthRef.current = map
  }, [treeData])

  // ── Cutscene state ──
  const [cutsceneActive, setCutsceneActive] = useState(false)
  const [cutsceneTarget, setCutsceneTarget] = useState(null)

  const cutsceneCtrl = useControls('Cutscene', {
    lerpDuration: { value: 3.0, min: 0.3, max: 4, step: 0.1 },
    holdDuration: { value: 0.8, min: 0.2, max: 4, step: 0.1 },
    zoomAmount: { value: 0.85, min: 0.5, max: 1, step: 0.01 },
  })

  const handleCutsceneComplete = useCallback(() => {
    setCutsceneActive(false)
    setCutsceneTarget(null)
  }, [])

  // Phase 1: Letter clicked → expand the 3D card (no growth yet)
  const handleLetterClick = useCallback(
    (childNodeId) => {
      if (cutsceneActive || cardExpanded) return
      expandedNodeRef.current = childNodeId
      setCardExpanded(true)
    },
    [cutsceneActive, cardExpanded],
  )

  // Phase 2: Card dismissed (X clicked, collapse done) → trigger growth + cutscene
  const handleCardDismiss = useCallback(
    (childNodeId) => {
      setCardExpanded(false)
      window.dispatchEvent(new CustomEvent('card-dismissed', {
        detail: {
          id: childNodeId,
          question: LETTER_TEXT[childNodeId] || '',
          answer: ANSWER_TEXT[childNodeId] || '',
        },
      }))

      // Mark letter as dismissed so hover lock stops
      setDismissedLetters((prev) => {
        const next = new Set(prev)
        next.add(childNodeId)
        return next
      })
      lockedLetterRef.current = null

      const { nodes, edges } = treeData
      const edgeIdx = edges.findIndex((e) => e.to === childNodeId)
      if (edgeIdx === -1) return

      const childNode = nodes.find((n) => n.id === childNodeId)

      // Move any currently growing edges into grown
      setGrownEdges((prev) => {
        const next = new Set(prev)
        for (const eIdx of growingEdges) next.add(eIdx)
        return next
      })

      // Start growing just this edge
      setGrowingEdges(new Set([edgeIdx]))

      // Reveal the child mailbox
      setVisibleNodeIds((prev) => {
        const next = new Set(prev)
        next.add(childNodeId)
        return next
      })

      // Trigger the camera cutscene toward the new mailbox
      // Defer slightly so React can flush state updates (new meshes, etc.)
      // before the cutscene starts — avoids a frame hitch on the first frame
      if (childNode) {
        const tgt = new THREE.Vector3(
          childNode.pos.x,
          networkCtrl.height,
          childNode.pos.z,
        )
        setCutsceneTarget(tgt)
        requestAnimationFrame(() => {
          setCutsceneActive(true)
        })
      }
    },
    [treeData, growingEdges, networkCtrl.height],
  )

  // Combine grown + growing edges for flower field
  const allActiveEdges = useMemo(() => {
    const combined = new Set(grownEdges)
    for (const e of growingEdges) combined.add(e)
    return combined
  }, [grownEdges, growingEdges])

  return (
    <>
      <CameraRig />
      <GrowthDriver
        growthRef={growthRef}
        growingEdges={growingEdges}
        grownEdges={grownEdges}
      />

      {/* Lighting */}
      <ambientLight intensity={sun.ambient} />
      <directionalLight
        key={`shadow-${sun.shadowMapSize}`}
        castShadow
        position={[
          10 * Math.cos((sun.angle * Math.PI) / 180) * Math.cos((sun.height * Math.PI) / 180),
          10 * Math.sin((sun.height * Math.PI) / 180),
          10 * Math.sin((sun.angle * Math.PI) / 180) * Math.cos((sun.height * Math.PI) / 180),
        ]}
        intensity={sun.intensity}
        shadow-mapSize-width={sun.shadowMapSize}
        shadow-mapSize-height={sun.shadowMapSize}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        shadow-bias={-0.001}
      />

      {/* White background */}
      <color attach="background" args={['#ffffff']} />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color={sun.floorColor} />
      </mesh>

      {/* Flower field — scattered along network edges */}
      <FlowerField
        count={count}
        treeData={treeData}
        growthRef={growthRef}
        growingEdges={allActiveEdges}
        stemLength={[stem.lengthMin, stem.lengthMax]}
        stemSegments={[stem.segmentsMin, stem.segmentsMax]}
        stemNoiseStrength={[stem.noiseMin, stem.noiseMax]}
        stemRadius={[stem.radiusMin, stem.radiusMax]}
        tubularSegments={stem.tubularSegments}
        radialSegments={stem.radialSegments}
        petalCount={[petals.countMin, petals.countMax]}
        petalLength={[petals.lengthMin, petals.lengthMax]}
        petalWidth={[petals.widthMin, petals.widthMax]}
        centerRadius={[petals.centerMin, petals.centerMax]}
        scatterWidth={[networkCtrl.scatterWidthMin, networkCtrl.scatterWidthMax]}
        windSpeed={wind.speed}
        windStrength={wind.strength}
        windFrequency={wind.frequency}
      />

      {/* Branch network */}
      <BranchNetwork
        height={networkCtrl.height}
        mailboxScale={networkCtrl.mailboxScale}
        letterScale={networkCtrl.letterScale}
        letterSpread={networkCtrl.letterSpread}
        letterHeight={networkCtrl.letterHeight}
        letterColor={networkCtrl.letterColor}
        letterRotation={[
          networkCtrl.letterRotX * Math.PI / 180,
          networkCtrl.letterRotY * Math.PI / 180,
          networkCtrl.letterRotZ * Math.PI / 180,
        ]}
        clickRadius={networkCtrl.clickRadius}
        treeData={treeData}
        growthRef={growthRef}
        visibleNodeIds={visibleNodeIds}
        lockedLetterRef={lockedLetterRef}
        expandedNodeRef={expandedNodeRef}
        onLetterClick={handleLetterClick}
        onCardDismiss={handleCardDismiss}
      />

      {/* Camera cutscene on envelope trigger */}
      <CameraCutscene
        active={cutsceneActive}
        targetPos={cutsceneTarget}
        lerpDuration={cutsceneCtrl.lerpDuration}
        holdDuration={cutsceneCtrl.holdDuration}
        zoomAmount={cutsceneCtrl.zoomAmount}
        onComplete={handleCutsceneComplete}
      />

      {/* Cursor-tracking wireframe cube */}
      <CursorCube
        lockRadius={cursorCtrl.lockRadius}
        unlockRadius={cursorCtrl.unlockRadius}
        lockStrength={cursorCtrl.lockStrength}
        sensitivity={cursorCtrl.sensitivity}
        inputDisabled={cutsceneActive || cardExpanded}
        letterPositions={letterPositions}
        onLockedIdChange={(id) => { lockedLetterRef.current = id }}
        onLockedClick={handleLetterClick}
      />

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        enabled={!cardExpanded && !cutsceneActive}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        keyPanSpeed={0}
        screenSpacePanning={false}
        panSpeed={1.5}
        minDistance={orbitCtrl.minDistance}
        maxDistance={orbitCtrl.maxDistance}
        minPolarAngle={(orbitCtrl.minPolarAngle * Math.PI) / 180}
        maxPolarAngle={(orbitCtrl.maxPolarAngle * Math.PI) / 180}
        minAzimuthAngle={(orbitCtrl.minAzimuthAngle * Math.PI) / 180}
        maxAzimuthAngle={(orbitCtrl.maxAzimuthAngle * Math.PI) / 180}
      />

      {/* Post-processing hatching effect */}
      {postLines.enabled && (
        <PostLines
          scale={postLines.scale}
          noiseScale={postLines.noiseScale}
          thickness={postLines.thickness}
          noisiness={postLines.noisiness}
          angle={postLines.angle}
          contour={postLines.contour}
          divergence={postLines.divergence}
          inkColor={postLines.inkColor}
          paperThreshold={postLines.paperThreshold}
          networkInkColor={networkCtrl.color}
          networkGlow={0}
        />
      )}
    </>
  )
}
