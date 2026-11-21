import fs from 'node:fs'
import os from 'node:os'
import v8 from 'node:v8'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Writable } from 'node:stream'
import type { AITeam, GameState, MatchRecord, Player } from '../src/game/types.ts'

const gzipAsync = promisify(zlib.gzip)
const brotliAsync = promisify(zlib.brotliCompress)

export type ContentEncoding = 'br' | 'gzip' | null

export type MemorySnapshot = {
  rssMb: number
  heapUsedMb: number
  heapLimitMb: number
  memAvailableMb: number
  underPressure: boolean
}

export type MemoryMonitor = {
  isUnderPressure: () => boolean
  snapshot: () => MemorySnapshot
}

function readLinuxMemAvailableBytes(): number {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8')
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(text)
    if (match) return Number(match[1]) * 1024
  } catch {
    // 非 Linux 或无法读取 /proc/meminfo 时退回 os.freemem()。
  }
  return os.freemem()
}

/** 轻量内存压力采样器（2 秒缓存一次，避免每次请求重复 syscall）。 */
export function createMemoryMonitor(override?: () => boolean): MemoryMonitor {
  const totalMb = os.totalmem() / (1024 * 1024)
  const envLimitMb = Number(process.env.FM_MEM_PRESSURE_MB)
  const rssLimitMb = Number.isFinite(envLimitMb) && envLimitMb > 0
    ? envLimitMb
    : Math.max(384, Math.min(768, Math.round(totalMb * 0.42)))
  const minAvailMb = Math.min(220, Math.round(totalMb * 0.12))
  let cachedAt = 0
  let cached: MemorySnapshot | null = null

  const sample = (): MemorySnapshot => {
    const now = Date.now()
    if (cached && now - cachedAt < 2000 && !override) return cached
    const mem = process.memoryUsage()
    const heapLimit = v8.getHeapStatistics().heap_size_limit || 1
    const rssMb = Math.round(mem.rss / (1024 * 1024))
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024))
    const heapLimitMb = Math.round(heapLimit / (1024 * 1024))
    const memAvailableMb = Math.round(readLinuxMemAvailableBytes() / (1024 * 1024))
    const underPressure = override
      ? override()
      : rssMb >= rssLimitMb || (mem.heapUsed / heapLimit) >= 0.72 || memAvailableMb <= minAvailMb
    cachedAt = now
    cached = { rssMb, heapUsedMb, heapLimitMb, memAvailableMb, underPressure }
    return cached
  }

  return {
    isUnderPressure: () => (override ? override() : sample().underPressure),
    snapshot: sample,
  }
}

/** 按 RFC 7231 解析 Accept-Encoding 权重，优先选择 br，其次 gzip（支持 q=0 禁用）。 */
export function negotiateEncoding(
  header: string | string[] | undefined,
  options: { allowBrotli?: boolean; preferGzip?: boolean } = {},
): ContentEncoding {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '')
  if (!raw.trim()) return null
  const allowBrotli = options.allowBrotli !== false
  const preferGzip = options.preferGzip === true
  let brQ: number | undefined
  let gzipQ: number | undefined
  let starQ: number | undefined
  for (const part of raw.split(',')) {
    const segments = part.trim().toLowerCase().split(/\s*;\s*/)
    const coding = segments[0]
    if (!coding) continue
    let q = 1
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].startsWith('q=')) {
        const parsed = Number(segments[i].slice(2))
        q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0
      }
    }
    if (coding === 'br') brQ = Math.max(brQ ?? 0, q)
    else if (coding === 'gzip' || coding === 'x-gzip') gzipQ = Math.max(gzipQ ?? 0, q)
    else if (coding === '*') starQ = Math.max(starQ ?? 0, q)
  }
  const effBr = allowBrotli ? (brQ !== undefined ? brQ : (starQ ?? 0)) : 0
  const effGzip = gzipQ !== undefined ? gzipQ : (starQ ?? 0)
  if (effBr <= 0 && effGzip <= 0) return null
  if (preferGzip) {
    if (effGzip > 0 && effGzip >= effBr) return 'gzip'
    return effBr > 0 ? 'br' : null
  }
  if (effBr > 0 && effBr >= effGzip) return 'br'
  return effGzip > 0 ? 'gzip' : null
}

