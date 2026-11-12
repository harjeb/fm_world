/**
 * 球队下场比赛计划（Match Plan）系统。
 *
 * 参考 FM（Football Manager）赛前比赛计划机制：玩家在赛前除了排定基准阵型与十二项战术指令外，
 * 还可以指定一场比赛的动态执教预案（如「全力争胜」「龟缩防守」「抢开局闪电战」「领先锁局」「留力养生」「杯赛鏖战」等）。
 *
 * 作用范围：
 * 1. 比赛内（同时作用于【赛季联赛】与【全部挑战赛：传奇挑战、巅峰之路、杯赛含两回合总比分、友谊赛、交流赛】）：
 *    按实时比赛分钟数（0–90'）与净胜球局势（含杯赛次回合总比分）自动切换战术指令叠加层、压迫侵略度与场内跑动消耗倍率，
 *    并在阶段切换时生成教练场边调度战报。
 * 2. 赛季长期策略（作用于单机与联机【赛季联赛】赛后体能结算）：
 *    高强度搏命计划（如全力争胜、疯狗高压）会额外消耗赛后体能，考验阵容轮换；
 *    控场与轮换计划（如留力养生、太极控场、龟缩防守）可显著降低体能损耗，帮助主力度过密集赛程。
 *    挑战赛不扣赛季持久体能，因此单场挑战可大胆启用高压搏命或针对性防反预案。
 */
import {
  cloneInstructions,
  legacyTacticsFromInstructions,
  normalizeInstructions,
  type LegacyTacticsShape,
  type TacticalInstructionsV2,
} from './tactics.ts'

export type MatchPlanId =
  | 'standard'
  | 'allOutWin'
  | 'parkTheBus'
  | 'fastStart'
  | 'protectLead'
  | 'lateSiege'
  | 'counterTrap'
  | 'highPressBlitz'
  | 'wingBombard'
  | 'controlTempo'
  | 'conserveStamina'
  | 'underdogGrind'
  | 'twoGoalCushion'
  | 'cupHoldout'

export type MatchPlanCategory = '综合' | '进攻' | '防守' | '局势' | '赛程/挑战'

export type MatchPlanDef = {
  id: MatchPlanId
  name: string
  category: MatchPlanCategory
  /** 一句话核心定位 */
  tagline: string
  /** 临场阶段触发条件说明 */
  triggerSummary: string
  /** 战术收益 */
  pros: string
  /** 战术代价与风险 */
  cons: string
  /** 对赛季联赛的影响说明 */
  seasonEffect: string
  /** 对挑战赛/杯赛的影响说明 */
  challengeEffect: string
  /** 赛季联赛赛后体能消耗倍率（1.00 为基准 90分钟掉70点） */
  conditionFactor: number
}

