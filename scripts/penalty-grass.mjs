// Original seamless grass albedo + tangent-space normal tile, seed fixed for reproducible builds.
export function bakeGrass(n = 384) {
  let seed = 17311
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const pixels = Buffer.alloc(n * n * 4),
    normal = Buffer.alloc(n * n * 4),
    height = new Float32Array(n * n)
  const index = (x, y) => ((y + n) % n) * n + ((x + n) % n)
  for (let i = 0; i < n * n; i++) {
    const x = i % n,
      y = Math.floor(i / n),
      patch = 3 * Math.sin((2 * Math.PI * x) / n) * Math.cos((4 * Math.PI * y) / n),
      v = rnd() * 9 + patch
    pixels.set([38 + v, 84 + v, 45 + 0.65 * v, 255], 4 * i)
    height[i] = rnd() * 0.14
  }
  for (let b = 0; b < 24500; b++) {
    const x = rnd() * n,
      y = rnd() * n,
      len = 2 + rnd() * 6,
      lean = (rnd() - 0.42) * 0.96,
      light = rnd(),
      curve = (rnd() - 0.5) * 2
    for (let j = 0; j < len; j += 0.7) {
      const t = j / len,
        i = index(Math.round(x + j * lean + curve * t * t), Math.round(y - j)),
        v = 9 * t + light * 20
      pixels.set([39 + v, 92 + v * 1.38, 43 + v * 0.82, 255], i * 4)
      height[i] = 0.22 + light * 0.23 + 0.34 * t
    }
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const nx = (height[index(x - 1, y)] - height[index(x + 1, y)]) * 0.48,
        ny = (height[index(x, y + 1)] - height[index(x, y - 1)]) * 0.48,
        len = Math.hypot(nx, ny, 1)
      normal.set([128 + (nx / len) * 127, 128 + (ny / len) * 127, 128 + 127 / len, 255], index(x, y) * 4)
    }
  return { n, pixels, normal }
}
