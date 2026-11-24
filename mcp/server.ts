import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export type FmMcpConfig = {
  server: string
  token: string
}

type Json = Record<string, unknown>

async function callJson(config: FmMcpConfig, path: string, init: RequestInit = {}): Promise<Json> {
  const response = await fetch(`${config.server}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => null) as Json | null
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload ?? {}
}

async function callText(config: FmMcpConfig, path: string): Promise<string> {
  const response = await fetch(`${config.server}${path}`, { headers: { Authorization: `Bearer ${config.token}` } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

function toolResult(value: unknown, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text }], isError }
}

const tacticsSchema = z.object({
  attack: z.enum(['middle', 'wing', 'balanced']),
  passing: z.enum(['short', 'mixed', 'direct']),
  tempo: z.enum(['slow', 'normal', 'fast']),
  line: z.enum(['low', 'mid', 'high']),
  press: z.enum(['low', 'mid', 'high']),
})

const formationIdSchema = z.enum(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2'])

const lineupInputSchema = z.object({
  formationId: formationIdSchema,
  starters: z.array(z.object({ slotId: z.string(), playerId: z.string(), role: z.string().optional() })).describe('11 名首发；role 可省略，服务器会选该位置默认职责'),
  bench: z.array(z.string()).max(7),
  tactics: tacticsSchema.optional(),
  tacticalStyle: z.string().nullable().optional().describe('可选战术风格模板 ID，见 state.tacticalStyles；null 清空'),
  tacticalInstructions: z.record(z.string(), z.unknown()).nullable().optional().describe('可选十二项战术指令对象；null 清空'),
  matchPlan: z.string().nullable().optional().describe('可选下场比赛计划 ID，见 state.matchPlans；standard 或 null 恢复常规'),
  backupTactics: z.array(z.record(z.string(), z.unknown())).max(3).nullable().optional().describe('可选 FM 备选战术槽数组（最多 3 套：{id,name,formationId,mentality,tacticalStyle?,tacticalInstructions,slotRoles?,customPositions?,preferredPlayers?}）；null 清空'),
  matchPlanRules: z.array(z.record(z.string(), z.unknown())).max(8).nullable().optional().describe('可选 FM 自定义条件比赛计划规则数组（最多 8 条：{id,name,enabled,once?,condition:{minMinute?,maxMinute?,score?,redCard?,avgStaminaBelow?},action:{tacticSlotId?,mentality?,tacticalStyle?,instructionPatch?,linkedSub?}}）；null 清空'),
  customPositions: z.record(z.string(), z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).nullable().optional().describe('可选槽位自定义坐标映射；null 清空'),
  autoShout: z.boolean().optional().describe('可选：是否开启赛前自动情绪喊话兜底（离线或未观赛时由助教按局势自动喊话）'),
})

const positionSchema = z.enum(['GK', 'CB', 'W', 'CM', 'ST'])

const autoSubConditionRuleSchema = z.object({
  targetKind: z.enum(['any', 'position', 'slot', 'player']).describe('目标类型：any 任意首发 / position 指定位置 / slot 指定槽位 / player 指定首发球员'),
  targetValue: z.string().optional().describe('targetKind 为 position/slot/player 时填写对应位置、槽位 ID 或球员 ID'),
  staminaBelow: z.number().min(1).max(99).describe('体力低于此百分比时触发（1-99）'),
  minMinute: z.number().min(0).lt(90).optional().describe('最早触发分钟（0-89）'),
  scoreState: z.enum(['any', 'leading', 'drawing', 'trailing', 'not_leading']).optional().describe('比分条件：any/leading/drawing/trailing/not_leading'),
  inId: z.string().optional().describe('可选指定替补球员 ID'),
})

const autoSubsSchema = z.object({
  timed: z.array(z.object({ atMinute: z.number().gt(0).lt(90), outId: z.string(), inId: z.string() })).max(5)
    .describe('指定首发换下和替补换上的比赛分钟数（0-90），达到后在事件边界执行'),
  staminaBelow: z.number().min(1).max(99).nullable().describe('比赛中体力百分比低于此值时换人；null 为关闭'),
  preMatchStaminaBelow: z.number().min(1).max(99).nullable().optional().describe('赛前按预计开球体能轮换低于此值的首发；null 或省略为关闭，不消耗比赛换人次数'),
  staminaPositions: z.array(positionSchema).optional().describe('可选：限制全局体力换人只替换指定位置（如 ["W","CM","ST"]）'),
  staminaMinMinute: z.number().min(0).lt(90).optional().describe('可选：全局体力换人最早触发分钟（0-89）'),
  preferBy: z.enum(['proficiency', 'stamina', 'ca']).optional().describe('可选：自动替补挑选策略（proficiency 位置熟练优先 / stamina 充沛体力优先 / ca 综合能力优先）'),
  conditionRules: z.array(autoSubConditionRuleSchema).max(5).optional().describe('可选：最多 5 条按位置/槽位/球员/比分触发的条件换人规则'),
  onInjury: z.boolean().describe('发生比赛内伤病时自动换人'),
})

const shoutKindSchema = z.enum([
  'encourage',
  'praise',
  'demand_more',
  'fire_up',
  'focus',
  'calm_down',
  'no_pressure',
  'berate',
])

const trainingPositionSchema = z.enum(['GK', 'CB', 'W', 'CM', 'ST', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR'])
const trainingRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('activity'), activityId: z.string().min(1), teammateIds: z.array(z.string().min(1)).optional(), position: trainingPositionSchema.optional(), detailed: z.boolean().optional(), mentorId: z.string().min(1).optional(), skill: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('drill'), attr: z.string().describe('主属性英文名，如 passing / shooting / tackling / speed'), teammateIds: z.array(z.string().min(1)).optional() }).strict(),
  z.object({ kind: z.literal('combo'), focus: z.enum(['attack', 'defense']), teammateIds: z.array(z.string().min(1)).optional() }).strict(),
  z.object({ kind: z.literal('match'), teammateIds: z.array(z.string().min(1)).optional() }).strict(),
  z.object({ kind: z.literal('position'), position: trainingPositionSchema, detailed: z.boolean().optional() }),
  z.object({ kind: z.literal('rest') }),
  z.object({ kind: z.literal('mentor') }),
  z.object({ kind: z.literal('protection'), focus: z.enum(['prevention', 'resilience']) }),
])

export function createFmMcpServer(config: FmMcpConfig): McpServer {
  const server = new McpServer({ name: 'fm-mcp', version: '0.1.0' })

  const read = (path: string) => callJson(config, path)
  const action = async (name: string, args: Json = {}) => callJson(config, '/api/agent/action', {
    method: 'POST',
    body: JSON.stringify({ action: name, ...args }),
  })

  const register = (
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodRawShape,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    server.registerTool(name, { title, description, inputSchema }, async (args) => {
      try {
        return toolResult(await run((args ?? {}) as Record<string, unknown>))
      } catch (error) {
        return toolResult(error instanceof Error ? error.message : String(error), true)
      }
    })
  }

  register('get_state', '读取游戏状态', '读取当前俱乐部、阵容、球员属性、训练进度、赛程、积分榜与进行中比赛。每次决策前先调用。', {}, () => read('/api/agent/state'))

  register('get_player', '查看球员详情', '按 playerId 读取一名球员的可见属性、位置、培养历史、体力与精力。隐藏属性不会返回。', {
    playerId: z.string().describe('球员 ID，来自 get_state 的 roster'),
  }, (args) => action('get_player', args))

  register('upgrade_facility', '升级设施', '第 2 赛季起优先消耗董事会本季「独立设施预算」，不足或用完时自动使用俱乐部余额补足。', {
    facilityId: z.enum(['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics']),
  }, (args) => action('upgrade_facility', args))

  register('board_choose_ambition', '选择董事会赛季目标档位', '休赛期预选下赛季目标档位（safe 稳妥 / expected 基准 / ambitious 野心；升级杯未决时可传 tier 分别为 division1 与 division2 各预选一套），或在开季第 1–3 轮切换/确认本赛季目标档位（按新旧档位差额调整转会预算、设施预算、工资帽与余额；第 4 轮起自动锁定）。', {
    ambition: z.enum(['safe', 'expected', 'ambitious']),
    scope: z.enum(['offseason', 'current']).optional().describe('可选：休赛期预选传 offseason，开季第 1–3 轮调整传 current；省略时按赛季是否结束自动判断'),
    tier: z.enum(['division2', 'division1', 'champions']).optional().describe('可选：升级杯进行中级别未确定时，指定为 division1（若升级）或 division2（若留级）分别预选'),
    lock: z.boolean().optional().describe('开季第 1–3 轮时传 true 可提前锁定当前档位'),
  }, (args) => action('board_choose_ambition', args))

  register('board_adjust_budget', '调节转会预算与工资帽滑块', '在转会预算与每轮基础工资帽之间按 38:1（每赛季 38 轮）双向调拨额度；严禁触碰独立设施预算。transferDelta 为正表示把多余工资帽转为转会预算，为负表示把转会预算转为工资帽。', {
    transferDelta: z.number().int().safe().describe('转会预算变动量（正=工资帽转转会，负=转会转工资帽），需为 38 的整数倍或至少 ±38'),
  }, (args) => action('board_adjust_budget', args))

  register('pay_wage_arrears', '补发欠薪', '发薪时余额不够会欠薪（state.economy.wageArrears）；欠薪期间球员在比赛里所有属性减半（只发挥 50%），联机按开球前 30 分钟锁定时的状态算。余额够时一次补清全部欠薪；下次发薪时余额够也会先自动补发。', {}, () => action('pay_wage_arrears', {}))

  register('bid_free_agent', '竞拍自由球员', '自由市场全服共用：第一个出价开始 1 小时倒计时，最后 10 分钟内有人跟价，倒计时重新回到 10 分钟；跟价每次至少加 5%，并交出价 2%（至少 1,000）的手续费，手续费不退还。时间到时最高价者得。amount 是出价总额。', {
    playerId: z.string().min(1), amount: z.number().int().positive().safe(),
  }, (args) => action('bid_free_agent', args))

  register('list_player', '挂牌球员', '在本地 NPC 市场挂牌，价格为正整数。', {
    playerId: z.string().min(1), price: z.number().int().positive().safe(),
  }, (args) => action('list_player', args))

  register('cancel_listing', '取消挂牌', '取消本地挂牌并将球员放回阵容。', {
    playerId: z.string().min(1),
  }, (args) => action('cancel_listing', args))

  const goalSchema = z.enum(['title', 'promotion', 'top-half', 'survival']).optional().describe('承诺的赛季目标：title 争冠/升级、promotion 冲击上游（默认）、top-half 稳居中游、survival 保级为主')
  const roleSchema = z.enum(['star', 'first-team', 'rotation']).optional().describe('承诺的队内定位：star 绝对主力、first-team 常规首发（默认）、rotation 轮换替补')

  register('preview_signing', '预览谈判', '向世界各赛区 AI 球队买人前预览，不写入存档：俱乐部这关（主力/轮换/冷板凳、年龄、最近 20 场出场、要求的溢价、点头概率）和球员这关（想听的目标/定位、想去的球队、最低联赛级别、点头概率），chance 是两关相乘。年轻主力是非卖品（asking 为 null）。', {
    teamId: z.string().min(1), playerId: z.string().min(1),
    offer: z.number().int().positive().safe().optional().describe('报价总额；不填按底价'),
    goal: goalSchema, role: roleSchema,
  }, (args) => action('preview_signing', args))

  register('sign_club_player', '谈判买人', '向世界各赛区 AI 球队报价买人（转会窗口开放时，不含其他玩家执教的球队）：俱乐部按放人规则、球员按个人诉求，两关都过才成交；报价不能低于俱乐部要价。同一份报价和承诺的结果固定，换报价或承诺才重新判定。', {
    teamId: z.string().min(1), playerId: z.string().min(1),
    offer: z.number().int().positive().safe().describe('报价总额，不能低于底价'),
    goal: goalSchema, role: roleSchema,
  }, (args) => action('sign_club_player', args))

  register('respond_offer', '回复报价', 'AI 俱乐部给你球员的报价（state.transferOffers 里 status 为 pending 的）：accept=true 接受（球员转走、钱到账），false 拒绝。现实 24 小时内不回复算拒绝；拒绝高价报价（high=true，不低于身价 1.3 倍）球员会不满 16 小时，期间精力恢复只剩一成。', {
    offerId: z.string().min(1),
    accept: z.boolean(),
  }, (args) => action('respond_offer', args))

  register('renew_contract', '续约 / 提前续约', '给自己的球员续约或提前续约（3-5 年新合同，从当前赛季起算且须晚于原到期赛季）。每次续约均按当前工资、能力成长与年限要求加薪；可先查看 get_state 中球员的 renewal 字段了解要求的年限、薪资与涨幅。', {
    playerId: z.string().min(1),
    years: z.number().int().min(3).max(5).optional().describe('新合同年限（3-5 年，须晚于当前到期赛季）；省略时按球员要求年限续约'),
  }, (args) => action('renew_contract', args))

  register('release_player', '解约', '解约球员，球员进入自由市场；阵容至少保留 18 人（一套完整比赛名单）。', {
    playerId: z.string().min(1),
  }, (args) => action('release_player', args))

  register('auto_lineup', '自动排阵容', '按指定阵型自动选择首发、替补和默认战术。', {
    formationId: formationIdSchema.optional().describe('不填则沿用当前阵型'),
  }, (args) => action('auto_lineup', args))

  register('set_lineup', '提交阵容', '提交完整首发、替补和战术。首发必须 11 人并占满阵型的位置，替补最多 7 人；任何球员都能踢任何位置，没学过的位置属性按 60% 发挥。', {
    lineup: lineupInputSchema,
    autoSubs: autoSubsSchema.optional().describe('可同时提交与新阵容匹配的自动换人计划'),
  }, (args) => action('set_lineup', args))

  register('save_lineup_preset', '保存或覆盖阵容预设', '将当前阵容（或指定的 lineup）保存为命名预设，或通过 presetId / name+overwrite=true 覆盖已有预设；不会修改当前生效阵容，锁阵期间也可维护预设。', {
    presetId: z.string().min(1).optional().describe('要覆盖的已有预设 ID（来自 get_state.lineup.presets[].id）；传入时覆盖该预设，name 可选'),
    name: z.string().min(1).max(20).optional().describe('预设名称（1-20 字）；新建预设时必填，按 presetId 覆盖时传入可顺便改名'),
    overwrite: z.boolean().optional().describe('未传 presetId 且存在同名预设时，传 true 原地覆盖（不存在则新建）；默认 false 拒绝重名'),
    lineup: lineupInputSchema.optional().describe('可选要保存的完整阵容；省略则保存当前生效阵容'),
  }, (args) => action('save_lineup_preset', args))

  register('apply_lineup_preset', '应用阵容预设', '将已保存的阵容预设应用为当前阵容（来自 get_state.lineup.presets[].id）；赛前 30 分钟锁阵期间不可用。若原自动换人与新阵容冲突且未传 autoSubs，会自动清空冲突规则。', {
    presetId: z.string().min(1),
    autoSubs: autoSubsSchema.optional().describe('可选与该预设匹配的自动换人计划'),
  }, (args) => action('apply_lineup_preset', args))

  register('rename_lineup_preset', '重命名阵容预设', '修改已有阵容预设的名称（1-20 字，不可与其他预设重名）。', {
    presetId: z.string().min(1),
    name: z.string().min(1).max(20),
  }, (args) => action('rename_lineup_preset', args))

  register('delete_lineup_preset', '删除阵容预设', '删除指定 ID 的阵容预设（来自 get_state.lineup.presets[].id）。', {
    presetId: z.string().min(1),
  }, (args) => action('delete_lineup_preset', args))

  register('set_auto_subs', '设置自动换人', '可选赛前低体能轮换，以及比赛内定时、体力和受伤自动换人；场内自动与手动共用 5 次额度。', {
    plan: autoSubsSchema,
  }, (args) => action('set_auto_subs', args))

  register('set_match_auto_subs', '比赛中设置自动换人', '进行中的比赛实时更新本场自动换人计划；可选 syncDefault 同步保存为默认设置。', {
    plan: autoSubsSchema,
    syncDefault: z.boolean().optional(),
  }, (args) => action('set_match_auto_subs', args))

  register('set_training_books', '保存培养技能卡配置', '按球员保存技能书配置（第 1–2 赛季最多 4 本，第 3 赛季起最多 5 本，见 get_state.trainingBookLimit），key 来自 get_state 的 legendBooks。交流赛后从技能书、随机最多 5 名共同培养的队友和基础技能按 50:30:20 权重抽取三选一；已学技能不出现。', {
    playerId: z.string(),
    bookKeys: z.array(z.string()).max(5),
  }, (args) => action('set_training_books', args))

  register('buy_shop_book', '商店兑换金色技能书', '消耗商店点数购买当季上架的一本金色技能书（8 外场 + 2 门将 + 2 辅助共 12 本，每赛季轮换；skillId 来自 get_state.shop.catalog）。买后永久进入 legendBooks。', {
    skillId: z.string().min(1),
  }, (args) => action('buy_shop_book', args))

  register('claim_achievement', '领取成就奖励', '领取已达成且未领取的成就奖励（含商店点数、金币福利及联赛 5 连胜 +50 / 10 连胜 +100 独立主属性上限加成等；领取上限加成后同步刷新进行中培养上限）。省略 id 或传 all=true 时一键领取全部可领成就。', {
    id: z.string().min(1).optional().describe('成就 ID，来自 get_state.achievements.items[].id；省略时领取全部可领成就'),
    all: z.boolean().optional().describe('传 true 一键领取当前所有已达成且有奖励的未领成就'),
  }, (args) => action('claim_achievement', args))

  register('youth_action', '管理青训', '读取 get_state.youth 后操作青训：设置位置与能力方向、招募、临时征召、返回、正式提拔或解约。正式提拔永久停止基础成长；解约不返资源。', {
    youth: z.object({
      action: z.enum(['plan', 'recruit_position', 'sign', 'call_up', 'return', 'promote', 'release']),
      playerId: z.string().optional(),
      position: z.enum(['GK', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST']).optional(),
      plan: z.object({
        position: z.enum(['GK', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST']),
        focus: z.enum(['balanced', 'pace', 'strength', 'endurance', 'dribbling', 'passing', 'finishing', 'defending', 'saves', 'handling', 'distribution']),
      }).optional(),
    }),
  }, (args) => action('youth_action', args))

  register('start_training', '开始培养', '每轮从原始属性开始，产出球员卡（第 1 赛季 30 时段、第 2 赛季 40 时段、第 3 赛季起 50 时段且第 3 周非比赛日为国外特训 ×3；技能卡装备上限第 1–2 赛季 4 张、第 3 赛季起 5 张）；省略 bookKeys 时使用保存的技能卡配置，传入时同时保存。可投入共享培养点提高品质。', {
    playerId: z.string(),
    bookKeys: z.array(z.string()).max(5).optional(),
    points: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(30)]).optional().describe('本轮投入的共享培养点；余额不足会失败'),
  }, (args) => action('start_training', args))

  register('start_scouting', '委托球探', '考察其他球队或自由市场球员；转会/自由市场考察原始版本，球队目标考察装备版本。完成前不返回估计属性。', {
    playerId: z.string().min(1),
    source: z.enum(['club', 'transfer', 'market']),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    clubId: z.string().optional().describe('source=club 或 transfer 时必填，来自 get_world 的 clubs[].id'),
  }, (args) => action('start_scouting', args))

  register('get_scout_reports', '读取球探报告', '读取进行中和已完成的球探报告；已完成报告附相对本队的明细位置星级。', {}, () => action('get_scout_reports', {}))

  register('delete_scout_report', '删除球探报告', '删除已完成的球探报告，不退费。', {
    reportId: z.string().min(1),
  }, (args) => action('delete_scout_report', args))

  register('preview_training', '预览训练行动', '验证训练并预览成长等信息，不写入存档；交流赛结果在执行时产生，预览不保证比赛结果。', {
    playerId: z.string(),
    request: trainingRequestSchema,
  }, (args) => action('preview_training', args))

  register('training_action', '执行训练', '新日历从 get_state 的 options 选择 activityId（按选项提供参数）；周一上午交流赛、周五上午队内赛及下午恢复为强制时段。旧培养使用旧请求。遇到 pendingEvent 时先处理事件。', {
    playerId: z.string(),
    request: trainingRequestSchema,
  }, (args) => action('training_action', args))

  register('training_event_choice', '处理训练事件', '选择一个训练事件选项。optionId 来自 get_state 的 pendingEvent.options。', {
    playerId: z.string(),
    optionId: z.string(),
    replaceSkill: z.string().optional().describe('同类别技能槽已满时，选择要替换的已学技能 ID；失败不替换'),
  }, (args) => action('training_event_choice', args))

  register('confirm_training', '装备刚练出的卡', '培养结束后新卡已自动进入库存；这个操作把它装备到球员身上并收起培养结果。', {
    playerId: z.string(),
  }, (args) => action('confirm_training', args))

  register('keep_training', '新卡留在库存', '培养结束后不换卡，新卡留在库存，球员继续用原来的卡。', {
    playerId: z.string(),
  }, (args) => action('keep_training', args))

  register('discard_training', '丢弃刚练出的卡', '从库存删除刚练出的新卡，球员继续用原来的卡。', {
    playerId: z.string(),
  }, (args) => action('discard_training', args))

  register('set_auto_training', '设置自动培养', '设置这名球员的自动培养策略（和培养页“自动策略”一致）：mode=priority 按优先级依次练满、targets 把主属性补到目标值、max 每次选成长最多的一项。', {
    playerId: z.string().min(1),
    mode: z.enum(['priority', 'targets', 'max']).optional(),
    priority: z.array(z.string()).optional().describe('属性英文名的优先顺序'),
    resetPriority: z.boolean().optional().describe('true 时恢复默认优先级（先练这名球员的 2 个主要属性）'),
    targets: z.record(z.string(), z.number().min(0).max(2000)).optional().describe('targets 模式的目标值（0–2000），如 { "passing": 1500 }'),
  }, (args) => action('set_auto_training', args))

  register('run_auto_training', '自动培养', '按自动培养策略连续推进进行中的一轮培养（自动挑训练、自动处理事件），直到本轮结束或用完 maxSteps。不会自己开始新一轮。', {
    playerId: z.string().min(1),
    maxSteps: z.number().int().min(1).max(200).optional().describe('最多推进几步，默认 120（足够跑完第 3 赛季 50 时段及事件）'),
  }, (args) => action('run_auto_training', args))

  register('equip_card', '给球员换卡', '把球员自己的一张球员卡装备到他身上；cardId 为 null 换回原始属性。比赛进行中不能换；体能、精力、伤病和停赛不受换卡影响。', {
    playerId: z.string(),
    cardId: z.string().nullable().describe('来自 get_state 的 cards[].id；null 表示原始属性'),
  }, (args) => action('equip_card', args))

  register('delete_card', '删除球员卡', '从库存删除一张没有装备的球员卡。', {
    cardId: z.string(),
  }, (args) => action('delete_card', args))

  register('recycle_cards', '回收球员卡', '回收未装备、未锁定且已处理完培养结果的球员卡，获得共享培养点；不可逆。', {
    cardIds: z.array(z.string().min(1)).min(1).describe('来自 get_state 的 cards[].id'),
  }, (args) => action('recycle_cards', args))

  register('lock_card', '锁定球员卡', '锁定或解锁库存卡的回收状态；锁定卡不能回收，挂牌成交仍会销毁。', {
    cardId: z.string().min(1),
    locked: z.boolean(),
  }, (args) => action('lock_card', args))

  register('start_next_season', '开始新赛季', '赛季结束后开始下一赛季，保留球员和俱乐部数据。', {}, () => action('start_next_season'))

  register('start_league', '开始联赛比赛', '单机：开始本轮联赛。联机联赛到开赛时间由服务器用保存的阵容自动结算，不能手动开赛；开赛前 30 分钟锁定阵容。', {}, () => action('start_league'))

  register('start_friendly', '开始友谊赛', '与本分区一支 AI 球队开始一场友谊赛；约全服其他球队用 start_world_friendly。', {
    teamId: z.string().describe('来自 get_state 的 teams[].id'),
  }, (args) => action('start_friendly', args))

  register('start_world_friendly', '约战全服球队', '和世界页一样，与全服任意一支球队（含其他教练执教的球队）开始友谊赛，对手名单由服务器给出。', {
    clubId: z.string().describe('来自 get_world 的 clubs[].id'),
  }, (args) => action('start_world_friendly', args))

  register('get_pve', '查看巅峰之路与传奇挑战', '读取巅峰之路 100 关目录、今日剩余次数、50 关全明星候选名单及 50 支传奇强队与掉落技能书；可选传 stage 或 legendId 预览对手名单。', {
    stage: z.number().int().min(1).max(100).optional(),
    legendId: z.string().min(1).optional(),
  }, (args) => action('get_pve', args))

  register('start_peak_challenge', '开启巅峰之路挑战', '开启一场巅峰之路关卡比赛（满体能、不消耗联赛体能、支持平局点球决胜）；省略 stage 时默认挑战下一未通关关卡。开赛后可用 advance_match / play_match 完成结算。', {
    stage: z.number().int().min(1).max(100).optional().describe('关卡号 1–100，仅可挑战已通关或当前下一关；省略默认下一关'),
  }, (args) => action('start_peak_challenge', args))

  register('start_legend_challenge', '开启传奇挑战', '与历史传奇强队开启一场挑战赛（满体能、允许平局、赢球可掉落该队传奇技能书）；开赛后可用 advance_match / play_match 完成结算。', {
    legendId: z.string().min(1).describe('来自 get_pve 的 legends.teams[].id'),
  }, (args) => action('start_legend_challenge', args))

  register('use_peak_breakthrough', '使用巅峰属性突破卡', '消耗 1 张巅峰之路属性突破卡，将指定球员一项主属性个人上限 +100（不超过 2000 硬上限）。', {
    playerId: z.string().min(1),
    attr: z.string().min(1).describe('主属性英文名，如 shooting / passing / speed / reflexes'),
  }, (args) => action('use_peak_breakthrough', args))

  register('claim_peak_reward', '领取巅峰 50 关全明星奖励', '通关巅峰之路第 50 关后，从第 50 关全明星阵容中任选 1 人加入一线队。', {
    templateId: z.string().min(1).describe('来自 get_pve 的 peak.reward50Candidates[].templateId'),
  }, (args) => action('claim_peak_reward', args))

  register('get_world', '查看全服世界', '读取全服所有球队（名单、RANK、是否有教练执教、电脑球队设施）以及各分区的积分榜和赛程，和世界页 / 球队详情一致。', {}, () => action('get_world'))

  register('get_chat', '读取全服聊天', '读取最新最多 50 条全服聊天，含教练、俱乐部、文字和时间。', {}, () => action('get_chat'))

  register('send_chat', '发送全服聊天', '发送一条最多 200 字的全服聊天消息，受发言间隔限制。', {
    text: z.string().min(1).max(200),
  }, (args) => action('send_chat', args))

  register('rename_club', '俱乐部改名', '联机时修改俱乐部名字：最多 8 个字，不能和全服已有球队（AI 球队或其他教练的球队）重名；比赛进行中不能改。', {
    name: z.string().min(1).max(8),
  }, (args) => action('rename_club', args))

  register('get_match', '查看比赛', '不传 matchId 时读取当前进行中比赛（含联机 10 分钟直播中的联赛与杯赛）的比分、时钟、统计、场上球员情绪 mood、喊话状态 shouts、替补、战术和最近事件；传 matchId 时读取完整比赛记录和复盘建议。', {
    matchId: z.string().optional().describe('比赛记录 ID；不填则读取当前比赛'),
  }, (args) => action('get_match', args))

  register('advance_match', '推进挑战赛 / 友谊赛', '适用于友谊赛、巅峰之路与传奇挑战：按步推进，默认 1 步；联赛只能等待现实时间。返回当前比赛或终场记录。', {
    steps: z.number().int().min(1).max(20000).optional(),
  }, (args) => action('advance_match', args))

  register('set_auto_shout', '开关自动情绪喊话', '开关赛前「自动喊话」兜底（赛前 30 分钟锁阵容后不可改）。开启后，离线或未观赛的联赛/杯赛会在关键节点自动按局势触发最稳妥的情绪喊话。', {
    enabled: z.boolean().describe('true 开启自动喊话，false 关闭'),
  }, (args) => action('set_auto_shout', args))

  register('match_shout', '场边情绪喊话', 'FM27 8 种场边情绪喊话（全模式可用：友谊赛/巅峰/传奇/离线联赛，及联机 10 分钟直播第 85 分钟前的联赛与赛季杯赛，联机直播会触发服务器实时重算后半场）。每场最多 6 次、12 分钟冷却、持续 15 分钟、不耗暂停；按性格/比分/评分/黄牌产生正负反馈。', {
    kind: shoutKindSchema.describe('喊话类型：encourage 鼓励 / praise 表扬 / demand_more 要求更多 / fire_up 点燃斗志 / focus 保持专注 / calm_down 冷静下来 / no_pressure 卸下包袱 / berate 严厉斥责'),
    targetPlayerId: z.string().min(1).nullable().optional().describe('可选单人点名目标（球员 ID 或 onPitch[].id）；省略或 null 为全队喊话'),
  }, (args) => action('match_shout', args))

  register('set_match_tactics', '比赛中调整战术', '比赛中可选择全体进攻、均衡或全体防守；赛前仍可设置完整战术。', {
    mentality: z.enum(['attack', 'balanced', 'defend']).describe('attack=全体进攻，balanced=均衡，defend=全体防守'),
  }, (args) => action('set_match_tactics', args))

  register('substitute', '比赛中换人', '在比赛进行中换人；被换下球员不能再次上场，自动和手动换人共用最多 5 次。', {
    outId: z.string().describe('场上球员 ID，来自 get_match 的 onPitch'),
    inId: z.string().describe('可用替补 ID，来自 get_match 的 availableBench'),
  }, (args) => action('substitute', args))

  register('coach_pause', '教练暂停', '适用于友谊赛、巅峰之路与传奇挑战：使用一次教练暂停（最多 3 次）。联赛不停表，可以直接调整战术或换人。', {}, () => action('coach_pause'))

  register('play_match', '结束挑战赛 / 友谊赛', '将已开始的友谊赛、巅峰之路或传奇挑战模拟至终场并结算；联赛不能跳过。返回比分、球员数据与复盘建议。', {}, () => action('play_match'))

  register('simulate_round', '模拟本轮 AI 比赛', '只模拟本轮其他 AI 球队的比赛；玩家本轮比赛未完成时会报错。', {}, () => action('simulate_round'))

  register('get_docs', '读取 Agent 规则', '读取完整 Agent API 文档与推荐流程。', {}, () => callText(config, '/api/agent/docs'))

  server.registerResource('agent-api', 'fm://agent-api.md', {
    mimeType: 'text/markdown',
    description: 'FM 世界（11 人制足球经理）Agent API：令牌、HTTP 动作、训练/阵容/比赛流程与 MCP 配置。',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: readFileSync(new URL('../docs/agent-api.md', import.meta.url), 'utf8'), mimeType: 'text/markdown' }],
  }))

  return server
}
