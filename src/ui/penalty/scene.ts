import * as T from 'three'
import { HALF, HEIGHT, SPOT, R, clamp, keeperAt, type Point } from '../../game/penalty/practice.ts'
import {
  ENVIRONMENT_PRESETS,
  environmentPhysics,
  type PitchEnvironment,
  type WeatherId,
} from '../../game/penalty/environment.ts'
import { stadium } from './stadium.ts'
import { makeGoalNet } from './goal-net.ts'
import type { Impact } from '../../game/penalty/net.ts'
import type { loadMatchday } from './matchday.ts'
export type Inspection = 'play' | 'player' | 'keeper' | 'ball'

const SKY_RAMPS: Record<WeatherId, readonly [number, string][]> = {
  clear: [
    [0, '#13213b'],
    [0.26, '#213a5e'],
    [0.48, '#3b5d80'],
    [0.62, '#6986a1'],
    [0.74, '#b89a8c'],
    [1, '#26394a'],
  ],
  rain: [
    [0, '#0f1824'],
    [0.3, '#1c2b3c'],
    [0.55, '#2f4356'],
    [0.75, '#465b6d'],
    [1, '#1d2a35'],
  ],
  snow: [
    [0, '#1c2a3e'],
    [0.3, '#314761'],
    [0.56, '#58728c'],
    [0.76, '#9cb1c4'],
    [1, '#4b5f73'],
  ],
  sandstorm: [
    [0, '#3d2817'],
    [0.28, '#6e4927'],
    [0.54, '#a67540'],
    [0.76, '#cfa065'],
    [1, '#78542e'],
  ],
}

const FOG_SETTINGS: Record<WeatherId, { color: number; density: number }> = {
  clear: { color: 0x273e55, density: 0.011 },
  rain: { color: 0x243444, density: 0.021 },
  snow: { color: 0x6b8299, density: 0.025 },
  sandstorm: { color: 0xb08048, density: 0.036 },
}

