// Original art source. Run from repo root with `node scripts/build-penalty-art.mjs`.
// Rig pivot is at the pelvis (y=0, straight-leg ground at y=-0.963, total ~1.78m), local front is -Z.
// Shirt UVs reserve u=0.25 for back / u=0.75 for chest.
// Includes 6 conformal footballer hairstyles (Hair0..Hair5), optional Beard, Ankle pivots, and true L/R Gloves.
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

const matSpecs = {
  shirt: { color: 0xffffff, roughness: 0.78, metalness: 0.02 },
  sleeve: { color: 0xffeeee, roughness: 0.78, metalness: 0.02 },
  trim: { color: 0xe8eff3, roughness: 0.62, metalness: 0.06 },
  shorts: { color: 0x233846, roughness: 0.8, metalness: 0.02 },
  sock: { color: 0xecebed, roughness: 0.84, metalness: 0.0 },
  skin: { color: 0xc68e70, roughness: 0.64, metalness: 0.0 },
  lip: { color: 0x9c6258, roughness: 0.68, metalness: 0.0 },
  hair: { color: 0x2c221f, roughness: 0.74, metalness: 0.04 },
  iris: { color: 0x2c221e, roughness: 0.35, metalness: 0.05 },
  eye: { color: 0xf4ece6, roughness: 0.4, metalness: 0.0 },
  boot: { color: 0x1a222c, roughness: 0.38, metalness: 0.14 },
  bootAccent: { color: 0xcdf33f, roughness: 0.35, metalness: 0.18 },
  bootSole: { color: 0x131820, roughness: 0.55, metalness: 0.1 },
  stud: { color: 0xc6d0d8, roughness: 0.28, metalness: 0.6 },
  glove: { color: 0xf7f9fb, roughness: 0.5, metalness: 0.04 },
  palm: { color: 0x26313b, roughness: 0.84, metalness: 0.02 },
  leather: { color: 0xffffff, roughness: 0.48, metalness: 0.04 },
  print: { color: 0xffffff, roughness: 0.45, metalness: 0.05 },
  grass: { color: 0xffffff, roughness: 0.94, metalness: 0.0 },
}
for (const [name, spec] of Object.entries(matSpecs)) {
  const m = new T.MeshStandardMaterial(spec)
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
  const m = mesh(new T.SphereGeometry(1, 18, 14), mat, p, x, y, z)
  m.scale.set(rx, ry, rz)
  return m
}

