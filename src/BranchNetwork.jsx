import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF, Billboard, Text } from '@react-three/drei'

/* ── generate the branching tree ─────────────────────────────── */

/** Sample a point on a cubic bezier edge at parameter t ∈ [0,1] */
export function sampleBezier(edge, t) {
  const u = 1 - t
  const uu = u * u
  const uuu = uu * u
  const tt = t * t
  const ttt = tt * t
  return new THREE.Vector3(
    uuu * edge.fromPos.x + 3 * uu * t * edge.cp1.x + 3 * u * tt * edge.cp2.x + ttt * edge.toPos.x,
    uuu * edge.fromPos.y + 3 * uu * t * edge.cp1.y + 3 * u * tt * edge.cp2.y + ttt * edge.toPos.y,
    uuu * edge.fromPos.z + 3 * uu * t * edge.cp1.z + 3 * u * tt * edge.cp2.z + ttt * edge.toPos.z,
  )
}

/** Get the tangent direction of a cubic bezier at parameter t */
export function bezierTangent(edge, t) {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return new THREE.Vector3(
    -3 * uu * edge.fromPos.x + 3 * (uu - 2 * u * t) * edge.cp1.x + 3 * (2 * u * t - tt) * edge.cp2.x + 3 * tt * edge.toPos.x,
    -3 * uu * edge.fromPos.y + 3 * (uu - 2 * u * t) * edge.cp1.y + 3 * (2 * u * t - tt) * edge.cp2.y + 3 * tt * edge.toPos.y,
    -3 * uu * edge.fromPos.z + 3 * (uu - 2 * u * t) * edge.cp1.z + 3 * (2 * u * t - tt) * edge.cp2.z + 3 * tt * edge.toPos.z,
  ).normalize()
}

/** Approximate arc length of a cubic bezier by summing N linear segments */
export function bezierLength(edge, segments = 32) {
  let len = 0
  let prev = sampleBezier(edge, 0)
  for (let i = 1; i <= segments; i++) {
    const pt = sampleBezier(edge, i / segments)
    len += prev.distanceTo(pt)
    prev = pt
  }
  return len
}

function makeBezierEdge(id, from, to, fromPos, toPos, cpPull) {
  // Direction vector
  const dx = toPos.x - fromPos.x
  const dz = toPos.z - fromPos.z
  // cp1 pulls from fromPos in the x-forward direction, cp2 pulls back toward toPos
  const cp1 = new THREE.Vector3(
    fromPos.x + dx * cpPull,
    0,
    fromPos.z,
  )
  const cp2 = new THREE.Vector3(
    toPos.x - dx * cpPull,
    0,
    toPos.z,
  )
  return { id, from, to, fromPos: fromPos.clone(), toPos: toPos.clone(), cp1, cp2 }
}

