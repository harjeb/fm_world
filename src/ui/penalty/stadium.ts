import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { loadMatchday } from './matchday.ts'
import { HALF, HEIGHT, SPOT } from '../../game/penalty/practice.ts'
import type { SurfaceId } from '../../game/penalty/environment.ts'

// A purpose-built penalty practice end: one goal, its box, one small stand. No full stadium.
export function stadium(art: Awaited<ReturnType<typeof loadMatchday>>, maxAnisotropy: number) {
  const root = new T.Group(),
    mats: T.Material[] = [],
    textures: T.Texture[] = []
  function own<M extends T.Material>(m: M) {
    mats.push(m)
    return m
  }
  const standard = (color: T.ColorRepresentation, roughness = 0.83) =>
    own(new T.MeshStandardMaterial({ color, roughness }))
  const paint = standard(0xdde5d4),
    steel = standard(0x536776, 0.54),
    shell = standard(0x374552),
    dark = standard(0x24333e),
    pole = standard(0xf4f5ed, 0.4)
  function put(g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0, parent: T.Object3D = root) {
    const o = new T.Mesh(g, m)
    o.position.set(x, y, z)
    parent.add(o)
    return o
  }
  function box(
    m: T.Material,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    p: T.Object3D = root,
  ) {
    return put(new T.BoxGeometry(w, h, d), m, x, y, z, p)
  }
  const turf = own(art.grass.clone())
  turf.vertexColors = true
  turf.roughness = 0.96
  turf.normalScale.set(0.6, 0.6)
  for (const tex of [turf.map!, turf.normalMap!]) {
    tex.wrapS = tex.wrapT = T.RepeatWrapping
    tex.anisotropy = Math.min(8, maxAnisotropy)
    tex.needsUpdate = true
  }
  const grassMap = turf.map!
  const pos: number[] = [],
    uv: number[] = [],
    colors: number[] = []
  for (let iz = -2; iz < 8; iz++)
    for (let ix = -3; ix < 3; ix++) {
      const x = ix * 8,
        z = iz * 5,
        x1 = x + 8,
        z1 = z + 5
      const shade = (iz & 1 ? 0.84 : 1) * (ix & 1 ? 0.97 : 1)
      for (const [a, b] of [
        [x, z],
        [x, z1],
        [x1, z],
        [x1, z],
        [x, z1],
        [x1, z1],
      ]) {
        pos.push(a, -0.012, b)
        uv.push(a / 1.8, b / 1.8)
        colors.push(shade, shade, shade)
      }
    }
  const lawn = new T.BufferGeometry()
  lawn.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  lawn.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  lawn.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  lawn.computeVertexNormals()
  const lawnMesh = put(lawn, turf)
  lawnMesh.receiveShadow = true
  lawnMesh.userData.dynamic = true
  // Subtle translucent worn patches in the keeper's landing zone and at the spot (no hard disc edge).
  const can = document.createElement('canvas')
  can.width = can.height = 128
  const c = can.getContext('2d')!
  function paintWear(inner: string, mid: string, outer: string) {
    c.clearRect(0, 0, 128, 128)
    const fade = c.createRadialGradient(64, 64, 3, 64, 64, 61)
    fade.addColorStop(0, inner)
    fade.addColorStop(0.55, mid)
    fade.addColorStop(1, outer)
    c.fillStyle = fade
    c.fillRect(0, 0, 128, 128)
  }
  paintWear('rgba(122,106,57,.58)', 'rgba(123,118,68,.32)', 'rgba(110,115,60,0)')
  const wear = new T.CanvasTexture(can)
  wear.colorSpace = T.SRGBColorSpace
  textures.push(wear)
  const wearMat = own(new T.MeshBasicMaterial({ map: wear, transparent: true, depthWrite: false }))
  for (const [x, z, w, h] of [
    [0, 0.85, 6.4, 2.0],
    [0, SPOT + 0.1, 0.95, 0.79],
  ]) {
    const a = put(new T.PlaneGeometry(w, h), wearMat, x, -0.005, z)
    a.rotation.x = -Math.PI / 2
    a.userData.dynamic = true
  }
  const stripes: number[] = []
  function stroke(x: number, z: number, X: number, Z: number, width = 0.105) {
    const l = Math.hypot(X - x, Z - z),
      a = (((Z - z) / l) * width) / 2,
      b = (((x - X) / l) * width) / 2
    for (const [px, pz] of [
      [x + a, z + b],
      [x - a, z - b],
      [X + a, Z + b],
      [X + a, Z + b],
      [x - a, z - b],
      [X - a, Z - b],
    ])
      stripes.push(px, 0.007, pz)
  }
  function arc(x: number, z: number, r: number, start: number, end: number) {
    const n = Math.ceil((40 * (end - start)) / Math.PI)
    for (let i = 0; i < n; i++) {
      const a = start + ((end - start) * i) / n,
        b = start + ((end - start) * (i + 1)) / n
      stroke(x + r * Math.cos(a), z + r * Math.sin(a), x + r * Math.cos(b), z + r * Math.sin(b))
    }
  }
  stroke(-24, 0, 24, 0)
  for (const [width, deep] of [
    [18.32, 5.5],
    [40.32, 16.5],
  ]) {
    stroke(-width / 2, deep, width / 2, deep)
    for (const j of [-1, 1]) stroke((j * width) / 2, 0, (j * width) / 2, deep)
  }
  const angle = Math.asin(5.5 / 9.15)
  arc(0, SPOT, 9.15, angle, Math.PI - angle)
  put(new T.CircleGeometry(0.12, 24), paint, 0, 0.009, SPOT).rotation.x = -Math.PI / 2
  const markings = new T.BufferGeometry()
  markings.setAttribute('position', new T.Float32BufferAttribute(stripes, 3))
  markings.computeVertexNormals()
  paint.side = T.DoubleSide
  put(markings, paint)
  function goal(z: number) {
    for (const side of [-1, 1])
      put(new T.CylinderGeometry(0.055, 0.055, HEIGHT, 16), pole, side * HALF, HEIGHT / 2, z)
    put(new T.CylinderGeometry(0.055, 0.055, HALF * 2 + 0.11, 16), pole, 0, HEIGHT, z).rotation.z = Math.PI / 2
  }
  goal(0)
  // One local, club-branded LED ribbon per stand (no external sponsor images or fonts).
  const board = document.createElement('canvas')
  board.width = 1024
  board.height = 96
  const led = board.getContext('2d')!
  function drawBanner(eventLabel: string) {
    led.fillStyle = '#122b38'
    led.fillRect(0, 0, 1024, 96)
    led.fillStyle = art.club.color
    led.fillRect(0, 0, 1024, 6)
    led.drawImage(art.badge, 22, 10, 62, 72)
    led.textBaseline = 'middle'
    led.fillStyle = '#f0f6ee'
    led.font = 'bold 44px sans-serif'
    led.fillText(art.club.name, 108, 48, 420)
    led.fillStyle = '#b2d8d4'
    led.font = '600 25px sans-serif'
    led.fillText(`${eventLabel}    /    MATCHDAY`, 580, 48)
  }
  drawBanner('十二码之夜')
  const ledTex = new T.CanvasTexture(board)
  ledTex.colorSpace = T.SRGBColorSpace
  ledTex.wrapS = T.RepeatWrapping
  ledTex.repeat.x = 2
  ledTex.anisotropy = Math.min(8, maxAnisotropy)
  textures.push(ledTex)
  const ledMat = own(new T.MeshBasicMaterial({ map: ledTex }))
  // Sculpt the one-piece bucket in cross-section; share the same shell across every seat.
  const seatGeo = new T.BufferGeometry(),
    sp: number[] = [],
    si: number[] = []
  const profile = [
    [-0.18, 0.08],
    [-0.19, 0.19],
    [-0.23, 0.37],
    [-0.255, 0.42],
    [-0.21, 0.43],
    [-0.15, 0.2],
    [-0.11, 0.1],
    [0.03, 0.055],
    [0.17, 0.055],
    [0.21, 0.073],
    [0.22, 0.042],
    [0.17, 0.022],
    [0.015, 0.017],
    [-0.14, 0.045],
    [-0.18, 0.08],
  ]
  for (let j = 0; j < profile.length; j++) {
    for (let i = 0; i <= 6; i++) {
      const x = (i / 6 - 0.5) * 0.48,
        wing = (x * x) / 0.06
      sp.push(x, profile[j][1] + wing * 0.048, profile[j][0] + wing * 0.045)
      if (i < 6 && j + 1 < profile.length) {
        const a = j * 7 + i
        si.push(a, a + 1, a + 7, a + 1, a + 8, a + 7)
      }
    }
  }
  seatGeo.setAttribute('position', new T.Float32BufferAttribute(sp, 3))
  seatGeo.setIndex(si)
  seatGeo.computeVertexNormals()
  const seatMat = standard(0xffffff),
    seatMatrices: T.Matrix4[] = [],
    seatColors: T.Color[] = []
  const tmp = new T.Object3D(),
    brand = new T.Color(art.club.color),
    navy = new T.Color(0x293f53),
    light = new T.Color(0x8397a6)
  seatMat.side = T.DoubleSide
  function stand(x: number, z: number, rot: number, width: number) {
    const g = new T.Group()
    g.position.set(x, 0, z)
    g.rotation.y = rot
    root.add(g)
    g.updateMatrixWorld(true)
    for (let row = 0; row < 4; row++) {
      const y = 0.55 + row * 0.51,
        depth = -row * 0.82
      box(shell, 0, y - 0.3, depth, width, 0.53, 0.87, g)
      for (let i = 0; i < Math.floor(width / 0.63); i++) {
        if (i % 22 < 2) continue
        tmp.position.set(-width / 2 + 0.43 + i * 0.63, y + 0.1, depth - 0.14)
        tmp.rotation.set(-0.16, 0, 0)
        tmp.updateMatrix()
        seatMatrices.push(g.matrixWorld.clone().multiply(tmp.matrix))
        seatColors.push(
          row === 3 || row === 7 ? light : (Math.floor(i / 22) + Math.floor(row / 3)) % 3 === 0 ? brand : navy,
        )
      }
    }
    box(dark, 0, 0.42, 1.12, width, 0.84, 0.2, g)
    put(new T.PlaneGeometry(width, 0.72), ledMat, 0, 0.47, 1.23, g)
    // A handrail behind the last row, low enough to keep an open skyline.
    box(steel, 0, 2.83, -2.9, width, 0.07, 0.07, g)
    for (let xx = -width / 2 + 0.1; xx < width / 2; xx += 2.7) box(steel, xx, 2.32, -2.9, 0.06, 1, 0.06, g)
  }
  stand(0, -6.4, 0, 19)
  const seats = new T.InstancedMesh(seatGeo, seatMat, seatMatrices.length)
  seatMatrices.forEach((m, i) => {
    seats.setMatrixAt(i, m)
    seats.setColorAt(i, seatColors[i])
  })
  root.add(seats)
  // Merge the fixed stand and pitch markings into material batches.
  root.updateMatrixWorld(true)
  const batches = new Map<string, T.Mesh<T.BufferGeometry, T.Material>[]>()
  root.traverse((o) => {
    if (o instanceof T.Mesh && !(o instanceof T.InstancedMesh) && !o.userData.dynamic) {
      const key = [o.material.uuid, ...Object.keys(o.geometry.attributes).sort(), !!o.geometry.index].join(':')
      const items = batches.get(key) ?? []
      items.push(o)
      batches.set(key, items)
    }
  })
  for (const items of batches.values()) {
    if (items.length < 2) continue
    const joined = mergeGeometries(items.map((o) => o.geometry.applyMatrix4(o.matrixWorld)))
    const m = items[0].material
    for (const o of items) {
      o.removeFromParent()
      o.geometry.dispose()
    }
    const batch = new T.Mesh(joined, m)
    batch.receiveShadow = true
    batch.castShadow = m === pole
    root.add(batch)
  }

  // Procedural noise swatch for snow & desert sand surfaces
  const grainCanvas = document.createElement('canvas')
  grainCanvas.width = grainCanvas.height = 128
  const gctx = grainCanvas.getContext('2d')!
  const grainTex = new T.CanvasTexture(grainCanvas)
  grainTex.colorSpace = T.SRGBColorSpace
  grainTex.wrapS = grainTex.wrapT = T.RepeatWrapping
  grainTex.anisotropy = Math.min(4, maxAnisotropy)
  textures.push(grainTex)

  function fillGrain(baseHex: string, speckA: string, speckB: string) {
    gctx.fillStyle = baseHex
    gctx.fillRect(0, 0, 128, 128)
    let s = 918273
    for (let i = 0; i < 900; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      const x = s & 127
      const y = (s >>> 7) & 127
      gctx.fillStyle = (s & 1) === 0 ? speckA : speckB
      gctx.fillRect(x, y, 2, 2)
    }
    grainTex.needsUpdate = true
  }

  let currentSurface: SurfaceId = 'grass'
  function setSurface(surface: SurfaceId) {
    if (surface === currentSurface) return
    currentSurface = surface
    if (surface === 'grass') {
      turf.map = grassMap
      turf.color.set('#ffffff')
      turf.roughness = 0.95
      paint.color.set(0xdde5d4)
      paintWear('rgba(122,106,57,.58)', 'rgba(123,118,68,.32)', 'rgba(110,115,60,0)')
    } else if (surface === 'mud') {
      turf.map = grassMap
      turf.color.set('#807352')
      turf.roughness = 0.42
      paint.color.set(0xb9bcae)
      paintWear('rgba(52,38,22,.82)', 'rgba(66,51,30,.54)', 'rgba(66,51,30,0)')
    } else if (surface === 'snow') {
      fillGrain('#e8f0f7', '#d5e3ef', '#f7fbff')
      turf.map = grainTex
      turf.color.set('#ffffff')
      turf.roughness = 0.78
      paint.color.set(0x4a7066)
      paintWear('rgba(168,195,216,.65)', 'rgba(185,208,225,.35)', 'rgba(200,220,235,0)')
    } else {
      fillGrain('#d7b176', '#c59c5e', '#e5c48c')
      turf.map = grainTex
      turf.color.set('#ffffff')
      turf.roughness = 0.9
      paint.color.set(0xf5efe2)
      paintWear('rgba(168,122,64,.62)', 'rgba(182,138,78,.32)', 'rgba(182,138,78,0)')
    }
    turf.needsUpdate = true
    wear.needsUpdate = true
  }

  return {
    root,
    setSurface,
    setBanner(title: string) {
      drawBanner(title)
      ledTex.needsUpdate = true
    },
    dispose() {
      seats.dispose()
      for (const m of mats) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
