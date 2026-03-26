import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF, Billboard, Text } from '@react-three/drei'

/* ── generate the branching tree ─────────────────────────────── */

export function generateBranchTree(branchLength, spreadAngle, decay) {
  const nodes = []
  const edges = []
  let nextId = 0
  let edgeId = 0

  const origin = new THREE.Vector3(0, 0, 0)
  const rootId = nextId++
  nodes.push({ id: rootId, pos: origin.clone(), level: 0, parentId: null })

  // Level 1 – 3 branches from centre, 120° apart
  const L1 = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const end = origin.clone().add(dir.clone().multiplyScalar(branchLength))
    const id = nextId++
    nodes.push({ id, pos: end.clone(), level: 1, parentId: rootId })
    edges.push({ id: edgeId++, from: rootId, to: id, fromPos: origin.clone(), toPos: end.clone() })
    L1.push({ id, pos: end, dir })
  }

  // Level 2 – each L1 splits into 2
  const len2 = branchLength * decay
  const L2 = []
  for (const parent of L1) {
    for (const sign of [1, -1]) {
      const d = parent.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sign * spreadAngle)
      const end = parent.pos.clone().add(d.clone().multiplyScalar(len2))
      const id = nextId++
      nodes.push({ id, pos: end.clone(), level: 2, parentId: parent.id })
      edges.push({ id: edgeId++, from: parent.id, to: id, fromPos: parent.pos.clone(), toPos: end.clone() })
      L2.push({ id, pos: end, dir: d })
    }
  }

  // Level 3 – each L2 splits into 2
  const len3 = len2 * decay
  for (const parent of L2) {
    for (const sign of [1, -1]) {
      const d = parent.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sign * spreadAngle)
      const end = parent.pos.clone().add(d.clone().multiplyScalar(len3))
      const id = nextId++
      nodes.push({ id, pos: end.clone(), level: 3, parentId: parent.id })
      edges.push({ id: edgeId++, from: parent.id, to: id, fromPos: parent.pos.clone(), toPos: end.clone() })
    }
  }

  return { nodes, edges }
}

/** Trace path of edge indices from root to a given node */
export function getPathToNode(nodeId, nodes, edges) {
  const edgeIndices = []
  let current = nodeId
  while (current !== null) {
    const node = nodes.find((n) => n.id === current)
    if (!node || node.parentId === null) break
    const idx = edges.findIndex((e) => e.from === node.parentId && e.to === current)
    if (idx !== -1) edgeIndices.unshift(idx)
    current = node.parentId
  }
  return edgeIndices
}

/** Get the two child node IDs of a given node (in tree order) */
export function getChildNodeIds(nodeId, nodes) {
  return nodes.filter((n) => n.parentId === nodeId).map((n) => n.id)
}

/* ── component ───────────────────────────────────────────────── */