export const MATCH_PLAN_LIST: readonly MatchPlanDef[] = [
  {
    id: 'standard',
    name: '常规部署',
    category: '综合',
    tagline: '严格执行赛前既定战术与十二项指令，不做自动临场变阵。',
    triggerSummary: '全场维持赛前设定的战术指令与攻防节奏。',
    pros: '阵型结构与战术执行最稳定，完全忠于主帅手动微调。',
    cons: '比分落后或末段领先时不会自动改打搏命或锁局（需手动指挥）。',
    seasonEffect: '赛后体能标准消耗（×1.00）',
    challengeEffect: '按赛前既定战术平稳发挥',
    conditionFactor: 1.0,
  },
  {
    id: 'allOutWin',
    name: '全力争胜',
    category: '进攻',
    tagline: '开场即提速前压争胜；60分钟仍未领先则全线压上搏命总攻。',
    triggerSummary: '0–60′ 积极前压快攻；60′后平局或落后触发「全线总攻」；75′后领先2球转为稳压。',
    pros: '射门频次、前场夺回球权与破密集能力极强，平局绝不妥协。',
    cons: '后防身后空当巨大，末段体能下滑快且犯规吃牌风险上升。',
    seasonEffect: '赛后体能损耗 +15%（密集赛程需轮换）',
    challengeEffect: '单场满体能无后顾之忧，强攻破关首选',
    conditionFactor: 1.15,
  },
  {
    id: 'parkTheBus',
    name: '龟缩防守',
    category: '防守',
    tagline: '禁区前沿摆起铁桶大巴，全员深度退守低位，力保球门不失。',
    triggerSummary: '全场执行极低位防线、收缩肋部、克制盲目上抢与慢速稳妥出球。',
    pros: '极大压缩禁区与身后空间，克制豪门渗透与速度型锋线。',
    cons: '主动放弃控球与前场压迫，进攻端机会稀少，久守考验门将与防线专注。',
    seasonEffect: '赛后体能损耗 -8%（客战强敌抢分省力）',
    challengeEffect: '越级挑战传奇/巅峰强敌或守平拖点球利器',
    conditionFactor: 0.92,
  },
  {
    id: 'fastStart',
    name: '抢开局闪电战',
    category: '进攻',
    tagline: '前25分钟狂风暴雨高位抢攻争取早破门，得手后及时收网稳局。',
    triggerSummary: '0–25′ 高位快节奏疯抢冲击空当；25′后若已领先转「收网稳局」，未领先则回基准战术。',
    pros: '极易趁对手立足未稳抢下首球，避免全场透支体能。',
    cons: '若前25分钟久攻不下反被打穿身后，会陷入被动。',
    seasonEffect: '赛后体能损耗 +5%（开局高强度冲刺）',
    challengeEffect: '适合挑战赛抢先手进球打乱强敌部署',
    conditionFactor: 1.05,
  },
  {
    id: 'protectLead',
    name: '领先锁局',
    category: '局势',
    tagline: '平局落后按原计划踢；一旦取得领先立即降速回收，70分钟后铁桶锁门。',
    triggerSummary: '未领先时执行赛前战术；领先后转「稳健控局」；70′后仍领先触发「终场铁桶锁门」。',
    pros: '大幅减少领先后被反击追平的意外，把一球优势稳稳变成胜果。',
    cons: '过早一球领先时进攻火力明显收敛，若被扳平需重新提速。',
    seasonEffect: '赛后体能损耗 -5%（领先后降速养精蓄锐）',
    challengeEffect: '淘汰赛与挑战赛领先后防翻车神器',
    conditionFactor: 0.95,
  },
  {
    id: 'lateSiege',
    name: '绝地反扑',
    category: '局势',
    tagline: '前60分钟稳扎稳打保存体力；末段落后或久攻不下时吹响围攻号角。',
    triggerSummary: '0–60′ 未落后时稳健蓄力；60′后落后或75′后平局触发「末段围攻」（直传+尽早传中+高压反抢）。',
    pros: '前中段体能留存充沛，最后30分钟配合生力军替补具备极强绝杀与逆转火力。',
    cons: '上半场进攻节奏偏稳，若早早大比分落后追分时间较紧。',
    seasonEffect: '赛后体能损耗 +5%（末段高强度冲刺）',
    challengeEffect: '挑战赛下半场僵局破冰与逆风翻盘利器',
    conditionFactor: 1.05,
  },
  {
    id: 'counterTrap',
    name: '诱敌防反',
    category: '防守',
    tagline: '主动让出控球退守中低位引蛇出洞，断球瞬间直塞打穿对手身后。',
    triggerSummary: '常态执行低位收缩防守+得球立即直传反击冲击空当；75′后若仍落后则前压搏命。',
    pros: '面对高位控球强队时反击单刀效率极高，攻防转换刀刀致命。',
    cons: '面对同样低位死守的对手时缺乏阵地破密手段。',
    seasonEffect: '赛后体能标准消耗（×1.00）',
    challengeEffect: '巅峰之路与传奇挑战以弱胜强头号战术',
    conditionFactor: 1.0,
  },
  {
    id: 'highPressBlitz',
    name: '疯狗高压',
    category: '进攻',
    tagline: '全场高位防线配窒息式双人围抢与就地反抢，逼迫对手后场崩溃。',
    triggerSummary: '全场执行前场逼抢线+积极压迫+丢球立即反抢；仅在75′后领先2球以上时略降压迫防崩盘。',
    pros: '前场断球、压制控球与连续围攻能力拉满，让技术平庸对手难以出球。',
    cons: '全队体能燃烧极快，对球员耐力与板凳深度要求苛刻。',
    seasonEffect: '赛后体能损耗 +18%（极耗体能，慎用于一周双赛）',
    challengeEffect: '挑战赛不扣赛季体能，可肆无忌惮满血疯抢整场',
    conditionFactor: 1.18,
  },
  {
    id: 'wingBombard',
    name: '两翼狂轰',
    category: '进攻',
    tagline: '极致拉开球场宽度主攻两翼走廊，频繁45度与下底传中轰炸禁区。',
    triggerSummary: '全场拉开宽度+主攻两翼+尽早传中；60′后未领先升级为「高空强袭」加快直传冲吊。',
    pros: '专门撕扯收缩中路的密集防线，充分发挥边路快马与高中锋头球优势。',
    cons: '中路控球保护减弱，传中被解围后需提防对手中路快反。',
    seasonEffect: '赛后体能损耗 +6%（边路往返冲刺增多）',
    challengeEffect: '针对窄防线对手或拥有强力空霸中锋时奇效显著',
    conditionFactor: 1.06,
  },
  {
    id: 'controlTempo',
    name: '太极控场',
    category: '综合',
    tagline: '以传代跑、以控代守，用高控球率与慢节奏消磨对手锐气。',
    triggerSummary: '未落后时执行短传+偏慢节奏+接脚下球+稳住队形；落后时自动提速至均衡渗透追分。',
    pros: '大幅压制对手触球与射门次数，比赛场面平稳且显著节省全队体能。',
    cons: '节奏偏慢导致反击锐度下降，面对铁桶阵可能得势不得分。',
    seasonEffect: '赛后体能损耗 -10%（技术流球队双线续航优选）',
    challengeEffect: '适合实力占优时稳控全局、零封过关',
    conditionFactor: 0.9,
  },
  {
    id: 'conserveStamina',
    name: '留力养生',
    category: '赛程/挑战',
    tagline: '专为魔鬼赛程与弱旅轮换周打造，最大限度降低冲刺对抗与体能损耗。',
    triggerSummary: '全场低消耗慢节奏巡航、回撤落位减少拼抢；仅在75′后落后1球时适度提速尝试扳平。',
    pros: '全游戏最低体能损耗与较低碰撞受伤率，保障核心球员连续作战。',
    cons: '压迫与推进强度明显打折，强强对话易陷入被动。',
    seasonEffect: '赛后体能损耗 -20%（密集赛程保主力神器）',
    challengeEffect: '挑战赛不扣赛季体能，通常无需启用此保守预案',
    conditionFactor: 0.8,
  },
  {
    id: 'underdogGrind',
    name: '弱队死磕',
    category: '赛程/挑战',
    tagline: '越级挑战豪门专用：前70分钟铁桶苟住比分蓄力，末段突然亮剑偷袭！',
    triggerSummary: '0–70′ 极低位严防蓄力（降低场内体力消耗）；70′后平局或落后1球突然切换快反直塞亮剑！',
    pros: '把体能留到最后20分钟抓强敌压上后的疲态空当，常能上演一击致命爆冷。',
    cons: '若上半场早早丢满2球被迫提前攻出来，蓄力优势会被抵消。',
    seasonEffect: '赛后体能损耗 -5%（前70分钟低耗周旋）',
    challengeEffect: '传奇挑战与巅峰之路跨战力爆冷通关秘籍',
    conditionFactor: 0.95,
  },
  {
    id: 'twoGoalCushion',
    name: '乘胜追击',
    category: '局势',
    tagline: '拒绝一球小胜提心吊胆：领先1球继续猛攻追求两球安全垫，到手后再锁胜。',
    triggerSummary: '净胜球 < 2 时持续执行快节奏前压进攻；净胜球 ≥ 2 后自动转入「两球锁胜」慢控省力。',
    pros: '兼顾联赛刷净胜球与比赛安全感，早早两球领先后后半程反而更省体力。',
    cons: '一球领先时仍压上进攻，存在被对手反击偷平的风险。',
    seasonEffect: '赛后体能损耗 +4%（大胜场次场内体力更充裕）',
    challengeEffect: '杯赛首回合攒净胜球优势与稳拿完胜首选',
    conditionFactor: 1.04,
  },
  {
    id: 'cupHoldout',
    name: '杯赛鏖战',
    category: '赛程/挑战',
    tagline: '智能识别淘汰赛与两回合总比分：占优死守晋级线，持平末段力保拖入点球。',
    triggerSummary: '总比分领先时死守晋级；总比分持平65′后全面回收拖点球；总比分落后时立即前压破釜沉舟！',
    pros: '唯一深度联动两回合总比分（shootoutOffset）的淘汰赛专家预案，进退极具章法。',
    cons: '平局末段倾向保点球而非冒险绝杀，点球大战仍看门将与射手心理素质。',
    seasonEffect: '赛后体能损耗 -4%（平局与领先阶段注重防守站位）',
    challengeEffect: '杯赛（含两回合淘汰赛）与单场淘汰赛最具针对性预案',
    conditionFactor: 0.96,
  },
]

