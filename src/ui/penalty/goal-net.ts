import * as T from 'three'
import { HALF, HEIGHT, clamp } from '../../game/penalty/practice.ts'
import { NET_DEPTH, ripple, type Impact } from '../../game/penalty/net.ts'

// Shared indexed knots at the back/side/top seams. The goal frame and bottom tie-downs stay fixed.
export function makeGoalNet() {
  const points: number[] = [],
    edges: number[] = [],
    knots = new Map<string, number>(),
    links = new Set<string>()
  function grid(cols: number, rows: number, at: (u: number, v: number) => number[]) {
    const ids: number[] = []
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const p = at(i / cols, j / rows),
          key = p.map((x) => Math.round(x * 10000)).join(':')
        let n = knots.get(key)
        if (n === undefined) {
          n = points.length / 3
          knots.set(key, n)
          points.push(...p)
        }
        ids.push(n)
        for (const neighbor of [i ? ids.at(-2) : undefined, j ? ids.at(-cols - 2) : undefined])
          if (neighbor !== undefined) {
            const k = [Math.min(n, neighbor), Math.max(n, neighbor)].join(':')
            if (!links.has(k)) {
              links.add(k)
              edges.push(n, neighbor)
            }
          }
      }
  }
  grid(52, 18, (u, v) => [(2 * u - 1) * HALF, v * HEIGHT, -NET_DEPTH])
  grid(52, 10, (u, v) => [(2 * u - 1) * HALF, HEIGHT, -v * NET_DEPTH])
  for (const side of [-1, 1]) grid(10, 18, (u, v) => [side * HALF, v * HEIGHT, -u * NET_DEPTH])
  const rest = new Float32Array(points),
    attr = new T.BufferAttribute(rest.slice(), 3).setUsage(T.DynamicDrawUsage),
    g = new T.BufferGeometry().setAttribute('position', attr)
  g.setIndex(edges)
  const m = new T.LineBasicMaterial({ color: 0xe2eee6, transparent: true, opacity: 0.47, depthWrite: false })
  const object = new T.LineSegments(g, m)
  object.frustumCulled = false
  const dist = new Float32Array(attr.count),
    pin = new Float32Array(attr.count)
  for (let i = 0; i < attr.count; i++) pin[i] = clamp(-rest[i * 3 + 2] / 0.18) * clamp(rest[i * 3 + 1] / 0.18)
  let active: Impact | null = null
  function move(hit: Impact | null, t: number) {
    if (!hit) {
      if (active) {
        attr.array.set(rest)
        attr.needsUpdate = true
        active = null
      }
      return
    }
    if (active !== hit) {
      active = hit
      for (let i = 0; i < attr.count; i++)
        dist[i] = Math.hypot(
          rest[3 * i] - hit.point.x,
          rest[3 * i + 1] - hit.point.y,
          rest[3 * i + 2] - hit.point.z,
        )
    }
    for (let i = 0; i < attr.count; i++) {
      const k = pin[i] * ripple(dist[i], t, hit.speed)
      attr.setXYZ(
        i,
        rest[3 * i] + k * hit.normal.x,
        rest[3 * i + 1] + k * hit.normal.y,
        rest[3 * i + 2] + k * hit.normal.z,
      )
    }
    attr.needsUpdate = true
  }
  return {
    object,
    move,
    keeperView(keep: boolean) {
      m.opacity = keep ? 0.13 : 0.31
    },
    dispose() {
      m.dispose()
    },
  }
}