export function createGround(host: HTMLElement, art: Awaited<ReturnType<typeof loadMatchday>>, bannerTitle?: string) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
  host.append(renderer.domElement)
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(39, 1, 0.1, 140)
  const sky = document.createElement('canvas')
  sky.width = 8
  sky.height = 256
  const sky2d = sky.getContext('2d')!
  function paintSky(weather: WeatherId) {
    const ramp = sky2d.createLinearGradient(0, 0, 0, 256)
    for (const [stop, color] of SKY_RAMPS[weather]) ramp.addColorStop(stop, color)
    sky2d.fillStyle = ramp
    sky2d.fillRect(0, 0, 8, 256)
  }
  paintSky('clear')
  const horizon = new T.CanvasTexture(sky)
  horizon.colorSpace = T.SRGBColorSpace
  scene.background = horizon
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  const fog = new T.FogExp2(0x273e55, 0.011)
  scene.fog = fog
  const hemi = new T.HemisphereLight(0xdcebff, 0x5c8b66, 1.75)
  scene.add(hemi)
  const sun = new T.DirectionalLight(0xfff0d8, 2.25)
  sun.position.set(-7, 12, 13)
  sun.target.position.set(0, 0, 6)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(host.clientWidth < 600 ? 512 : 1024)
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 48 })
  sun.shadow.normalBias = 0.012
  sun.shadow.bias = -0.0004
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
  if (bannerTitle) venue.setBanner(bannerTitle)
  scene.add(venue.root)
  const net = makeGoalNet()
  const extras = new T.Group()
  scene.add(net.object, art.objects, extras)
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

  // Wind-driven 3D weather particles (rain streaks / snowflakes / sandstorm dust)
  const PARTICLE_COUNT = 420
  const particleSeeds = new Float32Array(PARTICLE_COUNT * 3)
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3)
  let s = 2463534242
  for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    particleSeeds[i] = (s >>> 0) / 0xffffffff
  }
  const particleGeo = new T.BufferGeometry()
  particleGeo.setAttribute('position', new T.BufferAttribute(particlePositions, 3))
  const flakeCanvas = document.createElement('canvas')
  flakeCanvas.width = flakeCanvas.height = 32
  const fctx = flakeCanvas.getContext('2d')!,
    fgrad = fctx.createRadialGradient(16, 16, 1, 16, 16, 15)
  fgrad.addColorStop(0, 'rgba(255,255,255,1)')
  fgrad.addColorStop(0.5, 'rgba(255,255,255,0.65)')
  fgrad.addColorStop(1, 'rgba(255,255,255,0)')
  fctx.fillStyle = fgrad
  fctx.fillRect(0, 0, 32, 32)
  const flakeTex = new T.CanvasTexture(flakeCanvas)
  const particleMat = new T.PointsMaterial({
    color: 0xdceeff,
    map: flakeTex,
    size: 0.14,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  })
  const weatherPoints = new T.Points(particleGeo, particleMat)
  weatherPoints.visible = false
  weatherPoints.frustumCulled = false
  scene.add(weatherPoints)

  let currentEnv: PitchEnvironment = ENVIRONMENT_PRESETS.standard
  let spotX = 0
  let spotZ = SPOT

  function updateWeatherParticles(timeSec: number) {
    if (currentEnv.weather === 'clear') {
      weatherPoints.visible = false
      return
    }
    weatherPoints.visible = true
    const ep = environmentPhysics(currentEnv)
    const fallSpeed = currentEnv.weather === 'rain' ? 13.5 : currentEnv.weather === 'snow' ? 2.5 : 1.1
    const spanX = 28
    const spanY = 10
    const spanZ = Math.max(18, spotZ + 4)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const b = i * 3
      const sx = particleSeeds[b] * spanX
      const sy = particleSeeds[b + 1] * spanY
      const sz = particleSeeds[b + 2] * spanZ
      const swirl = currentEnv.weather === 'snow' ? Math.sin(timeSec * 2.3 + i) * 0.45 : 0
      const px = ((((sx + ep.windX * timeSec + swirl) % spanX) + spanX) % spanX) - spanX / 2
      const py = spanY - ((((sy + fallSpeed * timeSec) % spanY) + spanY) % spanY)
      const pz = ((((sz + ep.windZ * timeSec) % spanZ) + spanZ) % spanZ) - 5.5
      particlePositions[b] = px
      particlePositions[b + 1] = py
      particlePositions[b + 2] = pz
    }
    particleGeo.attributes.position.needsUpdate = true
  }

  function setEnvironment(env: PitchEnvironment) {
    currentEnv = env
    paintSky(env.weather)
    horizon.needsUpdate = true
    const f = FOG_SETTINGS[env.weather]
    fog.color.setHex(f.color)
    fog.density = f.density
    venue.setSurface(env.surface)
    const ep = environmentPhysics(env)
    art.setBallHiVis(ep.hiVisBall)
    if (env.weather === 'sandstorm') {
      sun.color.setHex(0xffcf96)
      sun.intensity = 1.85
      hemi.intensity = 1.45
      particleMat.color.setHex(0xe5b773)
      particleMat.size = 0.14
      particleMat.opacity = 0.62
    } else if (env.weather === 'snow') {
      sun.color.setHex(0xeaf4ff)
      sun.intensity = 1.95
      hemi.intensity = 1.95
      particleMat.color.setHex(0xf7fbff)
      particleMat.size = 0.15
      particleMat.opacity = 0.85
    } else if (env.weather === 'rain') {
      sun.color.setHex(0xd4e4f7)
      sun.intensity = 1.7
      hemi.intensity = 1.5
      particleMat.color.setHex(0x9ec8f0)
      particleMat.size = 0.095
      particleMat.opacity = 0.66
    } else {
      sun.color.setHex(0xfff0d8)
      sun.intensity = 2.25
      hemi.intensity = 1.75
    }
    revision++
  }

  function path(points: { x: number; y: number; z: number }[], showRing = true) {
    trail.geometry.dispose()
    if (points.length >= 2) {
      const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(p.x, p.y, p.z)))
      trail.geometry = new T.TubeGeometry(curve, 44, 0.022, 6, false)
      trail.visible = true
      const end = points[points.length - 1]
      impactRing.position.set(end.x, end.y, end.z)
      impactRing.visible = showRing
    } else {
      trail.geometry = new T.BufferGeometry()
      trail.visible = false
      impactRing.visible = false
    }
  }
  let inspecting: Inspection = 'play'
  let defending = false
  let revision = 0

  const defPos = new T.Vector3()
  const defTarget = new T.Vector3()
  let defFov = 39
  const camTarget = new T.Vector3()
  let customCam = false
  let camYaw = 0
  let camPitch = 0.18
  let camDist = 14

  function syncSphericalFromCurrent() {
    const offset = camera.position.clone().sub(camTarget)
    camDist = Math.max(2.2, offset.length())
    camPitch = clamp(Math.asin(clamp(offset.y / camDist, -0.95, 0.95)), 0.05, 1.38)
    camYaw = Math.atan2(offset.x, offset.z)
  }

  function applyCamera() {
    if (!customCam) {
      camera.position.copy(defPos)
      camera.lookAt(defTarget)
      camera.fov = defFov
      net.keeperView(defending)
    } else {
      const cosP = Math.cos(camPitch)
      const cx = camTarget.x + camDist * cosP * Math.sin(camYaw)
      const cy = Math.max(0.32, camTarget.y + camDist * Math.sin(camPitch))
      const cz = camTarget.z + camDist * cosP * Math.cos(camYaw)
      camera.position.set(cx, cy, cz)
      camera.lookAt(camTarget)
      camera.fov = clamp(defFov, 34, 48)
      net.keeperView(cz < -0.5)
    }
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  function resize() {
    revision++
    const w = host.clientWidth,
      h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    if (defending) {
      defPos.set(0, 2.65, -6.7)
      defTarget.set(spotX * 0.25, 1, Math.min(8, spotZ * 0.42))
      defFov = Math.max(39, T.MathUtils.radToDeg(2 * Math.atan(4.25 / (6.7 * camera.aspect))))
    } else {
      const distBack = spotZ > 13 ? 7.6 : 6.8
      const camY = spotZ > 13 ? 2.48 + (spotZ - 13) * 0.045 : 1.97
      const camX = spotX * 1.12 - (spotZ > 13 ? 0.95 : 1.45)
      const camZ = spotZ + distBack
      defPos.set(camX, camY, camZ)
      defTarget.set(spotX * 0.14, 1.08, 1.8)
      defFov = Math.max(
        spotZ > 13 ? 36 : 39,
        T.MathUtils.radToDeg(2 * Math.atan(4.45 / (Math.min(20, camZ) * camera.aspect))),
      )
    }
    if (!customCam) camTarget.copy(defTarget)
    applyCamera()
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
      if (projected.z > 1) return { x: -9999, y: -9999 }
      return { x: (projected.x * 0.5 + 0.5) * host.clientWidth, y: (0.5 - projected.y * 0.5) * host.clientHeight }
    },
    get isCustomCamera() {
      return customCam
    },
    orbitCamera(dYaw: number, dPitch: number) {
      if (!customCam) {
        camTarget.copy(defTarget)
        syncSphericalFromCurrent()
        customCam = true
      }
      camYaw -= dYaw
      camPitch = clamp(camPitch + dPitch, 0.04, 1.36)
      revision++
      applyCamera()
    },
    panCamera(dx: number, dy: number) {
      if (!customCam) {
        camTarget.copy(defTarget)
        syncSphericalFromCurrent()
        customCam = true
      }
      const rightX = Math.cos(camYaw)
      const rightZ = -Math.sin(camYaw)
      const fwdX = -Math.sin(camYaw)
      const fwdZ = -Math.cos(camYaw)
      const scale = camDist * 0.0022
      camTarget.x = clamp(camTarget.x - dx * rightX * scale + dy * fwdX * scale * 0.65, -12, 12)
      camTarget.y = clamp(camTarget.y + dy * scale * 0.55, 0.25, 4.8)
      camTarget.z = clamp(camTarget.z - dx * rightZ * scale + dy * fwdZ * scale * 0.65, -4, Math.max(16, spotZ + 4))
      revision++
      applyCamera()
    },
    zoomCamera(factor: number) {
      if (!customCam) {
        camTarget.copy(defTarget)
        syncSphericalFromCurrent()
        customCam = true
      }
      camDist = clamp(camDist * factor, 2.6, 34)
      revision++
      applyCamera()
    },
    setCameraPreset(preset: 'default' | 'behind_goal' | 'side' | 'bird') {
      if (preset === 'default') {
        customCam = false
        camTarget.copy(defTarget)
        revision++
        applyCamera()
        return
      }
      customCam = true
      if (preset === 'behind_goal') {
        camTarget.set(0, 1.15, 2.2)
        camYaw = Math.PI * 0.94
        camPitch = 0.16
        camDist = 7.8
      } else if (preset === 'side') {
        camTarget.set(0, 1.1, Math.min(6.5, spotZ * 0.36))
        camYaw = Math.PI * 0.44
        camPitch = 0.15
        camDist = Math.max(11.5, spotZ * 0.72)
      } else if (preset === 'bird') {
        camTarget.set(spotX * 0.25, 0.9, Math.min(8, spotZ * 0.42))
        camYaw = -0.18
        camPitch = 0.78
        camDist = Math.max(15.5, spotZ * 0.95)
      }
      revision++
      applyCamera()
    },
    resetCamera() {
      if (!customCam) return
      customCam = false
      camTarget.copy(defTarget)
      revision++
      applyCamera()
    },
    setBanner(title: string) {
      venue.setBanner(title)
    },
    setCinemaCamera(
      pos: { x: number; y: number; z: number },
      look: { x: number; y: number; z: number },
      fov = 39,
      hintSpot?: { x: number; z: number },
    ) {
      if (hintSpot) {
        spotX = hintSpot.x
        spotZ = hintSpot.z
      }
      const aspect = camera.aspect || 1.6
      defPos.set(pos.x, pos.y, pos.z)
      defTarget.set(look.x, look.y, look.z)
      defFov = Math.max(fov, T.MathUtils.radToDeg(2 * Math.atan(4.35 / (Math.max(7, Math.min(18, pos.z)) * aspect))))
      if (!customCam) {
        camTarget.copy(defTarget)
        applyCamera()
      }
    },
    drawScene(
      p: { x: number; y: number; z: number },
      hit: Impact | null,
      sinceImpact: number,
      timeSec: number,
      spinSign = 1,
    ) {
      net.move(hit, sinceImpact)
      updateWeatherParticles(timeSec)
      ball.position.set(p.x, p.y, p.z)
      ball.rotation.set(-p.z * 2.1, spinSign * p.x * 0.55, -p.x * 0.95)
      renderer.render(scene, camera)
    },
    path,
    extras,
    canvas: renderer.domElement,
    get revision() {
      return revision
    },
    dress: art.dress,
    setEnvironment,
    setKeeperless(keeperless: boolean) {
      art.setKeeperVisible(!keeperless)
      revision++
    },
    setSpot(x: number, z: number) {
      spotX = x
      spotZ = z
      customCam = false
      resize()
    },
    inspect(value: Inspection) {
      inspecting = value
      customCam = false
      resize()
    },
    mode(keep: boolean) {
      defending = keep
      customCam = false
      net.keeperView(keep)
      resize()
    },
    draw(
      p: { x: number; y: number; z: number },
      pose: ReturnType<typeof keeperAt> & { landed?: number },
      run: number,
      hit: Impact | null,
      sinceImpact: number,
      turn: number,
      timeSec = turn / 0.55,
      afterContact = 0,
    ) {
      art.pose(pose, run, spotX, spotZ, afterContact, pose.landed ?? 0)
      net.move(hit, sinceImpact)
      updateWeatherParticles(timeSec)
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
      scene.remove(art.objects, extras)
      venue.dispose()
      art.dispose()
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Points) o.geometry.dispose()
      })
      net.dispose()
      trailMat.dispose()
      flakeTex.dispose()
      particleMat.dispose()
      ;(impactRing.material as T.Material).dispose()
      horizon.dispose()
      sun.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
