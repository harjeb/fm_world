/**
 * 球员 3D 外观模型库与确定性 ID 绑定系统（无 DOM / Three.js 依赖）。
 *
 * 设计目标：
 * 1. 提供高辨识度的肤色（8 档从冷白到曜石黑）、15 款发型（含爆炸头、垂肩脏辫、莫西干、
 *    武士丸子头、马尾辫、运动发带卷发/长发、刺猬头、利落光头及 6 款经典短发）、10 种发色、
 *    4 种体型（修长/匀称/健硕/重坦）与显著身高比例缩放（163cm ~ 202cm）；
 * 2. 每名球员绑定唯一稳定的 `appearanceId`（如 `ap1:s6-h7-c0-b2-f1-d2-k3`），无论在
 *    赛后 3D 高光剧场、聊天分享战报、点球训练还是任意球实验室，同一名球员永远保持完全一致的外貌。
 */

export type HairStyleId =
  | 'crop'
  | 'side_part'
  | 'quiff'
  | 'buzz'
  | 'layered'
  | 'swept'
  | 'afro'
  | 'dreads'
  | 'mohawk'
  | 'topknot'
  | 'ponytail'
  | 'curls_band'
  | 'mane_band'
  | 'spiky'
  | 'bald'

export type BodyBuildId = 'lean' | 'athletic' | 'muscular' | 'stocky'

export const SKIN_PALETTE = [
  { hex: '#f7dcc8', label: '冷白肤色' },
  { hex: '#eec6a8', label: '白皙肤色' },
  { hex: '#dda981', label: '浅麦肤色' },
  { hex: '#c88d63', label: '古铜肤色' },
  { hex: '#ab7048', label: '深麦肤色' },
  { hex: '#854e2f', label: '可可深肤' },
  { hex: '#5f351e', label: '黑檀深肤' },
  { hex: '#3f2112', label: '曜石深肤' },
] as const

export const HAIR_STYLES: readonly { id: HairStyleId; label: string }[] = [
  { id: 'crop', label: '利落短寸' },
  { id: 'side_part', label: '经典偏分' },
  { id: 'quiff', label: '背梳飞机头' },
  { id: 'buzz', label: '干练圆寸' },
  { id: 'layered', label: '层次碎发' },
  { id: 'swept', label: '复古大背头' },
  { id: 'afro', label: '蓬松爆炸头' },
  { id: 'dreads', label: '垂肩脏辫' },
  { id: 'mohawk', label: '莫西干战斧' },
  { id: 'topknot', label: '武士丸子头' },
  { id: 'ponytail', label: '飘逸马尾辫' },
  { id: 'curls_band', label: '发带蓬松卷发' },
  { id: 'mane_band', label: '发带飘逸长发' },
  { id: 'spiky', label: '锋芒刺猬头' },
  { id: 'bald', label: '利落光头' },
] as const

export const HAIR_PALETTE = [
  { hex: '#161519', label: '乌黑' },
  { hex: '#2d2018', label: '深褐' },
  { hex: '#4e3523', label: '栗棕' },
  { hex: '#785435', label: '暖棕' },
  { hex: '#ba9456', label: '亚麻金' },
  { hex: '#ebda9e', label: '铂金黄' },
  { hex: '#8f3721', label: '赤褐红' },
  { hex: '#cdd5df', label: '银灰' },
  { hex: '#d83b44', label: '绯红染' },
  { hex: '#2884e8', label: '冰蓝染' },
] as const

export const BODY_BUILDS: readonly { id: BodyBuildId; label: string; widthFactor: number }[] = [
  { id: 'lean', label: '灵巧修长', widthFactor: 0.9 },
  { id: 'athletic', label: '标准匀称', widthFactor: 1.0 },
  { id: 'muscular', label: '宽肩健硕', widthFactor: 1.09 },
  { id: 'stocky', label: '敦实重坦', widthFactor: 1.15 },
] as const

export const HEADBAND_PALETTE = [
  '#f5f8fc',
  '#161d26',
  '#f2c138',
  '#e83a48',
  '#2490ff',
  '#cdf33f',
] as const

