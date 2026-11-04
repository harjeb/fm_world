/**
 * PCG32（固定实现版本）。所有逻辑随机都走这里，表现层随机另开流。
 * 同一 seed + 同一调用顺序在版本内可复现。
 */
export class PCG32 {
  private state: bigint
  private inc: bigint

  constructor(seed: number | bigint, sequence = 1) {
    this.state = 0n
    this.inc = ((BigInt(sequence) << 1n) | 1n) & 0xffffffffffffffffn
    this.nextUint32()
    this.state = (this.state + BigInt(seed)) & 0xffffffffffffffffn
    this.nextUint32()
  }

  static fromState(state: string, inc: string): PCG32 {
    const rng = Object.create(PCG32.prototype) as PCG32
    rng.state = BigInt(state)
    rng.inc = BigInt(inc)
    return rng
  }

  toJSON(): { state: string; inc: string } {
    return { state: this.state.toString(), inc: this.inc.toString() }
  }

  nextUint32(): number {
    const old = this.state
    this.state = (old * 6364136223846793005n + this.inc) & 0xffffffffffffffffn
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn)
    const rot = Number((old >> 59n) & 31n)
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

export function hash64(input: string): bigint {
  let h = 0x9e3779b97f4a7c15n
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
    h ^= h >> 29n
  }
  return h & 0xffffffffffffffffn
}

export function derivedRng(seed: number, ...labels: (string | number)[]): PCG32 {
  const combined = labels.length > 0 ? `${seed}|${labels.join('|')}` : String(seed)
  return new PCG32(hash64(combined), (hashString(combined) % 0x7fffffff) + 1)
}

export function splitSeed(seed: number, label: string): number {
  return Number(hash64(`${seed}|${label}`) & 0xffffffffn)
}
