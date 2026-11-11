/**
 * 战术风格 / 球队指令的实验模型（docs/fm-tactical-styles-and-instructions.md 3.3 / 4.1、
 * docs/team-instructions-system-design.md 4.1）。
 *
 * 首版九项保持不变；`advanced` 是显式启用的实验性接空当 / 无球宽度，不会隐式修改旧模板。
 * 旧五字段 `Tactics` / `PesTactics` 的语义完全不动：只有给了 `instructions` 的球队才走新分支，
 * 新分支把旧滑杆固定在 `0.5` 的中性基底上，再加本文件的偏好项，避免同一战术被叠加两次。
 *
 * 所有数值都是**首轮实验的起点**，不是已验证的平衡值：`npm run tactics:experiment` 用
 * docs/tactical-validation-report.md 的口径测量方向和幅度。
 */

/** 三档方向：-1 / 0 / +1，和文档 4.1 的 `p / f / q` 一致。 */
export type Tri = -1 | 0 | 1

export type TacticalInstructionsV2 = {
  possession: {
    /** 进攻方向：中路 / 均衡 / 边路 */
    focus: 'middle' | 'balanced' | 'wing'
    /** 传球倾向：短传 / 混合 / 直接 */
    passing: 'short' | 'mixed' | 'direct'
    /** 比赛节奏：慢 / 正常 / 快 */
    tempo: 'slow' | 'normal' | 'fast'
    /** 持球宽度：窄 / 正常 / 宽 */
    width: 'narrow' | 'normal' | 'wide'
  }
  transition: {
    /** 得球后：保持队形 / 均衡 / 反击 */
    onGain: 'hold' | 'balanced' | 'counter'
    /** 丢球后：回撤 / 均衡 / 反抢 */
    onLoss: 'regroup' | 'balanced' | 'counterpress'
  }
  defense: {
    /** 后防线：低 / 中 / 高 */
    line: 'low' | 'mid' | 'high'
    /** 逼抢线：从哪里开始允许逼抢 */
    engagement: 'low' | 'mid' | 'high'
    /** 压迫频率：搜索半径与同时上抢人数 */
    intensity: 'low' | 'mid' | 'high'
  }
  /** 实验性高级指令；缺省为中性，旧九项模板不自动迁移。 */
  advanced?: {
    possession?: {
      receiving?: 'feet' | 'mixed' | 'space'
      /** 传中时机：仅开放中性及实验性的尽早传中；晚传尚未实现。 */
      crossTiming?: 'balanced' | 'early'
    }
    defense?: { width?: 'narrow' | 'normal' | 'wide' }
  }
}

/** 中性（B0）：`空白 / 自定义` 的取值。 */
export const NEUTRAL_INSTRUCTIONS: TacticalInstructionsV2 = {
  possession: { focus: 'balanced', passing: 'mixed', tempo: 'normal', width: 'normal' },
  transition: { onGain: 'balanced', onLoss: 'balanced' },
  defense: { line: 'mid', engagement: 'mid', intensity: 'mid' },
}

export type StyleId =
  | 'control' | 'highPress' | 'tikiTaka' | 'verticalTiki' | 'wingPlay' | 'longBall'
  | 'fluidCounter' | 'directCounter' | 'catenaccio' | 'parkBus' | 'blank'

export type StyleDef = {
  id: StyleId
  name: string
  /** 复杂度标签（当前用于展示；尚未直接参与执行计算）。 */
  complexity: number
  /** 强度（跑动与执行要求），用于体能 / 熟练度提示，不直接改物理。 */
  intensity: number
  instructions: TacticalInstructionsV2
}

const style = (
  id: StyleId, name: string, complexity: number, intensity: number,
  possession: TacticalInstructionsV2['possession'],
  transition: TacticalInstructionsV2['transition'],
  defense: TacticalInstructionsV2['defense'],
): StyleDef => ({ id, name, complexity, intensity, instructions: { possession, transition, defense } })

/**
 * 文档 3.5 的风格模板初稿（三级近似值）。
 * 未列出的项用中性值；高级指令不在这里，也不能暗中折算成九项里的其他功能。
 */