export const BOOT_PALETTE: readonly { main: string; accent: string; sole: string }[] = [
  { main: '#182028', accent: '#cdf33f', sole: '#10151c' },
  { main: '#eef2f7', accent: '#e83a48', sole: '#1c2430' },
  { main: '#16b4f0', accent: '#0e1d34', sole: '#0b1626' },
  { main: '#ff691a', accent: '#161c24', sole: '#1a1d24' },
  { main: '#b9f22c', accent: '#171f26', sole: '#141a21' },
  { main: '#e2b232', accent: '#1b2128', sole: '#171b22' },
  { main: '#df3374', accent: '#f4f7fb', sole: '#1d1c28' },
  { main: '#c2cbd6', accent: '#256ae0', sole: '#182233' },
] as const

const HEAD_SHAPES: readonly [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [0.95, 1.03, 0.99],
  [1.04, 0.97, 1.01],
  [0.97, 0.99, 1.03],
  [1.02, 1.02, 0.97],
]

export interface AppearanceSeedInput {
  id?: string
  seedId?: string
  name?: string
  enName?: string
  country?: string
  height?: number
  appearanceId?: string
  attrs?: { strength?: number; speed?: number }
}

export interface Resolved3DAppearance {
  appearanceId: string
  skinIdx: number
  skinHex: string
  skinLabel: string
  hairIdx: number
  hairId: HairStyleId
  hairLabel: string
  hairColorIdx: number
  hairColorHex: string
  hairColorLabel: string
  buildIdx: number
  buildId: BodyBuildId
  buildLabel: string
  hasBeard: boolean
  bandColorIdx: number
  bandColorHex: string
  bootIdx: number
  boot: { main: string; accent: string; sole: string }
  headShape: readonly [number, number, number]
  effectiveHeightCm: number
  scaleY: number
  scaleXZ: number
}

const EA_COUNTRIES = new Set([
  '中国', '日本', '韩国', '中华台北', '中国香港', '朝鲜', '泰国', '越南', '印尼', '马来西亚', '新加坡',
])
const LAT_COUNTRIES = new Set([
  '西班牙', '意大利', '葡萄牙', '巴西', '阿根廷', '乌拉圭', '哥伦比亚', '智利', '墨西哥', '秘鲁', '巴拉圭', '厄瓜多尔', '委内瑞拉', '哥斯达黎加', '希腊',
])
const AF_COUNTRIES = new Set([
  '尼日利亚', '塞内加尔', '加纳', '喀麦隆', '科特迪瓦', '马里', '南非', '刚果', '几内亚', '布基纳法索', '赞比亚', '安哥拉', '马达加斯加', '加蓬', '几内亚比绍', '多哥', '贝宁',
])
const MENA_COUNTRIES = new Set([
  '土耳其', '摩洛哥', '印度', '埃及', '阿尔及利亚', '突尼斯', '伊朗', '沙特', '伊拉克', '卡塔尔', '阿联酋', '叙利亚', '约旦', '以色列', '巴基斯坦',
])

