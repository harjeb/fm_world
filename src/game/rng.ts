/**
 * PCG32（固定实现版本）。所有逻辑随机都走这里，表现层随机另开流。
 * 同一 seed + 同一调用顺序在版本内可复现。
 * 内部用双 uint32（hi/lo）执行精确 64 位无符号运算，与 BigInt 版本逐位等价但零堆分配。
 */
const MUL_HI = 0x5851f42d
const MUL_LO_HI = 0x4c95
const MUL_LO_LO = 0x7f2d
const MUL_LO = 0x4c957f2d
const TWO32 = 0x100000000

export class PCG32 {
  private stateHi: number
  private stateLo: number
  private incHi: number
  private incLo: number

  constructor(seed: number | bigint, sequence = 1) {
    this.stateHi = 0
    this.stateLo = 0
    if (typeof sequence === 'number' && sequence >= 0 && sequence <= 0x7fffffff) {
      this.incHi = 0
      this.incLo = ((sequence << 1) | 1) >>> 0
    } else {
      const inc = ((BigInt(sequence) << 1n) | 1n) & 0xffffffffffffffffn
      this.incHi = Number((inc >> 32n) & 0xffffffffn) >>> 0
      this.incLo = Number(inc & 0xffffffffn) >>> 0
    }
    this.nextUint32()
    let seedHi: number
    let seedLo: number
    if (typeof seed === 'number') {
      if (seed >= 0 && seed <= 0xffffffff && Number.isInteger(seed)) {
        seedHi = 0
        seedLo = seed >>> 0
      } else {
        const s = BigInt(seed) & 0xffffffffffffffffn
        seedHi = Number((s >> 32n) & 0xffffffffn) >>> 0
        seedLo = Number(s & 0xffffffffn) >>> 0
      }
    } else {
      const s = seed & 0xffffffffffffffffn
      seedHi = Number((s >> 32n) & 0xffffffffn) >>> 0
      seedLo = Number(s & 0xffffffffn) >>> 0
    }
    const sumLo = this.stateLo + seedLo
    this.stateLo = sumLo >>> 0
    this.stateHi = (this.stateHi + seedHi + (sumLo >= TWO32 ? 1 : 0)) >>> 0
    this.nextUint32()
  }

  /** 内部快速构造：直接传入已算好的 64 位 seed (hi, lo) 与 32 位 sequence，避免 BigInt 往返。 */
  static fromParts(seedHi: number, seedLo: number, sequence: number): PCG32 {
    const rng = Object.create(PCG32.prototype) as PCG32
    rng.stateHi = 0
    rng.stateLo = 0
    rng.incHi = 0
    rng.incLo = ((sequence << 1) | 1) >>> 0
    rng.nextUint32()
    const sumLo = rng.stateLo + (seedLo >>> 0)
    rng.stateLo = sumLo >>> 0
    rng.stateHi = (rng.stateHi + (seedHi >>> 0) + (sumLo >= TWO32 ? 1 : 0)) >>> 0
    rng.nextUint32()
    return rng
  }

  static fromState(state: string, inc: string): PCG32 {
    const rng = Object.create(PCG32.prototype) as PCG32
    const s = BigInt(state) & 0xffffffffffffffffn
    const i = BigInt(inc) & 0xffffffffffffffffn
    rng.stateHi = Number((s >> 32n) & 0xffffffffn) >>> 0
    rng.stateLo = Number(s & 0xffffffffn) >>> 0
    rng.incHi = Number((i >> 32n) & 0xffffffffn) >>> 0
    rng.incLo = Number(i & 0xffffffffn) >>> 0
    return rng
  }

  toJSON(): { state: string; inc: string } {
    const state = (BigInt(this.stateHi) << 32n) | BigInt(this.stateLo)
    const inc = (BigInt(this.incHi) << 32n) | BigInt(this.incLo)
    return { state: state.toString(), inc: inc.toString() }
  }

  nextUint32(): number {
    const oldHi = this.stateHi
    const oldLo = this.stateLo
    // 64 位精确乘加：state = (old * 0x5851f42d4c957f2d + inc) mod 2^64
    const a0 = oldLo & 0xffff
    const a1 = oldLo >>> 16
    const p00 = a0 * MUL_LO_LO
    const p01 = a0 * MUL_LO_HI
    const p10 = a1 * MUL_LO_LO
    const p11 = a1 * MUL_LO_HI
    const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff)
    const prodLo = ((mid << 16) | (p00 & 0xffff)) >>> 0
    const prodHi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16) + Math.imul(oldHi, MUL_LO) + Math.imul(oldLo, MUL_HI)) >>> 0
    const sumLo = prodLo + this.incLo
    this.stateLo = sumLo >>> 0
    this.stateHi = (prodHi + this.incHi + (sumLo >= TWO32 ? 1 : 0)) >>> 0
    const xLo = (oldLo ^ ((oldLo >>> 18) | (oldHi << 14))) >>> 0
    const xHi = (oldHi ^ (oldHi >>> 18)) >>> 0
    const xorshifted = ((xLo >>> 27) | (xHi << 5)) >>> 0
    const rot = oldHi >>> 27
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0
  }

  float(): number {
    return this.nextUint32() / 4294967296
  }

  range(min: number, max: number): number {
    return min + this.float() * (max - min)
  }

  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0
    return Math.min(maxExclusive - 1, Math.floor(this.float() * maxExclusive))
  }

  chance(p: number): boolean {
    return this.float() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('PCG32.pick: empty array')
    return items[this.int(items.length)]
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new Error('PCG32.weighted: empty array')
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
    if (total <= 0) return items[0]
    let roll = this.float() * total
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i])
      if (roll < 0) return items[i]
    }
    return items[items.length - 1]
  }
}

export function hashString(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

let lastHashHi = 0
let lastHashLo = 0

function computeHash64(input: string): void {
  let hi = 0x9e3779b9
  let lo = 0x7f4a7c15
  for (let i = 0; i < input.length; i++) {
    lo = (lo ^ input.charCodeAt(i)) >>> 0
    // 乘 0x100000001b3 mod 2^64（高 32 位 0x100 = <<8，低 32 位 0x1b3）
    const p0 = (lo & 0xffff) * 0x1b3
    const p1 = (lo >>> 16) * 0x1b3 + (p0 >>> 16)
    const nLo = ((p1 << 16) | (p0 & 0xffff)) >>> 0
    const nHi = ((p1 >>> 16) + Math.imul(hi, 0x1b3) + ((lo << 8) >>> 0)) >>> 0
    lo = (nLo ^ ((nLo >>> 29) | (nHi << 3))) >>> 0
    hi = (nHi ^ (nHi >>> 29)) >>> 0
  }
  lastHashHi = hi
  lastHashLo = lo
}

export function hash64(input: string): bigint {
  computeHash64(input)
  return (BigInt(lastHashHi) << 32n) | BigInt(lastHashLo)
}

export function derivedRng(seed: number, ...labels: (string | number)[]): PCG32 {
  const combined = labels.length > 0 ? `${seed}|${labels.join('|')}` : String(seed)
  computeHash64(combined)
  return PCG32.fromParts(lastHashHi, lastHashLo, (hashString(combined) % 0x7fffffff) + 1)
}

export function splitSeed(seed: number, label: string): number {
  computeHash64(`${seed}|${label}`)
  return lastHashLo
}