export const STYLE_LIST: readonly StyleDef[] = [
  style('blank', '空白 / 自定义', 1, 1,
    { focus: 'balanced', passing: 'mixed', tempo: 'normal', width: 'normal' },
    { onGain: 'balanced', onLoss: 'balanced' },
    { line: 'mid', engagement: 'mid', intensity: 'mid' }),
  style('control', '控制球权', 1.0, 1.0,
    { focus: 'balanced', passing: 'short', tempo: 'slow', width: 'normal' },
    { onGain: 'balanced', onLoss: 'counterpress' },
    { line: 'high', engagement: 'high', intensity: 'high' }),
  style('highPress', '高位压迫', 1.3, 1.5,
    { focus: 'balanced', passing: 'mixed', tempo: 'fast', width: 'narrow' },
    { onGain: 'counter', onLoss: 'counterpress' },
    { line: 'high', engagement: 'high', intensity: 'high' }),
  style('tikiTaka', '密集短传', 1.3, 1.2,
    { focus: 'balanced', passing: 'short', tempo: 'slow', width: 'normal' },
    { onGain: 'hold', onLoss: 'counterpress' },
    { line: 'high', engagement: 'high', intensity: 'high' }),
  style('verticalTiki', '垂直密集短传', 1.3, 1.2,
    { focus: 'middle', passing: 'short', tempo: 'slow', width: 'narrow' },
    { onGain: 'counter', onLoss: 'counterpress' },
    { line: 'high', engagement: 'high', intensity: 'high' }),
  style('wingPlay', '双翼齐飞', 0.7, 1.2,
    { focus: 'wing', passing: 'direct', tempo: 'fast', width: 'wide' },
    { onGain: 'counter', onLoss: 'balanced' },
    { line: 'mid', engagement: 'mid', intensity: 'high' }),
  style('longBall', '长传冲吊', 0.7, 1.2,
    { focus: 'balanced', passing: 'direct', tempo: 'fast', width: 'normal' },
    { onGain: 'counter', onLoss: 'regroup' },
    { line: 'low', engagement: 'mid', intensity: 'mid' }),
  style('fluidCounter', '灵活防反', 1.0, 1.2,
    { focus: 'balanced', passing: 'short', tempo: 'fast', width: 'normal' },
    { onGain: 'counter', onLoss: 'counterpress' },
    { line: 'low', engagement: 'mid', intensity: 'high' }),
  style('directCounter', '快速防反', 0.7, 1.2,
    { focus: 'balanced', passing: 'direct', tempo: 'fast', width: 'normal' },
    { onGain: 'counter', onLoss: 'balanced' },
    { line: 'low', engagement: 'low', intensity: 'high' }),
  style('catenaccio', '链式防守', 1.0, 0.8,
    { focus: 'balanced', passing: 'direct', tempo: 'slow', width: 'narrow' },
    { onGain: 'counter', onLoss: 'regroup' },
    { line: 'low', engagement: 'low', intensity: 'low' }),
  style('parkBus', '摆大巴', 1.0, 0.6,
    { focus: 'balanced', passing: 'direct', tempo: 'slow', width: 'narrow' },
    { onGain: 'balanced', onLoss: 'regroup' },
    { line: 'low', engagement: 'low', intensity: 'low' }),
]

export const STYLES: Record<StyleId, StyleDef> = Object.fromEntries(
  STYLE_LIST.map((item) => [item.id, item]),
) as Record<StyleId, StyleDef>

export const styleById = (id: StyleId): StyleDef => STYLES[id]

/** 修订版模板须显式应用；旧模板和已保存的指令不被改写。 */
export const STYLE_LIST_REV2: readonly StyleDef[] = STYLE_LIST.map((original) => {
  const instructions = structuredClone(original.instructions)
  if (original.id === 'verticalTiki' || original.id === 'fluidCounter' || original.id === 'directCounter') {
    instructions.advanced = { possession: { receiving: 'space' } }
  }
  if (original.id === 'fluidCounter' || original.id === 'directCounter' || original.id === 'catenaccio' || original.id === 'parkBus') {
    instructions.advanced = { ...instructions.advanced, defense: { width: 'narrow' } }
  }
  if (original.id === 'parkBus') {
    instructions.possession.passing = 'mixed'
    instructions.transition.onGain = 'hold'
  }
  return { ...original, instructions }
})
export const STYLES_REV2 = Object.fromEntries(STYLE_LIST_REV2.map((item) => [item.id, item])) as Record<StyleId, StyleDef>

/** 正式产品版风格模板（rev 3）：补齐双翼 / 长传的传中时机与控球系的接脚下，旧 rev 1/2 保持只读兼容。 */
export const ACTIVE_STYLE_REVISION = 3 as const
export const STYLE_LIST_REV3: readonly StyleDef[] = STYLE_LIST_REV2.map((rev2) => {
  const instructions = structuredClone(rev2.instructions)
  if (rev2.id === 'control' || rev2.id === 'tikiTaka') {
    instructions.advanced = { ...instructions.advanced, possession: { ...instructions.advanced?.possession, receiving: 'feet' } }
  }
  if (rev2.id === 'wingPlay') {
    instructions.possession.passing = 'mixed'
    instructions.advanced = { ...instructions.advanced, possession: { ...instructions.advanced?.possession, crossTiming: 'early' } }
  }
  if (rev2.id === 'longBall') {
    instructions.advanced = { ...instructions.advanced, possession: { receiving: 'space', crossTiming: 'early' } }
  }
  return { ...rev2, instructions }
})
export const STYLES_REV3 = Object.fromEntries(STYLE_LIST_REV3.map((item) => [item.id, item])) as Record<StyleId, StyleDef>
export const styleByRevision = (id: StyleId, revision: 1 | 2 | 3 = ACTIVE_STYLE_REVISION): StyleDef =>
  revision === 1 ? STYLES[id] : revision === 2 ? STYLES_REV2[id] : STYLES_REV3[id]

