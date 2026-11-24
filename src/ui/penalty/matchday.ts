import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import modelUrl from './art/matchday.glb?url'
import type { Player } from '../../game/types.ts'
import { crest, distinctKit, inkOn, type ClubLook } from '../components.ts'
import { clamp, GLOVE_Z, SPOT, type keeperAt } from '../../game/penalty/practice.ts'

export type Team = Pick<ClubLook, 'name' | 'color'>
export type Wearer = Pick<Player, 'id' | 'name' | 'number' | 'height'>
const keeperColor = (home: string) => distinctKit('#f4b441', home)

// Both sides of the training drill belong to the user's roster. GK wears a contrast shirt, not an away club's kit.
function tailor(
  ctx: CanvasRenderingContext2D,
  club: Team,
  p: Wearer | undefined,
  keeper: boolean,
  badge: HTMLImageElement,
) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height,
    base = keeper ? keeperColor(club.color) : club.color,
    ink = inkOn(base)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.fillStyle = '#0a1721'
  ctx.globalAlpha = 0.16
  for (const x of [0, w / 2, w]) {
    ctx.beginPath()
    ctx.moveTo(x - 54, 0)
    ctx.lineTo(x + 54, 0)
    ctx.lineTo(x + 30, h * 0.55)
    ctx.lineTo(x + 41, h)
    ctx.lineTo(x - 41, h)
    ctx.lineTo(x - 30, h * 0.55)
    ctx.fill()
  }
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.065
  ctx.lineWidth = 1
  for (let i = -h; i < w; i += 5) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + h, h)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = ink
  ctx.fillRect(0, h - 13, w, 3)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 34px sans-serif'
  ctx.fillText(p?.name ?? (keeper ? '门将' : '前锋'), w * 0.25, h * 0.22, 192)
  ctx.font = '900 154px sans-serif'
  ctx.fillText(
    String(p && Number.isInteger(p.number) && p.number > 0 ? p.number : keeper ? 1 : 9),
    w * 0.25,
    h * 0.52,
    190,
  )
  ctx.drawImage(badge, w * 0.75 + 36, h * 0.16, 42, 48)
  ctx.font = '700 24px sans-serif'
  ctx.fillText(club.name, w * 0.75, h * 0.51, 200)
  ctx.font = '700 17px sans-serif'
  ctx.fillText('FM  /  MATCH ISSUE', w * 0.75, h * 0.6, 160)
}
function clubBadge(club: Team) {
  const img = new Image()
  img.src =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(crest(club, 160).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))
  return img.decode().then(() => img)
}
const down = new T.Vector3(0, -1, 0)
export async function loadMatchday(club: Team) {
  // Decode the badge before loading GPU assets; no partial GLTF scene left behind on badge failure.
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
  function figure(isKeeper: boolean) {
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
    const tone = isKeeper ? keeperColor(club.color) : club.color
    mats.get('sleeve')!.color.set(tone)
    mats.get('trim')!.color.set(isKeeper ? club.color : inkOn(tone))
    mats.get('sock')!.color.set(tone)
    mats.get('shorts')!.color.set(club.color).multiplyScalar(0.3)
    const legs = ['L', 'R'].map((s) => root.getObjectByName('Hip' + s)!),
      knees = ['L', 'R'].map((s) => root.getObjectByName('Knee' + s)!),
      arms = ['L', 'R'].map((s) => root.getObjectByName('Shoulder' + s)!),
      elbows = ['L', 'R'].map((s) => root.getObjectByName('Elbow' + s)!)
    const gloves = isKeeper
      ? ['L', 'R'].map((s) => {
          root.getObjectByName('Hand' + s)!.visible = false
          return part('Glove')
        })
      : []
    let current: Wearer | undefined | null = null
    function dress(p?: Wearer) {
      if (p === current) return
      current = p
      tailor(ctx, club, p, isKeeper, badge)
      fabric.needsUpdate = true
      const h = Array.from(p?.id ?? 'training').reduce((a, c) => (Math.imul(a, 31) + c.codePointAt(0)!) >>> 0, 0)
      mats.get('skin')!.color.set(['#ad7354', '#cc9574', '#956348', '#d9aa89', '#b78466'][h % 5])
      mats.get('hair')!.color.set(['#302723', '#514034', '#352f2c'][h % 3])
      root.scale.setScalar(clamp((p?.height || 178) / 178, 0.91, 1.1))
    }
    return { root, legs, knees, arms, elbows, gloves, dress }
  }
  const kicker = figure(false),
    keeper = figure(true),
    ball = part('Football'),
    objects = new T.Group()
  objects.add(kicker.root, keeper.root, ball, ...keeper.gloves)
  ball.traverse((n) => {
    if (n instanceof T.Mesh && n.material.name === 'print') {
      n.material.color.set(club.color)
      n.material.polygonOffset = true
      n.material.polygonOffsetFactor = -1
      n.material.polygonOffsetUnits = -1
    }
  })
  const target = new T.Vector3(),
    axis = new T.Vector3(),
    bend = new T.Vector3(),
    elbowPt = new T.Vector3(),
    q = new T.Quaternion()
  function pose(k: ReturnType<typeof keeperAt>, run: number) {
    kicker.root.position.set(-0.18, 0.96 * kicker.root.scale.y, SPOT + 0.16 + 1.65 * (1 - run))
    kicker.root.rotation.x = -0.1 * run
    const stride = Math.sin(4 * Math.PI * run)
    kicker.legs[0].rotation.x = 0.3 * stride
    kicker.legs[1].rotation.x = run < 0.8 ? -0.4 * stride : (1.05 * (run - 0.8)) / 0.2
    for (let i = 0; i < 2; i++) {
      kicker.knees[i].rotation.x = -0.16 - 0.48 * Math.max(0, stride * (i ? 1 : -1))
      kicker.arms[i].rotation.set(0.32 * stride * (i ? 1 : -1), 0, (i ? 1 : -1) * 0.23)
      kicker.elbows[i].rotation.x = 0.5
    }
    keeper.root.position.set(k.body.x, k.body.y, GLOVE_Z)
    keeper.root.rotation.set(0, Math.PI, clamp(k.body.x * 0.44, -1.16, 1.16), 'YXZ')
    keeper.root.updateMatrixWorld(true)
    // Solve shoulder/elbow to the same world-space gloves used in the gameplay hit test.
    for (let i = 0; i < 2; i++) {
      const point = i ? k.left : k.right,
        hand = keeper.gloves[i],
        a = keeper.arms[i],
        e = keeper.elbows[i]
      hand.position.set(point.x, point.y, GLOVE_Z)
      hand.rotation.z = i ? -0.26 : 0.26
      target.copy(hand.position)
      keeper.root.worldToLocal(target)
      axis.copy(target).sub(a.position)
      const d = clamp(axis.length(), 0.04, 0.403)
      axis.normalize()
      bend.set(i ? 1 : -1, -1, 0.25)
      bend.addScaledVector(axis, -bend.dot(axis)).normalize()
      const l1 = 0.211,
        l2 = 0.194,
        x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
      elbowPt
        .copy(axis)
        .multiplyScalar(x)
        .addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - x * x)))
      a.quaternion.setFromUnitVectors(down, elbowPt.clone().normalize())
      axis.copy(target).sub(a.position).sub(elbowPt).normalize().applyQuaternion(q.copy(a.quaternion).invert())
      e.quaternion.setFromUnitVectors(down, axis)
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
    pose,
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
