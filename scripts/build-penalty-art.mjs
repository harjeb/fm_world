// Original art source. Run from repo root with `node scripts/build-penalty-art.mjs`.
// Rig pivot is at the pelvis, local front is -Z. Shirt UVs reserve .25 for back / .75 for chest.
import * as T from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { bakeGrass } from './penalty-grass.mjs'
const dir = 'src/ui/penalty/art'
await mkdir(dir, { recursive: true })
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer()
    this.onloadend()
  }
}
const art = new T.Scene(),
  materials = {}
for (const [name, color] of Object.entries({
  shirt: 0xffffff,
  sleeve: 0xffeeee,
  trim: 0xe4edf1,
  shorts: 0x233846,
  sock: 0xecebed,
  skin: 0xc68e70,
  lip: 0x985852,
  hair: 0x302523,
  iris: 0x392b29,
  eye: 0xf3e2d6,
  boot: 0x1d2732,
  stud: 0xa8b3bc,
  glove: 0xfcf1ce,
  palm: 0x404e59,
  leather: 0xffffff,
  print: 0xffffff,
  grass: 0xffffff,
})) {
  const m = new T.MeshStandardMaterial({ color, roughness: name === 'stud' ? 0.4 : name === 'boot' ? 0.55 : 0.85 })
  m.name = name
  materials[name] = m
}
function group(name, parent, x = 0, y = 0, z = 0) {
  const g = new T.Group()
  g.name = name
  g.position.set(x, y, z)
  parent.add(g)
  return g
}
function mesh(g, mat, p, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(g, materials[mat])
  m.position.set(x, y, z)
  p.add(m)
  return m
}
function oval(p, mat, x, y, z, rx, ry, rz) {
  const m = mesh(new T.SphereGeometry(1, 16, 12), mat, p, x, y, z)
  m.scale.set(rx, ry, rz)
  return m
}
// Successive anatomical cross sections (height, half width, half depth, local z offset).
function loft(p, mat, rings, n = 32, fold = 0) {
  const pos = [],
    uv = [],
    ix = []
  for (let j = 0; j < rings.length; j++) {
    const [y, w, d, z = 0] = rings[j],
      v = (y - rings[0][0]) / (rings.at(-1)[0] - rings[0][0])
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        a = (u - 0.25) * 2 * Math.PI,
        f = 1 + fold * (1 - v) * Math.cos(a * 10 + v * 3)
      pos.push(Math.sin(a) * w * f, y, z + Math.cos(a) * d * f)
      uv.push(u, v)
      if (i < n && j < rings.length - 1) {
        const h = j * (n + 1) + i
        ix.push(h, h + 1, h + n + 1, h + 1, h + n + 2, h + n + 1)
      }
    }
  }
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  g.setIndex(ix)
  g.computeVertexNormals()
  return mesh(g, mat, p)
}
function line(p, mat, pts, r) {
  const curve = new T.CatmullRomCurve3(pts.map((a) => new T.Vector3(...a)))
  return mesh(new T.TubeGeometry(curve, Math.max(6, pts.length * 2), r, 6, false), mat, p)
}
const player = group('Athlete', art)
loft(
  player,
  'shirt',
  [
    [-0.18, 0.14, 0.105],
    [-0.16, 0.187, 0.136],
    [-0.13, 0.178, 0.129],
    [-0.1, 0.186, 0.138],
    [-0.07, 0.18, 0.13],
    [0.03, 0.169, 0.116],
    [0.14, 0.185, 0.135, -0.008],
    [0.25, 0.219, 0.146, -0.014],
    [0.34, 0.235, 0.133],
    [0.39, 0.219, 0.1],
    [0.421, 0.115, 0.077],
    [0.42 + 0.002, 0.088, 0.068],
  ],
  48,
  0.026,
)
loft(
  player,
  'shorts',
  [
    [-0.295, 0.171, 0.104],
    [-0.26, 0.195, 0.134],
    [-0.14, 0.195, 0.143],
    [-0.105, 0.178, 0.123],
  ],
  32,
  0.035,
)
loft(
  player,
  'trim',
  [
    [0.395, 0.115, 0.082],
    [0.422, 0.111, 0.079],
    [0.429, 0.093, 0.066],
  ],
  32,
)
loft(player, 'skin', [
  [0.401, 0.072, 0.064],
  [0.48, 0.07, 0.068],
  [0.525, 0.08, 0.077],
])
// Contoured brow, cheeks, jaw and chin rather than a sphere head. Face points towards the ball.
loft(player, 'skin', [
  [0.46, 0.032, 0.039, -0.045],
  [0.477, 0.071, 0.083, -0.027],
  [0.5, 0.094, 0.094, -0.012],
  [0.546, 0.104, 0.105],
  [0.573, 0.112, 0.114],
  [0.609, 0.116, 0.117],
  [0.645, 0.115, 0.113],
  [0.687, 0.106, 0.109],
  [0.724, 0.077, 0.084],
  [0.741, 0.012, 0.017],
])
for (const side of [-1, 1]) {
  oval(player, 'skin', side * 0.114, 0.566, 0.012, 0.021, 0.037, 0.02)
  oval(player, 'lip', side * 0.128, 0.568, 0.009, 0.006, 0.017, 0.01)
  oval(player, 'eye', side * 0.046, 0.6, -0.106, 0.03, 0.011, 0.01)
  oval(player, 'iris', side * 0.046, 0.601, -0.115, 0.009, 0.009, 0.0045)
  line(
    player,
    'hair',
    [
      [side * 0.017, 0.62, -0.114],
      [side * 0.045, 0.627, -0.11],
      [side * 0.075, 0.618, -0.095],
    ],
    0.005,
  )
}
oval(player, 'skin', 0, 0.57, -0.112, 0.023, 0.041, 0.025)
oval(player, 'skin', 0, 0.548, -0.129, 0.022, 0.013, 0.015)
line(
  player,
  'lip',
  [
    [-0.031, 0.517, -0.103],
    [0, 0.514, -0.115],
    [0.031, 0.517, -0.103],
  ],
  0.0038,
)
loft(player, 'hair', [
  [0.641, 0.112, 0.114, 0.006],
  [0.653, 0.117, 0.12, 0.006],
  [0.695, 0.114, 0.113],
  [0.728, 0.1, 0.102],
  [0.754, 0.068, 0.071],
  [0.767, 0.006, 0.012],
])
for (let i = -3; i <= 3; i++) {
  const x = i * 0.022
  line(
    player,
    'hair',
    [
      [x, 0.655, -0.106 + Math.abs(x) * 0.25],
      [x - 0.015, 0.711, -0.099],
      [x - 0.027, 0.747, -0.04],
    ],
    0.012,
  )
}
for (const [s, side] of [
  [-1, 'L'],
  [1, 'R'],
]) {
  const hip = group('Hip' + side, player, s * 0.1, -0.2, 0)
  loft(
    hip,
    'skin',
    [
      [-0.31, 0.056, 0.059],
      [-0.257, 0.073, 0.077],
      [-0.16, 0.085, 0.099],
      [-0.03, 0.083, 0.093],
    ],
    20,
  )
  loft(
    hip,
    'shorts',
    [
      [-0.14, 0.088, 0.104],
      [-0.12, 0.094, 0.106],
      [-0.034, 0.099, 0.115],
      [0.064, 0.083, 0.11],
    ],
    24,
    0.025,
  )
  const knee = group('Knee' + side, hip, 0, -0.29, 0)
  loft(
    knee,
    'skin',
    [
      [-0.105, 0.046, 0.053],
      [-0.07, 0.055, 0.063],
      [0, 0.058, 0.067],
      [0.034, 0.048, 0.055],
    ],
    20,
  )
  loft(
    knee,
    'sock',
    [
      [-0.348, 0.036, 0.048],
      [-0.283, 0.036, 0.046],
      [-0.195, 0.053, 0.066, 0.011],
      [-0.11, 0.06, 0.067, 0.014],
      [-0.057, 0.056, 0.06],
    ],
    20,
  )
  loft(
    knee,
    'trim',
    [
      [-0.091, 0.06, 0.066, 0.013],
      [-0.079, 0.059, 0.065, 0.013],
    ],
    20,
  )
  oval(knee, 'boot', 0, -0.365, -0.049, 0.061, 0.056, 0.13)
  oval(knee, 'palm', 0, -0.398, -0.052, 0.065, 0.019, 0.133)
  for (const x of [-0.034, 0.034])
    for (const z of [-0.12, 0.016]) oval(knee, 'stud', x, -0.418, z, 0.012, 0.014, 0.014)
  for (let i = 0; i < 4; i++)
    line(
      knee,
      'trim',
      [
        [-0.029, -0.323 - i * 0.002, -0.038 - i * 0.015],
        [0.029, -0.321 - i * 0.003, -0.044 - i * 0.015],
      ],
      0.003,
    )
  const shoulder = group('Shoulder' + side, player, s * 0.207, 0.326, 0)
  loft(
    shoulder,
    'skin',
    [
      [-0.23, 0.043, 0.049],
      [-0.18, 0.057, 0.061],
      [-0.078, 0.068, 0.072],
      [0, 0.055, 0.063],
    ],
    20,
  )
  loft(
    shoulder,
    'sleeve',
    [
      [-0.137, 0.072, 0.074],
      [-0.104, 0.076, 0.08],
      [-0.01, 0.084, 0.085],
      [0.036, 0.063, 0.062],
      [0.045, 0.03, 0.032],
    ],
    24,
  )
  loft(
    shoulder,
    'trim',
    [
      [-0.141, 0.072, 0.075],
      [-0.126, 0.074, 0.076],
    ],
    20,
  )
  const elbow = group('Elbow' + side, shoulder, 0, -0.211, 0)
  loft(
    elbow,
    'skin',
    [
      [-0.209, 0.03, 0.032],
      [-0.174, 0.033, 0.037],
      [-0.081, 0.047, 0.05],
      [-0.015, 0.045, 0.046],
      [0.017, 0.036, 0.041],
    ],
    20,
  )
  const hand = group('Hand' + side, elbow, 0, -0.194, 0)
  oval(hand, 'skin', 0, -0.058, -0.005, 0.036, 0.067, 0.026)
  oval(hand, 'skin', s * 0.031, -0.045, -0.018, 0.014, 0.037, 0.015)
}
const glove = group('Glove', art)
oval(glove, 'glove', 0, 0, 0, 0.082, 0.085, 0.044)
oval(glove, 'palm', 0, -0.025, 0.033, 0.068, 0.062, 0.017)
for (let j = 0; j < 4; j++) {
  const x = (j - 1.5) * 0.036
  const finger = oval(glove, 'glove', x, 0.081 - Math.abs(x) * 0.28, 0, 0.02, 0.062 - Math.abs(x) * 0.26, 0.024)
  finger.rotation.z = -x * 2
}
oval(glove, 'glove', -0.076, 0.018, 0, 0.035, 0.048, 0.03).rotation.z = 0.6
oval(glove, 'trim', 0, -0.071, 0, 0.059, 0.03, 0.045)
mesh(new T.PlaneGeometry(1, 1), 'grass', group('TurfSwatch', art))
const football = group('Football', art)
mesh(new T.SphereGeometry(0.11, 64, 40), 'leather', football)
mesh(new T.SphereGeometry(0.11012, 64, 40), 'print', football)
// Batch details sharing a material and pivot into a single draw call (still editable as source above).
function batch(p) {
  for (const ch of [...p.children]) if (ch.isGroup) batch(ch)
  const buckets = new Map()
  for (const ch of [...p.children])
    if (ch.isMesh) {
      ch.updateMatrix()
      const g = ch.geometry.clone().applyMatrix4(ch.matrix)
      if (!buckets.has(ch.material)) buckets.set(ch.material, [])
      buckets.get(ch.material).push(g)
      p.remove(ch)
    }
  for (const [m, gs] of buckets) p.add(new T.Mesh(mergeGeometries(gs), m))
}
batch(art)
// Paint a UV leather skin using the 12 pentagon + 20 hexagon face planes of a truncated icosahedron.
const ico = new T.IcosahedronGeometry(1, 0).attributes.position,
  planes = [],
  uniq = new Set()