export function BranchNetwork({
  height,
  mailboxScale = 0.3,
  letterScale = 0.15,
  letterSpread = 0.25,
  letterHeight = 0.5,
  letterColor = '#ffffff',
  letterRotation = [0, 0, 0],
  clickRadius = 0.4,
  treeData,
  growthRef,
  visibleNodeIds,
  lockedLetterRef,
  expandedNodeRef,
  onLetterClick,
  onCardDismiss,
}) {
  const groupRef = useRef()
  const dismissedLetterRef = useRef(null) // ID of letter to fly away

  // Load models
  const { scene: mailboxScene } = useGLTF('/models/mailbox.glb')
  const { scene: letterScene } = useGLTF('/models/letter.glb')

  // Tag all network meshes so PostLines can isolate them for the mask pass
  useEffect(() => {
    if (!groupRef.current) return
    groupRef.current.traverse((child) => {
      if (child.isMesh) child.userData.isNetwork = true
    })
  }, [visibleNodeIds])

  const { nodes } = treeData

  // Compute rotation for each node so the mailbox faces away from origin
  const nodeRotations = useMemo(() => {
    const rotations = {}
    for (const node of nodes) {
      if (node.level === 0) continue
      const dir = new THREE.Vector2(node.pos.x, node.pos.z)
      const angle = Math.atan2(dir.x, dir.y)
      rotations[node.id] = angle
    }
    return rotations
  }, [nodes])

  // Pre-compute children for each visible node
  const nodeChildren = useMemo(() => {
    const map = {}
    for (const node of nodes) {
      if (node.level === 0) continue
      map[node.id] = getChildNodeIds(node.id, nodes)
    }
    return map
  }, [nodes])

  // Pre-compute the edge index that leads TO each node
  const nodeEdgeIdx = useMemo(() => {
    const map = {}
    treeData.edges.forEach((e, idx) => {
      map[e.to] = idx
    })
    return map
  }, [treeData.edges])

  return (
    <group ref={groupRef} position={[0, height, 0]}>
      {nodes
        .filter(({ id, level }) => level > 0 && visibleNodeIds.has(id))
        .map(({ id, pos }) => {
          const children = nodeChildren[id] || []
          const edgeIdx = nodeEdgeIdx[id]
          return (
            <group key={id} position={pos}>
              {/* Mailbox — scales in with flower growth */}
              <MailboxWithGrowth
                scene={mailboxScene}
                scale={mailboxScale}
                rotation={nodeRotations[id] ?? 0}
                growthRef={growthRef}
                edgeIdx={edgeIdx}
              />
              {/* Two letters floating above — one per child branch */}
              {children.length > 0 && children.map((childId, i) => (
                <SpinningLetter
                  key={childId}
                  childId={childId}
                  scene={letterScene}
                  scale={letterScale}
                  offsetX={(i === 0 ? -1 : 1) * letterSpread}
                  offsetY={letterHeight}
                  color={letterColor}
                  baseRotation={letterRotation}
                  clickRadius={clickRadius}
                  onLetterClick={() => onLetterClick(childId)}
                  growthRef={growthRef}
                  edgeIdx={edgeIdx}
                  dismissedLetterRef={dismissedLetterRef}
                />
              ))}
            </group>
          )
        })}
      {/* Single shared popup — positioned at the locked letter */}
      <LetterPopup
        lockedLetterRef={lockedLetterRef}
        expandedNodeRef={expandedNodeRef}
        onCardDismiss={onCardDismiss}
        dismissedLetterRef={dismissedLetterRef}
        nodes={nodes}
        nodeChildren={nodeChildren}
        letterSpread={letterSpread}
        letterHeight={letterHeight}
      />
    </group>
  )
}

/* ── Letter text content keyed by node ID ── */
const FONT_URL = '/fonts/PPMondwest-Bold.ttf'

export const LETTER_TEXT = {
  // Level 2 — children of the 3 L1 mailboxes
  4:  'You taught yourself 3D and started a lab while in college in Ohio. How did that self-directed environment shape the way you learn new tools today?',
  5:  "Between 3D modeling, traditional design, and new tools like 'vibecoding,' how do you decide which medium is right for a specific idea?",
  6:  'Where do philosophy and visual design actually intersect in your day-to-day work?',
  7:  'Is there a specific philosophical concept or text that has fundamentally changed the way you approach making things?',
  8:  'How does your creative process shift when moving between freelance work and studio environments like The Collected Works or VM Groupe?',
  9:  'Has transitioning from Ohio to the New York design scene changed the kind of work you want to create?',
  // Level 3 — children of the 6 L2 mailboxes
  10: "Since you learned by watching YouTube VFX artists, how much of your current workflow involves reverse-engineering other people's techniques versus inventing your own from scratch?",
  11: "How does that realization—that almost any technical skill is figure-out-able—change the scale or ambition of the projects you pitch today?",
  12: "When you build custom code to procedurally animate an idea, how do you know when the code is 'done' and the animation actually feels right?",
  13: "You mentioned using 3D tools for 2D results. Can you share a specific project where using the 'wrong' tool yielded a better aesthetic than the industry standard would have?",
  14: "How do you practically design for 'the humanity of the other' when you are working under the constraints of a fast-paced commercial brief?",
  15: 'You mentioned paying attention to history in your art. Are there specific design movements or historical periods you find yourself in dialogue with right now?',
  16: "What does a 'rich' moment in digital design actually look or feel like to you? Is it about friction, clarity, surprise, or something else?",
  17: 'When a commercial project naturally lacks that philosophical richness, how do you manufacture the drive to see it through to a high standard?',
  18: 'In your personal work, where you have total agency, how do you set constraints for yourself so that you actually finish the project?',
  19: 'When working on a highly guided studio project, where do you find the space to inject your own specific perspective or craft?',
  20: "Do you think being removed from a formal 'design scene' in Ohio allowed you to develop a more idiosyncratic style, free from local industry trends?",
  21: 'Now that you are working in New York, what specific cultural conversations or milieus do you feel your work is actively participating in?',
}

