// ── Ordered dithering (Bayer 8×8) shared utility ──

export const BAYER_8x8 = [
  [ 0, 48, 12, 60,  3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [ 8, 56,  4, 52, 11, 59,  7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [ 2, 50, 14, 62,  1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58,  6, 54,  9, 57,  5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
]

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function applyDither(ctx, w, h, { scale, threshold, inkColor, brightness, contrast }) {
  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data
  const ink = hexToRgb(inkColor)
  const s = Math.max(1, Math.round(scale))
  for (let y = 0; y < h; y++) {
    const row = BAYER_8x8[(Math.floor(y / s)) & 7]
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) << 2
      if (d[i + 3] < 10) continue
      let luma = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
      // Brightness shifts, contrast scales around midpoint
      luma = (luma - 0.5) * contrast + 0.5 + brightness
      luma = Math.max(0, Math.min(1, luma))
      // threshold scales the Bayer comparison: >1 = more ink, <1 = more white
      const bayerVal = row[(Math.floor(x / s)) & 7] / 64
      if (luma > bayerVal * threshold) {
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255
      } else {
        d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2]
      }
    }
  }
  ctx.putImageData(imageData, 0, 0)
}
