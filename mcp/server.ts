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

const autoSubsSchema = z.object({
  timed: z.array(z.object({ atMinute: z.number().gt(0).lt(90), outId: z.string(), inId: z.string() })).max(5)
    .describe('指定首发换下和替补换上的比赛分钟数（0-90），达到后在事件边界执行'),
  staminaBelow: z.number().min(1).max(99).nullable().describe('比赛中体力百分比低于此值时换人；null 为关闭'),
  preMatchStaminaBelow: z.number().min(1).max(99).nullable().optional().describe('赛前按预计开球体能轮换低于此值的首发；null 或省略为关闭，不消耗比赛换人次数'),
  onInjury: z.boolean().describe('发生比赛内伤病时自动换人'),
})

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

  register('upgrade_facility', '升级设施', '使用俱乐部余额升级设施。', {
    facilityId: z.enum(['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics']),
  }, (args) => action('upgrade_facility', args))

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

  register('renew_contract', '续约', '给自己的球员续约 2 年，工资按身价上调。', {
    playerId: z.string().min(1),
  }, (args) => action('renew_contract', args))

  register('release_player', '解约', '解约球员，球员进入自由市场；阵容至少保留 18 人（一套完整比赛名单）。', {
    playerId: z.string().min(1),
  }, (args) => action('release_player', args))

  register('auto_lineup', '自动排阵容', '按指定阵型自动选择首发、替补和默认战术。', {
    formationId: z.enum(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2']).optional().describe('不填则沿用当前阵型'),
  }, (args) => action('auto_lineup', args))

  register('set_lineup', '提交阵容', '提交完整首发、替补和战术。首发必须 11 人并占满阵型的位置，替补最多 7 人；任何球员都能踢任何位置，没学过的位置属性按 60% 发挥。', {
    lineup: z.object({
      formationId: z.enum(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2']),
      starters: z.array(z.object({ slotId: z.string(), playerId: z.string(), role: z.string().optional() })).describe('11 名首发；role 可省略，服务器会选该位置默认职责'),
      bench: z.array(z.string()).max(5),
      tactics: tacticsSchema.optional(),
    }),
    autoSubs: autoSubsSchema.optional().describe('可同时提交与新阵容匹配的自动换人计划'),
  }, (args) => action('set_lineup', args))

  register('set_auto_subs', '设置自动换人', '可选赛前低体能轮换，以及比赛内定时、体力和受伤自动换人；场内自动与手动共用 5 次额度。', {
    plan: autoSubsSchema,
  }, (args) => action('set_auto_subs', args))

  register('set_match_auto_subs', '比赛中设置自动换人', '进行中的比赛实时更新本场自动换人计划；可选 syncDefault 同步保存为默认设置。', {
    plan: autoSubsSchema,
    syncDefault: z.boolean().optional(),
  }, (args) => action('set_match_auto_subs', args))

  register('set_training_books', '保存培养技能卡配置', '按球员保存最多 4 本技能书，key 来自 get_state 的 legendBooks。交流赛后从技能书、随机最多 5 名共同培养的队友和基础技能按 50:30:20 权重抽取三选一；已学技能不出现。', {
    playerId: z.string(),
    bookKeys: z.array(z.string()).max(4),
  }, (args) => action('set_training_books', args))

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

  register('start_training', '开始培养', '每轮从原始属性开始，产出球员卡；省略 bookKeys 时使用保存的技能卡配置，传入时同时保存。可投入共享培养点提高品质。', {
    playerId: z.string(),
    bookKeys: z.array(z.string()).max(4).optional(),
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
    targets: z.record(z.string(), z.number().min(0).max(1500)).optional().describe('targets 模式的目标值，如 { "passing": 1200 }'),
  }, (args) => action('set_auto_training', args))

  register('run_auto_training', '自动培养', '按自动培养策略连续推进进行中的一轮培养（自动挑训练、自动处理事件），直到本轮结束或用完 maxSteps。不会自己开始新一轮。', {
    playerId: z.string().min(1),
    maxSteps: z.number().int().min(1).max(200).optional().describe('最多推进几步，默认 60'),
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

  register('get_world', '查看全服世界', '读取全服所有球队（名单、RANK、是否有教练执教、电脑球队设施）以及各分区的积分榜和赛程，和世界页 / 球队详情一致。', {}, () => action('get_world'))

  register('get_chat', '读取全服聊天', '读取最新最多 50 条全服聊天，含教练、俱乐部、文字和时间。', {}, () => action('get_chat'))

  register('send_chat', '发送全服聊天', '发送一条最多 200 字的全服聊天消息，受发言间隔限制。', {
    text: z.string().min(1).max(200),
  }, (args) => action('send_chat', args))

  register('rename_club', '俱乐部改名', '联机时修改俱乐部名字：最多 8 个字，不能和全服已有球队（AI 球队或其他教练的球队）重名；比赛进行中不能改。', {
    name: z.string().min(1).max(8),
  }, (args) => action('rename_club', args))

  register('choose_club', '选择执教球队', '新账号在本赛季还没踢过联赛时，可以换到另一支没人执教的二级联赛球队；会按共享世界重建存档。', {
    clubId: z.string().describe('来自 get_world 的 clubs[].id，tier 为 division2 且 managed 为 false'),
  }, (args) => action('choose_club', args))

  register('get_match', '查看比赛', '不传 matchId 时读取当前进行中比赛的比分、时钟、统计、场上球员、替补、战术和最近事件；传 matchId 时读取完整比赛记录和复盘建议。', {
    matchId: z.string().optional().describe('比赛记录 ID；不填则读取当前比赛'),
  }, (args) => action('get_match', args))

  register('advance_match', '推进友谊赛', '仅限友谊赛：按步推进，默认 1 步；联赛只能等待现实时间。返回当前比赛或终场记录。', {
    steps: z.number().int().min(1).max(20000).optional(),
  }, (args) => action('advance_match', args))

  register('set_match_tactics', '比赛中调整战术', '比赛中可选择全体进攻、均衡或全体防守；赛前仍可设置完整战术。', {
    mentality: z.enum(['attack', 'balanced', 'defend']).describe('attack=全体进攻，balanced=均衡，defend=全体防守'),
  }, (args) => action('set_match_tactics', args))

  register('substitute', '比赛中换人', '在比赛进行中换人；被换下球员不能再次上场，自动和手动换人共用最多 5 次。', {
    outId: z.string().describe('场上球员 ID，来自 get_match 的 onPitch'),
    inId: z.string().describe('可用替补 ID，来自 get_match 的 availableBench'),
  }, (args) => action('substitute', args))

  register('coach_pause', '教练暂停', '仅限友谊赛：使用一次教练暂停（最多 3 次）。联赛不停表，可以直接调整战术或换人。', {}, () => action('coach_pause'))

  register('play_match', '结束友谊赛', '将已开始的友谊赛模拟至终场并结算；联赛不能跳过。返回比分、球员数据与复盘建议。', {}, () => action('play_match'))

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
