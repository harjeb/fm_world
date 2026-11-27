import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import modelUrl from './art/matchday.glb?url'
import type { Player } from '../../game/types.ts'
import { assetUrl, distinctKit, inkOn, type ClubLook } from '../components.ts'
import { clamp, GLOVE_Z, SPOT, type keeperAt } from '../../game/penalty/practice.ts'
import { resolve3DAppearance } from '../../game/appearance.ts'

export type Team = Pick<ClubLook, 'name' | 'color'>
export type Wearer = Pick<Player, 'id' | 'name' | 'number' | 'height'> & {
  seedId?: string
  enName?: string
  country?: string
  appearanceId?: string
  attrs?: { strength?: number; speed?: number }
}
const keeperColor = (home: string) => distinctKit('#f2b632', home)
const GLB_HAIR_COUNT = 6

/**
 * 为 Head 骨骼构建 8 款高辨识度扩展 3D 发型节点（索引 6..13；索引 14 为利落光头）：
 * 6: afro (蓬松爆炸头)
 * 7: dreads (垂肩脏辫)
 * 8: mohawk (莫西干战斧)
 * 9: topknot (武士丸子头)
 * 10: ponytail (飘逸马尾辫)
 * 11: curls_band (运动发带卷发)
 * 12: mane_band (运动发带飘逸长发)
 * 13: spiky (锋芒刺猬头)
 *
 * Head 局部坐标：x ∈ [-0.106, +0.106]，y ∈ [-0.123, +0.129]（颅顶 +0.129），
 * -z 为正脸方向（-0.124），+z 为后脑勺方向（+0.106）。
 */