export const STYLE_IDS: readonly StyleId[] = STYLE_LIST_REV3.map((item) => item.id)
export const isStyleId = (value: unknown): value is StyleId => typeof value === 'string' && STYLE_IDS.includes(value as StyleId)

export type StyleMeta = {
  tagline: string
  pros: string
  cons: string
}

export const STYLE_META: Record<StyleId, StyleMeta> = {
  blank: {
    tagline: '各项保持中立均衡，适合完全按阵容特点手动定制每一条指令。',
    pros: '无极端站位暴露，攻守转换平稳，容错率高。',
    cons: '缺少鲜明的局部压制或反击锐度。',
  },
  control: {
    tagline: '耐心短传控球、就地反抢与高位防线结合，把比赛纳入我方节奏。',
    pros: '控球率与前场压制力强，减少无谓丢球。',
    cons: '防线靠前惧怕速度型身后反击，传接技术差时后场易被断。',
  },
  highPress: {
    tagline: '双人积极围抢 + 高逼抢线 + 得球快节奏直插，在前场窒息对手出球。',
    pros: '前场夺回球权与就地制造射门能力极强。',
    cons: '体能消耗最大，下半场末段易脱节并暴露大片身后空当。',
  },
  tikiTaka: {
    tagline: '极致的近距离脚下配合与高位反抢，通过连续短传撕开防线。',
    pros: '短传衔接最绵密，能有效消解对手球权。',
    cons: '极度依赖传控属性与战术熟练度，面对密集铁桶阵可能得势不得分。',
  },
  verticalTiki: {
    tagline: '收缩中路短传渗透，同时积极寻找防线身后空当完成纵向刺穿。',
    pros: '兼顾中路人数优势与突然的直塞威胁。',
    cons: '两翼宽度较窄，容易被对手收缩中路针对性封堵。',
  },
  wingPlay: {
    tagline: '拉开球场宽度将球输送两翼，利用边路突破与尽早传中冲击禁区。',
    pros: '能绕开拥挤中路，对收缩窄防线的低位球队尤为奏效。',
    cons: '需要禁区内有争顶与抢点终结者，中路保护相对分散。',
  },
  longBall: {
    tagline: '直接长传找前锋身后或第一落点，配合尽早传中减少后场停留。',
    pros: '迅速越过对手高位逼抢，后场失误风险低。',
    cons: '传球成功率较低、球权易旁落，依赖前场对抗与争顶能力。',
  },
  fluidCounter: {
    tagline: '低位收缩防线诱敌深入，断球后通过中短传配合快速投入反击。',
    pros: '稳固后防空间的同时打出高质量推进反击。',
    cons: '主动压迫较少，落后时较难在敌方半场持续抢回球权。',
  },
  directCounter: {
    tagline: '窄防线严守禁区前沿，一旦得球立即直传身后空当高速突袭。',
    pros: '克制高位防线与大举压上的对手，反击单次威胁极高。',
    cons: '控球率低，若对手同样回收低位则缺少身后冲刺空间。',
  },
  catenaccio: {
    tagline: '失球立即回撤结成窄低位防线，优先封死中路渗透与身后球。',
    pros: '禁区正面与身后保护极佳，极难被打穿单刀。',
    cons: '让出大量外围与两翼空间，容易承受对手持续边路传中。',
  },
  parkBus: {
    tagline: '全员深度退守本方半场并放慢比赛节奏，以守住比分为最高目标。',
    pros: '体能消耗最低、后场密度最高，适合领先守胜或以弱抗强。',
    cons: '进攻投入极少，很难主动创造破门良机。',
  },
}