for (let i = 0; i < ico.count; i += 3) {
  const vs = [0, 1, 2].map((j) => new T.Vector3().fromBufferAttribute(ico, i + j))
  const face = vs[0].clone().add(vs[1]).add(vs[2]).normalize()
  planes.push([face, face.dot(vs[0]), false])
  for (let j = 0; j < 3; j++) {
    const v = vs[j],
      key = v.toArray().join()
    if (!uniq.has(key)) {
      uniq.add(key)
      planes.push([v, (2 + v.dot(vs[(j + 1) % 3])) / 3, true])
    }
  }
}
function png(w, h, data) {
  function chunk(type, p) {
    const s = Buffer.concat([Buffer.from(type), p]),
      a = Buffer.alloc(4),
      b = Buffer.alloc(4)
    a.writeUInt32BE(p.length)
    let crc = -1
    for (const v of s) {
      crc ^= v
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320)
    }
    b.writeUInt32BE((crc ^ -1) >>> 0)
    return Buffer.concat([a, s, b])
  }
  const ih = Buffer.alloc(13)
  ih.writeUInt32BE(w)
  ih.writeUInt32BE(h, 4)
  ih[8] = 8
  ih[9] = 6
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let i = 0; i < h; i++) data.copy(raw, i * (1 + w * 4) + 1, i * w * 4, (i + 1) * w * 4)
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ih),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const w = 768,
  h = 384,
  base = Buffer.alloc(w * h * 4),
  ink = Buffer.alloc(w * h * 4),
  v = new T.Vector3()
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const theta = (Math.PI * (y + 0.5)) / h,
      phi = (2 * Math.PI * (x + 0.5)) / w
    v.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
    let first = -2,
      next = -2,
      pent = false
    for (const [n, d, k] of planes) {
      const t = v.dot(n) / d
      if (t > first) {
        next = first
        first = t
        pent = k
      } else if (t > next) next = t
    }
    const edge = first - next,
      pebble = 3 * Math.cos(193 * v.x) * Math.sin(244 * v.y + v.z * 74),
      seam = Math.min(1, edge / 0.015)
    const value = Math.round((pent ? 35 : 222) + pebble)
    const i = (y * w + x) * 4
    base.set(
      [
        value * seam + 22 * (1 - seam),
        (value + 4) * seam + 25 * (1 - seam),
        (value + 8) * seam + 29 * (1 - seam),
        255,
      ],
      i,
    )
    if ((edge > 0.017 && edge < 0.031) || (pent && edge > 0.086 && edge < 0.126)) ink.set([255, 255, 255, 255], i)
  }