export const ANSWER_TEXT = {
  4:  'Placeholder answer for 1A.',
  5:  'Placeholder answer for 1B.',
  6:  'Placeholder answer for 2C.',
  7:  'Placeholder answer for 2D.',
  8:  'Placeholder answer for 3E.',
  9:  'Placeholder answer for 3F.',
  10: 'Placeholder answer for 1A-1.',
  11: 'Placeholder answer for 1A-2.',
  12: 'Placeholder answer for 1B-1.',
  13: 'Placeholder answer for 1B-2.',
  14: 'Placeholder answer for 2C-1.',
  15: 'Placeholder answer for 2C-2.',
  16: 'Placeholder answer for 2D-1.',
  17: 'Placeholder answer for 2D-2.',
  18: 'Placeholder answer for 3E-1.',
  19: 'Placeholder answer for 3E-2.',
  20: 'Placeholder answer for 3F-1.',
  21: 'Placeholder answer for 3F-2.',
}

/* ── temp vectors (hoisted to avoid per-frame allocation) ── */
const _dir = new THREE.Vector3()
const _worldTarget = new THREE.Vector3()
const _localTarget = new THREE.Vector3()
const _hoverPos = new THREE.Vector3()
const _lookTarget = new THREE.Vector3()

/*
 * ── Single card that morphs between hover (small, above letter)
 *    and expanded (large, centred in front of camera).
 */