/** 文档 4.1 的首选参数；实验脚本可以覆盖，验收报告记录实际使用的值。 */
export type TacticsParams = {
  /** 短传 / 直接：`S = wPass × p × (clamp(d / (40K), 0, 1) − 0.5)` */
  wPass: number
  /** 中路 / 边路：`S = wFocus × f × (z − 0.5)` */
  wFocus: number
  /** 持球宽度缩放：`1 + wWidth × {−1,0,+1}` */
  wWidth: number
  /** 得球转换：`S = wTransition × q × clamp(forward / (20K), −1, 1)` */
  wTransition: number
  /** 传球 / 方向 / 转换三项合计裁剪 */
  clipPreference: number
  /** 转换窗口（模拟秒，D = 900 标定；其他时长按 D/900 缩放） */
  transitionWindow: number
  /** 逼抢线：允许开始常规逼抢的 `u` 上限 */
  engagement: Record<'low' | 'mid' | 'high', number>
  /** 压迫频率：合格上抢者的搜索半径（米） */
  pressRadius: Record<'low' | 'mid' | 'high', number>
  /** 压迫频率：同时上抢人数上限 */
  pressCount: Record<'low' | 'mid' | 'high', number>
  /** 得球窗口内的前插尝试概率 */
  runnerProb: Record<'hold' | 'balanced' | 'counter', number>
  /** 旧 `PesTactics.line` 的取值。首轮 0.2/0.5/0.8 的防线几乎不移动，实验后拉大到 0.1/0.5/0.9。 */
  lineValue: Record<'low' | 'mid' | 'high', number>
  /** 新指令的防线纵深（米 / 单位 line）：低防线相对中性后撤多少米 */
  lineDepth: number
  /** 旧 `PesTactics.tempo` 的取值（沿用 tacticsOf） */
  tempoValue: Record<'slow' | 'normal' | 'fast', number>
  /** 反抢窗口：搜索半径加成（米）与上限 */
  counterpressBonus: number
  counterpressMax: number
  /** 紧急上抢：距持球人不超过该距离的合格球员可以额外上抢一人 */
  emergencyRadius: number
  /** 上抢球员留人：至少多少名外场球员不承担上抢任务 */
  keepBack: number
  /** 实验：对已有前插的速度提前量缩放（1 = 旧值）；仅接空当指令生效。 */
  spaceLeadScale?: number
  /** 实验：无球宽度相对中性的缩放幅度。 */
  defenseCompactness?: number
  /** 实验：窄 / 宽目标相对被盯球员最多额外拉开的距离（K）。 */
  defenseMarkBuffer?: number
  /** 熟练度：满熟练时的执行强度下限（`eff = minExecution + (1 − minExecution) × fam`） */
  familiarityFloor: number
  /** 熟练度：零熟练、复杂度 1 时的「执行反了」概率 */
  familiaritySlip: number
}

export const DEFAULT_PARAMS: TacticsParams = {
  // 校准（docs/tactical-validation-report.md）：短传/直接的目标幅度由 8 → 10 补足，
  // 方向从 8 → 6 压回 +6..+18pp 的上界，宽度从 15 → 18 补足 +3..+8 米的下界。
  wPass: 0.10,
  wFocus: 0.06,
  wWidth: 0.18,
  wTransition: 0.06,
  clipPreference: 0.10,
  transitionWindow: 1.5,
  // 重新锚定（docs/tactical-validation-report.md 5.1）：文档的 0.35/0.60/0.90 与 9/12/15
  // 让「中性」B0 比当前 v4 的逼抢弱 −0.62 xGD，于是每种风格都被高估约半个净胜球。
  // 校准后 mid 复现 v4 的逼抢覆盖，low 才是真的收缩，high 再叠加第二上抢者。
  engagement: { low: 0.60, mid: 0.90, high: 1.0 },
  pressRadius: { low: 12, mid: 15, high: 18 },
  pressCount: { low: 1, mid: 1, high: 2 },
  runnerProb: { hold: 0.08, balanced: 0.12, counter: 0.16 },
  lineValue: { low: 0.10, mid: 0.50, high: 0.90 },
  lineDepth: 8,
  tempoValue: { slow: 0.25, normal: 0.50, fast: 0.80 },
  counterpressBonus: 3,
  counterpressMax: 18,
  emergencyRadius: 3,
  keepBack: 2,
  familiarityFloor: 0.35,
  familiaritySlip: 0.35,
  // 空当提前量未证实改善，保留原值；无球宽度采用单项实验中的候选值，仍需正式验收。
  spaceLeadScale: 1,
  defenseCompactness: 0.25,
  defenseMarkBuffer: 3,
}

/** 单项指令的相对难度（1 = 平均）：用于熟练度惩罚，越高越吃熟练度。 */
export const INSTRUCTION_DIFFICULTY = {
  passing: 0.8,
  focus: 0.9,
  tempo: 0.9,
  width: 1.0,
  receiving: 1.1,
  crossTiming: 1.0,
  defenseWidth: 1.0,
  onGain: 1.2,
  onLoss: 1.3,
  line: 1.0,
  engagement: 1.2,
  intensity: 1.3,
} as const
export type InstructionKey = keyof typeof INSTRUCTION_DIFFICULTY

/** 三档枚举 → -1 / 0 / +1。 */
const TRI_NEGATIVE = new Set(['middle', 'narrow', 'slow', 'short', 'hold', 'regroup', 'low', 'feet'])
const TRI_POSITIVE = new Set(['wing', 'wide', 'fast', 'direct', 'counter', 'counterpress', 'high', 'space', 'early'])
export const triOf = (value: string): Tri => (TRI_NEGATIVE.has(value) ? -1 : TRI_POSITIVE.has(value) ? 1 : 0)

/**
 * 连续执行强度（docs/tactical-design-revision.md 5.2）：
 * - `fam` 0 = 完全不熟，1 = 完全熟练。
 * - `q_i = floor + (1 - floor) × clamp(fam, 0, 1) ^ difficulty`；默认 `difficulty = 1` 与旧公式逐位相等。
 */
export function execution(fam: number, params: TacticsParams = DEFAULT_PARAMS, difficulty = 1): number {
  const f = Math.max(0, Math.min(1, fam))
  const d = Number.isFinite(difficulty) && difficulty > 0 ? difficulty : 1
  return params.familiarityFloor + (1 - params.familiarityFloor) * Math.pow(f, d)
}