const yieldImmediate = () => new Promise<void>((resolve) => setImmediate(resolve))

function waitDrain(stream: Writable): Promise<void> {
  return new Promise<void>((resolve) => {
    if (stream.destroyed || stream.writableEnded) return resolve()
    const onDone = () => {
      stream.off('drain', onDone)
      stream.off('close', onDone)
      stream.off('error', onDone)
      resolve()
    }
    stream.once('drain', onDone)
    stream.once('close', onDone)
    stream.once('error', onDone)
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 增量异步 JSON 序列化：把大对象拆成小块（逐 key / 逐数组元素）写入流，
 * 避免在堆里一次性拼出数 MB 连续字符串并长时间阻塞事件循环；内存压力大时更积极让出事件循环。
 */
export async function streamJsonTo(
  value: unknown,
  dest: Writable,
  options: { isUnderPressure?: () => boolean; isAborted?: () => boolean } = {},
): Promise<void> {
  const isUnderPressure = options.isUnderPressure ?? (() => false)
  const isAborted = options.isAborted ?? (() => dest.destroyed)
  let pending = ''
  let writtenSinceYield = 0

  const flushPending = async (force = false): Promise<void> => {
    if (isAborted()) return
    const pressure = isUnderPressure()
    const flushLimit = pressure ? 16_384 : 32_768
    const yieldLimit = pressure ? 49_152 : 262_144
    if (!force && pending.length < flushLimit) return
    if (pending.length > 0) {
      const chunk = pending
      pending = ''
      writtenSinceYield += chunk.length
      if (!dest.write(chunk)) await waitDrain(dest)
    }
    if (writtenSinceYield >= yieldLimit) {
      writtenSinceYield = 0
      await yieldImmediate()
    }
  }

  const push = async (text: string): Promise<void> => {
    pending += text
    if (pending.length >= 16_384) await flushPending(false)
  }

  const writeNode = async (node: unknown, depth: number): Promise<void> => {
    if (isAborted()) return
    if (node === null || typeof node !== 'object') {
      await push(JSON.stringify(node) ?? 'null')
      return
    }
    if (typeof (node as { toJSON?: unknown }).toJSON === 'function') {
      await writeNode((node as { toJSON: () => unknown }).toJSON(), depth)
      return
    }
    if (Array.isArray(node)) {
      if (depth > 3 || node.length < 6) {
        await push(JSON.stringify(node))
        return
      }
      await push('[')
      for (let i = 0; i < node.length; i++) {
        if (isAborted()) return
        if (i > 0) await push(',')
        const elem = node[i]
        if (elem === undefined || typeof elem === 'function' || typeof elem === 'symbol') {
          await push('null')
        } else if (depth < 3 && (Array.isArray(elem) || isPlainObject(elem))) {
          await writeNode(elem, depth + 1)
        } else {
          await push(JSON.stringify(elem) ?? 'null')
        }
        await flushPending(false)
      }
      await push(']')
      return
    }
    if (isPlainObject(node)) {
      if (depth > 3) {
        await push(JSON.stringify(node))
        return
      }
      await push('{')
      let first = true
      for (const [key, entry] of Object.entries(node)) {
        if (isAborted()) return
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue
        await push(first ? `${JSON.stringify(key)}:` : `,${JSON.stringify(key)}:`)
        first = false
        if (depth < 3 && (Array.isArray(entry) || isPlainObject(entry))) {
          await writeNode(entry, depth + 1)
        } else {
          await push(JSON.stringify(entry) ?? 'null')
        }
        await flushPending(false)
      }
      await push('}')
      return
    }
    await push(JSON.stringify(node) ?? 'null')
  }

  await writeNode(value, 0)
  await flushPending(true)
}

let tmpWriteSeq = 0

/** 同步分块写入 JSON 文件（原子重命名）：避免一次性构造 19MB+ 大字符串，使用独立临时文件避免并发冲突。 */
export function writeJsonChunkedSync(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${++tmpWriteSeq}.tmp`
  const fd = fs.openSync(tmp, 'w')
  let buf = ''
  const flush = (force = false) => {
    if (!buf.length || (!force && buf.length < 65_536)) return
    fs.writeSync(fd, buf, null, 'utf8')
    buf = ''
  }
  const emit = (chunk: string) => {
    buf += chunk
    if (buf.length >= 65_536) flush(true)
  }
  const writeNode = (node: unknown, depth: number) => {
    if (node === null || typeof node !== 'object') {
      emit(JSON.stringify(node) ?? 'null')
      return
    }
    if (Array.isArray(node)) {
      if (depth > 2 || node.length < 6) {
        emit(JSON.stringify(node))
        return
      }
      emit('[')
      for (let i = 0; i < node.length; i++) {
        if (i > 0) emit(',')
        const elem = node[i]
        if (elem === undefined || typeof elem === 'function' || typeof elem === 'symbol') emit('null')
        else if (depth < 2 && (Array.isArray(elem) || isPlainObject(elem))) writeNode(elem, depth + 1)
        else emit(JSON.stringify(elem) ?? 'null')
      }
      emit(']')
      return
    }
    if (isPlainObject(node)) {
      if (depth > 2) {
        emit(JSON.stringify(node))
        return
      }
      emit('{')
      let first = true
      for (const [k, v] of Object.entries(node)) {
        if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
        emit(first ? `${JSON.stringify(k)}:` : `,${JSON.stringify(k)}:`)
        first = false
        if (depth < 2 && (Array.isArray(v) || isPlainObject(v))) writeNode(v, depth + 1)
        else emit(JSON.stringify(v) ?? 'null')
      }
      emit('}')
      return
    }
    emit(JSON.stringify(node) ?? 'null')
  }
  try {
    writeNode(value, 0)
    flush(true)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

/** 异步分块写入 JSON 文件（原子重命名），在块间让出事件循环，降低事件循环阻塞与堆峰值。 */
export async function writeJsonChunkedAsync(
  file: string,
  value: unknown,
  isUnderPressure: () => boolean = () => false,
  shouldCommit: () => boolean = () => true,
): Promise<void> {
  const tmp = `${file}.${process.pid}.${++tmpWriteSeq}.tmp`
  const stream = fs.createWriteStream(tmp, { encoding: 'utf8', highWaterMark: 65_536 })
  let failed: unknown = null
  stream.on('error', (err) => { failed = err })
  try {
    await streamJsonTo(value, stream, { isUnderPressure, isAborted: () => !!failed || stream.destroyed || !shouldCommit() })
    if (failed) throw failed
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(() => resolve())
    })
    if (shouldCommit()) fs.renameSync(tmp, file)
    else if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  } catch (error) {
    stream.destroy()
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw error
  }
}

/** 发送支持 Brotli / Gzip 与分块流式序列化的 JSON 响应。 */
export async function sendCompressedJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  value: unknown,
  options: {
    stream?: boolean
    isUnderPressure?: () => boolean
    cacheControl?: string
    minCompressBytes?: number
  } = {},
): Promise<void> {
  if (res.destroyed || res.writableEnded) return
  const cacheControl = options.cacheControl ?? 'no-store'
  const encoding = negotiateEncoding(req.headers['accept-encoding'])
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    Vary: 'Accept-Encoding',
  }

  if (options.stream) {
    const headers = encoding ? { ...baseHeaders, 'Content-Encoding': encoding } : baseHeaders
    res.writeHead(status, headers)
    if (req.method === 'HEAD') { res.end(); return }
    let out: Writable = res
    let compressor: (zlib.BrotliCompress | zlib.Gzip) | null = null
    if (encoding === 'br') {
      compressor = zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_LGWIN]: 18,
        },
      })
      compressor.on('error', () => { if (!res.destroyed) res.destroy() })
      compressor.pipe(res)
      out = compressor
    } else if (encoding === 'gzip') {
      compressor = zlib.createGzip({ level: 4, memLevel: 6 })
      compressor.on('error', () => { if (!res.destroyed) res.destroy() })
      compressor.pipe(res)
      out = compressor
    }
    const onClose = () => { if (compressor && !compressor.destroyed) compressor.destroy() }
    res.once('close', onClose)
    try {
      await streamJsonTo(value, out, {
        isUnderPressure: options.isUnderPressure,
        isAborted: () => res.destroyed || out.destroyed,
      })
      if (!res.destroyed && !out.destroyed) {
        await new Promise<void>((resolve) => {
          res.once('finish', resolve)
          res.once('close', resolve)
          out.end()
        })
      }
    } finally {
      res.off('close', onClose)
    }
    return
  }

  const raw = JSON.stringify(value)
  const minBytes = options.minCompressBytes ?? 1024
  if (!encoding || Buffer.byteLength(raw) < minBytes) {
    res.writeHead(status, baseHeaders)
    res.end(req.method === 'HEAD' ? undefined : raw)
    return
  }
  const compressed = encoding === 'br'
    ? await brotliAsync(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_LGWIN]: 18,
        },
      })
    : await gzipAsync(raw, { level: 4, memLevel: 6 })
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { ...baseHeaders, 'Content-Encoding': encoding })
  res.end(req.method === 'HEAD' ? undefined : compressed)
}

export type SseSink = {
  encoding: ContentEncoding
  writeRaw: (text: string) => void
  flush: () => void
  writeEventAsync: (eventId: number | undefined, payload: unknown, isUnderPressure: () => boolean) => Promise<void>
  end: () => void
  isClosed: () => boolean
}

/** 创建支持流式 Gzip/Brotli 压缩（每条事件立即 flush）的 SSE 写入器。 */
export function createSseSink(req: IncomingMessage, res: ServerResponse): SseSink {
  // 长连接优先选低内存 gzip（~24KB/连接）；若客户端仅支持 br 则使用小窗口 br。
  const encoding = negotiateEncoding(req.headers['accept-encoding'], { preferGzip: true })
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    Vary: 'Accept-Encoding',
  }
  if (encoding) headers['Content-Encoding'] = encoding
  res.writeHead(200, headers)

  let compressor: (zlib.Gzip | zlib.BrotliCompress) | null = null
  let out: Writable = res
  if (encoding === 'gzip') {
    compressor = zlib.createGzip({ level: 1, memLevel: 4, windowBits: 13 })
    compressor.on('error', () => { if (!res.destroyed) res.destroy() })
    compressor.pipe(res)
    out = compressor
  } else if (encoding === 'br') {
    compressor = zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 1,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 16,
      },
    })
    compressor.on('error', () => { if (!res.destroyed) res.destroy() })
    compressor.pipe(res)
    out = compressor
  }

  const isClosed = () => res.destroyed || res.writableEnded || (compressor?.destroyed ?? false)

  const flush = () => {
    if (isClosed() || !compressor) return
    if (encoding === 'gzip') (compressor as zlib.Gzip).flush(zlib.constants.Z_SYNC_FLUSH)
    else if (encoding === 'br') (compressor as zlib.BrotliCompress).flush(zlib.constants.BROTLI_OPERATION_FLUSH)
  }

  const writeRaw = (text: string) => {
    if (isClosed()) return
    out.write(text)
    flush()
  }

  const writeEventAsync = async (eventId: number | undefined, payload: unknown, isUnderPressure: () => boolean) => {
    if (isClosed()) return
    const prefix = eventId !== undefined ? `id: ${eventId}\ndata: ` : 'data: '
    if (!out.write(prefix)) await waitDrain(out)
    if (isClosed()) return
    await streamJsonTo(payload, out, { isUnderPressure, isAborted: isClosed })
    if (isClosed()) return
    if (!out.write('\n\n')) await waitDrain(out)
    flush()
  }

  const end = () => {
    if (compressor && !compressor.destroyed) {
      try { compressor.end() } catch { compressor.destroy() }
    } else if (!res.destroyed && !res.writableEnded) {
      res.end()
    }
  }

  res.once('close', () => {
    if (compressor && !compressor.destroyed) compressor.destroy()
  })

  return { encoding, writeRaw, flush, writeEventAsync, end, isClosed }
}

function shallowRecordEqual(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (let i = 0; i < ka.length; i++) {
    const key = ka[i]
    if (a[key] !== b[key]) return false
  }
  return true
}

/** 零分配递归结构相等比较，用于替代热路径里的 JSON.stringify(a) === JSON.stringify(b)。 */
export function deepEqual(a: unknown, b: unknown, ignoreKeys?: ReadonlySet<string>): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  const arrA = Array.isArray(a)
  const arrB = Array.isArray(b)
  if (arrA !== arrB) return false
  if (arrA) {
    const listA = a as unknown[]
    const listB = b as unknown[]
    if (listA.length !== listB.length) return false
    for (let i = 0; i < listA.length; i++) {
      if (!deepEqual(listA[i], listB[i], ignoreKeys)) return false
    }
    return true
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  let countA = 0
  for (const key in objA) {
    if (!Object.prototype.hasOwnProperty.call(objA, key)) continue
    if (ignoreKeys?.has(key) || objA[key] === undefined) continue
    countA++
    if (!deepEqual(objA[key], objB[key], ignoreKeys)) return false
  }
  let countB = 0
  for (const key in objB) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) continue
    if (ignoreKeys?.has(key) || objB[key] === undefined) continue
    countB++
  }
  return countA === countB
}

const AI_TEAM_STRIP_KEYS = new Set(['condition', 'energy'])
const PUBLIC_PLAYER_IGNORE_KEYS = new Set(['condition', 'energy', 'recoveryAt', 'energyAt'])

/** 比较两份球队阵容是否一致，区分“含体能的完全一致”与“公开可见字段一致”。 */
export function compareTeamPlayers(a: readonly Player[], b: readonly Player[]): { anyChanged: boolean; publicChanged: boolean } {
  if (a === b) return { anyChanged: false, publicChanged: false }
  if (a.length !== b.length) return { anyChanged: true, publicChanged: true }
  let anyChanged = false
  let publicChanged = false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    if (!publicChanged && !deepEqual(a[i], b[i], PUBLIC_PLAYER_IGNORE_KEYS)) {
      publicChanged = true
      anyChanged = true
      return { anyChanged, publicChanged }
    }
    if (!anyChanged && !deepEqual(a[i], b[i])) anyChanged = true
  }
  return { anyChanged, publicChanged }
}

/** 投影对手球队：不修改原对象；slim 模式顺带省略前端不需要的冗余底表字段。 */
export function projectAiTeam(team: AITeam, slim: boolean): AITeam {
  const players = team.players.map((player) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(player)) {
      if (AI_TEAM_STRIP_KEYS.has(key)) continue
      if (slim && (key === 'recoveryAt' || key === 'energyAt' || key === 'ceilings' || key === 'pa' || key === 'positionProfile' || key === 'contract' || key === 'history')) continue
      out[key] = value
    }
    if (slim) {
      if (shallowRecordEqual(out.baseAttrs as Record<string, unknown> | undefined, out.attrs as Record<string, unknown> | undefined)) delete out.baseAttrs
      if (shallowRecordEqual(out.basePositions as Record<string, unknown> | undefined, out.positions as Record<string, unknown> | undefined)) delete out.basePositions
      if (shallowRecordEqual(out.basePersonality as Record<string, unknown> | undefined, out.personality as Record<string, unknown> | undefined)) delete out.basePersonality
      if (shallowRecordEqual(out.baseDetailedPositions as Record<string, unknown> | undefined, out.detailedPositions as Record<string, unknown> | undefined)) delete out.baseDetailedPositions
    }
    return out as unknown as Player
  })
  return { ...team, players }
}

const slimRecordCache = new WeakMap<MatchRecord, { sig: string; value: MatchRecord }>()

/** 精简战报摘要：保留列表/近况/球员统计/奖杯所需的全部字段，复盘明细按需拉取。 */
export function slimMatchRecord(record: MatchRecord): MatchRecord {
  if (record.detailDeferred) return record
  const sig = `${record.homeName}|${record.awayName}|${record.bookDrops?.length ?? -1}|${record.hasReplay ? 1 : 0}`
  const cached = slimRecordCache.get(record)
  if (cached && cached.sig === sig) return cached.value
  const {
    commentary: _commentary,
    keyEvents: _keyEvents,
    skillStats: _skillStats,
    failureStats: _failureStats,
    goalDetails: _goalDetails,
    instructions: _instructions,
    lineup: _lineup,
    decisionStats: _decisionStats,
    ...rest
  } = record
  const slim: MatchRecord = {
    ...rest,
    keyEvents: [],
    skillStats: [],
    failureStats: [],
    goalDetails: [],
    instructions: [],
    lineup: { formationId: record.lineup?.formationId ?? '433', starters: [], bench: [], tactics: record.lineup?.tactics ?? { mentality: 'balanced', pressing: 'medium', tempo: 'normal', width: 'normal', passStyle: 'mixed', lineHeight: 'normal' } },
    detailDeferred: true,
  }
  slimRecordCache.set(record, { sig, value: slim })
  return slim
}

/** 零分配双 32-bit FNV-1a 结构指纹，用于增量 SSE diff 而无需 JSON.stringify。 */
export function fingerprintValue(value: unknown): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ 0x9e3779b9
  const mixInt = (n: number) => {
    const v = n | 0
    h1 = Math.imul(h1 ^ (v & 0xff), 0x01000193)
    h1 = Math.imul(h1 ^ ((v >>> 8) & 0xff), 0x01000193)
    h1 = Math.imul(h1 ^ ((v >>> 16) & 0xff), 0x01000193)
    h1 = Math.imul(h1 ^ ((v >>> 24) & 0xff), 0x01000193)
    h2 = Math.imul(h2 ^ (v & 0xffff), 0x01000193)
    h2 = Math.imul(h2 ^ (v >>> 16), 0x01000193)
  }
  const mixStr = (s: string) => {
    mixInt(s.length)
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i)
      h1 = Math.imul(h1 ^ code, 0x01000193)
      h2 = Math.imul(h2 ^ (code + i), 0x01000193)
    }
  }
  const walk = (node: unknown) => {
    if (node === null) { mixInt(1); return }
    if (node === undefined) { mixInt(2); return }
    const t = typeof node
    if (t === 'boolean') { mixInt(node ? 3 : 4); return }
    if (t === 'number') {
      const num = node as number
      mixInt(5)
      if (Number.isInteger(num) && num >= -2147483648 && num <= 2147483647) {
        mixInt(num)
      } else {
        mixStr(String(num))
      }
      return
    }
    if (t === 'string') { mixInt(6); mixStr(node as string); return }
    if (Array.isArray(node)) {
      mixInt(7)
      mixInt(node.length)
      for (let i = 0; i < node.length; i++) walk(node[i])
      mixInt(8)
      return
    }
    if (t === 'object') {
      mixInt(9)
      const obj = node as Record<string, unknown>
      const keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        const v = obj[k]
        if (v === undefined) continue
        mixStr(k)
        walk(v)
      }
      mixInt(10)
    }
  }
  walk(value)
  return `${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`
}

export type HistoryMeta = {
  ids: string[]
  sigs: string[]
  sectionHash: string
}

const recordSigCache = new WeakMap<MatchRecord, { key: string; hash: string }>()

function matchRecordSignature(record: MatchRecord): string {
  const key = `${record.id}|${record.score.home}:${record.score.away}|${record.homeName}|${record.awayName}|${record.bookDrops?.length ?? -1}|${record.detailDeferred ? 1 : 0}|${record.hasReplay ? 1 : 0}`
  const cached = recordSigCache.get(record)
  if (cached && cached.key === key) return cached.hash
  const hash = fingerprintValue(key)
  recordSigCache.set(record, { key, hash })
  return hash
}

function historyMeta(records: readonly MatchRecord[] | undefined): HistoryMeta {
  const list = records ?? []
  const ids = new Array<string>(list.length)
  const sigs = new Array<string>(list.length)
  for (let i = 0; i < list.length; i++) {
    ids[i] = list[i].id
    sigs[i] = matchRecordSignature(list[i])
  }
  return { ids, sigs, sectionHash: fingerprintValue(sigs) }
}

export type GameSectionDigest = {
  keyHashes: Map<string, string>
  matchHistory: HistoryMeta
  challengeHistory: HistoryMeta
}

const projectedTeamHashCache = new WeakMap<object, string>()
const worldDigestCache = new WeakMap<object, { token: string; hash: string }>()

function hashAiTeams(teams: readonly AITeam[]): string {
  const perTeam = new Array<string>(teams.length)
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i]
    let hash = projectedTeamHashCache.get(team)
    if (!hash) {
      hash = fingerprintValue(team)
      projectedTeamHashCache.set(team, hash)
    }
    perTeam[i] = hash
  }
  return fingerprintValue(perTeam)
}

/** 计算投影后 GameState 各顶层字段的真实内容指纹（仅 ~1KB 内存，供增量 SSE 差分）。 */
export function digestGameSections(
  game: GameState,
  cacheHints?: { worldRef?: object; worldToken?: string },
): GameSectionDigest {
  const keyHashes = new Map<string, string>()
  const matchHistory = historyMeta(game.matchHistory)
  const challengeHistory = historyMeta(game.challengeHistory)
  for (const [key, value] of Object.entries(game)) {
    if (value === undefined) continue
    if (key === 'matchHistory') {
      keyHashes.set(key, matchHistory.sectionHash)
    } else if (key === 'challengeHistory') {
      keyHashes.set(key, challengeHistory.sectionHash)
    } else if (key === 'aiTeams' && Array.isArray(value)) {
      keyHashes.set(key, hashAiTeams(value as AITeam[]))
    } else if (key === 'world' && cacheHints?.worldRef && cacheHints.worldToken) {
      const cached = worldDigestCache.get(cacheHints.worldRef)
      if (cached && cached.token === cacheHints.worldToken) {
        keyHashes.set(key, cached.hash)
      } else {
        const hash = fingerprintValue(value)
        worldDigestCache.set(cacheHints.worldRef, { token: cacheHints.worldToken, hash })
        keyHashes.set(key, hash)
      }
    } else {
      keyHashes.set(key, fingerprintValue(value))
    }
  }
  return { keyHashes, matchHistory, challengeHistory }
}

export type GameDelta = {
  patch: Record<string, unknown>
  prepend?: { matchHistory?: MatchRecord[]; challengeHistory?: MatchRecord[] }
  remove?: string[]
  changed: boolean
  heavy: boolean
}

function detectPrepend(prev: HistoryMeta, next: HistoryMeta, list: readonly MatchRecord[]): MatchRecord[] | null {
  if (next.ids.length <= prev.ids.length) return null
  const added = next.ids.length - prev.ids.length
  for (let i = 0; i < prev.ids.length; i++) {
    if (next.ids[added + i] !== prev.ids[i] || next.sigs[added + i] !== prev.sigs[i]) return null
  }
  return list.slice(0, added)
}

const HEAVY_KEYS = new Set(['world', 'aiTeams', 'pve', 'reserveStars'])

/** 根据上一次发送的各段指纹构造增量 patch；历史战报仅头部新增时使用 prepend。 */
export function buildGameDelta(prev: GameSectionDigest, nextGame: GameState, next: GameSectionDigest): GameDelta {
  const patch: Record<string, unknown> = {}
  let prepend: GameDelta['prepend']
  const remove: string[] = []
  let heavyCount = 0

  for (const [key, hash] of next.keyHashes) {
    if (prev.keyHashes.get(key) === hash) continue
    if (key === 'matchHistory') {
      const added = detectPrepend(prev.matchHistory, next.matchHistory, nextGame.matchHistory)
      if (added) {
        prepend = { ...(prepend ?? {}), matchHistory: added }
        continue
      }
      heavyCount++
    } else if (key === 'challengeHistory') {
      const added = detectPrepend(prev.challengeHistory, next.challengeHistory, nextGame.challengeHistory)
      if (added) {
        prepend = { ...(prepend ?? {}), challengeHistory: added }
        continue
      }
      heavyCount++
    } else if (HEAVY_KEYS.has(key)) {
      heavyCount++
    }
    patch[key] = (nextGame as Record<string, unknown>)[key]
  }
  for (const key of prev.keyHashes.keys()) {
    if (!next.keyHashes.has(key)) remove.push(key)
  }

  const changed = Object.keys(patch).length > 0 || !!prepend || remove.length > 0
  return {
    patch,
    ...(prepend ? { prepend } : {}),
    ...(remove.length ? { remove } : {}),
    changed,
    heavy: heavyCount >= 2,
  }
}