export function generateBranchTree(branchLength, spreadAngle, decay) {
  const nodes = []
  const edges = []
  let nextId = 0
  let edgeId = 0
  const cpPull = 0.35 // how far control points pull (fraction of dx)

  const xStep = branchLength
  const zSpread = branchLength * Math.sin(spreadAngle) * decay

  // Layer 0: single origin node
  const n0 = { id: nextId++, pos: new THREE.Vector3(0, 0, 0), level: 0, parentId: null }
  nodes.push(n0)

  // Layer 1: diverge → 2 nodes
  const n1 = { id: nextId++, pos: new THREE.Vector3(xStep, 0, zSpread), level: 1, parentId: 0 }
  const n2 = { id: nextId++, pos: new THREE.Vector3(xStep, 0, -zSpread), level: 1, parentId: 0 }
  nodes.push(n1, n2)
  edges.push(
    makeBezierEdge(edgeId++, 0, 1, n0.pos, n1.pos, cpPull),
    makeBezierEdge(edgeId++, 0, 2, n0.pos, n2.pos, cpPull),
  )

  // Layer 2: diverge → 4 nodes (each L1 splits into 2)
  const x2 = xStep * 2.5
  const zOuter = zSpread * 1.5
  const zInner = zSpread * 0.5
  const n3 = { id: nextId++, pos: new THREE.Vector3(x2, 0, zOuter), level: 2, parentId: 1 }
  const n4 = { id: nextId++, pos: new THREE.Vector3(x2, 0, zInner), level: 2, parentId: 1 }
  const n5 = { id: nextId++, pos: new THREE.Vector3(x2, 0, -zInner), level: 2, parentId: 2 }
  const n6 = { id: nextId++, pos: new THREE.Vector3(x2, 0, -zOuter), level: 2, parentId: 2 }
  nodes.push(n3, n4, n5, n6)
  edges.push(
    makeBezierEdge(edgeId++, 1, 3, n1.pos, n3.pos, cpPull),
    makeBezierEdge(edgeId++, 1, 4, n1.pos, n4.pos, cpPull),
    makeBezierEdge(edgeId++, 2, 5, n2.pos, n5.pos, cpPull),
    makeBezierEdge(edgeId++, 2, 6, n2.pos, n6.pos, cpPull),
  )

  // Layer 3: converge → 2 nodes (top pair + bottom pair merge)
  const x3 = x2 + xStep * 1.8
  const n7 = { id: nextId++, pos: new THREE.Vector3(x3, 0, zSpread), level: 3, parentId: 3 }
  const n8 = { id: nextId++, pos: new THREE.Vector3(x3, 0, -zSpread), level: 3, parentId: 6 }
  nodes.push(n7, n8)
  edges.push(
    makeBezierEdge(edgeId++, 3, 7, n3.pos, n7.pos, cpPull),
    makeBezierEdge(edgeId++, 4, 7, n4.pos, n7.pos, cpPull),
    makeBezierEdge(edgeId++, 5, 8, n5.pos, n8.pos, cpPull),
    makeBezierEdge(edgeId++, 6, 8, n6.pos, n8.pos, cpPull),
  )

  // Layer 4: converge → 1 node (final merge)
  const x4 = x3 + xStep * 1.8
  const n9 = { id: nextId++, pos: new THREE.Vector3(x4, 0, 0), level: 4, parentId: 7 }
  nodes.push(n9)
  edges.push(
    makeBezierEdge(edgeId++, 7, 9, n7.pos, n9.pos, cpPull),
    makeBezierEdge(edgeId++, 8, 9, n8.pos, n9.pos, cpPull),
  )

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
      if (node.level === 0) {
        rotations[node.id] = Math.PI / 2 // origin faces +x (right)
        continue
      }
      const dir = new THREE.Vector2(node.pos.x, node.pos.z)
      const angle = Math.atan2(dir.x, dir.y)
      rotations[node.id] = angle
    }
    return rotations
  }, [nodes])

  // Pre-compute children for each node from outgoing EDGES (not parentId)
  // This ensures convergent nodes appear as children of all their source nodes
  const nodeChildren = useMemo(() => {
    const map = {}
    for (const node of nodes) {
      const childIds = treeData.edges
        .filter((e) => e.from === node.id)
        .map((e) => e.to)
      map[node.id] = [...new Set(childIds)]
    }
    return map
  }, [nodes, treeData.edges])

  // Pre-compute ALL edge indices leading TO each node (supports convergent edges)
  const nodeEdgeIndices = useMemo(() => {
    const map = {}
    treeData.edges.forEach((e, idx) => {
      if (!map[e.to]) map[e.to] = []
      map[e.to].push(idx)
    })
    return map
  }, [treeData.edges])

  return (
    <group ref={groupRef} position={[0, height, 0]}>
      {nodes
        .filter(({ id }) => visibleNodeIds.has(id))
        .map(({ id, pos }) => {
          const children = nodeChildren[id] || []
          const edgeIndices = nodeEdgeIndices[id] || []
          return (
            <group key={id} position={pos}>
              {/* Mailbox — scales in with flower growth */}
              <MailboxWithGrowth
                scene={mailboxScene}
                scale={mailboxScale}
                rotation={nodeRotations[id] ?? 0}
                growthRef={growthRef}
                edgeIndices={edgeIndices}
              />
              {/* Single letter floating above — triggers all outgoing edges */}
              <SpinningLetter
                  key={`letter-${id}`}
                  childId={id}
                  scene={letterScene}
                  scale={letterScale}
                  offsetX={0}
                  offsetY={letterHeight}
                  color={letterColor}
                  baseRotation={letterRotation}
                  clickRadius={clickRadius}
                  onLetterClick={() => onLetterClick(id)}
                  growthRef={growthRef}
                  edgeIndices={edgeIndices}
                  dismissedLetterRef={dismissedLetterRef}
                />
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
        letterHeight={letterHeight}
      />
    </group>
  )
}

/* ── Letter text content keyed by node ID ── */
const FONT_URL = '/fonts/PPMondwest-Bold.ttf'

export const LETTER_TEXT = {
  0: 'Nick Ellenoff',
  1: 'Yan Kulveit',
  2: 'Josh Citarella',
  3: 'Yan Xiao',
  4: 'Chloe',
  5: 'Brad Troemel',
  6: 'Christian Townsend',
  7: 'Justin Colt',
  8: 'Eli',
  9: ' ... ',
}

export const ANSWER_TEXT = {
  0: 'Kindling and nurturing curiosity, letting your curiosity be your guide and your drive is a superpower.',
  1: 'Attention to your internal life, modeling the brain, drinking tea, and the future of humanity are all connected.',
  2: 'Research, Design, and Community are as vital sources of artistic inspiration as emotion and experience. To make art is to engage in a conversation with a community.',
  3: 'The most interesting philosophical questions are rooted in the human capacity for attention. Intention, ritual, internal life, artistic practice are the real sites of philosophical practice.',
  4: 'The natural world, plant and animal life are some of our richest sources of knowledge and inspiration.',
  5: 'The platform itself is a vessel for creative expression. The post, the comment, the live code is a form in itself.',
  6: 'A procedural concept, a piece of code, a shader network, a simulation, is itself a design decision. The design decisions available to your imagination are constrained by your knowledge of the computational building blocks.',
  7: '2 hours of research and 20 minutes of execution means you are doing something right.',
  8: 'Slow methodical practice with paper, pencils, and friends.',
  9: "Every person I've learned from started as someone I hadn't yet met.",
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
function LetterPopup({ lockedLetterRef, expandedNodeRef, onCardDismiss, dismissedLetterRef, nodes, letterHeight }) {
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
  const EXP_W = 0.8, EXP_H = 0.55
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
      const name = LETTER_TEXT[activeId] || ''
      // Hover card: just the name, centred
      if (questionRef.current) {
        questionRef.current.text = name
        questionRef.current.sync()
      }
      // Expanded card: name as title
      if (questionExpRef.current) { questionExpRef.current.text = name; questionExpRef.current.sync() }
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
      const node = nodes.find((n) => n.id === relevantId)
      if (node) {
        _hoverPos.set(node.pos.x, letterHeight + 1.1, node.pos.z)
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
    const expandedScale = (visH * 0.45) / EXP_H

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
      questionRef.current.position.set(0, 0, 0.001)
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
      dividerRef.current.scale.x = innerW / 1.4  // 1.4 = geometry width
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

      {/* Question text — HOVER state (centred name) */}
      <Text
        ref={(obj) => { questionRef.current = obj; tagCursor(obj) }}
        font={FONT_URL}
        position={[0, 0, 0.001]}
        fontSize={0.08}
        color="#000000"
        anchorX="center"
        anchorY="middle"
        maxWidth={MAX_HOVER_W - PAD * 2}
        lineHeight={1.3}
        textAlign="center"
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

function MailboxWithGrowth({ scene, scale, rotation, growthRef, edgeIndices }) {
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
    let edgeGrowth = 1
    if (edgeIndices && edgeIndices.length > 0 && growthRef?.current) {
      edgeGrowth = Math.max(...edgeIndices.map(idx => growthRef.current.get(idx) ?? 0))
    }
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

function SpinningLetter({ scene, scale, offsetX, offsetY, color = '#ffffff', baseRotation = [0, 0, 0], clickRadius, onLetterClick, growthRef, edgeIndices, childId, dismissedLetterRef }) {
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
      let edgeGrowth = 1
      if (edgeIndices && edgeIndices.length > 0 && growthRef?.current) {
        edgeGrowth = Math.max(...edgeIndices.map(idx => growthRef.current.get(idx) ?? 0))
      }
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