function buildProceduralHairStyles(
  hairMat: T.Material,
  bandMat: T.Material,
  trackGeo: <G extends T.BufferGeometry>(g: G) => G,
): T.Group[] {
  const mkMesh = (geo: T.BufferGeometry, mat: T.Material = hairMat) => {
    const m = new T.Mesh(geo, mat)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  const capGeo = trackGeo(new T.SphereGeometry(0.106, 14, 10))
  const bandGeo = trackGeo(new T.TorusGeometry(0.103, 0.0155, 10, 26))
  const tieGeo = trackGeo(new T.TorusGeometry(0.025, 0.0085, 8, 16))

  // 6: Afro (蓬松爆炸头)
  const gAfro = new T.Group()
  const afroMain = mkMesh(trackGeo(new T.SphereGeometry(0.146, 16, 12)))
  afroMain.position.set(0, 0.072, 0.022)
  afroMain.scale.set(1.08, 0.96, 1.08)
  gAfro.add(afroMain)
  const puffGeo = trackGeo(new T.SphereGeometry(0.068, 10, 8))
  for (const [px, py, pz] of [
    [-0.088, 0.078, 0.018],
    [0.088, 0.078, 0.018],
    [-0.062, 0.138, -0.012],
    [0.062, 0.138, -0.012],
    [0, 0.148, 0.042],
    [0, 0.048, 0.105],
  ] as const) {
    const p = mkMesh(puffGeo)
    p.position.set(px, py, pz)
    gAfro.add(p)
  }

  // 7: Dreadlocks (垂肩脏辫)
  const gDreads = new T.Group()
  const dreadCap = mkMesh(capGeo)
  dreadCap.position.set(0, 0.044, 0.012)
  dreadCap.scale.set(1.01, 0.95, 1.04)
  gDreads.add(dreadCap)
  const dreadTie = mkMesh(trackGeo(new T.TorusGeometry(0.082, 0.011, 8, 20)), bandMat)
  dreadTie.position.set(0, 0.056, 0.036)
  dreadTie.rotation.x = Math.PI * 0.42
  gDreads.add(dreadTie)
  const lockGeo = trackGeo(new T.CapsuleGeometry(0.0165, 0.165, 4, 7))
  for (let i = 0; i < 13; i++) {
    const u = i / 12 // 0..1 around left -> back -> right
    const angle = -Math.PI * 0.58 + u * Math.PI * 1.16 // centered at +Z (back of head)
    const rx = Math.sin(angle) * 0.098
    const rz = Math.cos(angle) * 0.102 + 0.02
    const lock = mkMesh(lockGeo)
    lock.position.set(rx, -0.038 - (i % 2) * 0.018, rz)
    lock.rotation.set(0.24 + Math.cos(angle) * 0.1, 0, -Math.sin(angle) * 0.22)
    gDreads.add(lock)
  }

  // 8: Mohawk (莫西干战斧)
  const gMohawk = new T.Group()
  const bladeGeo = trackGeo(new T.ConeGeometry(0.032, 0.092, 5))
  for (let i = 0; i < 7; i++) {
    const t = -0.78 + (i / 6) * 1.85 // front (-z) over crown to back (+z)
    const by = Math.cos(t * 0.85) * 0.145 + 0.018
    const bz = Math.sin(t * 0.85) * 0.125 + 0.012
    const blade = mkMesh(bladeGeo)
    blade.position.set(0, by, bz)
    blade.scale.set(0.54, 1.05, 1.28)
    blade.rotation.x = t * 0.82
    gMohawk.add(blade)
  }

  // 9: Top-Knot (武士丸子头)
  const gTopknot = new T.Group()
  const tkCap = mkMesh(capGeo)
  tkCap.position.set(0, 0.04, 0.014)
  tkCap.scale.set(0.99, 0.94, 1.04)
  gTopknot.add(tkCap)
  const tkTie = mkMesh(tieGeo, bandMat)
  tkTie.position.set(0, 0.128, 0.085)
  tkTie.rotation.x = 0.72
  gTopknot.add(tkTie)
  const bun = mkMesh(trackGeo(new T.SphereGeometry(0.044, 12, 10)))
  bun.position.set(0, 0.156, 0.112)
  bun.scale.set(0.96, 0.94, 1.12)
  gTopknot.add(bun)
  const tkTail = mkMesh(trackGeo(new T.ConeGeometry(0.026, 0.082, 7)))
  tkTail.position.set(0, 0.122, 0.148)
  tkTail.rotation.x = -2.25
  gTopknot.add(tkTail)

  // 10: Ponytail (飘逸马尾辫)
  const gPonytail = new T.Group()
  const ptCap = mkMesh(capGeo)
  ptCap.position.set(0, 0.042, 0.014)
  ptCap.scale.set(1.0, 0.95, 1.04)
  gPonytail.add(ptCap)
  const ptTie = mkMesh(tieGeo, bandMat)
  ptTie.position.set(0, 0.028, 0.108)
  ptTie.rotation.x = 1.38
  gPonytail.add(ptTie)
  const ptBody = mkMesh(trackGeo(new T.CapsuleGeometry(0.026, 0.115, 4, 8)))
  ptBody.position.set(0, -0.036, 0.146)
  ptBody.rotation.x = 0.42
  gPonytail.add(ptBody)
  const ptTip = mkMesh(trackGeo(new T.ConeGeometry(0.025, 0.09, 7)))
  ptTip.position.set(0, -0.118, 0.168)
  ptTip.rotation.x = Math.PI - 0.18
  gPonytail.add(ptTip)

  // 11: Headband + Fluffy Curls (运动发带卷发)
  const gCurlsBand = new T.Group()
  const cbBand = mkMesh(bandGeo, bandMat)
  cbBand.position.set(0, 0.056, 0.002)
  cbBand.rotation.x = Math.PI * 0.5 - 0.16
  gCurlsBand.add(cbBand)
  const curlGeo = trackGeo(new T.SphereGeometry(0.05, 10, 8))
  for (const [cx, cy, cz] of [
    [0, 0.138, -0.042],
    [-0.054, 0.128, -0.028],
    [0.054, 0.128, -0.028],
    [-0.072, 0.112, 0.022],
    [0.072, 0.112, 0.022],
    [0, 0.148, 0.02],
    [-0.048, 0.125, 0.072],
    [0.048, 0.125, 0.072],
    [0, 0.098, 0.095],
  ] as const) {
    const c = mkMesh(curlGeo)
    c.position.set(cx, cy, cz)
    gCurlsBand.add(c)
  }

  // 12: Headband + Flowing Mane (运动发带飘逸长发)
  const gManeBand = new T.Group()
  const mbCap = mkMesh(capGeo)
  mbCap.position.set(0, 0.046, 0.014)
  mbCap.scale.set(1.02, 0.96, 1.05)
  gManeBand.add(mbCap)
  const mbBand = mkMesh(bandGeo, bandMat)
  mbBand.position.set(0, 0.055, 0.002)
  mbBand.rotation.x = Math.PI * 0.5 - 0.15
  gManeBand.add(mbBand)
  const maneGeo = trackGeo(new T.CapsuleGeometry(0.026, 0.15, 4, 8))
  for (let i = 0; i < 9; i++) {
    const u = i / 8
    const angle = -Math.PI * 0.52 + u * Math.PI * 1.04
    const mx = Math.sin(angle) * 0.095
    const mz = Math.cos(angle) * 0.098 + 0.022
    const strand = mkMesh(maneGeo)
    strand.position.set(mx, -0.032, mz)
    strand.rotation.set(0.22, 0, -Math.sin(angle) * 0.18)
    gManeBand.add(strand)
  }

  // 13: Spiky Striker (锋芒刺猬头)
  const gSpiky = new T.Group()
  const spCap = mkMesh(capGeo)
  spCap.position.set(0, 0.044, 0.012)
  spCap.scale.set(1.0, 0.95, 1.03)
  gSpiky.add(spCap)
  const spikeGeo = trackGeo(new T.ConeGeometry(0.033, 0.105, 5))
  for (const [sx, sy, sz, rx, rz] of [
    [0, 0.165, -0.035, -0.35, 0],
    [-0.055, 0.152, -0.02, -0.25, 0.45],
    [0.055, 0.152, -0.02, -0.25, -0.45],
    [0, 0.176, 0.025, 0.25, 0],
    [-0.072, 0.132, 0.028, 0.2, 0.72],
    [0.072, 0.132, 0.028, 0.2, -0.72],
    [-0.048, 0.155, 0.078, 0.68, 0.38],
    [0.048, 0.155, 0.078, 0.68, -0.38],
    [0, 0.142, 0.105, 0.92, 0],
    [-0.075, 0.092, 0.085, 0.85, 0.68],
    [0.075, 0.092, 0.085, 0.85, -0.68],
  ] as const) {
    const sp = mkMesh(spikeGeo)
    sp.position.set(sx, sy, sz)
    sp.rotation.set(rx, 0, rz)
    gSpiky.add(sp)
  }

  return [gAfro, gDreads, gMohawk, gTopknot, gPonytail, gCurlsBand, gManeBand, gSpiky]
}

// Both sides of the training drill belong to the user's roster. GK wears a contrast shirt, not an away club's kit.
function tailor(
  ctx: CanvasRenderingContext2D,
  club: Team,
  p: Wearer | undefined,
  keeper: boolean,
  badge: CanvasImageSource,
) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height,
    base = keeper ? keeperColor(club.color) : club.color,
    ink = inkOn(base)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  const shade = ctx.createLinearGradient(0, 0, 0, h)
  shade.addColorStop(0, 'rgba(255,255,255,0.09)')
  shade.addColorStop(0.45, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.16)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.055
  ctx.lineWidth = 4
  for (let x = -h; x < w + h; x += 28) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + h * 0.55, h)
    ctx.stroke()
  }
  ctx.restore()

  ctx.save()
  ctx.fillStyle = '#08121b'
  ctx.globalAlpha = 0.22
  for (const x of [0, w / 2, w]) {
    ctx.beginPath()
    ctx.moveTo(x - 42, 0)
    ctx.lineTo(x + 42, 0)
    ctx.lineTo(x + 26, h * 0.55)
    ctx.lineTo(x + 34, h)
    ctx.lineTo(x - 34, h)
    ctx.lineTo(x - 26, h * 0.55)
    ctx.fill()
  }
  ctx.restore()

  ctx.save()
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.72
  ctx.fillRect(0, h - 10, w, 4)
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const numStr = String(p && Number.isInteger(p.number) && p.number > 0 ? p.number : keeper ? 1 : 9)
  const nameStr = p?.name ?? (keeper ? '门将' : '前锋')
  const outline =
    ink === '#ffffff' || ink === '#fff' || ink.toLowerCase().startsWith('#f')
      ? 'rgba(8,14,22,0.52)'
      : 'rgba(255,255,255,0.42)'

  ctx.save()
  ctx.font = '800 46px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  ctx.lineWidth = 6
  ctx.strokeStyle = outline
  ctx.strokeText(nameStr, w * 0.25, h * 0.21, 248)
  ctx.fillStyle = ink
  ctx.fillText(nameStr, w * 0.25, h * 0.21, 248)

  ctx.font = '900 182px Bahnschrift, "DIN Alternate", "Arial Black", system-ui, sans-serif'
  ctx.lineWidth = 8
  ctx.strokeStyle = outline
  ctx.strokeText(numStr, w * 0.25, h * 0.54, 215)
  ctx.fillStyle = ink
  ctx.fillText(numStr, w * 0.25, h * 0.54, 215)
  ctx.restore()

  ctx.save()
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.1
  ctx.fillRect(w * 0.58, h * 0.43, w * 0.34, h * 0.16)
  ctx.restore()

  ctx.drawImage(badge, w * 0.75 + 42, h * 0.16, 46, 52)
  ctx.fillStyle = ink
  ctx.font = '800 28px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  ctx.fillText(club.name, w * 0.75, h * 0.51, 210)
  ctx.globalAlpha = 0.76
  ctx.font = '700 15px ui-monospace, sans-serif'
  ctx.fillText('FM WORLD  ·  MATCH ISSUE', w * 0.75, h * 0.63, 190)
  ctx.globalAlpha = 1
}

