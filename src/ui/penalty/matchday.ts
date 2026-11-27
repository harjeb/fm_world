import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import modelUrl from './art/matchday.glb?url'
import type { Player } from '../../game/types.ts'
import { assetUrl, distinctKit, inkOn, type ClubLook } from '../components.ts'
import { clamp, GLOVE_Z, SPOT, type keeperAt } from '../../game/penalty/practice.ts'

export type Team = Pick<ClubLook, 'name' | 'color'>
export type Wearer = Pick<Player, 'id' | 'name' | 'number' | 'height'>
const keeperColor = (home: string) => distinctKit('#f2b632', home)

// Deterministic player look templates: skin tones, hair styles/colors, subtle head proportions & pro cleat colorways.
const SKIN_TONES = ['#e7bea0', '#dbb08d', '#d29e79', '#c48d68', '#b57b57', '#9e6746', '#825136', '#633b27']
const HAIR_TONES = ['#1a191c', '#2a201b', '#3f2d21', '#5a3f2b', '#7b5b39', '#b89a67', '#6a3824']
const HEAD_SHAPES: readonly [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [0.95, 1.03, 0.99],
  [1.04, 0.97, 1.01],
  [0.97, 0.99, 1.03],
  [1.02, 1.02, 0.97],
]
const BOOT_STYLES: readonly { main: string; accent: string; sole: string }[] = [
  { main: '#182028', accent: '#cdf33f', sole: '#10151c' }, // Stealth Black / Volt Lime
  { main: '#eef2f7', accent: '#e83a48', sole: '#1c2430' }, // Pure White / Crimson
  { main: '#16b4f0', accent: '#0e1d34', sole: '#0b1626' }, // Electric Cyan / Navy
  { main: '#ff691a', accent: '#161c24', sole: '#1a1d24' }, // Solar Orange / Carbon
  { main: '#b9f22c', accent: '#171f26', sole: '#141a21' }, // Neon Volt / Obsidian
  { main: '#e2b232', accent: '#1b2128', sole: '#171b22' }, // Royal Gold / Matte Black
  { main: '#df3374', accent: '#f4f7fb', sole: '#1d1c28' }, // Hyper Pink / White
  { main: '#c2cbd6', accent: '#256ae0', sole: '#182233' }, // Metallic Silver / Cobalt
]
const HAIR_COUNT = 6

function hashSeed(input: string) {
  let h = 2166136261
  for (const ch of input) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return h >>> 0
}
function nextHash(h: number) {
  return (Math.imul(h, 1664525) + 1013904223) >>> 0
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

    const gloveTrimMats: T.MeshStandardMaterial[] = []
    const head = root.getObjectByName('Head')!,
      hairs = Array.from({ length: HAIR_COUNT }, (_, i) => root.getObjectByName('Hair' + i)!),
      beard = root.getObjectByName('Beard')!,
      legs = ['L', 'R'].map((s) => root.getObjectByName('Hip' + s)!),
      knees = ['L', 'R'].map((s) => root.getObjectByName('Knee' + s)!),
      ankles = ['L', 'R'].map((s) => root.getObjectByName('Ankle' + s)!),
      arms = ['L', 'R'].map((s) => root.getObjectByName('Shoulder' + s)!),
      elbows = ['L', 'R'].map((s) => root.getObjectByName('Elbow' + s)!)
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

      // Seed deterministic multi-trait player template (head shape, hairstyle, beard, skin, hair color, boot colorway)
      let h = hashSeed(`${p?.id ?? (isKeeper ? 'gk-default' : 'st-default')}|${p?.name ?? ''}`)
      const skinIdx = h % SKIN_TONES.length
      h = nextHash(h)
      const hairStyle = h % HAIR_COUNT
      h = nextHash(h)
      // Keep natural pairing: darker skin tones lean toward darker hair while preserving occasional stylish bleach
      const hairColorIdx =
        skinIdx >= 5 && h % 7 !== 0 ? h % 3 : h % HAIR_TONES.length
      h = nextHash(h)
      const headShape = HEAD_SHAPES[h % HEAD_SHAPES.length]
      h = nextHash(h)
      const hasBeard = h % 10 < 4
      h = nextHash(h)
      const bootStyle = BOOT_STYLES[h % BOOT_STYLES.length]

      mats.get('skin')!.color.set(SKIN_TONES[skinIdx])
      mats.get('hair')!.color.set(HAIR_TONES[hairColorIdx])
      mats.get('boot')!.color.set(bootStyle.main)
      mats.get('bootAccent')!.color.set(bootStyle.accent)
      mats.get('bootSole')!.color.set(bootStyle.sole)

      head.scale.set(headShape[0], headShape[1], headShape[2])
      hairs.forEach((node, idx) => {
        node.visible = idx === hairStyle
      })
      beard.visible = hasBeard

      root.scale.setScalar(clamp((p?.height || 180) / 180, 0.93, 1.09))
    }

    // Initialize default kit colors right away
    const initTone = isKeeper ? keeperColor(initialClub.color) : initialClub.color
    mats.get('sleeve')!.color.set(initTone)
    mats.get('trim')!.color.set(isKeeper ? initialClub.color : inkOn(initTone))
    mats.get('sock')!.color.set(initTone)
    mats.get('shorts')!.color.set(isKeeper ? '#182430' : initialClub.color).multiplyScalar(isKeeper ? 1 : 0.34)

    function dress(p?: Wearer) {
      if (p === current) return
      current = p
      currentKey = `${figClub.name}|${figClub.color}|${p?.id ?? ''}|${p?.name ?? ''}|${p?.number ?? ''}|${p?.height ?? ''}`
      applyColorsAndAppearance(figClub, figBadge, p)
    }

    async function rekit(nextClub: Team, p?: Wearer) {
      const nextKey = `${nextClub.name}|${nextClub.color}|${p?.id ?? ''}|${p?.name ?? ''}|${p?.number ?? ''}|${p?.height ?? ''}`
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
