import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sampleBezier, bezierTangent, bezierLength } from './BranchNetwork'

// Simple seeded PRNG (Mulberry32)
function mulberry32(seed) {
  let s = seed | 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function lerp(min, max, t) {
  return min + (max - min) * t
}

function gaussRng(rng) {
  return (rng() + rng() + rng()) / 3 * 2 - 1
}

// Gaussian offset via Box-Muller — dense center, smooth infinite tail
function gaussianOffset(rng) {
  const u1 = Math.max(rng(), 1e-10) // avoid log(0)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// Hash matching GLSL: fract(sin(n) * 43758.5453)
function hashF(n) {
  const v = Math.sin(n) * 43758.5453
  return v - Math.floor(v)
}

// CPU stem point at parameter t (0=base, 1=tip) — must match GLSL exactly
function stemPointAt(pos, seed, len, noise, g, t, time, wStr, wFreq) {
  const noiseScale = g * g
  const nf = t * t
  const rx = (hashF(seed * 17.3) - 0.5) * 2
  const rz = (hashF(seed * 31.7) - 0.5) * 2
  let nx = rx * noise * nf * noiseScale
  let nz = rz * noise * nf * noiseScale
  const wa = t * t * wStr
  nx += Math.sin(t * wFreq + time + seed) * wa
  nz += Math.cos(t * wFreq * 0.8 + time * 0.8 + seed) * wa
  return [pos[0] + nx, len * g * t, pos[2] + nz]
}

// ── Scratch objects reused every frame ──
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _headMat = new THREE.Matrix4()
const _mat4a = new THREE.Matrix4()
const _mat4b = new THREE.Matrix4()
const ZERO_SCALE = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -999, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0, 0, 0)
)
const _centerQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
const _tangent = new THREE.Vector3()
const _headQuat = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)

// ── Self-contained stem ShaderMaterial shaders ──
const STEM_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aPos;
  attribute float aSeed;
  attribute float aLen;
  attribute float aNoise;
  attribute float aRadius;
  attribute float aGrowth;

  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindFrequency;

  float stemHash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float g = aGrowth;
    float t = position.y; // 0 at base, 1 at tip

    // Stem height
    float y = t * aLen * g;

    // Noise displacement (increases toward tip with t²)
    float noiseScale = g * g;
    float nf = t * t;
    float rx = (stemHash(aSeed * 17.3) - 0.5) * 2.0;
    float rz = (stemHash(aSeed * 31.7) - 0.5) * 2.0;
    float nx = rx * aNoise * nf * noiseScale;
    float nz = rz * aNoise * nf * noiseScale;

    // Wind
    float wa = t * t * uWindStrength;
    nx += sin(t * uWindFrequency + uTime + aSeed) * wa;
    nz += cos(t * uWindFrequency * 0.8 + uTime * 0.8 + aSeed) * wa;

    // World position along stem centerline
    vec3 worldPos = aPos + vec3(nx, y, nz);

    // Billboard: expand perpendicular to camera direction (horizontal only)
    vec3 toC = cameraPosition - worldPos;
    toC.y = 0.0;
    float cd = length(toC);
    vec3 cDir = cd > 0.001 ? toC / cd : vec3(0.0, 0.0, 1.0);
    vec3 right = vec3(-cDir.z, 0.0, cDir.x);

    // Taper thinner toward tip
    float taper = 1.0 - t * 0.3;
    worldPos += right * position.x * aRadius * taper * 2.0;

    // Hide if not yet growing
    vec3 finalPos = g < 0.001 ? vec3(0.0, -999.0, 0.0) : worldPos;

    gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
  }
`

const STEM_FRAGMENT_SHADER = /* glsl */ `
  void main() {
    // Dark muted green to match the scene palette
    gl_FragColor = vec4(0.18, 0.25, 0.18, 1.0);
  }