const CREST_SHAPES = [
  { id: 'classic', cy: 0.475, fs: 0.36 },
  { id: 'modern', cy: 0.45, fs: 0.36 },
  { id: 'crown', cy: 0.535, fs: 0.32 },
  { id: 'laurel', cy: 0.45, fs: 0.29 },
] as const

const badgeCache = new Map<string, Promise<CanvasImageSource>>()

function loadImg(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  return img.decode().then(() => img)
}

function clubBadge(club: Team): Promise<CanvasImageSource> {
  const cacheKey = `${club.name}|${club.color}`
  const hit = badgeCache.get(cacheKey)
  if (hit) return hit

  const task = (async (): Promise<CanvasImageSource> => {
    const size = 160
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    let hash = 0
    for (const ch of club.name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
    const shape = CREST_SHAPES[hash % CREST_SHAPES.length]
    const baseColor = /^#[0-9a-fA-F]{3,8}$/.test(club.color) ? club.color : '#2a7de1'
    const ink = inkOn(baseColor)
    const letter = [...club.name][0] ?? '?'

    try {
      const [metal, mask] = await Promise.all([
        loadImg(assetUrl(`assets/crests/crest-${shape.id}.webp`)),
        loadImg(assetUrl(`assets/crests/crest-${shape.id}-mask.webp`)),
      ])
      ctx.drawImage(metal, 0, 0, size, size)

      const fillCanvas = document.createElement('canvas')
      fillCanvas.width = size
      fillCanvas.height = size
      const fctx = fillCanvas.getContext('2d')!
      const grad = fctx.createLinearGradient(0, 0, size * 0.6, size)
      grad.addColorStop(0, baseColor)
      grad.addColorStop(1, '#101824')
      fctx.fillStyle = grad
      fctx.fillRect(0, 0, size, size)
      fctx.globalCompositeOperation = 'destination-in'
      fctx.drawImage(mask, 0, 0, size, size)

      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(fillCanvas, 0, 0)
      ctx.restore()
    } catch {
      // Vector shield fallback if WebP assets are unavailable
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(size * 0.16, size * 0.12)
      ctx.lineTo(size * 0.84, size * 0.12)
      ctx.lineTo(size * 0.84, size * 0.54)
      ctx.quadraticCurveTo(size * 0.84, size * 0.82, size * 0.5, size * 0.92)
      ctx.quadraticCurveTo(size * 0.16, size * 0.82, size * 0.16, size * 0.54)
      ctx.closePath()
      ctx.fillStyle = baseColor
      ctx.fill()
      ctx.lineWidth = 7
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round(size * shape.fs)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
    ctx.fillStyle = ink
    ctx.shadowColor = ink === '#10141a' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.52)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetY = 2
    ctx.fillText(letter, size * 0.5, size * shape.cy)
    ctx.restore()

    return canvas
  })()

  badgeCache.set(cacheKey, task)
  return task
}

const down = new T.Vector3(0, -1, 0)
const worldFwd = new T.Vector3(0, 0, 1)

export async function loadMatchday(club: Team) {
  const badge = await clubBadge(club),
    { scene: source } = await new GLTFLoader().loadAsync(modelUrl)
  const materials = new Set<T.Material>(),
    geometries = new Set<T.BufferGeometry>(),
    textures = new Set<T.Texture>()
  const register = (o: T.Object3D) =>
    o.traverse((n) => {
      if (n instanceof T.Mesh) {
        geometries.add(n.geometry)
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          materials.add(m)
          if (m.map) textures.add(m.map)
          if (m.normalMap) textures.add(m.normalMap)
        }
      }
    })
  register(source)
  function part(name: string) {
    const original = source.getObjectByName(name)
    if (!original) throw Error('Missing matchday asset: ' + name)
    return original.clone(true)
  }
  function figure(isKeeper: boolean, initialClub: Team = club, initialBadge: CanvasImageSource = badge) {
    const root = part('Athlete'),
      mats = new Map<string, T.MeshStandardMaterial>()
    root.traverse((n) => {
      if (n instanceof T.Mesh) {
        const m = n.material as T.MeshStandardMaterial
        if (!mats.has(m.name)) {
          const copy = m.clone()
          mats.set(m.name, copy)
          materials.add(copy)
        }
        n.material = mats.get(m.name)!
        n.castShadow = true
        n.receiveShadow = true
      }
    })
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 512
    const ctx = canvas.getContext('2d')!,
      fabric = new T.CanvasTexture(canvas)
    fabric.colorSpace = T.SRGBColorSpace
    textures.add(fabric)
    mats.get('shirt')!.map = fabric

    const bandMat = new T.MeshStandardMaterial({
      color: '#f5f8fc',
      roughness: 0.72,
      metalness: 0.04,
    })
    materials.add(bandMat)

    const gloveTrimMats: T.MeshStandardMaterial[] = []
    const head = root.getObjectByName('Head')!,
      glbHairs = Array.from({ length: GLB_HAIR_COUNT }, (_, i) => root.getObjectByName('Hair' + i)!),
      extraHairs = buildProceduralHairStyles(mats.get('hair')!, bandMat, (g) => {
        geometries.add(g)
        return g
      }),
      hairs: T.Object3D[] = [...glbHairs, ...extraHairs],
      beard = root.getObjectByName('Beard')!,
      legs = ['L', 'R'].map((s) => root.getObjectByName('Hip' + s)!),
      knees = ['L', 'R'].map((s) => root.getObjectByName('Knee' + s)!),
      ankles = ['L', 'R'].map((s) => root.getObjectByName('Ankle' + s)!),
      arms = ['L', 'R'].map((s) => root.getObjectByName('Shoulder' + s)!),
      elbows = ['L', 'R'].map((s) => root.getObjectByName('Elbow' + s)!)
    for (const eh of extraHairs) {
      eh.visible = false
      head.add(eh)
    }
    const gloves = isKeeper
      ? ['L', 'R'].map((s) => {
          root.getObjectByName('Hand' + s)!.visible = false
          const g = part('Glove' + s)
          // Match glove cuff accent cleanly to club color
          g.traverse((n) => {
            if (n instanceof T.Mesh) {
              const m = (n.material as T.MeshStandardMaterial).clone()
              materials.add(m)
              if (m.name === 'trim') {
                m.color.set(initialClub.color)
                gloveTrimMats.push(m)
              }
              n.material = m
              n.castShadow = true
              n.receiveShadow = true
            }
          })
          return g
        })
      : []

    let figClub = initialClub
    let figBadge = initialBadge
    let current: Wearer | undefined | null = null
    let currentKey = ''

    function applyColorsAndAppearance(targetClub: Team, targetBadge: CanvasImageSource, p?: Wearer) {
      const tone = isKeeper ? keeperColor(targetClub.color) : targetClub.color
      mats.get('sleeve')!.color.set(tone)
      mats.get('trim')!.color.set(isKeeper ? targetClub.color : inkOn(tone))
      mats.get('sock')!.color.set(tone)
      mats.get('shorts')!.color.set(isKeeper ? '#182430' : targetClub.color).multiplyScalar(isKeeper ? 1 : 0.34)
      for (const gm of gloveTrimMats) gm.color.set(targetClub.color)

      tailor(ctx, targetClub, p, isKeeper, targetBadge)
      fabric.needsUpdate = true

      // Resolve bound 3D appearance (skin tone, 15 hairstyles incl. bald, 10 hair colors, 4 builds, stature, headband & boots)
      const app = resolve3DAppearance(
        p ?? { id: isKeeper ? 'gk-default' : 'st-default' },
        isKeeper,
      )

      mats.get('skin')!.color.set(app.skinHex)
      mats.get('hair')!.color.set(app.hairColorHex)
      bandMat.color.set(app.bandColorHex)
      mats.get('boot')!.color.set(app.boot.main)
      mats.get('bootAccent')!.color.set(app.boot.accent)
      mats.get('bootSole')!.color.set(app.boot.sole)

      root.scale.set(app.scaleXZ, app.scaleY, app.scaleXZ)
      // Counter-scale head X/Z slightly when body build is wide/lean so head & hair stay naturally proportioned
      const invWidth = app.scaleY / Math.max(0.5, app.scaleXZ)
      const compXZ = 1 + (invWidth - 1) * 0.65
      head.scale.set(app.headShape[0] * compXZ, app.headShape[1], app.headShape[2] * compXZ)

      // app.hairIdx === 14 ('bald') hides all 0..13 hair groups cleanly
      hairs.forEach((node, idx) => {
        node.visible = idx === app.hairIdx
      })
      beard.visible = app.hasBeard
    }

    const wearerKey = (c: Team, p?: Wearer) =>
      `${c.name}|${c.color}|${p?.id ?? ''}|${p?.name ?? ''}|${p?.number ?? ''}|${p?.height ?? ''}|${p?.appearanceId ?? ''}|${p?.country ?? ''}`

    // Initialize default kit colors right away
    const initTone = isKeeper ? keeperColor(initialClub.color) : initialClub.color
    mats.get('sleeve')!.color.set(initTone)
    mats.get('trim')!.color.set(isKeeper ? initialClub.color : inkOn(initTone))
    mats.get('sock')!.color.set(initTone)
    mats.get('shorts')!.color.set(isKeeper ? '#182430' : initialClub.color).multiplyScalar(isKeeper ? 1 : 0.34)

    function dress(p?: Wearer) {
      if (p === current) return
      current = p
      currentKey = wearerKey(figClub, p)
      applyColorsAndAppearance(figClub, figBadge, p)
    }

    async function rekit(nextClub: Team, p?: Wearer) {
      const nextKey = wearerKey(nextClub, p)
      if (nextKey === currentKey) return
      const nextBadge = await clubBadge(nextClub)
      figClub = nextClub
      figBadge = nextBadge
      current = p
      currentKey = nextKey
      applyColorsAndAppearance(nextClub, nextBadge, p)
    }

    const rig = {
      root,
      legs,
      knees,
      ankles,
      arms,
      elbows,
      gloves,
      dress,
      rekit,
      plant(lift = 0) {
        plantFeetOnTurf(rig, lift)
      },
    }
    return rig
  }

  const kicker = figure(false),
    keeper = figure(true),
    ball = part('Football'),
    objects = new T.Group()
  objects.add(kicker.root, keeper.root, ball, ...keeper.gloves)
  const ballBaseColors = new Map<T.MeshStandardMaterial, T.Color>()
  ball.traverse((n) => {
    if (n instanceof T.Mesh) {
      const m = (n.material as T.MeshStandardMaterial).clone()
      materials.add(m)
      n.material = m
      ballBaseColors.set(m, m.color.clone())
      if (m.name === 'print') {
        m.color.set(club.color)
        ballBaseColors.set(m, m.color.clone())
        m.polygonOffset = true
        m.polygonOffsetFactor = -1
        m.polygonOffsetUnits = -1
      }
    }
  })
  function setBallHiVis(hiVis: boolean) {
    ball.traverse((n) => {
      if (n instanceof T.Mesh) {
        const m = n.material as T.MeshStandardMaterial
        if (hiVis) {
          if (m.name === 'print') m.color.set('#1f1520')
          else m.color.set('#ff6f1a')
        } else {
          const orig = ballBaseColors.get(m)
          if (orig) m.color.copy(orig)
        }
      }
    })
  }
  function setKeeperVisible(visible: boolean) {
    keeper.root.visible = visible
    for (const g of keeper.gloves) g.visible = visible
  }
  async function spawnKitFigure(kitClub: Team, wearer?: Wearer) {
    const kitBadge = await clubBadge(kitClub)
    const fig = figure(false, kitClub, kitBadge)
    fig.dress(wearer)
    return fig
  }

  const target = new T.Vector3(),
    axis = new T.Vector3(),
    bend = new T.Vector3(),
    elbowPt = new T.Vector3(),
    q = new T.Quaternion(),
    aPosL = new T.Vector3(),
    aPosR = new T.Vector3(),
    shWorld = new T.Vector3(),
    elWorld = new T.Vector3(),
    wristWorld = new T.Vector3(),
    palmWorld = new T.Vector3(),
    reachDir = new T.Vector3(),
    upAxis = new T.Vector3(),
    fwdAxis = new T.Vector3(),
    rightAxis = new T.Vector3(),
    basisMat = new T.Matrix4()

  // Ground both feet exactly onto y = 0.000 using the actual posed Ankle world coordinates (ZERO turf clipping!)
  function plantFeetOnTurf(fig: ReturnType<typeof figure>, lift = 0) {
    fig.root.updateMatrixWorld(true)
    fig.ankles[0].getWorldPosition(aPosL)
    fig.ankles[1].getWorldPosition(aPosR)
    const soleOffset = 0.073 * fig.root.scale.y
    const lowestSoleY = Math.min(aPosL.y, aPosR.y) - soleOffset
    fig.root.position.y += lift - lowestSoleY
    fig.root.updateMatrixWorld(true)
  }

  function pose(
    k: ReturnType<typeof keeperAt>,
    run: number,
    spotX = 0,
    spotZ = SPOT,
    afterContact = 0,
    keeperLand = 0,
  ) {
    // --- STRIKER ---
    const sc = kicker.root.scale.y
    const aimYaw = Math.atan2(-spotX, spotZ)
    const settle = afterContact > 0 ? clamp(afterContact / 0.54) : 0
    const settleEase = settle * (2 - settle)
    const approachX = spotX - 0.14 - 0.04 * clamp(run / 0.82) + 0.06 * settleEase
    const approachZ = spotZ + 0.22 + 1.66 * (1 - run) - 0.34 * settleEase
    const runLift = run > 0 && run < 0.96 ? Math.abs(Math.sin(4 * Math.PI * run)) * 0.035 : 0
    kicker.root.position.set(approachX, 0.96 * sc, approachZ)

    if (run <= 0.001) {
      const rootX = -0.05
      kicker.root.rotation.set(rootX, 0.12 + aimYaw * 0.65, 0, 'YXZ')
      kicker.legs[0].rotation.set(0.11, 0, -0.05)
      kicker.knees[0].rotation.set(-0.18, 0, 0)
      kicker.ankles[0].rotation.set(-(rootX + 0.11 - 0.18), 0, 0.05)
      kicker.legs[1].rotation.set(-0.14, 0, 0.06)
      kicker.knees[1].rotation.set(-0.2, 0, 0)
      kicker.ankles[1].rotation.set(-(rootX - 0.14 - 0.2) * 0.85, 0, -0.06)
      kicker.arms[0].rotation.set(0.12, 0, -0.14)
      kicker.elbows[0].rotation.set(0.46, 0, 0)
      kicker.arms[1].rotation.set(-0.08, 0, 0.14)
      kicker.elbows[1].rotation.set(0.5, 0, 0)
      plantFeetOnTurf(kicker, 0)
    } else if (run < 0.78) {
      const u = run / 0.78
      const stride = Math.sin(3.5 * Math.PI * u)
      const rootX = -0.14
      kicker.root.rotation.set(rootX, 0.12 * (1 - u), -0.05 * stride, 'YXZ')
      kicker.legs[0].rotation.set(0.44 * stride, 0, -0.04)
      kicker.legs[1].rotation.set(-0.44 * stride, 0, 0.04)
      kicker.knees[0].rotation.set(-0.14 - 0.56 * Math.max(0, -stride), 0, 0)
      kicker.knees[1].rotation.set(-0.14 - 0.56 * Math.max(0, stride), 0, 0)
      kicker.ankles[0].rotation.set(-0.12, 0, 0)
      kicker.ankles[1].rotation.set(-0.12, 0, 0)
      kicker.arms[0].rotation.set(-0.42 * stride, 0, -0.18)
      kicker.arms[1].rotation.set(0.42 * stride, 0, 0.18)
      kicker.elbows[0].rotation.set(0.85, 0, 0)
      kicker.elbows[1].rotation.set(0.85, 0, 0)
      plantFeetOnTurf(kicker, runLift)
    } else if (afterContact <= 0) {
      const w = clamp((run - 0.78) / 0.22)
      const swing = w < 0.35 ? -0.62 * (w / 0.35) : -0.62 + 1.56 * ((w - 0.35) / 0.65)
      const rootX = -0.15 + 0.11 * w
      kicker.root.rotation.set(rootX, -0.14 * w, 0.13 * w, 'YXZ')
      kicker.legs[0].rotation.set(0.15, 0, -0.06)
      kicker.knees[0].rotation.set(-0.24, 0, 0)
      kicker.ankles[0].rotation.set(-(rootX + 0.15 - 0.24), 0, 0.06)
      kicker.legs[1].rotation.set(swing, 0, 0.08)
      kicker.knees[1].rotation.set(w < 0.5 ? -0.66 : -0.66 * (1 - (w - 0.5) * 1.4), 0, 0)
      kicker.ankles[1].rotation.set(-0.22, 0, 0)
      kicker.arms[0].rotation.set(0.32, 0, -0.45 - 0.3 * w)
      kicker.arms[1].rotation.set(-0.38 * w, 0, 0.28)
      kicker.elbows[0].rotation.set(0.55, 0, 0)
      kicker.elbows[1].rotation.set(0.65, 0, 0)
      plantFeetOnTurf(kicker, 0)
    } else {
      // Smooth post-strike follow-through: kicking leg swings down into a balanced forward step + idle breathing
      const breathe = afterContact > 0.54 ? Math.sin((afterContact - 0.54) * 2.8) * 0.018 : 0
      const rootX = -0.04 * (1 - settleEase) - 0.03 * settleEase + breathe * 0.5
      const rootY = -0.14 * (1 - settleEase) + aimYaw * 0.45 * settleEase
      const rootZ = 0.13 * (1 - settleEase)
      kicker.root.rotation.set(rootX, rootY, rootZ, 'YXZ')

      const hipL = 0.15 * (1 - settleEase) + 0.18 * settleEase
      const kneeL = -0.24 * (1 - settleEase) - 0.2 * settleEase
      kicker.legs[0].rotation.set(hipL, 0, -0.06)
      kicker.knees[0].rotation.set(kneeL, 0, 0)
      kicker.ankles[0].rotation.set(-(rootX + hipL + kneeL), 0, 0.06)

      // Right kicking leg lowers smoothly from +0.94 rad high follow-through down onto the turf (-0.14 rad forward stance)
      const hipR = 0.94 * (1 - settleEase) - 0.14 * settleEase
      const kneeR = -0.198 * (1 - settleEase) - 0.22 * settleEase - Math.sin(settle * Math.PI) * 0.24
      kicker.legs[1].rotation.set(hipR, 0, 0.07)
      kicker.knees[1].rotation.set(kneeR, 0, 0)
      kicker.ankles[1].rotation.set(-0.22 * (1 - settleEase) - (rootX + hipR + kneeR) * 0.85 * settleEase, 0, -0.05)

      kicker.arms[0].rotation.set(0.32 * (1 - settleEase) + (0.08 + breathe) * settleEase, 0, -0.75 * (1 - settleEase) - 0.15 * settleEase)
      kicker.arms[1].rotation.set(-0.38 * (1 - settleEase) - (0.06 - breathe) * settleEase, 0, 0.28 * (1 - settleEase) + 0.15 * settleEase)
      kicker.elbows[0].rotation.set(0.55 * (1 - settleEase) + 0.44 * settleEase, 0, 0)
      kicker.elbows[1].rotation.set(0.65 * (1 - settleEase) + 0.48 * settleEase, 0, 0)
      plantFeetOnTurf(kicker, 0)
    }

    poseKeeper(k, keeperLand)
  }

  function poseKeeper(k: ReturnType<typeof keeperAt>, keeperLand = 0) {
    // --- GOALKEEPER ---
    const diveMag = clamp(Math.max(Math.abs(k.body.x) / 1.35, keeperLand))
    const rootX = -0.14 * (1 - diveMag)
    const sideSign = Math.sign(k.body.x) || 1
    const airRoll = clamp(k.body.x * 0.48, -1.24, 1.24)
    const landedRoll = sideSign * 1.42
    const rollZ = airRoll * (1 - keeperLand) + landedRoll * keeperLand
    keeper.root.position.set(k.body.x, k.body.y, GLOVE_Z - 0.22 * (1 - diveMag * 0.65))
    keeper.root.rotation.set(rootX, Math.PI, rollZ, 'YXZ')

    const crouchHip = 0.28 * (1 - diveMag)
    const crouchKnee = -0.52 * (1 - diveMag)
    const spread = 0.17 * (1 - diveMag) + 0.06 * diveMag * (1 - keeperLand * 0.5)
    const hipL = crouchHip - 0.18 * diveMag + 0.28 * keeperLand
    const hipR = crouchHip - 0.18 * diveMag + 0.18 * keeperLand
    const kneeL = crouchKnee - (sideSign > 0 ? 0.32 : 0.12) * diveMag - 0.35 * keeperLand
    const kneeR = crouchKnee - (sideSign < 0 ? 0.32 : 0.12) * diveMag - 0.25 * keeperLand
    keeper.legs[0].rotation.set(hipL, 0, -spread)
    keeper.legs[1].rotation.set(hipR, 0, spread)
    keeper.knees[0].rotation.set(kneeL, 0, 0)
    keeper.knees[1].rotation.set(kneeR, 0, 0)
    keeper.ankles[0].rotation.set(-(rootX + hipL + kneeL) * (1 - diveMag) - 0.28 * diveMag, 0, spread * (1 - diveMag))
    keeper.ankles[1].rotation.set(-(rootX + hipR + kneeR) * (1 - diveMag) - 0.28 * diveMag, 0, -spread * (1 - diveMag))

    if (diveMag < 0.04) {
      plantFeetOnTurf(keeper, 0)
    } else {
      keeper.root.updateMatrixWorld(true)
    }

    // --- ZERO-CLIPPING GOALKEEPER ARM IK & FOREARM-ALIGNED GLOVES ---
    // Stop the wrist joint 0.072m short of palm center along the reach ray so forearm ends cleanly INSIDE the glove cuff!
    const l1 = 0.25,
      l2 = 0.23,
      wristToPalm = 0.072 * keeper.root.scale.y
    for (let i = 0; i < 2; i++) {
      const point = i ? k.left : k.right,
        gloveObj = keeper.gloves[i],
        a = keeper.arms[i],
        e = keeper.elbows[i]

      palmWorld.set(point.x, point.y, GLOVE_Z)
      a.getWorldPosition(shWorld)
      reachDir.copy(palmWorld).sub(shWorld)
      if (reachDir.lengthSq() < 1e-5) reachDir.set(0, -1, 0)
      else reachDir.normalize()

      // Solve IK to the wrist entry point (slightly behind palm center so forearm never pierces palm!)
      wristWorld.copy(palmWorld).addScaledVector(reachDir, -wristToPalm)
      target.copy(wristWorld)
      keeper.root.worldToLocal(target)
      axis.copy(target).sub(a.position)
      const d = clamp(axis.length(), 0.06, l1 + l2 - 0.006)
      axis.normalize()
      bend.set(i ? 0.72 : -0.72, -1.0, 0.2)
      bend.addScaledVector(axis, -bend.dot(axis))
      if (bend.lengthSq() < 1e-5) bend.set(0, -1, 0)
      bend.normalize()
      const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
      elbowPt
        .copy(axis)
        .multiplyScalar(x)
        .addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - x * x)))
      a.quaternion.setFromUnitVectors(down, elbowPt.clone().normalize())
      axis.copy(target).sub(a.position).sub(elbowPt).normalize().applyQuaternion(q.copy(a.quaternion).invert())
      e.quaternion.setFromUnitVectors(down, axis)

      // Update forearm world transform and align glove cuff directly with the actual wrist & forearm direction!
      a.updateMatrixWorld(true)
      e.getWorldPosition(elWorld)
      // Exact world position of forearm tip (y = -0.228 in elbow local space)
      wristWorld.set(0, -0.228, 0).applyMatrix4(e.matrixWorld)
      upAxis.copy(wristWorld).sub(elWorld)
      if (upAxis.lengthSq() < 1e-5) upAxis.set(0, 1, 0)
      else upAxis.normalize()

      // Palm (+Z) faces the striker (+Z world), orthogonalized smoothly against forearm extension (+Y)
      fwdAxis.copy(worldFwd).addScaledVector(upAxis, -worldFwd.dot(upAxis))
      if (fwdAxis.lengthSq() < 1e-4) fwdAxis.set(0, 1, 0).addScaledVector(upAxis, -upAxis.y)
      fwdAxis.normalize()
      rightAxis.crossVectors(upAxis, fwdAxis).normalize()
      fwdAxis.crossVectors(rightAxis, upAxis).normalize()

      basisMat.makeBasis(rightAxis, upAxis, fwdAxis)
      gloveObj.position.copy(wristWorld)
      gloveObj.quaternion.setFromRotationMatrix(basisMat)
      gloveObj.scale.setScalar(keeper.root.scale.y)
    }
  }

  const grass = (
    source.getObjectByName('TurfSwatch')!.children[0] as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
  ).material

  return {
    objects,
    ball,
    club,
    badge,
    grass,
    kicker: kicker.root,
    keeper: keeper.root,
    kickerRig: kicker,
    keeperRig: keeper,
    pose,
    poseKeeper,
    setBallHiVis,
    setKeeperVisible,
    spawnKitFigure,
    dress(s?: Wearer, g?: Wearer) {
      kicker.dress(s)
      keeper.dress(g)
    },
    dispose() {
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) {
        t.dispose()
        if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close()
      }
    },
  }
}