// Smooth anatomical cross-section loft: [y, halfWidth, halfDepth, zOffset?, frontDepthScale?, xOffset?]
function loft(p, mat, rings, n = 36, fold = 0) {
  const pos = [],
    uv = [],
    ix = []
  for (let j = 0; j < rings.length; j++) {
    const [y, w, d, z = 0, frontScale = 1, xOff = 0] = rings[j],
      v = (y - rings[0][0]) / (rings.at(-1)[0] - rings[0][0] || 1)
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        a = (u - 0.25) * 2 * Math.PI,
        ca = Math.cos(a),
        sa = Math.sin(a),
        depth = ca < 0 ? d * frontScale : d,
        f = 1 + fold * Math.sin(v * Math.PI) * Math.cos(a * 6 + v * 2.5)
      pos.push(xOff + sa * w * f, y, z + ca * depth * f)
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

// Closed smooth loft along Z axis (ideal for sleek unified football boots!)
// rings: [z, halfWidth, yBottom, yTop]
function bootLoft(p, mat, rings, n = 28) {
  const pos = [],
    uv = [],
    ix = []
  for (let j = 0; j < rings.length; j++) {
    const [z, w, yBot, yTop] = rings[j],
      yc = (yBot + yTop) * 0.5,
      ry = Math.max(0.002, (yTop - yBot) * 0.5),
      v = j / (rings.length - 1)
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        a = u * 2 * Math.PI,
        ca = Math.cos(a),
        sa = Math.sin(a)
      // Flatten bottom half slightly for a clean sole contact profile
      const yNorm = sa < 0 ? -Math.pow(-sa, 0.72) : sa
      pos.push(ca * w, yc + yNorm * ry, z)
      uv.push(u, v)
      if (i < n && j < rings.length - 1) {
        const h = j * (n + 1) + i
        ix.push(h, h + n + 1, h + 1, h + 1, h + n + 1, h + n + 2)
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

function line(p, mat, pts, r, segs = 10) {
  const curve = new T.CatmullRomCurve3(pts.map((a) => new T.Vector3(...a)))
  return mesh(new T.TubeGeometry(curve, Math.max(segs, pts.length * 3), r, 8, false), mat, p)
}

function sampleProfile(rings, y) {
  if (y <= rings[0][0]) return rings[0]
  if (y >= rings.at(-1)[0]) return rings.at(-1)
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i],
      b = rings[i + 1]
    if (y >= a[0] && y <= b[0]) {
      const t = (y - a[0]) / (b[0] - a[0] || 1)
      return a.map((v, k) => v + (b[k] - v) * t)
    }
  }
  return rings.at(-1)
}

const player = group('Athlete', art)

// --- ATHLETIC V-TAPERED TORSO (SHIRT) ---
loft(
  player,
  'shirt',
  [
    [-0.105, 0.156, 0.106, 0.0],
    [-0.075, 0.164, 0.114, 0.0],
    [0.005, 0.153, 0.107, 0.001],
    [0.095, 0.164, 0.114, 0.0],
    [0.195, 0.186, 0.125, -0.005, 1.07],
    [0.295, 0.208, 0.13, -0.008, 1.08],
    [0.365, 0.212, 0.116, -0.004, 1.04],
    [0.405, 0.178, 0.096, 0.0],
    [0.435, 0.118, 0.078, 0.002],
    [0.452, 0.076, 0.064, 0.002],
  ],
  48,
  0.006,
)

// Clean modern athletic crew/V collar
loft(
  player,
  'trim',
  [
    [0.432, 0.095, 0.074, 0.001, 1.06],
    [0.448, 0.084, 0.069, 0.002, 1.03],
    [0.459, 0.068, 0.06, 0.002],
  ],
  32,
)

// Smooth tapered pelvis / shorts upper shell
loft(
  player,
  'shorts',
  [
    [-0.168, 0.154, 0.096, 0.0],
    [-0.125, 0.168, 0.11, 0.002],
    [-0.075, 0.165, 0.112, 0.002],
    [-0.045, 0.156, 0.107, 0.0],
  ],
  32,
  0.005,
)

// --- NATURAL ATHLETIC NECK ---
loft(
  player,
  'skin',
  [
    [0.44, 0.062, 0.059, 0.002],
    [0.48, 0.055, 0.056, -0.002],
    [0.515, 0.057, 0.058, -0.005],
    [0.54, 0.063, 0.063, -0.006],
  ],
  28,
)

// --- HEAD GROUP (centered at y=0.625 for subtle per-player head-shape template scaling) ---
const headOriginY = 0.625
const headGroup = group('Head', player, 0, headOriginY, 0)
const headRings = [
  [0.502 - headOriginY, 0.029, 0.033, -0.042],
  [0.517 - headOriginY, 0.058, 0.066, -0.025],
  [0.544 - headOriginY, 0.077, 0.086, -0.014],
  [0.58 - headOriginY, 0.087, 0.097, -0.007],
  [0.616 - headOriginY, 0.092, 0.104, -0.003],
  [0.654 - headOriginY, 0.094, 0.106, 0.0],
  [0.69 - headOriginY, 0.09, 0.102, 0.002],
  [0.722 - headOriginY, 0.077, 0.089, 0.003],
  [0.744 - headOriginY, 0.049, 0.059, 0.003],
  [0.754 - headOriginY, 0.008, 0.01, 0.002],
]
loft(headGroup, 'skin', headRings, 36)

for (const side of [-1, 1]) {
  const ear = oval(headGroup, 'skin', side * 0.092, 0.614 - headOriginY, 0.008, 0.014, 0.028, 0.016)
  ear.rotation.z = side * -0.1
  oval(headGroup, 'eye', side * 0.034, 0.64 - headOriginY, -0.094, 0.019, 0.0085, 0.007)
  oval(headGroup, 'iris', side * 0.034, 0.64 - headOriginY, -0.1, 0.0072, 0.0072, 0.0035)
  line(
    headGroup,
    'hair',
    [
      [side * 0.013, 0.656 - headOriginY, -0.101],
      [side * 0.035, 0.661 - headOriginY, -0.097],
      [side * 0.06, 0.653 - headOriginY, -0.085],
    ],
    0.0044,
    8,
  )
}
line(
  headGroup,
  'skin',
  [
    [0, 0.646 - headOriginY, -0.099],
    [0, 0.616 - headOriginY, -0.111],
    [0, 0.6 - headOriginY, -0.113],
  ],
  0.0115,
  8,
)
oval(headGroup, 'skin', 0, 0.6 - headOriginY, -0.109, 0.015, 0.009, 0.011)
line(
  headGroup,
  'lip',
  [
    [-0.022, 0.564 - headOriginY, -0.096],
    [0, 0.562 - headOriginY, -0.103],
    [0.022, 0.564 - headOriginY, -0.096],
  ],
  0.0034,
  8,
)

// Conformal hair shell builder sampled directly from headRings so ZERO hair style floats off the skull!
function buildConformalHair(parent, opts) {
  const {
    backDrop = 0.068,
    frontLift = 0.055,
    baseY = 0.625,
    topY = 0.768,
    minThick = 0.003,
    topThick = 0.011,
    sideFade = 0.0,
    ripple = 0.002,
    ridgeBoost = 0.0,
    crownFluff = 0.0,
  } = opts
  const n = 44,
    rows = 12,
    pos = [],
    uv = [],
    ix = []
  for (let j = 0; j <= rows; j++) {
    const v = j / rows
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        a = (u - 0.25) * 2 * Math.PI,
        ca = Math.cos(a), // +1 back (+Z), -1 front (-Z)
        sa = Math.sin(a)
      const backW = Math.max(0, ca) ** 1.35
      const frontW = Math.max(0, -ca) ** 1.25
      const earDip = Math.exp(-Math.pow((ca - 0.05) / 0.26, 2)) * 0.015
      const yLow = baseY - backDrop * backW + frontLift * frontW + earDip - headOriginY
      const yTopLocal = topY - headOriginY
      const y = yLow + (yTopLocal - yLow) * v
      const [, sw, sd, sz] = sampleProfile(headRings, Math.min(y, 0.753 - headOriginY))
      const sideFactor = 1 - Math.abs(sa) * sideFade * (1 - v * 0.6)
      const centerRidge = Math.exp(-Math.pow(sa / 0.42, 2)) * ridgeBoost * Math.pow(v, 0.7)
      const fluff = crownFluff * Math.pow(v, 1.1)
      const thick = (minThick + topThick * Math.pow(v, 0.75) * sideFactor) + centerRidge + fluff
      const tex = ripple * Math.sin(a * 10 + v * 5) * Math.sin(v * Math.PI)
      pos.push(sa * (sw + thick + tex), y + centerRidge * 0.8 + fluff * 0.65, sz + ca * (sd + thick + tex))
      uv.push(u, v)
      if (i < n && j < rows) {
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
  return mesh(g, 'hair', parent)
}

function addSideburns(parent, len = 0.052) {
  for (const side of [-1, 1]) {
    line(
      parent,
      'hair',
      [
        [side * 0.09, 0.665 - headOriginY, -0.026],
        [side * 0.09, 0.665 - len * 0.55 - headOriginY, -0.018],
        [side * 0.087, 0.665 - len - headOriginY, -0.014],
      ],
      0.0068,
      6,
    )
  }
}

// === 6 PROCEDURAL FOOTBALLER HAIRSTYLE TEMPLATES (Hair0 .. Hair5) ===

// Hair0: Classic Tapered Quiff (经典微背头)
{
  const h = group('Hair0', headGroup)
  buildConformalHair(h, { backDrop: 0.068, frontLift: 0.055, topY: 0.768, topThick: 0.011 })
  addSideburns(h, 0.052)
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.017,
      ax = Math.abs(x)
    line(
      h,
      'hair',
      [
        [x, 0.695 - ax * 0.1 - headOriginY, -0.09 + ax * 0.32],
        [x - 0.008, 0.752 - ax * 0.2 - headOriginY, -0.062 + ax * 0.2],
        [x - 0.012, 0.774 - ax * 0.25 - headOriginY, -0.006],
        [x - 0.006, 0.754 - ax * 0.22 - headOriginY, 0.056],
      ],
      0.014 - ax * 0.04,
      10,
    )
  }
}

// Hair1: Crisp Athletic Buzz / Short Crop Fade (精干寸头)
{
  const h = group('Hair1', headGroup)
  buildConformalHair(h, {
    baseY: 0.635,
    backDrop: 0.06,
    frontLift: 0.042,
    topY: 0.76,
    minThick: 0.0025,
    topThick: 0.0055,
    ripple: 0.0008,
  })
  addSideburns(h, 0.036)
}

// Hair2: Modern Curly / Short Afro Fade (卷发渐层)
{
  const h = group('Hair2', headGroup)
  buildConformalHair(h, {
    baseY: 0.638,
    backDrop: 0.055,
    frontLift: 0.04,
    topY: 0.775,
    minThick: 0.0025,
    topThick: 0.012,
    sideFade: 0.45,
    crownFluff: 0.018,
    ripple: 0.0038,
  })
  // Sculpted tight curl clusters across crown
  const curls = [
    [0, 0.782, -0.045, 0.032],
    [-0.038, 0.774, -0.032, 0.029],
    [0.038, 0.774, -0.032, 0.029],
    [0, 0.79, 0.005, 0.036],
    [-0.046, 0.775, 0.012, 0.03],
    [0.046, 0.775, 0.012, 0.03],
    [0, 0.775, 0.055, 0.033],
    [-0.036, 0.762, 0.052, 0.028],
    [0.036, 0.762, 0.052, 0.028],
  ]
  for (const [cx, cy, cz, r] of curls) oval(h, 'hair', cx, cy - headOriginY, cz, r * 1.15, r * 0.9, r * 1.1)
}

// Hair3: Side-Swept Fringe / Layered Mid-Cut (偏分碎盖/侧分)
{
  const h = group('Hair3', headGroup)
  buildConformalHair(h, {
    baseY: 0.618,
    backDrop: 0.075,
    frontLift: 0.042,
    topY: 0.77,
    minThick: 0.004,
    topThick: 0.014,
    ripple: 0.0025,
  })
  addSideburns(h, 0.062)
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.019,
      ax = Math.abs(x)
    line(
      h,
      'hair',
      [
        [x + 0.022, 0.678 - ax * 0.08 - headOriginY, -0.095 + ax * 0.25],
        [x + 0.01, 0.742 - ax * 0.16 - headOriginY, -0.065 + ax * 0.15],
        [x - 0.012, 0.772 - ax * 0.22 - headOriginY, 0.005],
        [x - 0.016, 0.735 - ax * 0.15 - headOriginY, 0.078],
      ],
      0.016 - ax * 0.035,
      10,
    )
  }
}

// Hair4: Athletic Headband + Swept-Back Mid-Long Flow (运动发带背头)
{
  const h = group('Hair4', headGroup)
  buildConformalHair(h, {
    baseY: 0.612,
    backDrop: 0.088,
    frontLift: 0.052,
    topY: 0.772,
    minThick: 0.004,
    topThick: 0.015,
    ripple: 0.0028,
  })
  addSideburns(h, 0.055)
  // Flowing swept-back strands over crown down to lower nape
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.02,
      ax = Math.abs(x)
    line(
      h,
      'hair',
      [
        [x, 0.715 - ax * 0.1 - headOriginY, -0.072 + ax * 0.22],
        [x, 0.772 - ax * 0.2 - headOriginY, 0.005],
        [x * 0.95, 0.71 - ax * 0.15 - headOriginY, 0.096 - ax * 0.12],
        [x * 0.85, 0.595 - ax * 0.08 - headOriginY, 0.104 - ax * 0.15],
      ],
      0.015 - ax * 0.03,
      12,
    )
  }
  // Sleek contrast athletic headband hugging the forehead & temples
  const bandPts = []
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI,
      ca = Math.cos(a),
      sa = Math.sin(a),
      yBand = 0.692 - 0.035 * Math.max(0, ca) - headOriginY
    const [, sw, sd, sz] = sampleProfile(headRings, yBand)
    bandPts.push([sa * (sw + 0.013), yBand, sz + ca * (sd + 0.013)])
  }
  line(h, 'trim', bandPts, 0.0065, 36)
}

// Hair5: High-Fade Spiky / Faux-Hawk Ridge (立体莫西干渐层)
{
  const h = group('Hair5', headGroup)
  buildConformalHair(h, {
    baseY: 0.632,
    backDrop: 0.062,
    frontLift: 0.05,
    topY: 0.766,
    minThick: 0.0025,
    topThick: 0.008,
    sideFade: 0.55,
    ridgeBoost: 0.018,
    ripple: 0.002,
  })
  addSideburns(h, 0.04)
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.018
    line(
      h,
      'hair',
      [
        [x, 0.715 - headOriginY, -0.082],
        [x * 0.8, 0.785 - headOriginY, -0.045],
        [x * 0.7, 0.794 - headOriginY, 0.015],
        [x * 0.75, 0.76 - headOriginY, 0.07],
      ],
      0.017,
      10,
    )
  }
}

