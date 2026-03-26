import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Procedural Flower with growth animation.
 *
 * Renders ONLY the stem. Petal/center rendering is handled by FlowerField
 * via instanced meshes. This component writes its head transform to `headRef`
 * so FlowerField can position the instanced petals.
 */
export function Flower({
  stemLength = 1.5,
  stemSegments = 8,
  stemNoiseStrength = 0.1,
  stemRadius = 0.02,
  petalCount = 6,
  petalLength = 0.3,
  petalWidth = 0.08,
  centerRadius = 0.06,
  seed = 0,
  position = [0, 0, 0],
  growthRef,
  headRef: headData,  // { position, quaternion, scale, visible } — written to by useFrame
  tubularSegments = 8,
  radialSegments = 4,
  windSpeed = 0.5,
  windStrength = 0.15,
  windFrequency = 3.0,
}) {
  const groupRef = useRef()
  const shadowProgressRef = useRef(0)
  // Cache for "settled" state — fully grown, shadows done
  const settledRef = useRef(false)
  const cachedTipRef = useRef(null)       // { x, y, z } base tip position
  const cachedQuatRef = useRef(null)       // THREE.Quaternion for head orientation
  const prevShadowStateRef = useRef(false) // last castShadow value we applied

  // Build the full-size stem curve once (at target size)
  const { stemRands } = useMemo(() => {
    const rng = mulberry32(seed)

    const rands = []
    const segCount = Math.max(2, stemSegments)
    for (let i = 0; i <= segCount; i++) {
      rands.push({ x: (rng() - 0.5) * 2, z: (rng() - 0.5) * 2 })
    }

    return { stemRands: rands }
  }, [stemLength, stemSegments, stemNoiseStrength, seed])

  // Build a stem curve that's scaled by current growth factor and animated by wind
  const stemMeshRef = useRef()
  const prevGrowthRef = useRef(-1)
  const curveRef = useRef(null)
  const basePointsRef = useRef([])

  // Reset settled state when stem params change so geometry gets rebuilt
  useEffect(() => {
    settledRef.current = false
    prevGrowthRef.current = -1
  }, [stemLength, stemSegments, stemNoiseStrength, stemRadius, tubularSegments, radialSegments])

  // --- GPU wind + shadow materials ---
  const windUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSeed: { value: seed },
    uStemHeight: { value: 0 },
    uWindStrength: { value: windStrength },
    uWindFrequency: { value: windFrequency },
  }), [seed])
  const shadowOpacityUniform = useMemo(() => ({ value: 0.0 }), [])

  const WIND_VERTEX = `
    float ht = uStemHeight > 0.001 ? transformed.y / uStemHeight : 0.0;
    float windStr = ht * ht * uWindStrength;
    transformed.x += sin(ht * uWindFrequency + uTime + uSeed) * windStr;
    transformed.z += cos(ht * uWindFrequency * 0.8 + uTime * 0.8 + uSeed) * windStr;`
  const WIND_UNIFORMS_GLSL = 'uniform float uTime;\nuniform float uSeed;\nuniform float uStemHeight;\nuniform float uWindStrength;\nuniform float uWindFrequency;\n'

  const DITHER_FRAGMENT = `uniform float shadowOpacity;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      if (hash(floor(gl_FragCoord.xy * 0.5)) > shadowOpacity) discard;`

  const stemMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide })
    mat.customProgramCacheKey = () => 'flowerStemWind'
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime
      shader.uniforms.uSeed = windUniforms.uSeed
      shader.uniforms.uStemHeight = windUniforms.uStemHeight
      shader.uniforms.uWindStrength = windUniforms.uWindStrength
      shader.uniforms.uWindFrequency = windUniforms.uWindFrequency
      shader.vertexShader = WIND_UNIFORMS_GLSL + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + WIND_VERTEX
      )
    }
    return mat
  }, [windUniforms])

  const stemDepthMat = useMemo(() => {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime
      shader.uniforms.uSeed = windUniforms.uSeed
      shader.uniforms.uStemHeight = windUniforms.uStemHeight
      shader.uniforms.uWindStrength = windUniforms.uWindStrength
      shader.uniforms.uWindFrequency = windUniforms.uWindFrequency
      shader.uniforms.shadowOpacity = shadowOpacityUniform
      shader.vertexShader = WIND_UNIFORMS_GLSL + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + WIND_VERTEX
      )
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', DITHER_FRAGMENT)
    }
    return mat
  }, [windUniforms, shadowOpacityUniform])

  useFrame((state, delta) => {
    if (!stemMeshRef.current) return

    const g = Math.max(0, Math.min(1, growthRef ? growthRef.value : 0))

    // Hide until growth starts — also mark head as not visible
    if (g < 0.001) {
      groupRef.current.visible = false
      settledRef.current = false
      if (headData) headData.visible = false
      return
    }

    // ── FAST PATH: fully grown + shadows done ──
    if (settledRef.current) {
      const timeOffset = state.clock.elapsedTime * windSpeed
      windUniforms.uTime.value = timeOffset
      windUniforms.uWindStrength.value = windStrength
      windUniforms.uWindFrequency.value = windFrequency
      // Update head position for instanced petals
      const windX = Math.sin(windFrequency + timeOffset + seed) * windStrength
      const windZ = Math.cos(windFrequency * 0.8 + timeOffset * 0.8 + seed) * windStrength
      const tip = cachedTipRef.current
      if (headData && tip) {
        headData.position.set(tip.x + windX, tip.y, tip.z + windZ)
      }
      return
    }

    // ── FULL PATH: still growing ──
    groupRef.current.visible = true
    const scaleT = Math.min(1, g / 0.15)
    groupRef.current.scale.setScalar(Math.max(0.001, scaleT))

    stemMeshRef.current.visible = true

    // Update head visibility for instanced rendering
    const headVisible = g > 0.5
    if (headData) headData.visible = headVisible

    const growthChanged = Math.abs(g - prevGrowthRef.current) > 0.001

    if (growthChanged) {
      prevGrowthRef.current = g

      const currentPoints = []
      const segCount = Math.max(2, stemSegments)
      const noiseScale = g * g
      for (let i = 0; i <= segCount; i++) {
        const segT = i / segCount
        const y = segT * stemLength * g
        const noiseFactor = segT * segT
        const r = stemRands[i]
        const nx = r.x * stemNoiseStrength * noiseFactor * noiseScale
        const nz = r.z * stemNoiseStrength * noiseFactor * noiseScale
        currentPoints.push(new THREE.Vector3(nx, y, nz))
      }

      basePointsRef.current = currentPoints
      const curve = new THREE.CatmullRomCurve3(currentPoints)
      curveRef.current = curve

      const oldGeo = stemMeshRef.current.geometry
      if (oldGeo) oldGeo.dispose()
      const tubSegs = g < 0.15 ? Math.min(4, tubularSegments) : tubularSegments
      const tubeGeo = new THREE.TubeGeometry(curve, tubSegs, stemRadius, radialSegments, false)
      tubeGeo.computeBoundingSphere()
      stemMeshRef.current.geometry = tubeGeo
    }

    // Update wind uniforms
    const timeOffset = state.clock.elapsedTime * windSpeed
    windUniforms.uTime.value = timeOffset
    windUniforms.uWindStrength.value = windStrength
    windUniforms.uWindFrequency.value = windFrequency
    windUniforms.uStemHeight.value = stemLength * g

    // Write head transform for FlowerField's instanced rendering
    if (curveRef.current) {
      const curve = curveRef.current
      const tip = curve.getPointAt(1)
      const tangent = curve.getTangentAt(1).normalize()

      const windX = Math.sin(windFrequency + timeOffset + seed) * windStrength
      const windZ = Math.cos(windFrequency * 0.8 + timeOffset * 0.8 + seed) * windStrength

      if (!cachedQuatRef.current) cachedQuatRef.current = new THREE.Quaternion()
      cachedQuatRef.current.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)

      const petalGrowth = Math.max(0, (g - 0.5) * 2)
      const s = petalGrowth * petalGrowth

      // Write to headData for instanced petal rendering
      if (headData) {
        headData.position.set(tip.x + windX, tip.y, tip.z + windZ)
        headData.quaternion.copy(cachedQuatRef.current)
        headData.scale = Math.max(0.001, s)
      }

      cachedTipRef.current = { x: tip.x, y: tip.y, z: tip.z }
    }

    // Shadow fade-in
    const growthDone = g >= 0.98
    if (growthDone) {
      shadowProgressRef.current = Math.min(1, shadowProgressRef.current + delta * 1.5)
    } else {
      shadowProgressRef.current = 0
    }
    shadowOpacityUniform.value = shadowProgressRef.current

    const wantShadow = shadowProgressRef.current > 0
    if (wantShadow !== prevShadowStateRef.current) {
      prevShadowStateRef.current = wantShadow
      if (stemMeshRef.current) stemMeshRef.current.castShadow = wantShadow
    }

    if (growthDone && shadowProgressRef.current >= 1) {
      settledRef.current = true
    }
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Stem tube — geometry is injected dynamically by useFrame */}
      <mesh ref={stemMeshRef} material={stemMaterial} customDepthMaterial={stemDepthMat} frustumCulled={false} visible={false}
        userData={{ isFlowerStem: true }} />
    </group>
  )
}

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
