import * as T from 'three'
import { HALF, HEIGHT, SPOT, R, GLOVE_Z, clamp, keeperAt, type Point } from '../../game/penalty/practice.ts'

export function createGround(host: HTMLElement) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
  host.append(renderer.domElement)
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(39, 1, 0.1, 120)
  scene.background = new T.Color(0x344c68)
  scene.fog = new T.FogExp2(0x344c68, 0.023)
  scene.add(new T.HemisphereLight(0xecf6ff, 0x78a681, 2.1))
  const sun = new T.DirectionalLight(0xffecd3, 2.2)
  sun.position.set(-5, 12, 9)
  scene.add(sun)
  const materials = new Map<number, T.MeshStandardMaterial>()
  function mesh(g: T.BufferGeometry, color: number, pos: number[], parent: T.Object3D = scene) {
    if (!materials.has(color)) materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.88 }))
    const obj = new T.Mesh(g, materials.get(color))
    obj.position.set(pos[0], pos[1], pos[2])
    parent.add(obj)
    return obj
  }
  const box = (
    w: number,
    h: number,
    d: number,
    c: number,
    x: number,
    y: number,
    z: number,
    p: T.Object3D = scene,
  ) => mesh(new T.BoxGeometry(w, h, d), c, [x, y, z], p)
  for (let i = 0; i < 14; i++) box(58, 0.12, 4, i % 2 ? 0x2f805f : 0x378d65, 0, -0.08, -13 + i * 4)
  const white = 0xeef5e8
  box(36, 0.015, 0.08, white, 0, 0.004, 0)
  box(18, 0.015, 0.07, white, 0, 0.004, 5.5)
  for (const sign of [-1, 1]) {
    box(0.07, 0.015, 5.5, white, sign * 9, 0.004, 2.75)
    box(0.1, HEIGHT, 0.1, white, sign * HALF, HEIGHT / 2, 0)
  }
  box(HALF * 2 + 0.1, 0.1, 0.1, white, 0, HEIGHT, 0)
  box(0.21, 0.014, 0.13, white, 0, 0.006, SPOT)
  // Low-cost net: one line batch. Hide the back net when looking through it as keeper.
  const netCoords: number[] = []
  for (let x = -HALF; x <= HALF + 0.01; x += HALF / 11)
    netCoords.push(x, 0, -1.35, x, HEIGHT, -1.35, x, HEIGHT, -1.35, x, HEIGHT, 0)
  for (let y = 0; y <= HEIGHT + 0.01; y += HEIGHT / 8)
    netCoords.push(-HALF, y, -1.35, HALF, y, -1.35, -HALF, y, 0, -HALF, y, -1.35, HALF, y, 0, HALF, y, -1.35)
  const net = new T.LineSegments(
    new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(netCoords, 3)),
    new T.LineBasicMaterial({ color: 0xdfeaf1, transparent: true, opacity: 0.38 }),
  )
  scene.add(net)
  for (const z of [-9, 28])
    for (let i = 0; i < 4; i++)
      box(52, 0.85, 1.2, i % 2 ? 0x36577c : 0x487092, 0, 0.3 + i * 0.8, z + (z < 0 ? -1 : 1) * i)
  for (const x of [-15, 15])
    for (const z of [-7, 24]) {
      box(0.18, 9, 0.18, 0x779298, x, 4.5, z)
      box(2.8, 0.6, 0.25, 0xfff8d6, x, 9, z)
    }
  function figure(c: number) {
    const p = new T.Group()
    scene.add(p)
    mesh(new T.SphereGeometry(0.19, 12, 10), 0xb67856, [0, 0.61, 0], p)
    box(0.46, 0.56, 0.28, c, 0, 0.17, 0, p)
    box(0.42, 0.21, 0.29, 0x202f46, 0, -0.21, 0, p)
    const legs = [-1, 1].map((side) => {
      const joint = new T.Group()
      joint.position.set(side * 0.14, -0.27, 0)
      p.add(joint)
      box(0.15, 0.52, 0.18, c, 0, -0.27, 0, joint)
      box(0.17, 0.15, 0.29, 0x192537, 0, -0.59, 0, joint)
      box(0.13, 0.34, 0.15, c, side * 0.29, 0.13, 0, p)
      return joint
    })
    return { body: p, legs }
  }
  const kicker = figure(0xf16545),
    keeper = figure(0x35cabc)
  const gloves = [-1, 1].map(() => mesh(new T.SphereGeometry(0.17, 12, 10), 0xffd859, [0, 0, GLOVE_Z]))
  const ball = mesh(new T.IcosahedronGeometry(R, 2), 0xffffff, [0, R, SPOT])
  mesh(new T.IcosahedronGeometry(0.043, 0), 0x192737, [0, 0.026, 0.09], ball)
  const marker = new T.Group()
  scene.add(marker)
  for (const s of [-1, 1]) {
    box(0.42, 0.035, 0.035, 0xffdf65, 0, 0.19 * s, 0, marker)
    box(0.035, 0.38, 0.035, 0xffdf65, 0.2 * s, 0, 0, marker)
  }
  const shadow = (x: number, z: number, s: number) => {
    const m = mesh(new T.CircleGeometry(s, 24), 0x276d55, [x, 0.012, z])
    m.rotation.x = -Math.PI / 2
    m.scale.y = 0.53
    return m
  }
  const ballShade = shadow(0, SPOT, 0.13),
    keeperShade = shadow(0, GLOVE_Z, 0.52),
    kickerShade = shadow(0, SPOT, 0.43)
  const trailGeo = new T.BufferGeometry(),
    lineMat = new T.LineBasicMaterial({ color: 0xffdf80, depthTest: false })
  const trail = new T.Line(trailGeo, lineMat)
  trail.frustumCulled = false
  trail.renderOrder = 2
  scene.add(trail)
  function path(points: { x: number; y: number; z: number }[]) {
    trail.visible = points.length > 0
    if (points.length) trailGeo.setFromPoints(points.map((p) => new T.Vector3(p.x, p.y, p.z)))
  }
  let defending = false
  let revision = 0
  function resize() {
    revision++
    const w = host.clientWidth,
      h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.position.set(0, defending ? 2.65 : 4.05, defending ? -6.7 : 16.6)
    camera.lookAt(0, defending ? 1 : 1.05, defending ? 4.5 : 2)
    camera.fov = Math.max(
      39,
      T.MathUtils.radToDeg(2 * Math.atan(4.25 / ((defending ? 6.7 : 16.6) * camera.aspect))),
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
    path,
    canvas: renderer.domElement,
    get revision() {
      return revision
    },
    mode(keep: boolean) {
      defending = keep
      net.visible = !keep
      resize()
    },
    draw(
      p: { x: number; y: number; z: number },
      pose: ReturnType<typeof keeperAt>,
      aim: Point | null,
      run: number,
    ) {
      kicker.body.position.set(-0.32, 0.96, SPOT + 0.15 + 1.65 * (1 - run))
      kicker.body.rotation.x = -0.12 * run
      kicker.legs[0].rotation.x = 0.32 * Math.sin(4 * Math.PI * run)
      kicker.legs[1].rotation.x = run < 0.8 ? -0.38 * Math.sin(4 * Math.PI * run) : (1.08 * (run - 0.8)) / 0.2
      keeper.body.position.set(pose.body.x, pose.body.y, GLOVE_Z)
      keeper.body.rotation.z = -clamp(pose.body.x * 0.42, -1.05, 1.05)
      ballShade.position.set(p.x, 0.012, p.z)
      keeperShade.position.x = pose.body.x
      kickerShade.position.set(-0.32, 0.012, kicker.body.position.z)
      for (const [i, g] of gloves.entries()) {
        const pt = i ? pose.right : pose.left
        g.position.set(pt.x, pt.y, GLOVE_Z)
      }
      marker.visible = !!aim
      if (aim) marker.position.set(aim.x, aim.y, 0.08)
      ball.position.set(p.x, p.y, p.z)
      ball.rotation.x = -p.z * 2
      renderer.render(scene, camera)
    },
    dispose() {
      ro.disconnect()
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line) o.geometry.dispose()
      })
      for (const m of materials.values()) m.dispose()
      net.material.dispose()
      lineMat.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