export const MATCH_PLANS: Record<MatchPlanId, MatchPlanDef> = Object.fromEntries(
  MATCH_PLAN_LIST.map((plan) => [plan.id, plan]),
) as Record<MatchPlanId, MatchPlanDef>

export const MATCH_PLAN_GROUPS: readonly { category: MatchPlanCategory; plans: readonly MatchPlanDef[] }[] = (
  ['综合', '进攻', '防守', '局势', '赛程/挑战'] as const
).map((category) => ({
  category,
  plans: MATCH_PLAN_LIST.filter((plan) => plan.category === category),
}))

export function isMatchPlanId(value: unknown): value is MatchPlanId {
  return typeof value === 'string' && Object.hasOwn(MATCH_PLANS, value)
}

export function matchPlanConditionFactor(planId?: MatchPlanId): number {
  if (!planId || !isMatchPlanId(planId)) return 1
  return MATCH_PLANS[planId].conditionFactor
}

export function matchPlanLabel(planId?: MatchPlanId): string {
  if (!planId || planId === 'standard' || !isMatchPlanId(planId)) return '常规部署'
  return MATCH_PLANS[planId].name
}

export interface MatchPlanContext {
  /** 显示分钟数（0–90+） */
  minute: number
  /** 本场己方比分 - 对方比分 */
  scoreDiff: number
  /** 计入两回合首回合偏移后的有效净胜球（单场赛等于 scoreDiff） */
  effectiveDiff: number
  /** 是否淘汰赛 */
  knockout?: boolean
}

