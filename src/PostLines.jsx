import { useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Procedural textures (no external assets needed)
// ---------------------------------------------------------------------------

function createNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(Math.random() * 256)
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, size, size)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

// Paper texture removed — grain is now generated in the shader via thresholded noise

// ---------------------------------------------------------------------------
// Shaders (ported from spite/sketch post-lines-i)
// ---------------------------------------------------------------------------

const vertexShader = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

const fragmentShader = `precision highp float;

uniform sampler2D colorTexture;
uniform sampler2D normalTexture;
uniform sampler2D noiseTexture;
uniform vec3 inkColor;
uniform float noiseScale;
uniform float paperThreshold;
uniform float scale;
uniform float thickness;
uniform float noisiness;
uniform float angle;
uniform float contour;
uniform float divergence;
uniform sampler2D maskTexture;
uniform vec3 networkInkColor;
uniform float networkGlow;

out vec4 fragColor;
in vec2 vUv;

// --- Sobel edge detection ---
vec4 sobel(in sampler2D src, in vec2 uv, in vec2 resolution, in float width) {
  float x = width / resolution.x;
  float y = width / resolution.y;
  vec4 horizEdge = vec4(0.0);
  horizEdge -= texture(src, vec2(uv.x - x, uv.y - y)) * 1.0;
  horizEdge -= texture(src, vec2(uv.x - x, uv.y    )) * 2.0;
  horizEdge -= texture(src, vec2(uv.x - x, uv.y + y)) * 1.0;
  horizEdge += texture(src, vec2(uv.x + x, uv.y - y)) * 1.0;
  horizEdge += texture(src, vec2(uv.x + x, uv.y    )) * 2.0;
  horizEdge += texture(src, vec2(uv.x + x, uv.y + y)) * 1.0;
  vec4 vertEdge = vec4(0.0);
  vertEdge -= texture(src, vec2(uv.x - x, uv.y - y)) * 1.0;
  vertEdge -= texture(src, vec2(uv.x    , uv.y - y)) * 2.0;
  vertEdge -= texture(src, vec2(uv.x + x, uv.y - y)) * 1.0;
  vertEdge += texture(src, vec2(uv.x - x, uv.y + y)) * 1.0;
  vertEdge += texture(src, vec2(uv.x    , uv.y + y)) * 2.0;
  vertEdge += texture(src, vec2(uv.x + x, uv.y + y)) * 1.0;
  return sqrt(horizEdge * horizEdge + vertEdge * vertEdge);
}

// --- Luminance ---
float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

// --- Anti-aliased step ---
float aastep(float threshold, float value) {
  float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
  return smoothstep(threshold - afwidth, threshold + afwidth, value);
}

// --- Blend darken ---
vec3 blendDarken(vec3 base, vec3 blend, float opacity) {
  return min(base, blend) * opacity + base * (1.0 - opacity);
}

#define TAU 6.28318530718
#define LEVELS 10
#define fLEVELS float(LEVELS)

// --- Simplex noise from texture ---
float simplex(in vec3 v) {
  return 2.0 * texture(noiseTexture, v.xy / 32.0).r - 1.0;
}

// --- FBM ---
float fbm3(vec3 v) {
  float result = simplex(v);
  result += simplex(v * 2.0) / 2.0;
  result += simplex(v * 4.0) / 4.0;
  result /= (1.0 + 0.5 + 0.25);
  return result;
}

// --- Hatching lines ---
float lines(in float l, in vec2 fragCoord, in vec2 resolution, in float thick) {
  vec2 uv = fragCoord.xy * resolution;
  float c = 0.5 + 0.5 * sin(uv.x * 0.5);
  float f = (c + thick) * l;
  float e = 1.0 * length(vec2(dFdx(fragCoord.x), dFdy(fragCoord.y)));
  f = smoothstep(0.5 - e, 0.5 + e, f);
  return f;
}

void main() {
  vec2 size = vec2(textureSize(colorTexture, 0));

  // Noise-offset the UV
  float ss = noiseScale;
  vec2 offset = noisiness * vec2(
    fbm3(vec3(ss * vUv, 1.0)),
    fbm3(vec3(ss * vUv.yx, 1.0))
  );
  vec2 uv = vUv + offset;

  // Sample & quantize luminance
  float l = luma(texture(colorTexture, uv).rgb);
  l = round(l * fLEVELS) / fLEVELS;
  float hatch = 1.0;

  // Normal-based edge detection
  float normalEdge = length(sobel(normalTexture, uv, size, 3.0 * contour));
  normalEdge = 1.0 - aastep(0.5, normalEdge);
  l *= normalEdge;
  l *= 2.0;
  l = clamp(l, 0.0, 1.0);

  // Multi-level hatching
  for (int i = 0; i < LEVELS; i++) {
    float f = float(i) / fLEVELS;

    if (l <= f) {
      float ss2 = noiseScale * mix(1.0, 4.0, f);
      vec2 off2 = noisiness * vec2(
        fbm3(vec3(ss2 * vUv, 1.0)),
        fbm3(vec3(ss2 * vUv.yx, 1.0))
      );
      vec2 uv2 = vUv + off2;

      float a = angle + divergence * mix(0.0, 3.2 * TAU, f);
      float s = sin(a);
      float c = cos(a);
      mat2 rot = mat2(c, -s, s, c);
      uv2 = rot * (uv2 - 0.5) + 0.5;

      float w = l / f;
      float v = lines(w, scale * mix(5.0, 1.0, f) * uv2, size, w * (1.0 - thickness));
      hatch *= v;
    }
  }

  float mask = texture(maskTexture, vUv).r;
  vec3 ink = mix(inkColor, networkInkColor, mask);

  // Sharp grain: sample noise at screen-pixel scale, threshold to black specks
  float grain = texture(noiseTexture, vUv * size / 256.0).r;
  float speck = step(paperThreshold, grain);  // 1 = white, 0 = dark speck
  vec3 paper = vec3(mix(0.88, 1.0, speck));   // dark specks on white
  fragColor.rgb = blendDarken(paper, ink, 1.0 - hatch);
  // Additive glow for network objects
  fragColor.rgb += networkInkColor * mask * networkGlow;
  fragColor.a = 1.0;
}
`

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export function PostLines({
  scale = 0.5,
  noiseScale = 0.72,
  angle = 2.0,
  divergence = 1.0,
  thickness = 0.72,
  contour = 1.2,
  noisiness = 0.007,
  inkColor = '#446b93',
  paperThreshold = 0.15,
  networkInkColor = '#88ccff',
  networkGlow = 0.5,
}) {
  const { gl, scene, camera, size } = useThree()

  // --- Override materials for mask / normal passes ---
  const normalMat = useMemo(
    () => new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
    [],
  )
  const maskMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0xffffff }),
    [],
  )

  // --- Procedural textures ---
  const noiseTexture = useMemo(() => createNoiseTexture(), [])

  // --- Render targets ---
  const colorTarget = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        type: THREE.HalfFloatType,
      }),
    [],
  )

  const normalTarget = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [],
  )

  const maskTarget = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [],
  )

  // --- Scene & camera for fullscreen quad rendering ---
  const quadScene = useMemo(() => new THREE.Scene(), [])
  const quadCamera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    [],
  )

  // --- Hatching shader material ---
  const shaderMat = useMemo(() => {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        colorTexture: { value: null },
        normalTexture: { value: null },
        noiseTexture: { value: noiseTexture },
        inkColor: { value: new THREE.Color(inkColor) },
        paperThreshold: { value: paperThreshold },
        scale: { value: scale },
        noiseScale: { value: noiseScale },
        thickness: { value: thickness },
        noisiness: { value: noisiness },
        angle: { value: angle },
        contour: { value: contour },
        divergence: { value: divergence },
        maskTexture: { value: null },
        networkInkColor: { value: new THREE.Color(networkInkColor) },
        networkGlow: { value: networkGlow },
      },
      depthTest: false,
      depthWrite: false,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Build the hatching fullscreen quad once
  useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geo, shaderMat)
    mesh.frustumCulled = false
    quadScene.add(mesh)
  }, [shaderMat, quadScene])

  // --- Resize render targets when viewport changes ---
  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.floor(size.width * dpr)
    const h = Math.floor(size.height * dpr)
    colorTarget.setSize(w, h)
    normalTarget.setSize(w, h)
    maskTarget.setSize(w, h)
  }, [size, gl, colorTarget, normalTarget, maskTarget])

  // --- Sync uniforms with props ---
  useEffect(() => {
    const u = shaderMat.uniforms
    u.scale.value = scale
    u.noiseScale.value = noiseScale
    u.thickness.value = thickness
    u.noisiness.value = noisiness
    u.angle.value = angle
    u.contour.value = contour
    u.divergence.value = divergence
    u.inkColor.value.set(inkColor)
    u.paperThreshold.value = paperThreshold
    u.networkInkColor.value.set(networkInkColor)
    u.networkGlow.value = networkGlow
  }, [scale, noiseScale, thickness, noisiness, angle, contour, divergence, inkColor, paperThreshold, networkInkColor, networkGlow, shaderMat])

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      colorTarget.dispose()
      normalTarget.dispose()
      maskTarget.dispose()
      noiseTexture.dispose()
      shaderMat.dispose()
    }
  }, [colorTarget, normalTarget, maskTarget, noiseTexture, shaderMat])

  // -----------------------------------------------------------------------
  // Render loop (priority 1 takes over from R3F's default render)
  // -----------------------------------------------------------------------
  const _prevClear = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const bg = scene.background
    gl.getClearColor(_prevClear)
    const prevAlpha = gl.getClearAlpha()
    const prevToneMapping = gl.toneMapping
    const prevAutoClear = gl.autoClear
    gl.autoClear = false

    // 1. Color pass — render lit scene to HDR FBO
    gl.toneMapping = THREE.NoToneMapping
    gl.setRenderTarget(colorTarget)
    gl.clear()
    gl.render(scene, camera)

    // Switch to black clear for mask / normal passes
    gl.setClearColor(0x000000, 1)

    // 2. Mask pass — visibility-toggle so only network meshes render white
    scene.background = null
    const hidden = []
    scene.traverse((obj) => {
      if (obj.isMesh && (!obj.userData.isNetwork || obj.userData.isCursor) && obj.visible) {
        obj.visible = false
        hidden.push(obj)
      }
    })
    scene.overrideMaterial = maskMat
    gl.setRenderTarget(maskTarget)
    gl.clear()
    gl.render(scene, camera)
    scene.overrideMaterial = null
    for (const obj of hidden) obj.visible = true

    // 3. Normal pass — black background, normal material override
    //    Hide cursor meshes and flower stems (stems use a wind vertex shader
    //    that overrideMaterial ignores, causing static duplicates)
    const hiddenCursor = []
    scene.traverse((obj) => {
      if (obj.isMesh && (obj.userData.isCursor || obj.userData.isFlowerStem) && obj.visible) {
        obj.visible = false
        hiddenCursor.push(obj)
      }
    })
    scene.overrideMaterial = normalMat
    gl.setRenderTarget(normalTarget)
    gl.clear()
    gl.render(scene, camera)
    scene.overrideMaterial = null
    for (const obj of hiddenCursor) obj.visible = true
    scene.background = bg

    // Restore clear color and tone mapping
    gl.setClearColor(_prevClear, prevAlpha)
    gl.toneMapping = prevToneMapping

    // 4. Hatching → screen
    shaderMat.uniforms.colorTexture.value = colorTarget.texture
    shaderMat.uniforms.normalTexture.value = normalTarget.texture
    shaderMat.uniforms.maskTexture.value = maskTarget.texture
    gl.setRenderTarget(null)
    gl.clear()
    gl.render(quadScene, quadCamera)

    gl.autoClear = prevAutoClear
  }, 1)

  return null
}