`

// Depth material vertex shader — same displacement logic, outputs depth for shadow map
const STEM_DEPTH_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <packing>

  attribute vec3 aPos;
  attribute float aSeed;
  attribute float aLen;
  attribute float aNoise;
  attribute float aRadius;
  attribute float aGrowth;

  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindFrequency;

  varying vec2 vHighPrecisionZW;

  float stemHash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float g = aGrowth;
    float t = position.y;

    float y = t * aLen * g;
    float noiseScale = g * g;
    float nf = t * t;
    float rx = (stemHash(aSeed * 17.3) - 0.5) * 2.0;
    float rz = (stemHash(aSeed * 31.7) - 0.5) * 2.0;
    float nx = rx * aNoise * nf * noiseScale;
    float nz = rz * aNoise * nf * noiseScale;

    float wa = t * t * uWindStrength;
    nx += sin(t * uWindFrequency + uTime + aSeed) * wa;
    nz += cos(t * uWindFrequency * 0.8 + uTime * 0.8 + aSeed) * wa;

    vec3 worldPos = aPos + vec3(nx, y, nz);

    // Billboard (use light's view for shadow pass)
    // In shadow pass, cameraPosition is the light position
    vec3 toC = cameraPosition - worldPos;
    toC.y = 0.0;
    float cd = length(toC);
    vec3 cDir = cd > 0.001 ? toC / cd : vec3(0.0, 0.0, 1.0);
    vec3 right = vec3(-cDir.z, 0.0, cDir.x);

    float taper = 1.0 - t * 0.3;
    worldPos += right * position.x * aRadius * taper * 2.0;

    vec3 finalPos = g < 0.001 ? vec3(0.0, -999.0, 0.0) : worldPos;

    gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
    vHighPrecisionZW = gl_Position.zw;
  }
`

const STEM_DEPTH_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <packing>

  varying vec2 vHighPrecisionZW;

  void main() {
    float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
    gl_FragColor = packDepthToRGBA(fragCoordZ);
  }