const raw = Buffer.from(
  await new GLTFExporter().parseAsync(art, {
    binary: true,
    trs: true,
    copyright: 'FM World — original penalty training art',
  }),
)
const jl = raw.readUInt32LE(12),
  json = JSON.parse(raw.subarray(20, 20 + jl)),
  parts = [raw.subarray(28 + jl)]
let total = parts[0].length
json.images = []
json.textures = []
const grass = bakeGrass()
for (const [name, pixels, width, height] of [
  ['leather', base, w, h],
  ['print', ink, w, h],
  ['grass', grass.pixels, grass.n, grass.n],
  ['normal', grass.normal, grass.n, grass.n],
]) {
  const bytes = png(width, height, pixels),
    buf = Buffer.alloc(Math.ceil(bytes.length / 4) * 4)
  bytes.copy(buf)
  const bv = json.bufferViews.push({ buffer: 0, byteOffset: total, byteLength: bytes.length }) - 1
  parts.push(buf)
  total += buf.length
  const i = json.images.push({ bufferView: bv, mimeType: 'image/png' }) - 1
  json.textures.push({ source: i })
  const m = json.materials.find((m) => m.name === (name === 'normal' ? 'grass' : name))
  if (name === 'normal') m.normalTexture = { index: i, scale: 0.7 }
  else m.pbrMetallicRoughness.baseColorTexture = { index: i }
  if (name === 'print') {
    m.alphaMode = 'MASK'
    m.alphaCutoff = 0.45
  }
}
json.buffers[0].byteLength = total
const txt = Buffer.from(JSON.stringify(json)),
  padded = Buffer.alloc(Math.ceil(txt.length / 4) * 4, 32)
txt.copy(padded)
const head = Buffer.alloc(20),
  bh = Buffer.alloc(8)
head.write('glTF')
head.writeUInt32LE(2, 4)
head.writeUInt32LE(28 + padded.length + total, 8)
head.writeUInt32LE(padded.length, 12)
head.write('JSON', 16)
bh.writeUInt32LE(total)
bh.writeUInt32LE(0x004e4942, 4)
await writeFile(`${dir}/matchday.glb`, Buffer.concat([head, padded, bh, ...parts]))
console.log('Baked matchday.glb', total, 'binary bytes')
