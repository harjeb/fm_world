/**
 * 战术风格 / 球队指令的实验模型（docs/fm-tactical-styles-and-instructions.md 3.3 / 4.1、
 * docs/team-instructions-system-design.md 4.1）。
 *
 * 这里只放**首版九项**和它们的参数；高级指令（P2）不在本文件里。
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
  /** 复杂度（文档 1. 各风格的「低 / 平均 / 高 / 极高复杂度」），用于熟练度惩罚。 */
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
}

/** 单项指令的相对难度（1 = 平均）：用于熟练度惩罚，越高越吃熟练度。 */
export const INSTRUCTION_DIFFICULTY = {
  passing: 0.8,
  focus: 0.9,
  tempo: 0.9,
  width: 1.0,
  onGain: 1.2,
  onLoss: 1.3,
  line: 1.0,
  engagement: 1.2,
  intensity: 1.3,
} as const
export type InstructionKey = keyof typeof INSTRUCTION_DIFFICULTY

/** 三档枚举 → -1 / 0 / +1。 */
const TRI_NEGATIVE = new Set(['middle', 'narrow', 'slow', 'short', 'hold', 'regroup', 'low'])
const TRI_POSITIVE = new Set(['wing', 'wide', 'fast', 'direct', 'counter', 'counterpress', 'high'])
export const triOf = (value: string): Tri => (TRI_NEGATIVE.has(value) ? -1 : TRI_POSITIVE.has(value) ? 1 : 0)

/**
 * 执行强度与「执行反了」的概率（战术难度 / 熟练度的核心）。
 * - `fam` 0 = 完全不熟，1 = 完全熟练。
 * - 复杂度和单项难度越高，同样的熟练度下执行越弱、失误越多。
 * - 数值来自 `npm run tactics:experiment -- --familiarity`，见验证报告。
 */
export function execution(fam: number, params: TacticsParams = DEFAULT_PARAMS): number {
  const f = Math.max(0, Math.min(1, fam))
  return params.familiarityFloor + (1 - params.familiarityFloor) * f
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
  for (const key of Object.keys(v)) if (!['possession', 'transition', 'defense'].includes(key)) throw new Error(`未知战术指令分组 ${key}`)
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
  }
}

/** 深拷贝 + 冻结检查：模板被复制成可编辑指令，风格 ID 不参与模拟。 */
export const cloneInstructions = (value: TacticalInstructionsV2): TacticalInstructionsV2 => structuredClone(value)

/** 两项指令是否逐项相等（「已调整」判定，不比较风格 ID）。 */
export function sameInstructions(a: TacticalInstructionsV2, b: TacticalInstructionsV2): boolean {
  return a.possession.focus === b.possession.focus && a.possession.passing === b.possession.passing
    && a.possession.tempo === b.possession.tempo && a.possession.width === b.possession.width
    && a.transition.onGain === b.transition.onGain && a.transition.onLoss === b.transition.onLoss
    && a.defense.line === b.defense.line && a.defense.engagement === b.defense.engagement
    && a.defense.intensity === b.defense.intensity
}