export interface MatchPlanPhaseResult {
  phaseId: string
  phaseLabel: string
  announcement: string
  instructions: TacticalInstructionsV2
  tactics: LegacyTacticsShape
  aggression: number
  staminaMul: number
}

type InstructionPatch = {
  focus?: TacticalInstructionsV2['possession']['focus']
  passing?: TacticalInstructionsV2['possession']['passing']
  tempo?: TacticalInstructionsV2['possession']['tempo']
  width?: TacticalInstructionsV2['possession']['width']
  receiving?: 'feet' | 'mixed' | 'space'
  crossTiming?: 'balanced' | 'early'
  onGain?: TacticalInstructionsV2['transition']['onGain']
  onLoss?: TacticalInstructionsV2['transition']['onLoss']
  line?: TacticalInstructionsV2['defense']['line']
  engagement?: TacticalInstructionsV2['defense']['engagement']
  intensity?: TacticalInstructionsV2['defense']['intensity']
  defWidth?: 'narrow' | 'normal' | 'wide'
}

function patchInstructions(base: TacticalInstructionsV2, patch: InstructionPatch): TacticalInstructionsV2 {
  const next = cloneInstructions(base)
  if (patch.focus) next.possession.focus = patch.focus
  if (patch.passing) next.possession.passing = patch.passing
  if (patch.tempo) next.possession.tempo = patch.tempo
  if (patch.width) next.possession.width = patch.width
  if (patch.onGain) next.transition.onGain = patch.onGain
  if (patch.onLoss) next.transition.onLoss = patch.onLoss
  if (patch.line) next.defense.line = patch.line
  if (patch.engagement) next.defense.engagement = patch.engagement
  if (patch.intensity) next.defense.intensity = patch.intensity
  if (patch.receiving || patch.crossTiming || patch.defWidth) {
    next.advanced = {
      ...next.advanced,
      ...(patch.receiving || patch.crossTiming
        ? {
            possession: {
              ...next.advanced?.possession,
              ...(patch.receiving ? { receiving: patch.receiving } : {}),
              ...(patch.crossTiming ? { crossTiming: patch.crossTiming } : {}),
            },
          }
        : {}),
      ...(patch.defWidth
        ? {
            defense: {
              ...next.advanced?.defense,
              width: patch.defWidth,
            },
          }
        : {}),
    }
  }
  return normalizeInstructions(next)
}

