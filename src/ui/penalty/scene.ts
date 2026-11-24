import * as T from 'three'
import { HALF, HEIGHT, SPOT, R, GLOVE_Z, clamp, keeperAt, type Point } from '../../game/penalty/practice.ts'

import { stadium } from './stadium.ts'
import { makeGoalNet } from './goal-net.ts'
import type { Impact } from '../../game/penalty/net.ts'
import type { loadMatchday } from './matchday.ts'
export type Inspection = 'play' | 'player' | 'keeper' | 'ball'

export function createGround(host: HTMLElement, art: Awaited<ReturnType<typeof loadMatchday>>) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
  host.append(renderer.domElement)
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(39, 1, 0.1, 120)
  const sky = document.createElement('canvas')
  sky.width = 8
  sky.height = 256
  const sky2d = sky.getContext('2d')!,
    skyRamp = sky2d.createLinearGradient(0, 0, 0, 256)
  skyRamp.addColorStop(0, '#13213b')
  skyRamp.addColorStop(0.26, '#213a5e')
  skyRamp.addColorStop(0.48, '#3b5d80')
  skyRamp.addColorStop(0.62, '#6986a1')
  skyRamp.addColorStop(0.74, '#b89a8c')
  skyRamp.addColorStop(1, '#26394a')
  sky2d.fillStyle = skyRamp
  sky2d.fillRect(0, 0, 8, 256)
  const horizon = new T.CanvasTexture(sky)
  horizon.colorSpace = T.SRGBColorSpace
  scene.background = horizon
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  scene.fog = new T.FogExp2(0x273e55, 0.011)
  scene.add(new T.HemisphereLight(0xdcebff, 0x5c8b66, 1.75))
  const sun = new T.DirectionalLight(0xfff0d8, 2.25)
  sun.position.set(-7, 12, 13)
  sun.target.position.set(0, 0, 6)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(host.clientWidth < 600 ? 512 : 1024)
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 40 })
  sun.shadow.normalBias = 0.012
  sun.shadow.bias = -0.0004
  // Subtle stadium floodlight rim light for crisp 3D athlete shoulder/hair silhouette
  const rim = new T.DirectionalLight(0x9ecaff, 0.85)
  rim.position.set(6, 9.5, -10)
  rim.target.position.set(0, 1, 6)
  scene.add(sun, sun.target, rim, rim.target)
  art.objects.traverse((n) => {
    if (n instanceof T.Mesh) {
      n.castShadow = true
      n.receiveShadow = true
    }
  })
  const venue = stadium(art, renderer.capabilities.getMaxAnisotropy())
  scene.add(venue.root)
  const net = makeGoalNet()
  scene.add(net.object, art.objects)
  const { ball } = art
  const projected = new T.Vector3()
  const trailMat = new T.MeshBasicMaterial({
    color: 0xffe26a,
    transparent: true,
    opacity: 0.86,
    depthTest: false,
  })
  const trail = new T.Mesh(new T.BufferGeometry(), trailMat)
  trail.visible = false
  trail.frustumCulled = false
  trail.renderOrder = 2
  const impactRing = new T.Mesh(
    new T.RingGeometry(0.11, 0.165, 24),
    new T.MeshBasicMaterial({
      color: 0xfff099,
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    }),
  )
  impactRing.visible = false
  impactRing.renderOrder = 3
  scene.add(trail, impactRing)
  function path(points: { x: number; y: number; z: number }[]) {
    trail.geometry.dispose()
    if (points.length >= 2) {
      const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(p.x, p.y, p.z)))
      trail.geometry = new T.TubeGeometry(curve, 36, 0.022, 6, false)
      trail.visible = true
      const end = points[points.length - 1]
      impactRing.position.set(end.x, end.y, end.z)
      impactRing.visible = true
    } else {
      trail.geometry = new T.BufferGeometry()
      trail.visible = false
      impactRing.visible = false
    }
  }
  let inspecting: Inspection = 'play'
  let defending = false
  let revision = 0
  function resize() {
    revision++
    const w = host.clientWidth,
      h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.position.set(defending ? 0 : -1.45, defending ? 2.65 : 1.97, defending ? -6.7 : 17.8)
    camera.lookAt(0, defending ? 1 : 1.05, defending ? 4.5 : 2)
    camera.fov = Math.max(
      39,
      T.MathUtils.radToDeg(2 * Math.atan(4.25 / ((defending ? 6.7 : 17.8) * camera.aspect))),
    )
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()
  function aimAt(clientX: number, clientY: number): Point | null {
    const rect = host.getBoundingClientRect(),
      ray = new T.Raycaster(),
      hit = new T.Vector3()
    ray.setFromCamera(
      new T.Vector2((2 * (clientX - rect.left)) / rect.width - 1, 1 - (2 * (clientY - rect.top)) / rect.height),
      camera,
    )
    return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), 0), hit)
      ? { x: clamp(hit.x, -HALF, HALF), y: clamp(hit.y, R, HEIGHT) }
      : null
  }
  return {
    aimAt,
    aimScreen(aim: Point): Point {
      projected.set(aim.x, aim.y, 0).project(camera)
      return { x: (projected.x * 0.5 + 0.5) * host.clientWidth, y: (0.5 - projected.y * 0.5) * host.clientHeight }
    },
    path,
    canvas: renderer.domElement,
    get revision() {
      return revision
    },
    dress: art.dress,
    inspect(value: Inspection) {
      inspecting = value
      resize()
    },
    mode(keep: boolean) {
      defending = keep
      net.keeperView(keep)
      resize()
    },
    draw(
      p: { x: number; y: number; z: number },
      pose: ReturnType<typeof keeperAt>,
      run: number,
      hit: Impact | null,
      sinceImpact: number,
      turn: number,
    ) {
      art.pose(pose, run)
      net.move(hit, sinceImpact)
      ball.position.set(p.x, p.y, p.z)
      ball.rotation.x = -p.z * 2
      if (inspecting !== 'play') {
        const obj = inspecting === 'player' ? art.kicker : inspecting === 'keeper' ? art.keeper : ball
        const target = obj.position.clone()
        if (inspecting !== 'ball') target.y += 0.01
        const angle = turn + 0.22 + (inspecting === 'keeper' ? Math.PI : 0),
          r = inspecting === 'ball' ? 0.52 : 2.98
        camera.fov = inspecting === 'ball' ? 32 : 40
        camera.position.set(
          target.x + Math.sin(angle) * r,
          target.y + (inspecting === 'ball' ? 0.14 : 0.34),
          target.z + Math.cos(angle) * r,
        )
        camera.lookAt(target)
        camera.updateProjectionMatrix()
      }
      renderer.render(scene, camera)
    },
    dispose() {
      ro.disconnect()
      scene.remove(art.objects)
      venue.dispose()
      art.dispose()
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line) o.geometry.dispose()
      })
      net.dispose()
      trailMat.dispose()
      ;(impactRing.material as T.Material).dispose()
      horizon.dispose()
      sun.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