export function slipChance(fam: number, difficulty: number, params: TacticsParams = DEFAULT_PARAMS): number {
  const f = Math.max(0, Math.min(1, fam))
  return params.familiaritySlip * (1 - f) * difficulty
}

/** 校验：只认识完整枚举，`undefined` 不能代表隐藏默认值。 */
export function validateInstructions(value: unknown): TacticalInstructionsV2 {
  const fail = (path: string, allowed: string[]): never => {
    throw new Error(`无效战术指令 ${path}（允许：${allowed.join(' / ')}）`)
  }
  const pick = <T extends string>(raw: unknown, path: string, allowed: readonly T[]): T => {
    if (typeof raw !== 'string' || !allowed.includes(raw as T)) return fail(path, [...allowed])
    return raw as T
  }
  if (!value || typeof value !== 'object') throw new Error('战术指令必须是对象')
  const v = value as Record<string, Record<string, unknown>>
  const group = (name: string, keys: string[]): Record<string, unknown> => {
    const g = v[name]
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error(`战术指令缺少 ${name}`)
    for (const key of Object.keys(g)) if (!keys.includes(key)) throw new Error(`未知战术指令 ${name}.${key}`)
    return g
  }
  const possession = group('possession', ['focus', 'passing', 'tempo', 'width'])
  const transition = group('transition', ['onGain', 'onLoss'])
  const defense = group('defense', ['line', 'engagement', 'intensity'])
  for (const key of Object.keys(v)) if (!['possession', 'transition', 'defense', 'advanced'].includes(key)) throw new Error(`未知战术指令分组 ${key}`)
  let advanced: TacticalInstructionsV2['advanced']
  if ('advanced' in v && v.advanced !== undefined) {
    const raw = v.advanced
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('无效战术指令 advanced')
    for (const key of Object.keys(raw)) if (!['possession', 'defense'].includes(key)) throw new Error(`未知战术指令 advanced.${key}`)
    advanced = {}
    if ('possession' in raw && raw.possession !== undefined) {
      const part = raw.possession as Record<string, unknown>
      if (!part || typeof part !== 'object' || Array.isArray(part)) throw new Error('无效战术指令 advanced.possession')
      for (const key of Object.keys(part)) if (key !== 'receiving' && key !== 'crossTiming') throw new Error(`未知战术指令 advanced.possession.${key}`)
      advanced.possession = {}
      if ('receiving' in part && part.receiving !== undefined) {
        advanced.possession.receiving = pick(part.receiving, 'advanced.possession.receiving', ['feet', 'mixed', 'space'] as const)
      }
      if ('crossTiming' in part && part.crossTiming !== undefined) {
        advanced.possession.crossTiming = pick(part.crossTiming, 'advanced.possession.crossTiming', ['balanced', 'early'] as const)
      }
    }
    if ('defense' in raw && raw.defense !== undefined) {
      const part = raw.defense as Record<string, unknown>
      if (!part || typeof part !== 'object' || Array.isArray(part)) throw new Error('无效战术指令 advanced.defense')
      for (const key of Object.keys(part)) if (key !== 'width') throw new Error(`未知战术指令 advanced.defense.${key}`)
      advanced.defense = {}
      if ('width' in part && part.width !== undefined) {
        advanced.defense.width = pick(part.width, 'advanced.defense.width', ['narrow', 'normal', 'wide'] as const)
      }
    }
  }
  return {
    possession: {
      focus: pick(possession.focus, 'possession.focus', ['middle', 'balanced', 'wing'] as const),
      passing: pick(possession.passing, 'possession.passing', ['short', 'mixed', 'direct'] as const),
      tempo: pick(possession.tempo, 'possession.tempo', ['slow', 'normal', 'fast'] as const),
      width: pick(possession.width, 'possession.width', ['narrow', 'normal', 'wide'] as const),
    },
    transition: {
      onGain: pick(transition.onGain, 'transition.onGain', ['hold', 'balanced', 'counter'] as const),
      onLoss: pick(transition.onLoss, 'transition.onLoss', ['regroup', 'balanced', 'counterpress'] as const),
    },
    defense: {
      line: pick(defense.line, 'defense.line', ['low', 'mid', 'high'] as const),
      engagement: pick(defense.engagement, 'defense.engagement', ['low', 'mid', 'high'] as const),
      intensity: pick(defense.intensity, 'defense.intensity', ['low', 'mid', 'high'] as const),
    },
    ...(advanced ? { advanced } : {}),
  }
}