function LetterPopup({ lockedLetterRef, expandedNodeRef, onCardDismiss, dismissedLetterRef, nodes, nodeChildren, letterSpread, letterHeight }) {
  const groupRef = useRef()
  const bgMeshRef = useRef()
  const bgMatRef = useRef()
  const questionRef = useRef()       // hover question (centred, large)
  const questionExpRef = useRef()     // expanded question (top-left, smaller)
  const answerRef = useRef()
  const dividerRef = useRef()
  const xBgMatRef = useRef()
  const xTextRef = useRef()
  const xGroupRef = useRef()
  const hoverSize = useRef({ w: 1.4, h: 0.4 })   // smoothed current hover card size
  const hoverTarget = useRef({ w: 1.4, h: 0.4 })  // target from text bounds
  const opacity = useRef(0)
  const lastPositionedForId = useRef(null)
  const snapFrames = useRef(0)
  const lastLockedId = useRef(null)
  const lastExpandedId = useRef(null)
  const dismissNodeId = useRef(null)
  const dismissSlide = useRef(0)     // 0 = no slide, grows upward during dismiss
  const expandT = useRef(0) // 0 = hover, 1 = expanded
  const currentScale = useRef(new THREE.Vector3(1, 1, 1))

  const { camera } = useThree()

  /* Card dimensions in local space */
  const MAX_HOVER_W = 1.6   // max width for hover card text
  const MIN_HOVER_W = 0.5, MIN_HOVER_H = 0.2  // minimum hover card size
  const EXP_W = 0.8, EXP_H = 1.2
  const PAD = 0.06

  useFrame(() => {
    const lockedId = lockedLetterRef.current
    const expandedId = expandedNodeRef.current
    const isExpanded = expandedId !== null
    const isDismissing = dismissNodeId.current !== null && !isExpanded
    const showCard = lockedId !== null || isExpanded || dismissNodeId.current !== null
    const g = groupRef.current
    if (!g) return

    /* ---- Detect hover target change → snap position before fading in ---- */
    const hoverId = lockedId ?? expandedId ?? null
    if (hoverId !== null && hoverId !== lastPositionedForId.current && lastPositionedForId.current !== null && !isExpanded) {
      // New target differs from where the card was last shown — snap instantly
      opacity.current = 0
      snapFrames.current = 2
    }
    if (hoverId !== null) lastPositionedForId.current = hoverId

    /* ---- Visibility fade ---- */
    // Snap opacity to 1 when expand starts so there's no scale jump
    if (isExpanded) {
      opacity.current = 1
    } else {
      const visTarget = showCard ? 1 : 0
      const fadeOut = visTarget === 0
      const fadeSpeed = fadeOut ? 0.35 : 0.12
      // While snapping, keep opacity at 0 so position can settle first
      if (snapFrames.current > 0) {
        snapFrames.current--
      } else if (!isDismissing) {
        opacity.current += (visTarget - opacity.current) * fadeSpeed
        if (opacity.current < 0.005) opacity.current = 0
      }
    }
    g.visible = opacity.current > 0 || snapFrames.current > 0
    if (!g.visible) return

    /* ---- Expand morph (0→1) — freeze during dismiss so card doesn't shrink ---- */
    const expTarget = isExpanded ? 1 : 0
    if (!isDismissing) expandT.current += (expTarget - expandT.current) * 0.08
    if (expandT.current < 0.003) expandT.current = 0
    if (expandT.current > 0.997) expandT.current = 1
    const t = expandT.current

    /* ---- Dismiss: slide card upward then remove ---- */
    if (isDismissing) {
      dismissSlide.current += (1 - dismissSlide.current) * 0.08
      if (dismissSlide.current > 0.98) {
        dismissSlide.current = 0
        opacity.current = 0
        const id = dismissNodeId.current
        dismissNodeId.current = null
        lastExpandedId.current = null
        onCardDismiss?.(id)
        return
      }
    } else {
      dismissSlide.current = 0
    }

    /* ---- Update text content ---- */
    const activeId = expandedId ?? lockedId ?? lastExpandedId.current
    if (activeId !== null && activeId !== lastLockedId.current) {
      lastLockedId.current = activeId
      const txt = LETTER_TEXT[activeId] || ''
      // Hover card: letter format with To/From lines
      if (questionRef.current) {
        questionRef.current.text = `To Henry,\n\n${txt}\n\nBest, Gemini`
        questionRef.current.sync()
      }
      // Expanded card: just the question
      if (questionExpRef.current) { questionExpRef.current.text = txt; questionExpRef.current.sync() }
    }
    if (expandedId !== null && expandedId !== lastExpandedId.current) {
      lastExpandedId.current = expandedId
      if (answerRef.current) {
        answerRef.current.text = ANSWER_TEXT[expandedId] || ''
        answerRef.current.sync()
      }
    }

    /* ---- Position: lerp between hover-pos and camera-centre ---- */
    // Compute hover position (above the letter)
    const relevantId = expandedId ?? lockedId ?? dismissNodeId.current
    if (relevantId !== null) {
      const childNode = nodes.find((n) => n.id === relevantId)
      if (childNode) {
        const parentNode = nodes.find((n) => n.id === childNode.parentId)
        if (parentNode) {
          const siblings = nodeChildren[parentNode.id] || []
          const idx = siblings.indexOf(relevantId)
          const ox = (idx === 0 ? -1 : 1) * letterSpread
          _hoverPos.set(parentNode.pos.x + ox, letterHeight + 1.1, parentNode.pos.z)
        }
      }
    }

    // Compute expanded position (in front of camera, in local space)
    camera.getWorldDirection(_dir)
    const dist = 3.5
    _worldTarget.copy(camera.position).addScaledVector(_dir, dist)
    if (g.parent) g.parent.worldToLocal(_worldTarget)

    // Lerp position (snap instantly when card is invisible)
    _localTarget.copy(_hoverPos).lerp(_worldTarget, t)
    if (opacity.current < 0.01 && !isDismissing) {
      g.position.copy(_localTarget)
    } else if (!isDismissing) {
      g.position.lerp(_localTarget, 0.35)
    }

    // Slide up during dismiss (in camera-local up direction)
    if (isDismissing) {
      const slideAmount = dismissSlide.current * 0.1 // world units to slide up
      _lookTarget.copy(camera.up).normalize()
      // Convert camera up to parent-local space
      if (g.parent) {
        const parentMatInv = new THREE.Matrix3().getNormalMatrix(g.parent.matrixWorld).invert()
        _lookTarget.applyMatrix3(parentMatInv).normalize()
      }
      g.position.addScaledVector(_lookTarget, slideAmount)
    }

    /* ---- Rotation: always face camera ---- */
    // Get camera position in local space for lookAt
    _lookTarget.copy(camera.position)
    if (g.parent) g.parent.worldToLocal(_lookTarget)
    g.lookAt(_lookTarget)

    /* ---- Phased expand transition (overlapping phases) ----
     *  Hover text fades:  t = 0.0 → 0.15
     *  Card grows:        t = 0.05 → 0.7  (overlaps text fade-out)
     *  Expanded text in:  t = 0.55 → 0.85 (overlaps end of growth)
     */
    const growT = Math.min(1, Math.max(0, (t - 0.05) / 0.65))  // starts at t=0.05, done at t=0.7

    /* ---- Scale ---- */
    const vFov = camera.fov * Math.PI / 180
    const visH = 2 * dist * Math.tan(vFov / 2)
    const expandedScale = (visH * 0.65) / EXP_H

    // Scale grows smoothly during phase 2 only; stays 1 during phase 1
    const groupScale = THREE.MathUtils.lerp(1, expandedScale, growT)
    const baseScale = groupScale * opacity.current
    currentScale.current.set(baseScale, baseScale, baseScale)
    g.scale.copy(currentScale.current)

    /* ---- Materials ---- */
    if (bgMatRef.current) bgMatRef.current.opacity = opacity.current

    // Expanded-only elements fade in from t=0.55→0.85
    const expandAlpha = Math.min(1, Math.max(0, (t - 0.55) / 0.3))
    if (answerRef.current) answerRef.current.material.opacity = expandAlpha
    if (dividerRef.current) dividerRef.current.material.opacity = expandAlpha
    if (xBgMatRef.current) xBgMatRef.current.opacity = expandAlpha
    if (xTextRef.current) xTextRef.current.material.opacity = expandAlpha

    /* ---- Auto-size hover card from text bounds (freeze during expand) ---- */
    if (t < 0.01) {
      const tri = questionRef.current?.textRenderInfo
      if (tri && tri.blockBounds) {
        const bw = tri.blockBounds[2] - tri.blockBounds[0]
        const bh = Math.abs(tri.blockBounds[3] - tri.blockBounds[1])
        if (bw > 0.01 && bh > 0.01) {
          hoverTarget.current.w = Math.max(MIN_HOVER_W, Math.min(MAX_HOVER_W, bw + PAD * 2))
          hoverTarget.current.h = Math.max(MIN_HOVER_H, bh + PAD * 2)
        }
      }
      // Smoothly lerp hover size toward target
      hoverSize.current.w += (hoverTarget.current.w - hoverSize.current.w) * 0.4
      hoverSize.current.h += (hoverTarget.current.h - hoverSize.current.h) * 0.4
    }

    /* ---- Morph bg plane size: hover → EXP (in sync with scale growth) ---- */
    const hW = hoverSize.current.w
    const hH = hoverSize.current.h
    const w = THREE.MathUtils.lerp(hW, EXP_W, growT)
    const h = THREE.MathUtils.lerp(hH, EXP_H, growT)
    const bg = bgMeshRef.current
    if (bg && (bg.userData._w !== w || bg.userData._h !== h)) {
      bg.geometry.dispose()
      bg.geometry = new THREE.PlaneGeometry(w, h)
      bg.userData._w = w
      bg.userData._h = h
    }

    /* ---- Crossfade between hover text and expanded text ---- */
    const innerW = w - PAD * 2

    // Hover text fades out from t=0→0.15
    const hoverAlpha = Math.max(0, 1 - t / 0.15) * opacity.current
    if (questionRef.current) {
      questionRef.current.material.opacity = hoverAlpha
      questionRef.current.position.set(-w / 2 + PAD, h / 2 - PAD, 0.001)
      questionRef.current.maxWidth = MAX_HOVER_W - PAD * 2
    }

    // Expanded question fades in from t=0.55→0.85
    const expTextAlpha = Math.min(1, Math.max(0, (t - 0.55) / 0.3))
    if (questionExpRef.current) {
      questionExpRef.current.material.opacity = expTextAlpha
      questionExpRef.current.position.set(-w / 2 + PAD, h / 2 - PAD, 0.001)
      questionExpRef.current.maxWidth = innerW
    }

    // Divider at ~22% from top
    const divY = h / 2 - h * 0.22
    if (dividerRef.current) {
      dividerRef.current.position.set(0, divY, 0.001)
      dividerRef.current.scale.x = innerW / (hW - PAD * 2 + 0.001)
    }
    // Answer just below divider
    if (answerRef.current) {
      answerRef.current.position.set(-w / 2 + PAD, divY - PAD, 0.001)
      answerRef.current.maxWidth = innerW
    }
    // X button top-right
    if (xGroupRef.current) {
      xGroupRef.current.position.set(w / 2 - 0.035, h / 2 - 0.035, 0)
    }
  })

  const handleXClick = (e) => {
    e.stopPropagation()
    const id = expandedNodeRef.current
    if (id === null) return
    dismissNodeId.current = id
    expandedNodeRef.current = null
    lockedLetterRef.current = null  // clear hover lock so hover card doesn't reappear
    // Signal the letter to fly away
    if (dismissedLetterRef) dismissedLetterRef.current = id
  }

  // Tag all meshes in the card as isCursor to hide from normal pass
  const tagCursor = (obj) => {
    if (obj) obj.traverse((c) => { c.userData.isCursor = true })
  }

  return (
    <group ref={groupRef} visible={false}>
      {/* White background card — NO isCursor so it occludes scene normals behind it */}
      <mesh ref={bgMeshRef} renderOrder={999}>
        <planeGeometry args={[1.4, 0.4]} />
        <meshBasicMaterial
          ref={bgMatRef}
          color="#ffffff"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Question text — HOVER state (top-left aligned) */}
      <Text
        ref={(obj) => { questionRef.current = obj; tagCursor(obj) }}
        font={FONT_URL}
        position={[0, 0, 0.001]}
        fontSize={0.07}
        color="#000000"
        anchorX="left"
        anchorY="top"
        maxWidth={MAX_HOVER_W - PAD * 2}
        lineHeight={1.3}
        textAlign="left"
        renderOrder={1000}
        material-depthTest={false}
        material-depthWrite={false}
        material-transparent={true}
        material-opacity={0}
      >
        {' '}
      </Text>

      {/* Question text — EXPANDED state (top-left, smaller font) */}
      <Text
        ref={(obj) => { questionExpRef.current = obj; tagCursor(obj) }}
        font={FONT_URL}
        position={[0, 0, 0.001]}
        fontSize={0.045}
        color="#000000"
        anchorX="left"
        anchorY="top"
        maxWidth={EXP_W - PAD * 2}
        lineHeight={1.3}
        textAlign="left"
        renderOrder={1000}
        material-depthTest={false}
        material-depthWrite={false}
        material-transparent={true}
        material-opacity={0}
      >
        {' '}
      </Text>

      {/* Divider line (expanded only) */}
      <mesh ref={(obj) => { dividerRef.current = obj; tagCursor(obj) }} position={[0, 0, 0.001]} renderOrder={1000}>
        <planeGeometry args={[1.4, 0.001]} />
        <meshBasicMaterial color="#cccccc" transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>

      {/* Answer text (expanded only) */}
      <Text
        ref={(obj) => { answerRef.current = obj; tagCursor(obj) }}
        font={FONT_URL}
        position={[0, -0.1, 0.001]}
        fontSize={0.035}
        color="#333333"
        anchorX="left"
        anchorY="top"
        maxWidth={0.7}
        lineHeight={1.55}
        textAlign="left"
        renderOrder={1000}
        material-depthTest={false}
        material-depthWrite={false}
        material-transparent={true}
        material-opacity={0}
      >
        {' '}
      </Text>

      {/* X close button (expanded only) */}
      <group ref={xGroupRef}>
        <mesh
          position={[0, 0, 0.002]}
          renderOrder={1001}
          onClick={handleXClick}
        >
          <planeGeometry args={[0.07, 0.07]} />
          <meshBasicMaterial ref={xBgMatRef} color="#ffffff" transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
        <Text
          ref={(obj) => { xTextRef.current = obj; tagCursor(obj) }}
          font={FONT_URL}
          position={[0, 0, 0.003]}
          fontSize={0.035}
          color="#000000"
          anchorX="center"
          anchorY="middle"
          renderOrder={1002}
          material-depthTest={false}
          material-depthWrite={false}
          material-transparent={true}
          material-opacity={0}
        >
          ✕
        </Text>
      </group>
    </group>
  )
}