// Optional tailored athletic short beard hugging the jawline (toggled on ~35% of players)
{
  const beard = group('Beard', headGroup)
  const n = 28,
    rows = 6,
    pos = [],
    uv = [],
    ix = []
  for (let j = 0; j <= rows; j++) {
    const v = j / rows
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        // Span front jaw arc from left ear (-0.42*PI) across chin (PI) to right ear
        a = Math.PI + (u - 0.5) * 1.15 * Math.PI,
        ca = Math.cos(a),
        sa = Math.sin(a)
      const jawEdge = Math.abs(u - 0.5) * 2
      const yLow = 0.504 + 0.048 * jawEdge * jawEdge - headOriginY
      const yHigh = 0.555 + 0.045 * jawEdge - headOriginY
      const y = yLow + (yHigh - yLow) * v
      const [, sw, sd, sz] = sampleProfile(headRings, y)
      const thick = 0.0035 * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.85)
      pos.push(sa * (sw + thick), y, sz + ca * (sd + thick))
      uv.push(u, v)
      if (i < n && j < rows) {
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
  mesh(g, 'hair', beard)
}

// --- LEGS WITH ANKLE PIVOTS & UNIFIED NON-CLIPPING SPEED BOOTS ---
for (const [s, side] of [
  [-1, 'L'],
  [1, 'R'],
]) {
  const hip = group('Hip' + side, player, s * 0.092, -0.06, 0)
  // Muscular athletic thigh
  loft(
    hip,
    'skin',
    [
      [-0.425, 0.052, 0.055, -0.002],
      [-0.36, 0.06, 0.064, -0.003],
      [-0.25, 0.072, 0.082, -0.004],
      [-0.14, 0.081, 0.091, -0.002],
      [-0.02, 0.078, 0.087, 0.0],
    ],
    24,
  )
  // Sleek fitted shorts leg
  loft(
    hip,
    'shorts',
    [
      [-0.225, 0.083, 0.092, -0.002],
      [-0.185, 0.086, 0.095, -0.002],
      [-0.08, 0.091, 0.102, 0.001],
      [0.02, 0.085, 0.098, 0.002],
    ],
    28,
    0.008,
  )
  // Shorts outer side stripe
  line(
    hip,
    'trim',
    [
      [s * 0.086, 0.0, 0.0],
      [s * 0.092, -0.09, -0.001],
      [s * 0.087, -0.185, -0.002],
      [s * 0.084, -0.223, -0.002],
    ],
    0.0055,
    8,
  )

  const knee = group('Knee' + side, hip, 0, -0.42, 0)
  // Defined knee & upper shin
  loft(
    knee,
    'skin',
    [
      [-0.12, 0.044, 0.05, 0.0],
      [-0.075, 0.05, 0.058, 0.002],
      [-0.01, 0.054, 0.062, -0.003],
      [0.032, 0.048, 0.054, -0.002],
    ],
    22,
  )
  // Sculpted athletic calf & sock (tapers cleanly INTO the boot collar at y=-0.415 so ZERO poke-through!)
  loft(
    knee,
    'sock',
    [
      [-0.418, 0.028, 0.034, 0.0],
      [-0.39, 0.034, 0.04, 0.001],
      [-0.335, 0.037, 0.045, 0.004],
      [-0.245, 0.052, 0.062, 0.012],
      [-0.16, 0.059, 0.068, 0.014],
      [-0.105, 0.054, 0.06, 0.006],
      [-0.082, 0.052, 0.057, 0.003],
    ],
    24,
  )
  // Double athletic sock cuff stripes
  for (const [y0, y1] of [
    [-0.118, -0.106],
    [-0.136, -0.127],
  ]) {
    loft(
      knee,
      'trim',
      [
        [y0, 0.057, 0.064, 0.009],
        [y1, 0.056, 0.063, 0.008],
      ],
      24,
    )
  }

  // Dedicated Ankle pivot at y=-0.41 so the boot sole sits 100% flat on grass in every stance!
  const ankle = group('Ankle' + side, knee, 0, -0.41, 0)

  // Snug knitted ankle collar wrapping smoothly over the tapered sock bottom
  loft(
    ankle,
    'boot',
    [
      [-0.032, 0.041, 0.049, 0.0],
      [-0.008, 0.039, 0.047, 0.002],
      [0.014, 0.037, 0.044, 0.002],
    ],
    24,
  )

  // Unified sleek modern speed boot upper (single continuous Z-loft — ZERO intersecting spheres!)
  // [z, halfWidth, yBottom, yTop]  (-Z is toe, +Z is heel)
  bootLoft(
    ankle,
    'boot',
    [
      [-0.178, 0.004, -0.052, -0.046],
      [-0.165, 0.029, -0.056, -0.034],
      [-0.135, 0.045, -0.057, -0.022],
      [-0.088, 0.047, -0.057, -0.01],
      [-0.035, 0.044, -0.057, 0.006],
      [0.018, 0.043, -0.057, 0.004],
      [0.052, 0.036, -0.055, -0.008],
      [0.064, 0.005, -0.045, -0.025],
    ],
    28,
  )

  // Clean separate soleplate strictly beneath the boot upper (y = -0.056 .. -0.065)
  bootLoft(
    ankle,
    'bootSole',
    [
      [-0.172, 0.005, -0.063, -0.057],
      [-0.155, 0.032, -0.065, -0.056],
      [-0.115, 0.047, -0.065, -0.056],
      [-0.05, 0.042, -0.064, -0.056],
      [0.015, 0.042, -0.065, -0.056],
      [0.05, 0.033, -0.064, -0.056],
      [0.06, 0.005, -0.062, -0.057],
    ],
    24,
  )

  // Crisp metallic studs cleanly below soleplate (stud tips at y = -0.073 -> world -0.963 straight)
  for (const [x, z] of [
    [-0.025, -0.135],
    [0.025, -0.135],
    [-0.029, -0.088],
    [0.029, -0.088],
    [-0.023, 0.025],
    [0.023, 0.025],
  ]) {
    const stud = mesh(new T.CylinderGeometry(0.0065, 0.0045, 0.01, 8), 'stud', ankle, x, -0.068, z)
    stud.updateMatrix()
  }

  // Clean speed-stripe accent clearly offset outside boot surface (+0.003m clearance -> ZERO z-fighting!)
  line(
    ankle,
    'bootAccent',
    [
      [s * 0.044, -0.024, 0.035],
      [s * 0.048, -0.034, -0.025],
      [s * 0.05, -0.04, -0.095],
      [s * 0.044, -0.043, -0.14],
    ],
    0.0045,
    10,
  )
  // Heel accent counter arc cleanly hugging rear of boot
  line(
    ankle,
    'bootAccent',
    [
      [-0.034, -0.026, 0.046],
      [0, -0.022, 0.062],
      [0.034, -0.026, 0.046],
    ],
    0.0042,
    8,
  )
  // Clean laces sitting clearly atop the vamp (+0.004m clearance)
  for (let i = 0; i < 4; i++) {
    const z = -0.044 - i * 0.019,
      y = 0.001 - i * 0.006
    line(
      ankle,
      'bootAccent',
      [
        [-0.017, y, z],
        [0, y + 0.0045, z],
        [0.017, y, z],
      ],
      0.0024,
      6,
    )
  }

  // --- ARMS (SHOULDER y=0.358, ELBOW -0.25, HAND -0.23) ---
  const shoulder = group('Shoulder' + side, player, s * 0.194, 0.358, 0.002)
  loft(
    shoulder,
    'sleeve',
    [
      [-0.155, 0.056, 0.059, 0.0, 1, 0],
      [-0.105, 0.059, 0.063, 0.0, 1, 0],
      [-0.025, 0.064, 0.067, 0.0, 1, -s * 0.004],
      [0.024, 0.054, 0.057, 0.0, 1, -s * 0.014],
      [0.048, 0.032, 0.034, 0.0, 1, -s * 0.028],
    ],
    26,
  )
  loft(
    shoulder,
    'trim',
    [
      [-0.16, 0.056, 0.059],
      [-0.146, 0.058, 0.061],
    ],
    24,
  )
  loft(
    shoulder,
    'skin',
    [
      [-0.258, 0.038, 0.042],
      [-0.205, 0.046, 0.05],
      [-0.135, 0.053, 0.057],
      [-0.04, 0.051, 0.055],
    ],
    22,
  )

  const elbow = group('Elbow' + side, shoulder, 0, -0.25, 0)
  // Forearm ends neatly at y=-0.226 (radius 0.025) so on keeper it tucks cleanly inside the glove wrist cuff!
  loft(
    elbow,
    'skin',
    [
      [-0.226, 0.025, 0.027],
      [-0.185, 0.03, 0.033],
      [-0.1, 0.041, 0.044],
      [-0.025, 0.041, 0.043],
      [0.015, 0.035, 0.038],
    ],
    22,
  )

  const hand = group('Hand' + side, elbow, 0, -0.23, 0)
  oval(hand, 'skin', 0, -0.044, -0.004, 0.028, 0.047, 0.018)
  oval(hand, 'skin', 0, -0.086, -0.011, 0.025, 0.027, 0.014)
  oval(hand, 'skin', -s * 0.023, -0.042, -0.017, 0.011, 0.027, 0.011)
}

// --- TRUE ANATOMICAL LEFT & RIGHT GOALKEEPER GLOVES (PIVOT AT WRIST ENTRY, PALM AT +Z, FINGERS AT +Y) ---
// Wrist cuff sits at y = -0.032..+0.022 (wider than forearm radius 0.027) so wrist tucks cleanly inside with ZERO clipping!
for (const [thumbSide, name] of [
  [1, 'GloveL'], // Left hand (in keeper local coords): thumb on inner +X side when palm faces +Z
  [-1, 'GloveR'], // Right hand: thumb on inner -X side when palm faces +Z
]) {
  const g = group(name, art)
  // Snug wide wrist strap cuff cleanly enclosing forearm end
  loft(
    g,
    'trim',
    [
      [-0.032, 0.038, 0.034, 0],
      [-0.01, 0.041, 0.036, 0],
      [0.018, 0.044, 0.037, 0],
    ],
    24,
  )
  // Smooth padded backhand + palm body (y = 0.015 .. 0.115)
  loft(
    g,
    'glove',
    [
      [0.012, 0.044, 0.034, -0.002],
      [0.045, 0.06, 0.032, -0.002],
      [0.082, 0.064, 0.03, -0.002],
      [0.112, 0.058, 0.024, -0.002],
      [0.122, 0.025, 0.014, -0.002],
    ],
    26,
  )
  // Latex grip palm pad clearly proud on +Z front face (no z-fighting!)
  oval(g, 'palm', 0, 0.068, 0.026, 0.052, 0.046, 0.012)
  // 4 fingers rising smoothly from top of palm (y = 0.11 .. 0.175)
  for (let j = 0; j < 4; j++) {
    const x = (j - 1.5) * 0.029,
      len = 0.048 - Math.abs(x) * 0.24
    const finger = oval(g, 'glove', x, 0.115 + len * 0.72, 0.002, 0.0145, len, 0.016)
    finger.rotation.z = -x * 1.4
    // Latex finger palm pad
    const pad = oval(g, 'palm', x, 0.118 + len * 0.65, 0.014, 0.011, len * 0.75, 0.007)
    pad.rotation.z = -x * 1.4
  }
  // Anatomical inner thumb
  const thumb = oval(g, 'glove', thumbSide * 0.064, 0.082, 0.008, 0.02, 0.038, 0.018)
  thumb.rotation.z = -thumbSide * 0.58
}

mesh(new T.PlaneGeometry(1, 1), 'grass', group('TurfSwatch', art))
const football = group('Football', art)
mesh(new T.SphereGeometry(0.11, 64, 40), 'leather', football)
mesh(new T.SphereGeometry(0.11012, 64, 40), 'print', football)

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