function buildPhase(
  planId: MatchPlanId,
  phaseId: string,
  phaseLabel: string,
  detail: string,
  base: TacticalInstructionsV2,
  patch: InstructionPatch | null,
  aggression = 0.5,
  staminaMul = 1,
  baseTactics?: LegacyTacticsShape,
): MatchPlanPhaseResult {
  const instructions = patch ? patchInstructions(base, patch) : cloneInstructions(base)
  const tactics = patch ? legacyTacticsFromInstructions(instructions) : (baseTactics ? { ...baseTactics } : legacyTacticsFromInstructions(instructions))
  return {
    phaseId,
    phaseLabel,
    announcement: `比赛计划「${MATCH_PLANS[planId].name}」：${detail}`,
    instructions,
    tactics,
    aggression,
    staminaMul,
  }
}

const PHASE_LABELS: Record<string, string> = {
  base: '既定战术',
  allout_open: '积极强攻',
  allout_siege: '全线总攻',
  allout_cruise: '高位控胜',
  bus_lock: '铁桶大巴',
  fast_blitz: '开局抢攻',
  fast_hold: '收网稳局',
  lead_steady: '稳健控局',
  lead_lockdown: '终场锁门',
  siege_pace: '稳守蓄力',
  siege_storm: '末段围攻',
  trap_ambush: '低位伏击',
  trap_push: '前压反扑',
  press_hunt: '高压绞杀',
  press_manage: '高位转稳',
  wing_fly: '两翼齐飞',
  wing_storm: '高空强袭',
  tempo_hypnosis: '催眠控球',
  tempo_probe: '提速渗透',
  stamina_save: '低耗巡航',
  stamina_push: '末段抢分',
  underdog_shell: '铁桶蓄力',
  underdog_strike: '奇袭亮剑',
  underdog_chase: '被迫反扑',
  cushion_push: '扩大战果',
  cushion_lock: '两球锁胜',
  cup_protect: '死守晋级',
  cup_cautious: '稳守周旋',
  cup_penalties: '力保点球',
  cup_chase: '破釜沉舟',
  cup_desperate: '全线搏命',
}

export function matchPlanPhaseName(phaseId?: string): string {
  if (!phaseId) return ''
  return PHASE_LABELS[phaseId] ?? ''
}

/**
 * 纯函数评估当前时刻应生效的比赛计划阶段。
 * `standard` 或未设置返回 `null`（完全不介入，确保现有确定性测试零变化）。
 */