`

/**
 * Scatters flowers along the edges of the branch network tree.
 *
 * ALL rendering is handled here via instancing:
 * - Stems: InstancedBufferGeometry + ShaderMaterial (1 draw call, created imperatively)
 * - Petals: InstancedMesh (1 draw call)
 * - Centers: InstancedMesh (1 draw call)
 *
 * Total: 3 draw calls regardless of flower count.
 */
export function FlowerField({
  count = 100,
  treeData,
  growingEdges,
  growthRef,
  stemLength,
  stemSegments,
  stemNoiseStrength,
  stemRadius,
  petalCount,
  petalLength,
  petalWidth,
  centerRadius,
  scatterWidth = [0.5, 2.0],
  tubularSegments = 8,
  radialSegments = 4,
  windSpeed = 0.5,
  windStrength = 0.15,
  windFrequency = 3.0,
}) {
  const groupRef = useRef()
  const petalInstanceRef = useRef()
  const centerInstanceRef = useRef()

  // Imperative stem mesh refs
  const stemMeshObjRef = useRef(null)
  const stemGrowthAttrRef = useRef(null)
  const stemUniformsRef = useRef({
    uTime: { value: 0 },
    uWindStrength: { value: windStrength },
    uWindFrequency: { value: windFrequency },
  })

  const maxPetals = petalCount[1]
  const totalPetalInstances = count * maxPetals
  const totalCenterInstances = count

  // ── Pre-compute flower data ──
  const flowers = useMemo(() => {
    if (!treeData) return []
    const { edges, nodes } = treeData
    const rng = mulberry32(42)
    const items = []
    const edgeLengths = edges.map((e) => bezierLength(e))
    const totalLength = edgeLengths.reduce((a, b) => a + b, 0)

    // Build node-level lookup for depth-based scatter width
    const nodeLevel = new Map()
    const maxLevel = nodes.reduce((m, n) => Math.max(m, n.level), 0) || 1
    for (const n of nodes) nodeLevel.set(n.id, n.level)

    const swMin = Array.isArray(scatterWidth) ? scatterWidth[0] : scatterWidth
    const swMax = Array.isArray(scatterWidth) ? scatterWidth[1] : scatterWidth

    for (let i = 0; i < count; i++) {
      let r = rng() * totalLength
      let edgeIdx = 0
      for (let e = 0; e < edges.length; e++) {
        r -= edgeLengths[e]
        if (r <= 0) { edgeIdx = e; break }
      }
      const edge = edges[edgeIdx]
      const t = rng()
      // Sample position along the cubic bezier
      const pt = sampleBezier(edge, t)
      const baseX = pt.x
      const baseZ = pt.z
      // Get tangent direction at this point to compute perpendicular offset
      const tan = bezierTangent(edge, t)
      const perpX = -tan.z
      const perpZ = tan.x

      // Depth-based scatter: wider as we go deeper in the tree
      const fromLevel = nodeLevel.get(edge.from) ?? 0
      const toLevel = nodeLevel.get(edge.to) ?? fromLevel
      const edgeDepth = lerp(fromLevel, toLevel, t) / maxLevel // 0→1
      const sw = lerp(swMin, swMax, edgeDepth)

      // Gaussian falloff: dense center, smooth gradual tail (no hard cutoff)
      const rawG = gaussianOffset(rng)
      const offset = rawG * sw * 0.45
      const x = baseX + perpX * offset
      const z = baseZ + perpZ * offset

      // Flowers further from the path shrink for a natural taper
      const dist = Math.abs(rawG)
      const edgeScale = Math.exp(-dist * dist * 0.18)

      items.push({
        key: i,
        edgeIdx,
        edgeT: t,
        position: [x, 0, z],
        stemLength: lerp(stemLength[0], stemLength[1], rng()) * edgeScale,
        stemSegments: Math.round(lerp(stemSegments[0], stemSegments[1], rng())),
        stemNoiseStrength: lerp(stemNoiseStrength[0], stemNoiseStrength[1], rng()),
        stemRadius: lerp(stemRadius[0], stemRadius[1], rng()) * edgeScale,
        petalCount: Math.round(lerp(petalCount[0], petalCount[1], rng()) * edgeScale),
        petalLength: lerp(petalLength[0], petalLength[1], rng()) * edgeScale,
        petalWidth: lerp(petalWidth[0], petalWidth[1], rng()) * edgeScale,
        centerRadius: lerp(centerRadius[0], centerRadius[1], rng()) * edgeScale,
        seed: i * 137 + 7,
      })
    }
    return items
  }, [count, treeData, scatterWidth, stemLength, stemSegments, stemNoiseStrength, stemRadius, petalCount, petalLength, petalWidth, centerRadius])

  // ── Petal local quaternions (fan + tilt in head space) ──
  const flowerPetalQuats = useMemo(() => {
    const fanQ = new THREE.Quaternion()
    const tiltQ = new THREE.Quaternion()
    const localX = new THREE.Vector3()
    const yAxis = new THREE.Vector3(0, 1, 0)
    return flowers.map((f) => {
      const quats = []
      for (let i = 0; i < f.petalCount; i++) {
        const angle = (i / f.petalCount) * Math.PI * 2
        fanQ.setFromAxisAngle(yAxis, angle)
        localX.set(1, 0, 0).applyQuaternion(fanQ)
        tiltQ.setFromAxisAngle(localX, Math.PI * 0.35)
        quats.push(tiltQ.clone().multiply(fanQ))
      }
      return quats
    })
  }, [flowers])

  // ── Stem: imperatively create InstancedBufferGeometry + ShaderMaterial mesh ──
  useEffect(() => {
    const group = groupRef.current
    if (!group || flowers.length === 0) return

    // Clean up previous mesh
    if (stemMeshObjRef.current) {
      group.remove(stemMeshObjRef.current)
      stemMeshObjRef.current.geometry.dispose()
      stemMeshObjRef.current.material.dispose()
      stemMeshObjRef.current = null
      stemGrowthAttrRef.current = null
    }

    // Build billboard strip geometry
    const segs = Math.max(2, tubularSegments)
    const verts = []
    const idx = []
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      verts.push(-0.5, t, 0, 0.5, t, 0)
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
      idx.push(a, b, c, b, d, c)
    }

    const geo = new THREE.InstancedBufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setIndex(idx)

    // Per-instance attributes
    const n = flowers.length
    const posA = new Float32Array(n * 3)
    const seedA = new Float32Array(n)
    const lenA = new Float32Array(n)
    const noiseA = new Float32Array(n)
    const radA = new Float32Array(n)
    const growA = new Float32Array(n)

    for (let i = 0; i < n; i++) {
      const f = flowers[i]
      posA[i * 3] = f.position[0]
      posA[i * 3 + 1] = 0
      posA[i * 3 + 2] = f.position[2]
      seedA[i] = f.seed
      lenA[i] = f.stemLength
      noiseA[i] = f.stemNoiseStrength
      radA[i] = f.stemRadius
    }

    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(posA, 3))
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedA, 1))
    geo.setAttribute('aLen', new THREE.InstancedBufferAttribute(lenA, 1))
    geo.setAttribute('aNoise', new THREE.InstancedBufferAttribute(noiseA, 1))
    geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radA, 1))
    const gAttr = new THREE.InstancedBufferAttribute(growA, 1)
    gAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aGrowth', gAttr)
    stemGrowthAttrRef.current = gAttr

    geo.instanceCount = n

    const mat = new THREE.ShaderMaterial({
      uniforms: stemUniformsRef.current,
      vertexShader: STEM_VERTEX_SHADER,
      fragmentShader: STEM_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
    })

    // Custom depth material for shadow casting (same vertex displacement)
    const depthMat = new THREE.ShaderMaterial({
      uniforms: stemUniformsRef.current,
      vertexShader: STEM_DEPTH_VERTEX_SHADER,
      fragmentShader: STEM_DEPTH_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
    })
    depthMat.depthPacking = THREE.RGBADepthPacking

    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.customDepthMaterial = depthMat
    mesh.frustumCulled = false
    mesh.userData.isFlowerStem = true
    group.add(mesh)
    stemMeshObjRef.current = mesh

    return () => {
      if (stemMeshObjRef.current && group) {
        group.remove(stemMeshObjRef.current)
        stemMeshObjRef.current.geometry.dispose()
        stemMeshObjRef.current.material.dispose()
        if (stemMeshObjRef.current.customDepthMaterial) {
          stemMeshObjRef.current.customDepthMaterial.dispose()
        }
        stemMeshObjRef.current = null
        stemGrowthAttrRef.current = null
      }
    }
  }, [flowers, tubularSegments])

  // ── Petal + center instancing ──
  const petalGeo = useMemo(() => new THREE.CircleGeometry(1, 6), [])
  const centerGeo = useMemo(() => new THREE.CircleGeometry(1, 6), [])
  const sharedMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
    []
  )

  // Init petal/center instances to hidden
  useEffect(() => {
    if (petalInstanceRef.current) {
      for (let i = 0; i < totalPetalInstances; i++)
        petalInstanceRef.current.setMatrixAt(i, ZERO_SCALE)
      petalInstanceRef.current.instanceMatrix.needsUpdate = true
    }
    if (centerInstanceRef.current) {
      for (let i = 0; i < totalCenterInstances; i++)
        centerInstanceRef.current.setMatrixAt(i, ZERO_SCALE)
      centerInstanceRef.current.instanceMatrix.needsUpdate = true
    }
  }, [totalPetalInstances, totalCenterInstances])

  // ── Per-frame: update growth attr + uniforms + petal/center matrices ──
  const WAVE_SPREAD = 1.0

  useFrame((state) => {
    const map = growthRef.current
    const time = state.clock.elapsedTime * windSpeed

    // Update stem shader uniforms
    stemUniformsRef.current.uTime.value = time
    stemUniformsRef.current.uWindStrength.value = windStrength
    stemUniformsRef.current.uWindFrequency.value = windFrequency

    const gAttr = stemGrowthAttrRef.current
    const petalMesh = petalInstanceRef.current
    const centerMesh = centerInstanceRef.current

    for (let i = 0; i < flowers.length; i++) {
      const f = flowers[i]
      const isActive = growingEdges.has(f.edgeIdx)
      const edgeGrowth = isActive ? (map.get(f.edgeIdx) ?? 0) : 0
      const g = Math.max(0, Math.min(1,
        edgeGrowth * (1 + WAVE_SPREAD) - f.edgeT * WAVE_SPREAD
      ))

      // Write growth to stem instance attribute (GPU reads this)
      if (gAttr) gAttr.array[i] = g

      // Petal/center visibility
      const petalGrowth = Math.max(0, (g - 0.5) * 2)
      const headScale = petalGrowth * petalGrowth

      if (headScale < 0.001 || !petalMesh || !centerMesh) {
        if (centerMesh) centerMesh.setMatrixAt(i, ZERO_SCALE)
        if (petalMesh) {
          for (let p = 0; p < maxPetals; p++)
            petalMesh.setMatrixAt(i * maxPetals + p, ZERO_SCALE)
        }
        continue
      }

      // Compute stem tip on CPU (must match GLSL exactly for petal placement)
      const tip = stemPointAt(f.position, f.seed, f.stemLength, f.stemNoiseStrength, g, 1.0, time, windStrength, windFrequency)
      const near = stemPointAt(f.position, f.seed, f.stemLength, f.stemNoiseStrength, g, 0.95, time, windStrength, windFrequency)

      // Head orientation from tangent at tip
      _tangent.set(tip[0] - near[0], tip[1] - near[1], tip[2] - near[2]).normalize()
      _headQuat.setFromUnitVectors(_up, _tangent)

      _headMat.compose(
        _pos.set(tip[0], tip[1], tip[2]),
        _headQuat,
        _scale.set(headScale, headScale, headScale)
      )

      // Center disc
      _mat4b.makeScale(f.centerRadius, f.centerRadius, f.centerRadius)
      _mat4a.makeRotationFromQuaternion(_centerQuat)
      _mat4a.multiply(_mat4b)
      _mat4b.copy(_headMat)
      _mat4b.multiply(_mat4a)
      centerMesh.setMatrixAt(i, _mat4b)

      // Petals
      const quats = flowerPetalQuats[i]
      for (let p = 0; p < f.petalCount; p++) {
        _mat4a.makeScale(f.petalWidth, f.petalLength, 1)
        _mat4b.makeTranslation(0, f.petalLength, 0)
        _mat4b.multiply(_mat4a)
        _mat4a.makeRotationFromQuaternion(quats[p])
        _mat4a.multiply(_mat4b)
        _mat4b.copy(_headMat)
        _mat4b.multiply(_mat4a)
        petalMesh.setMatrixAt(i * maxPetals + p, _mat4b)
      }
      for (let p = f.petalCount; p < maxPetals; p++) {
        petalMesh.setMatrixAt(i * maxPetals + p, ZERO_SCALE)
      }
    }

    if (gAttr) gAttr.needsUpdate = true
    if (petalMesh) petalMesh.instanceMatrix.needsUpdate = true
    if (centerMesh) centerMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      {/* Stem mesh is added imperatively via useEffect above */}

      {/* Instanced petals — 1 draw call */}
      <instancedMesh
        ref={petalInstanceRef}
        args={[petalGeo, sharedMaterial, totalPetalInstances]}
        frustumCulled={false}
        castShadow
      />

      {/* Instanced center discs — 1 draw call */}
      <instancedMesh
        ref={centerInstanceRef}
        args={[centerGeo, sharedMaterial, totalCenterInstances]}
        frustumCulled={false}
        castShadow
      />
    </group>
  )
}