/** 经典传奇与代表球星标志性外观预设（按英文名或中文名精确命中）。 */
const STAR_PRESETS: Record<string, { s: number; h: number; c: number; b?: number; f?: number }> = {
  'Ruud Gullit': { s: 5, h: 7, c: 0, b: 2, f: 1 },
  'Edgar Davids': { s: 6, h: 7, c: 0, b: 3, f: 0 },
  'Clarence Seedorf': { s: 6, h: 7, c: 0, b: 2, f: 0 },
  'Patrick Vieira': { s: 7, h: 14, c: 0, b: 2, f: 0 },
  'Thierry Henry': { s: 5, h: 14, c: 0, b: 0, f: 0 },
  'Didier Drogba': { s: 6, h: 10, c: 0, b: 2, f: 1 },
  'Samuel Eto\'o': { s: 6, h: 3, c: 0, b: 0, f: 0 },
  'Ronaldinho': { s: 4, h: 12, c: 0, b: 1, f: 0 },
  'Ronaldo': { s: 3, h: 14, c: 0, b: 2, f: 0 },
  'Roberto Carlos': { s: 4, h: 14, c: 0, b: 3, f: 0 },
  'Pelé': { s: 6, h: 0, c: 0, b: 1, f: 0 },
  'Vinícius Júnior': { s: 6, h: 7, c: 0, b: 0, f: 0 },
  'Marcelo': { s: 4, h: 6, c: 0, b: 1, f: 1 },
  'Carlos Valderrama': { s: 3, h: 6, c: 5, b: 1, f: 1 },
  'Marouane Fellaini': { s: 2, h: 6, c: 0, b: 2, f: 0 },
  'Carles Puyol': { s: 1, h: 12, c: 2, b: 2, f: 0 },
  'Zinedine Zidane': { s: 1, h: 14, c: 0, b: 1, f: 0 },
  'Arjen Robben': { s: 0, h: 14, c: 3, b: 0, f: 0 },
  'Jaap Stam': { s: 0, h: 14, c: 4, b: 2, f: 0 },
  'Fabien Barthez': { s: 0, h: 14, c: 0, b: 1, f: 1 },
  'Roberto Baggio': { s: 1, h: 10, c: 0, b: 0, f: 1 },
  'Paolo Maldini': { s: 1, h: 12, c: 1, b: 1, f: 0 },
  'Alessandro Nesta': { s: 1, h: 12, c: 0, b: 1, f: 0 },
  'Andrea Pirlo': { s: 1, h: 12, c: 1, b: 0, f: 1 },
  'Gabriel Batistuta': { s: 1, h: 12, c: 3, b: 2, f: 1 },
  'Diego Maradona': { s: 3, h: 6, c: 0, b: 3, f: 0 },
  'Lionel Messi': { s: 1, h: 4, c: 1, b: 0, f: 1 },
  'Cristiano Ronaldo': { s: 2, h: 2, c: 0, b: 2, f: 0 },
  'Luka Modrić': { s: 0, h: 12, c: 4, b: 0, f: 0 },
  'Erling Haaland': { s: 0, h: 9, c: 5, b: 2, f: 0 },
  'Zlatan Ibrahimović': { s: 1, h: 9, c: 0, b: 2, f: 1 },
  'Gareth Bale': { s: 0, h: 9, c: 1, b: 1, f: 1 },
  'Virgil van Dijk': { s: 4, h: 9, c: 0, b: 2, f: 1 },
  'David Beckham': { s: 0, h: 8, c: 4, b: 1, f: 1 },
  'Paul Pogba': { s: 6, h: 8, c: 5, b: 2, f: 0 },
  'Arturo Vidal': { s: 3, h: 8, c: 0, b: 3, f: 1 },
  'Mario Balotelli': { s: 6, h: 8, c: 4, b: 2, f: 0 },
  'Kylian Mbappé': { s: 5, h: 3, c: 0, b: 1, f: 0 },
  'Tsubasa Ozora': { s: 1, h: 13, c: 1, b: 1, f: 0 },
  'Kojiro Hyuga': { s: 2, h: 13, c: 0, b: 2, f: 0 },
}

function hash32(text: string): number {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return h >>> 0
}