export function evaluateMatchPlan(
  planId: MatchPlanId | undefined,
  baseInstructions: TacticalInstructionsV2,
  ctx: MatchPlanContext,
  baseTactics?: LegacyTacticsShape,
): MatchPlanPhaseResult | null {
  if (!planId || planId === 'standard' || !isMatchPlanId(planId)) return null
  const { minute, effectiveDiff } = ctx

  switch (planId) {
    case 'allOutWin': {
      if (effectiveDiff >= 2 && minute >= 75) {
        return buildPhase(planId, 'allout_cruise', '高位控胜', '已建立两球优势，维持前场压迫并稳住节奏。', baseInstructions, {
          tempo: 'normal',
          onGain: 'balanced',
          onLoss: 'counterpress',
          line: 'mid',
          engagement: 'high',
          intensity: 'mid',
        }, 0.62, 1.04, baseTactics)
      }
      if (effectiveDiff <= 0 && minute >= 60) {
        return buildPhase(planId, 'allout_siege', '全线总攻', '60分钟仍未领先，全线压上快节奏强攻禁区！', baseInstructions, {
          passing: 'direct',
          tempo: 'fast',
          width: 'wide',
          receiving: 'space',
          crossTiming: 'early',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.82, 1.18, baseTactics)
      }
      return buildPhase(planId, 'allout_open', '积极强攻', '开场积极提速前压，全力冲击球门。', baseInstructions, {
        tempo: 'fast',
        receiving: 'space',
        onGain: 'counter',
        onLoss: 'counterpress',
        line: 'high',
        engagement: 'high',
        intensity: 'high',
      }, 0.72, 1.12, baseTactics)
    }

    case 'parkTheBus': {
      return buildPhase(planId, 'bus_lock', '铁桶大巴', '全员退守低位收缩禁区，严防死守力保不失。', baseInstructions, {
        passing: 'short',
        tempo: 'slow',
        width: 'narrow',
        onGain: 'hold',
        onLoss: 'regroup',
        line: 'low',
        engagement: 'low',
        intensity: 'low',
        defWidth: 'narrow',
      }, 0.3, 0.9, baseTactics)
    }

    case 'fastStart': {
      if (minute < 25 && effectiveDiff < 2) {
        return buildPhase(planId, 'fast_blitz', '开局抢攻', '趁对手立足未稳，前25分钟高位快节奏抢攻！', baseInstructions, {
          tempo: 'fast',
          receiving: 'space',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.74, 1.14, baseTactics)
      }
      if (effectiveDiff > 0) {
        return buildPhase(planId, 'fast_hold', '收网稳局', '抢开局得手，回收防线稳控比赛节奏。', baseInstructions, {
          tempo: 'slow',
          onGain: 'hold',
          onLoss: 'regroup',
          line: 'mid',
          engagement: 'mid',
          intensity: 'mid',
        }, 0.45, 0.94, baseTactics)
      }
      return buildPhase(planId, 'base', '既定战术', '开局强攻时段结束，恢复赛前既定战术周旋。', baseInstructions, null, 0.5, 1, baseTactics)
    }

    case 'protectLead': {
      if (effectiveDiff <= 0) {
        return buildPhase(planId, 'base', '既定战术', '比分未领先，按赛前既定战术执行。', baseInstructions, null, 0.5, 1, baseTactics)
      }
      if (minute >= 70) {
        return buildPhase(planId, 'lead_lockdown', '终场锁门', '进入最后20分钟领先阶段，全员低位铁桶锁死胜局！', baseInstructions, {
          passing: 'short',
          tempo: 'slow',
          width: 'narrow',
          receiving: 'feet',
          onGain: 'hold',
          onLoss: 'regroup',
          line: 'low',
          engagement: 'low',
          intensity: 'low',
          defWidth: 'narrow',
        }, 0.34, 0.9, baseTactics)
      }
      return buildPhase(planId, 'lead_steady', '稳健控局', '取得领先优势，降慢节奏稳住球权与防线。', baseInstructions, {
        tempo: 'slow',
        receiving: 'feet',
        onGain: 'hold',
        onLoss: 'regroup',
        line: baseInstructions.defense.line === 'high' ? 'mid' : baseInstructions.defense.line,
        engagement: baseInstructions.defense.engagement === 'high' ? 'mid' : baseInstructions.defense.engagement,
        intensity: 'mid',
      }, 0.42, 0.94, baseTactics)
    }

    case 'lateSiege': {
      if (minute >= 60 && (effectiveDiff < 0 || (effectiveDiff === 0 && minute >= 75))) {
        return buildPhase(planId, 'siege_storm', '末段围攻', '吹响绝地反扑号角，全线压上直传冲吊围攻禁区！', baseInstructions, {
          passing: 'direct',
          tempo: 'fast',
          width: 'wide',
          receiving: 'space',
          crossTiming: 'early',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.8, 1.16, baseTactics)
      }
      if (minute < 60 && effectiveDiff >= 0) {
        return buildPhase(planId, 'siege_pace', '稳守蓄力', '前60分钟稳扎稳打减少无谓消耗，为下半场决战蓄力。', baseInstructions, {
          tempo: 'slow',
          onGain: 'balanced',
          onLoss: 'regroup',
          line: baseInstructions.defense.line === 'high' ? 'mid' : baseInstructions.defense.line,
          intensity: 'low',
        }, 0.42, 0.9, baseTactics)
      }
      return buildPhase(planId, 'base', '既定战术', '按赛前既定战术推进。', baseInstructions, null, 0.5, 1, baseTactics)
    }

    case 'counterTrap': {
      if (effectiveDiff < 0 && minute >= 75) {
        return buildPhase(planId, 'trap_push', '前压反扑', '终场前仍处落后，防线前压主动抢球搏命！', baseInstructions, {
          passing: 'direct',
          tempo: 'fast',
          receiving: 'space',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.74, 1.12, baseTactics)
      }
      return buildPhase(planId, 'trap_ambush', '低位伏击', '退守低位收缩中路诱敌深入，断球瞬间直塞打身后！', baseInstructions, {
        passing: 'direct',
        tempo: 'fast',
        receiving: 'space',
        onGain: 'counter',
        onLoss: 'regroup',
        line: 'low',
        engagement: 'low',
        intensity: 'mid',
        defWidth: 'narrow',
      }, 0.54, 0.98, baseTactics)
    }

    case 'highPressBlitz': {
      if (effectiveDiff >= 2 && minute >= 75) {
        return buildPhase(planId, 'press_manage', '高位转稳', '两球领先进入尾声，适度放缓上抢频率防止体能崩盘。', baseInstructions, {
          tempo: 'normal',
          onGain: 'balanced',
          onLoss: 'balanced',
          line: 'mid',
          engagement: 'high',
          intensity: 'mid',
        }, 0.56, 1.0, baseTactics)
      }
      return buildPhase(planId, 'press_hunt', '高压绞杀', '全队前场窒息式围抢与就地反抢，持续压迫对手出球！', baseInstructions, {
        tempo: 'fast',
        onGain: 'counter',
        onLoss: 'counterpress',
        line: 'high',
        engagement: 'high',
        intensity: 'high',
      }, 0.8, 1.18, baseTactics)
    }

    case 'wingBombard': {
      if (effectiveDiff <= 0 && minute >= 60) {
        return buildPhase(planId, 'wing_storm', '高空强袭', '下半场加强两翼快节奏起球，全力轰炸禁区高点！', baseInstructions, {
          focus: 'wing',
          passing: 'direct',
          tempo: 'fast',
          width: 'wide',
          receiving: 'space',
          crossTiming: 'early',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.7, 1.12, baseTactics)
      }
      return buildPhase(planId, 'wing_fly', '两翼齐飞', '拉开场地宽度主攻两翼走廊，尽早传中冲击防线。', baseInstructions, {
        focus: 'wing',
        width: 'wide',
        crossTiming: 'early',
        onGain: 'counter',
      }, 0.56, 1.04, baseTactics)
    }

    case 'controlTempo': {
      if (effectiveDiff < 0) {
        return buildPhase(planId, 'tempo_probe', '提速渗透', '比分落后，加快传切节奏并前压夺回球权。', baseInstructions, {
          passing: 'short',
          tempo: 'normal',
          receiving: 'space',
          onGain: 'balanced',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.6, 1.02, baseTactics)
      }
      return buildPhase(planId, 'tempo_hypnosis', '催眠控球', '短传接脚下配合偏慢节奏，以控代守消磨对手体能。', baseInstructions, {
        passing: 'short',
        tempo: 'slow',
        receiving: 'feet',
        onGain: 'hold',
        onLoss: 'balanced',
        line: 'mid',
        engagement: 'mid',
        intensity: 'low',
      }, 0.38, 0.88, baseTactics)
    }

    case 'conserveStamina': {
      if (effectiveDiff === -1 && minute >= 75) {
        return buildPhase(planId, 'stamina_push', '末段抢分', '终场前仅落后一球，适度恢复节奏尝试扳平比分。', baseInstructions, {
          tempo: 'normal',
          onGain: 'counter',
          onLoss: 'balanced',
          line: 'mid',
          engagement: 'mid',
          intensity: 'mid',
        }, 0.5, 0.96, baseTactics)
      }
      return buildPhase(planId, 'stamina_save', '低耗巡航', '慢节奏稳控球权、回撤落位减少对抗，最大限度节省体能。', baseInstructions, {
        passing: 'short',
        tempo: 'slow',
        receiving: 'feet',
        onGain: 'hold',
        onLoss: 'regroup',
        line: 'low',
        engagement: 'low',
        intensity: 'low',
      }, 0.28, 0.8, baseTactics)
    }

    case 'underdogGrind': {
      if (effectiveDiff <= -2) {
        return buildPhase(planId, 'underdog_chase', '被迫反扑', '落后两球以上，打破铁桶阵提前压上反击一搏！', baseInstructions, {
          passing: 'direct',
          tempo: 'fast',
          receiving: 'space',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'mid',
          engagement: 'high',
          intensity: 'high',
        }, 0.68, 1.08, baseTactics)
      }
      if (minute >= 70 && effectiveDiff <= 0) {
        return buildPhase(planId, 'underdog_strike', '奇袭亮剑', '进入最后20分钟决胜期，蓄力已足，突然提速直塞偷袭身后！', baseInstructions, {
          passing: 'direct',
          tempo: 'fast',
          receiving: 'space',
          crossTiming: 'early',
          onGain: 'counter',
          onLoss: 'balanced',
          line: 'mid',
          engagement: 'mid',
          intensity: 'high',
        }, 0.66, 1.08, baseTactics)
      }
      return buildPhase(planId, 'underdog_shell', '铁桶蓄力', '深度低位严防死守消耗强敌耐心，留存体力等待末段亮剑。', baseInstructions, {
        passing: 'mixed',
        tempo: 'slow',
        width: 'narrow',
        onGain: 'hold',
        onLoss: 'regroup',
        line: 'low',
        engagement: 'low',
        intensity: 'low',
        defWidth: 'narrow',
      }, 0.34, 0.86, baseTactics)
    }

    case 'twoGoalCushion': {
      if (effectiveDiff >= 2) {
        return buildPhase(planId, 'cushion_lock', '两球锁胜', '两球安全垫已到手，转入慢节奏稳健控场收下比赛。', baseInstructions, {
          passing: 'short',
          tempo: 'slow',
          receiving: 'feet',
          onGain: 'hold',
          onLoss: 'regroup',
          line: 'mid',
          engagement: 'low',
          intensity: 'low',
        }, 0.38, 0.88, baseTactics)
      }
      return buildPhase(planId, 'cushion_push', '扩大战果', '净胜未达两球，保持快节奏高压进攻全力扩大领先！', baseInstructions, {
        tempo: 'fast',
        receiving: 'space',
        onGain: 'counter',
        onLoss: 'counterpress',
        line: 'high',
        engagement: 'high',
        intensity: 'high',
      }, 0.68, 1.1, baseTactics)
    }

    case 'cupHoldout': {
      if (effectiveDiff > 0) {
        return buildPhase(planId, 'cup_protect', '死守晋级', '总比分占据优势，收缩低位防线稳守晋级名额。', baseInstructions, {
          passing: 'short',
          tempo: 'slow',
          width: 'narrow',
          onGain: 'hold',
          onLoss: 'regroup',
          line: 'low',
          engagement: 'low',
          intensity: 'low',
          defWidth: 'narrow',
        }, 0.34, 0.9, baseTactics)
      }
      if (effectiveDiff === 0) {
        if (minute >= 65) {
          return buildPhase(planId, 'cup_penalties', '力保点球', '总比分持平进入尾声，全员退守禁区力保不失拖入决胜！', baseInstructions, {
            passing: 'short',
            tempo: 'slow',
            width: 'narrow',
            receiving: 'feet',
            onGain: 'hold',
            onLoss: 'regroup',
            line: 'low',
            engagement: 'low',
            intensity: 'low',
            defWidth: 'narrow',
          }, 0.3, 0.88, baseTactics)
        }
        return buildPhase(planId, 'cup_cautious', '稳守周旋', '总比分持平，稳固中低位防线伺机反击，绝不轻易冒进。', baseInstructions, {
          tempo: 'slow',
          onGain: 'counter',
          onLoss: 'regroup',
          line: 'low',
          engagement: 'mid',
          intensity: 'low',
        }, 0.42, 0.94, baseTactics)
      }
      if (minute >= 70) {
        return buildPhase(planId, 'cup_desperate', '全线搏命', '总比分落后进入最后阶段，全员压上直传强攻挽救淘汰危局！', baseInstructions, {
          passing: 'direct',
          tempo: 'fast',
          width: 'wide',
          receiving: 'space',
          crossTiming: 'early',
          onGain: 'counter',
          onLoss: 'counterpress',
          line: 'high',
          engagement: 'high',
          intensity: 'high',
        }, 0.82, 1.16, baseTactics)
      }
      return buildPhase(planId, 'cup_chase', '破釜沉舟', '总比分处于落后，主动提速前压寻求扳平进球！', baseInstructions, {
        tempo: 'fast',
        receiving: 'space',
        onGain: 'counter',
        onLoss: 'counterpress',
        line: 'high',
        engagement: 'high',
        intensity: 'high',
      }, 0.7, 1.1, baseTactics)
    }
  }
}