/* ── Mailbox — scales in with edge growth ──────────────────── */

function MailboxWithGrowth({ scene, scale, rotation, growthRef, edgeIdx }) {
  const groupRef = useRef()

  const cloned = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          side: THREE.DoubleSide,
        })
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return clone
  }, [scene])

  useFrame(() => {
    if (!groupRef.current) return
    const edgeGrowth = edgeIdx != null && growthRef?.current
      ? (growthRef.current.get(edgeIdx) ?? 0)
      : 1
    // Ease-out scale
    const s = 1 - (1 - edgeGrowth) * (1 - edgeGrowth)
    const finalScale = scale * s
    groupRef.current.scale.setScalar(finalScale)
  })

  return (
    <primitive
      ref={groupRef}
      object={cloned}
      scale={0}
      rotation={[0, rotation, 0]}
    />
  )
}

/* ── Spinning letter with click target — scales in with edge growth */

const _bbWorldPos = new THREE.Vector3()

function SpinningLetter({ scene, scale, offsetX, offsetY, color = '#ffffff', baseRotation = [0, 0, 0], clickRadius, onLetterClick, growthRef, edgeIdx, childId, dismissedLetterRef }) {
  const groupRef = useRef()
  const spinRef = useRef()
  const billboardRef = useRef()
  const colorRef = useRef(color)
  colorRef.current = color
  const materialsRef = useRef([])
  const flyAwayT = useRef(0)  // 0 = grounded, grows toward 1 = offscreen

  const cloned = useMemo(() => {
    const clone = scene.clone(true)
    const mats = []
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color,
          side: THREE.DoubleSide,
        })
        child.castShadow = true
        child.receiveShadow = true
        mats.push(child.material)
      }
    })
    materialsRef.current = mats
    return clone
  }, [scene])

  // Random phase offset so letters don't all sync
  const phaseOffset = useMemo(() => Math.random() * Math.PI * 2, [])

  useFrame((state) => {
    // Billboard — face the camera (Y-axis only)
    if (billboardRef.current) {
      const cam = state.camera.position
      billboardRef.current.getWorldPosition(_bbWorldPos)
      const angle = Math.atan2(cam.x - _bbWorldPos.x, cam.z - _bbWorldPos.z)
      billboardRef.current.rotation.y = angle
    }

    // Gentle wobble
    if (spinRef.current) {
      const t = state.clock.elapsedTime + phaseOffset
      spinRef.current.rotation.x = Math.sin(t * 0.8) * 0.15
      spinRef.current.rotation.z = Math.sin(t * 0.5) * 0.1
    }

    // Fly away if dismissed
    const shouldFly = dismissedLetterRef?.current === childId
    if (shouldFly) {
      flyAwayT.current += 0.004
    }

    // Scale in with edge growth
    if (groupRef.current) {
      const edgeGrowth = edgeIdx != null && growthRef?.current
        ? (growthRef.current.get(edgeIdx) ?? 0)
        : 1
      const s = 1 - (1 - edgeGrowth) * (1 - edgeGrowth)
      groupRef.current.scale.setScalar(s)

      // Fly upward
      if (flyAwayT.current > 0) {
        const fly = flyAwayT.current
        groupRef.current.position.y = offsetY + fly * fly * 40 // accelerating upward
        groupRef.current.scale.setScalar(s * Math.max(0, 1 - fly))
      }
    }

    // Sync color
    for (const mat of materialsRef.current) {
      mat.color.set(colorRef.current)
    }
  })

  return (
    <group ref={groupRef} position={[offsetX, offsetY, 0]} scale={0}>
      <group ref={billboardRef}>
        {/* Spinning letter model */}
        <group ref={spinRef}>
          <primitive object={cloned} scale={scale} rotation={baseRotation} />
        </group>
      </group>
    </group>
  )
}

// Preload models
useGLTF.preload('/models/mailbox.glb')
useGLTF.preload('/models/letter.glb')