function nextHash(h: number): number {
  return (Math.imul(h, 1664525) + 1013904223) >>> 0
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** 去掉比赛内临时前缀（如 `home:p012` → `p012`），保证跨主客场同一球员 ID 恒定。 */
export function canonicalActorKey(rawId?: string, name?: string): string {
  const cleaned = (rawId ?? '').trim().replace(/^(?:home|away):/, '')
  if (cleaned && !/^(?:opp|actor|m-|rec-|demo-)/.test(cleaned)) return cleaned
  return `${cleaned}|${(name ?? '').trim()}`
}

const APPEARANCE_CODE_RE = /^ap1:s(\d+)-h(\d+)-c(\d+)-b(\d+)-f([01])-d(\d+)-k(\d+)$/

export function formatAppearanceId(parts: {
  s: number
  h: number
  c: number
  b: number
  f: number
  d: number
  k: number
}): string {
  const s = clampNum(Math.trunc(parts.s), 0, SKIN_PALETTE.length - 1)
  const h = clampNum(Math.trunc(parts.h), 0, HAIR_STYLES.length - 1)
  const c = clampNum(Math.trunc(parts.c), 0, HAIR_PALETTE.length - 1)
  const b = clampNum(Math.trunc(parts.b), 0, BODY_BUILDS.length - 1)
  const f = parts.f ? 1 : 0
  const d = clampNum(Math.trunc(parts.d), 0, HEADBAND_PALETTE.length - 1)
  const k = clampNum(Math.trunc(parts.k), 0, BOOT_PALETTE.length - 1)
  return `ap1:s${s}-h${h}-c${c}-b${b}-f${f}-d${d}-k${k}`
}

/**
 * 为任意球员生成 100% 确定性的 `appearanceId`（不消耗游戏随机数流）。
 * 综合国籍地区（决定合理的肤色/发色分布，同时保留金发挑染、爆炸头、脏辫等高辨识度特征）与力量/身高体型。
 */
export function deriveAppearanceId(input: AppearanceSeedInput): string {
  if (input.appearanceId && APPEARANCE_CODE_RE.test(input.appearanceId)) {
    return input.appearanceId
  }

  const star =
    (input.enName && STAR_PRESETS[input.enName]) ||
    (input.seedId && STAR_PRESETS[input.seedId]) ||
    undefined

  const key = input.seedId?.trim() || canonicalActorKey(input.id, input.name)
  let h = hash32(`${key}|${input.enName ?? ''}`)

  const country = input.country ?? ''
  type Region = 'ea' | 'eu' | 'lat' | 'af' | 'mena'
  let region: Region
  if (AF_COUNTRIES.has(country)) region = 'af'
  else if (EA_COUNTRIES.has(country)) region = 'ea'
  else if (LAT_COUNTRIES.has(country)) region = 'lat'
  else if (MENA_COUNTRIES.has(country)) region = 'mena'
  else if (country && country !== '随机青训') {
    // 欧洲足球强国（英法荷比葡等）也有相当比例非裔/混血球星，按哈希给约 24% 深肤色池，视觉更丰富真实
    region = h % 100 < 24 ? 'af' : 'eu'
  } else {
    // 无国籍信息时（如旧聊天战报里的虚构对手）：均匀覆盖全部 5 大区域，确保同场黑白肤色与发型高度多样！
    const regions: readonly Region[] = ['eu', 'af', 'lat', 'ea', 'mena']
    region = regions[h % regions.length]
  }

  h = nextHash(h)
  const skinPools: Record<Region, readonly number[]> = {
    ea: [0, 1, 1, 2, 2],
    eu: [0, 0, 1, 1, 2],
    lat: [1, 2, 3, 3, 4, 5, 6],
    mena: [2, 3, 3, 4, 4],
    af: [5, 6, 6, 7, 7],
  }
  const sPool = skinPools[region]
  const skinIdx = star?.s ?? sPool[h % sPool.length]

  h = nextHash(h)
  const hairPools: Record<Region, readonly number[]> = {
    ea: [0, 1, 2, 4, 5, 9, 10, 11, 13, 13, 8],
    eu: [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 12, 13, 14],
    lat: [0, 2, 4, 6, 7, 8, 9, 10, 11, 11, 12, 13, 14],
    mena: [0, 1, 2, 3, 4, 6, 8, 11, 12, 14],
    af: [0, 3, 6, 6, 7, 7, 7, 8, 9, 11, 14, 14],
  }
  const hPool = hairPools[region]
  const hairIdx = star?.h ?? hPool[h % hPool.length]

  h = nextHash(h)
  const colorPools: Record<Region, readonly number[]> = {
    ea: [0, 0, 0, 1, 1, 2, 5, 7, 8],
    eu: [0, 1, 2, 2, 3, 4, 4, 5, 6, 7],
    lat: [0, 0, 1, 1, 2, 3, 5, 4],
    mena: [0, 0, 1, 1, 2, 7],
    af: [0, 0, 0, 0, 1, 5, 4, 8],
  }
  const cPool = colorPools[region]
  const hairColorIdx = star?.c ?? cPool[h % cPool.length]

  h = nextHash(h)
  let buildIdx: number
  if (star?.b !== undefined) {
    buildIdx = star.b
  } else if (input.attrs?.strength !== undefined && input.attrs?.speed !== undefined) {
    const str = input.attrs.strength
    const spd = input.attrs.speed
    if (str >= 640 && (input.height ?? 180) < 179) buildIdx = 3 // 敦实重坦
    else if (str >= 620) buildIdx = 2 // 宽肩健硕
    else if (spd >= 640 && str < 540) buildIdx = 0 // 灵巧修长
    else buildIdx = h % 4 === 0 ? 0 : h % 4 === 3 ? 2 : 1
  } else {
    const builds = [0, 1, 1, 2, 2, 3]
    buildIdx = builds[h % builds.length]
  }

  h = nextHash(h)
  const hasBeard = star?.f !== undefined ? star.f : skinIdx >= 3 ? (h % 10 < 5 ? 1 : 0) : (h % 10 < 3 ? 1 : 0)
  h = nextHash(h)
  const bandColorIdx = h % HEADBAND_PALETTE.length
  h = nextHash(h)
  const bootIdx = h % BOOT_PALETTE.length

  return formatAppearanceId({
    s: skinIdx,
    h: hairIdx,
    c: hairColorIdx,
    b: buildIdx,
    f: hasBeard,
    d: bandColorIdx,
    k: bootIdx,
  })
}

export function playerAppearanceId(player: AppearanceSeedInput): string {
  if (player.appearanceId && APPEARANCE_CODE_RE.test(player.appearanceId)) return player.appearanceId
  return deriveAppearanceId(player)
}

/**
 * 解析完整 3D 外观参数（含明显可辨的身高纵向比例与肩腿宽窄体型）。
 */
export function resolve3DAppearance(
  input: AppearanceSeedInput,
  isKeeper = false,
): Resolved3DAppearance {
  const code = playerAppearanceId(input)
  const m = APPEARANCE_CODE_RE.exec(code)
  const keyHash = hash32(canonicalActorKey(input.id, input.name))

  const skinIdx = m ? clampNum(Number(m[1]), 0, SKIN_PALETTE.length - 1) : 2
  const hairIdx = m ? clampNum(Number(m[2]), 0, HAIR_STYLES.length - 1) : 0
  const hairColorIdx = m ? clampNum(Number(m[3]), 0, HAIR_PALETTE.length - 1) : 0
  const buildIdx = m ? clampNum(Number(m[4]), 0, BODY_BUILDS.length - 1) : 1
  const hasBeard = m ? m[5] === '1' : false
  const bandColorIdx = m ? clampNum(Number(m[6]), 0, HEADBAND_PALETTE.length - 1) : 0
  const bootIdx = m ? clampNum(Number(m[7]), 0, BOOT_PALETTE.length - 1) : 0

  // 若历史简版数据缺失身高，按球员哈希稳定映射到 166..198cm（门将偏高 183..200cm），高矮对比鲜明
  const rawH = input.height && input.height >= 150 ? input.height : 0
  const fallbackH = isKeeper ? 184 + (keyHash % 16) : 166 + (keyHash % 33)
  const effectiveHeightCm = clampNum(rawH || fallbackH, 160, 206)

  // 放大视觉可读的身高差：165cm -> 0.87x，180cm -> 1.00x，198cm -> 1.15x（同框高矮立判！）
  const scaleY = Math.round(clampNum(1 + (effectiveHeightCm - 180) * 0.0086, 0.85, 1.18) * 1000) / 1000
  // 门将保持各向同性缩放以确保手套 IK 零误差；外场球员叠加修长/健硕/重坦横向比例
  const scaleXZ = isKeeper
    ? scaleY
    : Math.round(scaleY * BODY_BUILDS[buildIdx].widthFactor * 1000) / 1000

  const skin = SKIN_PALETTE[skinIdx]
  const hair = HAIR_STYLES[hairIdx]
  const hairColor = HAIR_PALETTE[hairColorIdx]
  const build = BODY_BUILDS[buildIdx]

  return {
    appearanceId: code,
    skinIdx,
    skinHex: skin.hex,
    skinLabel: skin.label,
    hairIdx,
    hairId: hair.id,
    hairLabel: hair.label,
    hairColorIdx,
    hairColorHex: hairColor.hex,
    hairColorLabel: hairColor.label,
    buildIdx,
    buildId: build.id,
    buildLabel: build.label,
    hasBeard,
    bandColorIdx,
    bandColorHex: HEADBAND_PALETTE[bandColorIdx],
    bootIdx,
    boot: BOOT_PALETTE[bootIdx],
    headShape: HEAD_SHAPES[keyHash % HEAD_SHAPES.length],
    effectiveHeightCm,
    scaleY,
    scaleXZ,
  }
}

/** 用于球员详情面板展示的可读 3D 形象摘要。 */
export function appearanceSummaryText(player: AppearanceSeedInput): string {
  const res = resolve3DAppearance(player)
  const hairDesc = res.hairId === 'bald' ? res.hairLabel : `${res.hairColorLabel}${res.hairLabel}`
  return `${res.buildLabel} · ${res.skinLabel} · ${hairDesc}`
}
