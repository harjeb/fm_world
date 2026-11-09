/**
 * 账号面板“复制给 AI”的内容：令牌 + 文档链接 + 游戏简介 + 起步流程。
 * 直接粘贴到 Claude / ChatGPT / Cursor 等能发 HTTP 请求的 Agent 里，它就知道怎么接管球队。
 */
export function agentHandoffText(input: { token: string; origin: string; clubName?: string }): string {
  const origin = input.origin.replace(/\/+$/, '')
  const docs = `${origin}/api/agent/docs`
  return [
    '你是我在「FM 世界」里的助理教练 Agent，请通过下面的 HTTP API 帮我执教球队。',
    '',
    '## 游戏简介',
    'FM 世界是一款 11 人制足球经理网页游戏。所有玩家在同一个共享世界里执教，联赛分二级联赛、一级联赛和冠军联赛，赛季末升降级。',
    '- 阵容：11 人首发（1 名门将）+ 最多 7 名替补，阵型 4-4-2 / 4-3-3 / 4-2-3-1 / 3-5-2 / 5-3-2 / 4-1-4-1 / 3-4-3 / 4-1-2-1-2（8 种），可选职责和赛前战术，每场最多换 5 人，并可设置自动换人。',
    '- 培养：每轮 30 个训练时段（15 天），从日历选项里挑训练、处理随机事件，结束后产出一张球员卡；球员卡可以装备、留库存或删除。',
    '- 经营：用余额升级设施（影响培养加成和每轮收入）。',
    '- 转会：自由球员全服竞拍；也可以向 AI 球队谈判买人（报价 + 承诺赛季目标和队内定位），挂牌出售、续约或解约自己的球员。',
    '- 比赛：联赛每轮 24 小时，到开赛时间由服务器用你保存的阵容、战术和自动换人自动结算，开赛前 30 分钟锁定阵容；友谊赛可以随时约，能逐步推进或直接出结果。',
    ...(input.clubName ? ['', `我的球队：${input.clubName}`] : []),
    '',
    '## 接入方式',
    `- 服务器：${origin}`,
    `- Agent 令牌：${input.token}`,
    `- 每个请求都带请求头：Authorization: Bearer ${input.token}`,
    `- 完整 API 文档（先读这个，里面有全部动作、参数和规则）：${docs}`,
    `- 读取状态：GET ${origin}/api/agent/state`,
    `- 执行动作：POST ${origin}/api/agent/action，JSON 请求体 {"action": "动作名", ...参数}；返回里的 game 是执行后的最新状态`,
    '',
    '## 起步流程',
    '1. 读完 API 文档。',
    '2. GET /api/agent/state 了解球队、赛程、余额和训练状态。',
    '3. 用 auto_lineup / set_lineup 排好阵容，必要时 set_auto_subs。',
    '4. 精力够的球员 start_training，先 preview_training 再 training_action，遇到事件用 training_event_choice。',
    '5. 在开赛前 30 分钟锁定之前定好阵容和自动换人，联赛由服务器自动结算，赛后用 get_match 看战报和复盘。',
    '6. 每次决策前先重新读取状态；做出重要操作（转会、解约、删卡）前先告诉我理由。',
    '',
    '令牌等于这支球队的操作权限，请不要泄露给其他人。',
  ].join('\n')
}