export function tryValidateInstructions(value: unknown): { ok: true; value: TacticalInstructionsV2 } | { ok: false; error: string } {
  try {
    return { ok: true, value: validateInstructions(value) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 深拷贝 + 冻结检查：模板被复制成可编辑指令，风格 ID 不参与模拟。 */
export const cloneInstructions = (value: TacticalInstructionsV2): TacticalInstructionsV2 => structuredClone(value)

/** 规范化指令：剔除默认中性的高级子项，便于序列化和模板相等对比。 */
export function normalizeInstructions(value: TacticalInstructionsV2): TacticalInstructionsV2 {
  const base: TacticalInstructionsV2 = {
    possession: { ...value.possession },
    transition: { ...value.transition },
    defense: { ...value.defense },
  }
  const receiving = value.advanced?.possession?.receiving
  const crossTiming = value.advanced?.possession?.crossTiming
  const defWidth = value.advanced?.defense?.width
  const hasPoss = (receiving && receiving !== 'mixed') || (crossTiming && crossTiming !== 'balanced')
  const hasDef = defWidth && defWidth !== 'normal'
  if (hasPoss || hasDef) {
    base.advanced = {
      ...(hasPoss ? {
        possession: {
          ...(receiving && receiving !== 'mixed' ? { receiving } : {}),
          ...(crossTiming && crossTiming !== 'balanced' ? { crossTiming } : {}),
        },
      } : {}),
      ...(hasDef ? { defense: { width: defWidth } } : {}),
    }
  }
  return base
}

/** 两项指令是否逐项相等（「已调整」判定，不比较风格 ID）。 */
export function sameInstructions(a: TacticalInstructionsV2, b: TacticalInstructionsV2): boolean {
  return a.possession.focus === b.possession.focus && a.possession.passing === b.possession.passing
    && a.possession.tempo === b.possession.tempo && a.possession.width === b.possession.width
    && a.transition.onGain === b.transition.onGain && a.transition.onLoss === b.transition.onLoss
    && a.defense.line === b.defense.line && a.defense.engagement === b.defense.engagement
    && a.defense.intensity === b.defense.intensity
    && (a.advanced?.possession?.receiving ?? 'mixed') === (b.advanced?.possession?.receiving ?? 'mixed')
    && (a.advanced?.possession?.crossTiming ?? 'balanced') === (b.advanced?.possession?.crossTiming ?? 'balanced')
    && (a.advanced?.defense?.width ?? 'normal') === (b.advanced?.defense?.width ?? 'normal')
}

export type LegacyTacticsShape = {
  attack: 'middle' | 'wing' | 'balanced'
  passing: 'short' | 'mixed' | 'direct'
  tempo: 'slow' | 'normal' | 'fast'
  line: 'low' | 'mid' | 'high'
  press: 'low' | 'mid' | 'high'
}

/** 新指令投影回旧五字段：供后台 v2 AI 引擎、旧版摘要和兼容存档使用。 */
export function legacyTacticsFromInstructions(inst: TacticalInstructionsV2): LegacyTacticsShape {
  return {
    attack: inst.possession.focus,
    passing: inst.possession.passing,
    tempo: inst.possession.tempo,
    line: inst.defense.line,
    press: inst.defense.intensity === 'high' || inst.defense.engagement === 'high'
      ? 'high'
      : inst.defense.intensity === 'low' && inst.defense.engagement === 'low'
        ? 'low'
        : 'mid',
  }
}

/** 旧五字段映射到新指令：旧存档首次在战术页编辑或仅传旧 tactics 时的合并起点。 */
export function instructionsFromLegacyTactics(
  tactics: LegacyTacticsShape,
  base?: TacticalInstructionsV2,
): TacticalInstructionsV2 {
  const seed = base ? cloneInstructions(base) : undefined
  return normalizeInstructions({
    possession: {
      focus: tactics.attack,
      passing: tactics.passing,
      tempo: tactics.tempo,
      width: seed?.possession.width ?? (tactics.attack === 'wing' ? 'wide' : tactics.attack === 'middle' ? 'narrow' : 'normal'),
    },
    transition: {
      onGain: seed?.transition.onGain ?? 'balanced',
      onLoss: seed?.transition.onLoss ?? 'balanced',
    },
    defense: {
      line: tactics.line,
      engagement: tactics.press,
      intensity: tactics.press,
    },
    ...(seed?.advanced ? { advanced: seed.advanced } : {}),
  })
}

/** 识别指令对应的基础风格模板，以及是否相对该模板做过手动调整。 */
export function inferStyleForInstructions(
  inst: TacticalInstructionsV2,
  preferred?: StyleId,
): { styleId: StyleId; adjusted: boolean } {
  if (preferred && isStyleId(preferred)) {
    const def = STYLES_REV3[preferred]
    if (sameInstructions(inst, def.instructions)) return { styleId: preferred, adjusted: false }
    // 若与其它某个未调整预设完全一致，也优先尊重玩家显式选中的基准风格并标“已调整”（blank 除外）。
    if (preferred !== 'blank') return { styleId: preferred, adjusted: true }
  }
  for (const item of STYLE_LIST_REV3) {
    if (item.id !== 'blank' && sameInstructions(inst, item.instructions)) {
      return { styleId: item.id, adjusted: false }
    }
  }
  if (sameInstructions(inst, NEUTRAL_INSTRUCTIONS)) return { styleId: 'blank', adjusted: false }
  return { styleId: preferred && isStyleId(preferred) ? preferred : 'blank', adjusted: true }
}

function shiftTier<T extends string>(current: T, tiers: readonly T[], delta: -1 | 0 | 1): T {
  const index = tiers.indexOf(current)
  if (index < 0) return current
  return tiers[Math.max(0, Math.min(tiers.length - 1, index + delta))]
}

/**
 * 临场心态叠加层（docs/fm-tactical-styles-and-instructions.md 3.3 / 3.7）：
 * 在赛前基准指令上做有界、非累积的一档偏移；切回 `balanced` 精确恢复赛前指令，绝不抹除自定义配置。
 */
export function applyMentalityOverlay(
  base: TacticalInstructionsV2,
  mentality: 'attack' | 'balanced' | 'defend',
): TacticalInstructionsV2 {
  const next = cloneInstructions(base)
  if (mentality === 'balanced') return next
  const delta: -1 | 1 = mentality === 'attack' ? 1 : -1
  next.possession.tempo = shiftTier(base.possession.tempo, ['slow', 'normal', 'fast'] as const, delta)
  next.defense.line = shiftTier(base.defense.line, ['low', 'mid', 'high'] as const, delta)
  next.defense.engagement = shiftTier(base.defense.engagement, ['low', 'mid', 'high'] as const, delta)
  if (mentality === 'attack') {
    next.transition.onGain = shiftTier(base.transition.onGain, ['hold', 'balanced', 'counter'] as const, 1)
  } else {
    next.transition.onLoss = shiftTier(base.transition.onLoss, ['regroup', 'balanced', 'counterpress'] as const, -1)
    next.defense.intensity = shiftTier(base.defense.intensity, ['low', 'mid', 'high'] as const, -1)
  }
  return normalizeInstructions(next)
}

export type InstructionFieldId =
  | 'possession.focus'
  | 'possession.passing'
  | 'possession.tempo'
  | 'possession.width'
  | 'advanced.possession.receiving'
  | 'advanced.possession.crossTiming'
  | 'transition.onGain'
  | 'transition.onLoss'
  | 'defense.line'
  | 'defense.engagement'
  | 'defense.intensity'
  | 'advanced.defense.width'

export type InstructionFieldDef = {
  id: InstructionFieldId
  label: string
  desc: string
  options: readonly { value: string; label: string }[]
}

export const INSTRUCTION_GROUPS: readonly { title: string; fields: readonly InstructionFieldDef[] }[] = [
  {
    title: '持球阶段',
    fields: [
      {
        id: 'possession.focus',
        label: '进攻方向',
        desc: '决定接应站位与传球目标偏向中路肋部还是两翼走廊。中路人数集中但易拥挤；两翼空间大但依赖传中接应。',
        options: [
          { value: 'middle', label: '中路' },
          { value: 'balanced', label: '均衡' },
          { value: 'wing', label: '两翼' },
        ],
      },
      {
        id: 'possession.passing',
        label: '传球倾向',
        desc: '短传偏好近距离安全传递，控球稳但推进慢；直传偏好中长距离纵向输送，推进快但易被拦截。',
        options: [
          { value: 'short', label: '短传' },
          { value: 'mixed', label: '混合' },
          { value: 'direct', label: '直传' },
        ],
      },
      {
        id: 'possession.tempo',
        label: '比赛节奏',
        desc: '控制持球观察停留与出球频率。快节奏抢在防线落位前出球但失误增加；慢节奏耐心控球梳理。',
        options: [
          { value: 'slow', label: '偏慢' },
          { value: 'normal', label: '正常' },
          { value: 'fast', label: '偏快' },
        ],
      },
      {
        id: 'possession.width',
        label: '持球宽度',
        desc: '进攻时全队横向拉开程度。宽站位能拉扯对手窄防线，但丢球后横向补位距离更远。',
        options: [
          { value: 'narrow', label: '收缩' },
          { value: 'normal', label: '正常' },
          { value: 'wide', label: '拉开' },
        ],
      },
      {
        id: 'advanced.possession.receiving',
        label: '接球方式',
        desc: '脚下：队友主动回撤接应短传；空当：前锋积极前插防线身后，持球人尝试提前量直塞（对手低位时空间受限）。',
        options: [
          { value: 'feet', label: '接脚下' },
          { value: 'mixed', label: '混合' },
          { value: 'space', label: '跑空当' },
        ],
      },
      {
        id: 'advanced.possession.crossTiming',
        label: '传中时机',
        desc: '尽早传中允许边路球员在肋部/45度提前起球找禁区队友，不必每次下底；需要禁区内有争顶抢点点位。',
        options: [
          { value: 'balanced', label: '常规' },
          { value: 'early', label: '尽早' },
        ],
      },
    ],
  },
  {
    title: '攻防转换',
    fields: [
      {
        id: 'transition.onGain',
        label: '得球转换',
        desc: '夺回球权后数秒内的倾向。反击会立即激发前场跑位与向前传球；稳住队形优先安全第一脚过渡。',
        options: [
          { value: 'hold', label: '稳住' },
          { value: 'balanced', label: '均衡' },
          { value: 'counter', label: '反击' },
        ],
      },
      {
        id: 'transition.onLoss',
        label: '失球转换',
        desc: '丢球瞬间的反应。就地反抢扩大围抢半径并投入双人压迫（耗体能、怕长传越顶）；回撤优先退回防线位置。',
        options: [
          { value: 'regroup', label: '回撤' },
          { value: 'balanced', label: '均衡' },
          { value: 'counterpress', label: '反抢' },
        ],
      },
    ],
  },
  {
    title: '无球阶段',
    fields: [
      {
        id: 'defense.line',
        label: '后防线',
        desc: '无球时后卫线的站位纵深。高防线压缩中场空间但暴露大片身后草皮；低防线保护禁区与身后但让出外围。',
        options: [
          { value: 'low', label: '低位' },
          { value: 'mid', label: '中位' },
          { value: 'high', label: '高位' },
        ],
      },
      {
        id: 'defense.engagement',
        label: '逼抢线',
        desc: '从球场哪个区域开始主动上抢。高位在前场就施压对手后卫；低位退回本方半场后再启动常规逼抢。',
        options: [
          { value: 'low', label: '低位' },
          { value: 'mid', label: '中场' },
          { value: 'high', label: '前场' },
        ],
      },
      {
        id: 'defense.intensity',
        label: '压迫频率',
        desc: '控制上抢搜索半径与协防人数。积极压迫会派出第二名防守人封堵近端出球线，但大幅加快体能消耗。',
        options: [
          { value: 'low', label: '克制' },
          { value: 'mid', label: '均衡' },
          { value: 'high', label: '积极' },
        ],
      },
      {
        id: 'advanced.defense.width',
        label: '防守宽度',
        desc: '无球落位时的横向紧凑度。收缩中路能封堵直塞线路，代价是边路与弱侧空当更大。',
        options: [
          { value: 'narrow', label: '收缩' },
          { value: 'normal', label: '正常' },
          { value: 'wide', label: '扩宽' },
        ],
      },
    ],
  },
]

export function getInstructionField(inst: TacticalInstructionsV2, field: InstructionFieldId): string {
  switch (field) {
    case 'possession.focus': return inst.possession.focus
    case 'possession.passing': return inst.possession.passing
    case 'possession.tempo': return inst.possession.tempo
    case 'possession.width': return inst.possession.width
    case 'advanced.possession.receiving': return inst.advanced?.possession?.receiving ?? 'mixed'
    case 'advanced.possession.crossTiming': return inst.advanced?.possession?.crossTiming ?? 'balanced'
    case 'transition.onGain': return inst.transition.onGain
    case 'transition.onLoss': return inst.transition.onLoss
    case 'defense.line': return inst.defense.line
    case 'defense.engagement': return inst.defense.engagement
    case 'defense.intensity': return inst.defense.intensity
    case 'advanced.defense.width': return inst.advanced?.defense?.width ?? 'normal'
  }
}

export function setInstructionField(inst: TacticalInstructionsV2, field: InstructionFieldId, value: string): TacticalInstructionsV2 {
  const next = cloneInstructions(inst)
  switch (field) {
    case 'possession.focus':
      next.possession.focus = value as TacticalInstructionsV2['possession']['focus']
      break
    case 'possession.passing':
      next.possession.passing = value as TacticalInstructionsV2['possession']['passing']
      break
    case 'possession.tempo':
      next.possession.tempo = value as TacticalInstructionsV2['possession']['tempo']
      break
    case 'possession.width':
      next.possession.width = value as TacticalInstructionsV2['possession']['width']
      break
    case 'advanced.possession.receiving':
      next.advanced = { ...next.advanced, possession: { ...next.advanced?.possession, receiving: value as 'feet' | 'mixed' | 'space' } }
      break
    case 'advanced.possession.crossTiming':
      next.advanced = { ...next.advanced, possession: { ...next.advanced?.possession, crossTiming: value as 'balanced' | 'early' } }
      break
    case 'transition.onGain':
      next.transition.onGain = value as TacticalInstructionsV2['transition']['onGain']
      break
    case 'transition.onLoss':
      next.transition.onLoss = value as TacticalInstructionsV2['transition']['onLoss']
      break
    case 'defense.line':
      next.defense.line = value as TacticalInstructionsV2['defense']['line']
      break
    case 'defense.engagement':
      next.defense.engagement = value as TacticalInstructionsV2['defense']['engagement']
      break
    case 'defense.intensity':
      next.defense.intensity = value as TacticalInstructionsV2['defense']['intensity']
      break
    case 'advanced.defense.width':
      next.advanced = { ...next.advanced, defense: { ...next.advanced?.defense, width: value as 'narrow' | 'normal' | 'wide' } }
      break
  }
  return validateInstructions(normalizeInstructions(next))
}
