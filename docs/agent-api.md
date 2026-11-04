# FM Agent API

七人制足球经理的 Agent 接入协议。Agent 使用**永久 Agent 令牌**，不需要玩家的账号密码。

## 1. 获取令牌

玩家在游戏右上角「登录 / 注册」→ 已登录状态 →「复制给 AI」生成 `fm_...` 令牌。令牌只保存在服务器账号中，重新生成会使旧令牌立即失效。

所有 Agent 请求都带：

```http
Authorization: Bearer fm_...
```

Agent 令牌只能访问 `/api/agent/*`；不能读取账号资料、不能修改服务器存档版本、不能撤销令牌。玩家会话令牌也不能访问 Agent 接口。

## 2. HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/agent/state` | 当前游戏状态：阵容、球员、训练、赛程、积分榜、进行中比赛 |
| POST | `/api/agent/action` | 执行一个游戏动作，见第 3 节 |
| GET | `/api/agent/docs` | 本文件 |

`/api/agent/action` 请求体统一为 `{ "action": "...", ...参数 }`。成功返回 `{ ok: true, revision, result, game }`；失败返回 HTTP 400、`{ ok: false, error, revision, game }`。`game` 是执行后的最新状态，可直接用于下一步决策。

状态里和手动界面一致地公开：0–1500 原始主属性、位置、CA、技能、性格、训练日志（最近 24 条）、待处理事件及成功率、阵容合法性/位置折损、比赛历史、挑战历史、前 5 轮赛程。**球员的隐藏属性当前值不会返回给 Agent；事件提示或日志可能提及相关成长。**

## 3. 动作

### 球员与阵容

- `get_player` — 查看球员详情，含培养历史；隐藏属性不返回。
  - `playerId`

- `auto_lineup` — 自动按阵型选人。
  - `formationId?`: `"1-2-3-1" | "1-3-2-1" | "1-2-2-2"`
- `set_lineup` — 提交完整阵容。
  ```json
  {
    "action": "set_lineup",
    "lineup": {
      "formationId": "1-2-3-1",
      "starters": [{ "slotId": "gk", "playerId": "...", "role": "gk_line" }],
      "bench": ["playerId1", "playerId2", "playerId3"],
      "tactics": { "attack": "balanced", "passing": "mixed", "tempo": "normal", "line": "mid", "press": "mid" }
    }
  }
  ```
  `slotId` 与可选职责见 `state.formations`、`state.roles`。首发必须 7 人、1 名门将、替补最多 3 人。也可在顶层同时传 `autoSubs`，以便一次保存新阵容和匹配的新换人计划。已有定时计划若与新阵容冲突，须修改或清除计划后才能保存。

- `set_auto_subs` — 设置下一场比赛使用的自动换人计划，例如：
  ```json
  {
    "action": "set_auto_subs",
    "plan": {
      "timed": [{ "atMinute": 30, "outId": "首发球员ID", "inId": "替补球员ID" }],
      "staminaBelow": 35,
      "onInjury": true
    }
  }
  ```
  `timed` 最多 3 条，`atMinute` 为比赛显示分钟（大于 0、小于 90），指定的首发和替补须属于当前阵容且位置兼容，不能重复使用同一人。旧存档的 `atSeconds` 仍按旧 10 分钟比赛尺度兼容读取，新调用请使用 `atMinute`。到时后在下一个比赛事件边界执行；在此之前被换下或替补已不可用则该计划失效。`staminaBelow` 为 1–99 的百分比，严格低于时启用，`null` 为关闭。伤病和体力规则面向全队，自动挑选能胜任该位置、没有受伤的可用替补；定时换人也不会换上伤员。体力换人只选择体力不低于阈值的替补，避免刚换上又立即换下；没有合适替补则不换。按伤病、定时、体力顺序处理，自动与手动共用 3 次。设置仅影响下一场，`state.autoSubs` 是下场计划、`activeMatch.autoSubs` 是本场剩余计划。旧档默认关闭。

### 培养

- `start_next_season` — 赛季结束后开始下一赛季；`state.season.index` 表示赛季编号。
- `start_training` — 开始一轮 30 时段培养，消耗 30 精力，不消耗金币；成长逐轮累积。无 `scheduleVersion` 的旧 18/30 次课程保留旧规则。
  - `playerId`
- `preview_training` — 预览下一次行动，不写入存档；与执行使用同一套规则。
  - `playerId`
  - `request`: 同 `training_action`
- `training_action` — 执行一次训练行动。
  - `playerId`
  - 新日历 `request`: `{ "kind": "activity", "activityId": "选项ID", "teammateIds": ["球员ID"], "position": "CM", "mentorId": "球员ID", "skill": "技能ID" }`；除 `kind` 和 `activityId` 外均可省略，参数按选项要求填写，队友仅用于允许组队的活动。
  - 旧课程 `request`: `{ "kind": "drill", "attr": "passing" }`、`{ "kind": "combo", "focus": "attack" | "defense" }`、`{ "kind": "position", "position": "GK" | "CB" | "W" | "CM" | "ST" }`、`{ "kind": "match" }`、`{ "kind": "rest" }` 或 `{ "kind": "mentor" }`
- `training_event_choice` — 处理训练事件。
  - `playerId`
  - `optionId`: 来自 `state.trainingSessions[].pendingEvent.options[].id`
- `confirm_training` — 用培养成品替换当前球员。
  - `playerId`
- `discard_training` — 放弃成品，保留旧球员。
  - `playerId`

新课程的 `state.trainingSessions[]` 提供 `date`（下一时段的 week、day、dayLabel、slot）、`options`（id、label、desc、stamina、group 和可选 parameters）、`lowMoodWeeks` 和 `exchangeMatches`。15 天每周 7 天、每天两个时段；周一上午强制 AI 交流赛，周五上午强制队内赛、下午强制恢复，其余时段从每日随机选项（含休息）中选择。交流赛使用当前已确认的首发、替补及属性，不使用尚未确认的候选；仅在执行时模拟产生结果，不改变联赛体能、伤病或赛程，也不受赛季伤病限制。组队行动共享比分，单独培养各自模拟。失利使参与该行动的球员下周一至周三正向属性成长减少 50%，包括设施、队友和事件成长；事件提示为基础值。固定比赛消耗至多 25 训练体力，不足时耗尽剩余体力而不中断课程。

旧课程训练请求：`{ "kind": "protection", "focus": "prevention" | "resilience" }` 用于伤病防护；`{ "kind": "inherit", "mentorId": "球员ID", "skill": "技能ID" }` 用于导师技能传承。导师须在当前 `roster`，可从球员的 `skills` 和 `skillTiers` 查看可用技能及等级；具体资格以预览和执行规则为准。预览不修改培养状态。

新课程中 `group: true` 的选项及旧课程的 `drill`、`combo`、`match` 可附加 `teammateIds: string[]`，选择同版本、同日程种子及同一行动次数的进行中培养队友同步训练；队友不可有待处理事件，所有参与者必须符合规则。无效 ID、重复或不符合条件的组会返回错误，不会静默忽略。预览使用相同的组验证，错误通过 `error` 返回；成功的 `plan.quality`（若有）包含 `label` 和 `multiplier`，收益仅展示可见主属性。执行后可通过各参与者的状态查看事件和进度。

事件提示按课程基础倍率换算，不包含设施或低落情绪影响。属性训练每名参与者独立确定品质：一般 50% ×0.7、成功 30% ×1、大成功 15% ×1.3、完美成功 5% ×1.6；结果是确定性的。每位其他队友提供每项原始主属性 +2，隐藏属性按比例缩放，设施加成另计。旧行动的 `drill`、`combo`、`match` 分别消耗 12、16、25 点课程体力；新课程每个选项公布消耗，固定比赛最多消耗 25，恢复加 30。课程体力与开始课程消耗的球员精力不同：`stamina = 100 - fatigue`。

行动次数、实际 `actionsTotal`、`stamina`、疲劳、待处理事件都在 `state.trainingSessions` 中。事件未处理时不能继续训练。`facilityLevels` 是开始课程时的设施快照；旧课程若没有快照则没有建筑加成。升级从下一次培养生效。主属性及其收益返回原始数值，主属性范围 0–1500，但每名球员每项属性都有自己的上限（存档在 `player.ceilings`），培养到该项上限即停，不再统一到 1500；这改变了 API 的数值语义，调用方须调整。隐藏属性当前值不公开，范围为 0–20；比赛和 CA 仍使用内部 0–100 评分。事件选项提示列出未含设施加成的基础成长，实际成长还受上限影响。球场对所有属性提供额外成长，医疗对身体、青训对技术、商店对决断/团队合作/镇定、赞助商对视野/预判/无球跑动/防守站位提供额外成长。每次行动或事件仅对基础成长为正的属性加成：球场每级 +2，对应设施每级 +5。例如医疗 3 级为每项符合条件的身体主属性额外 +15，球场另计；其他设施同理。隐藏属性加成按 20/1500 缩放。休息、位置训练及无成长不加成；上限截断成长但不降低现有属性。已有快照的课程下一行动使用新规则。

### 经济与市场

`state.economy` 提供余额、设施等级及升级费用；`state.market.freeAgents` 和 `state.market.listings` 提供价格及经过可见字段过滤的球员信息。市场是**本地 NPC 市场，不是跨账号交易**；赛季结束后不能新挂牌。玩家联赛获胜在本轮额外获得 10,000，友谊赛没有胜场奖金。

- `upgrade_facility` — `facilityId`: `stadium`、`academy`、`medical`、`shop` 或 `sponsor`。
- `buy_free_agent` — `playerId`：从自由球员列表按所示价格签约。
- `list_player` — `playerId`、`price`：正的安全整数价格；挂牌受阵容、训练和比赛规则限制。
- `cancel_listing` — `playerId`：取消挂牌并将球员放回阵容。

### 比赛

- `start_league` — 开始本轮联赛，创建 `activeMatch`。比赛显示为完整 90 分钟，联赛现实推进固定约 600 秒（约 10 分钟），逻辑时钟用于动作与体力计算；Agent 离线也不会暂停。
- `get_match` — 不传 `matchId` 读取当前比赛（比分、90 分钟显示时钟、统计、场上球员、替补、战术、最近事件和截至当前的 `commentary`）；传 `matchId` 读取完整记录和复盘建议。
- `advance_match` — 仅限友谊赛：按步推进（默认 1 步），终场时自动结算。联赛调用会报错。
  - `steps?`
- `set_match_tactics` — 比赛中选择战术心态：`{ "action": "set_match_tactics", "mentality": "attack" }`（全体进攻）、`"balanced"`（均衡）或 `"defend"`（全体防守）。赛中不接受任意五维战术对象；赛前仍可设置完整战术。全体进攻使用直传、快速、高防线、高压；均衡使用均衡方向、混合传球、正常节奏、中防线和中等逼抢；全体防守使用短传、慢节奏、低防线、低压，场上非门将球员的整体站位也会相应前压或后撤。均衡是固定预设，并非恢复自定义的赛前战术。`activeMatch.mentality` 为当前心态，`null` 表示还在使用赛前战术。
- `substitute` — 比赛中手动换人，与自动换人共用 3 次。
  - `outId`、`inId`：`get_match` 返回的带主客前缀的比赛球员 ID。
- `coach_pause` — 仅限友谊赛：使用一次教练暂停，返回当前比赛。联赛不可暂停，可以直接调整战术或换人。
- `start_friendly` — 开始一场友谊赛。
  - `teamId`: 来自 `state.teams[].id`
- `play_match` — 仅限已有进行中的友谊赛：立即模拟至终场并结算。联赛不能跳过。
- `simulate_round` — 只模拟本轮 AI 比赛；玩家比赛未完成时返回错误。

`get_state` / `get_player` 的球员 `injuryUntil` 是预计恢复的 Unix 毫秒时间戳，`null` 表示当前没有伤病；易伤倾向的数值不公开。伤病由比赛对抗产生，基础恢复期为 1–60 个游戏日（大多数为 1–5 日；1 游戏日 = 现实 6 小时），防护技能和医疗设施可缩短新伤病恢复时间，同一人物的所有培养成品共用，联赛、友谊赛和 AI 对局均会应用。`get_match` 的 `injured` 包含赛前未恢复的伤病和本场新伤；带伤上场的有效能力降低 30%，可手动换入伤员或用受伤自动换人尝试将其换下。本场开始时的伤病状态保持到终场。伤病不会影响训练精力、培养行动、培养收益或成品属性。旧比赛记录不会被追溯为伤病。

`commentary` 是按 `seq` 排序的已发生播报，每条含 90 分钟显示时钟、类型、文字、该时刻常规比分，以及（进入点球大战后）`shootoutScore`。多次读取时可用 `seq` 去重。一次 `advance_match` 可能产生多条；比赛结束后从结果的 `record.commentary`，或用 `get_match(matchId)` 获取完整记录。`recentLog` 的射门事件包含 `shotChance`（机会类型、基础射正、保底、上限、距离/角度/压力/封堵），`ratings` 包含最终射正、射正后进球、终结和门将评分。`goalDetails` 记录常规比赛进球（含机会类型 `chance`）：射门位置 `origin`（主队进攻方向为 x 增大，客队相反）、距离、左右脚或头球、射门方式、比赛情境和入球区域 `target`；入球区域左/右以进攻方为视角，不包含点球大战。

联赛每 3 个游戏日推进一轮。已开始的联赛由服务器持续推进，关闭网页、断开 Agent 或重启服务器不会重置时钟；重启后按实际经过时间补算。轮询 `get_match` 或 `GET /api/agent/state` 观察已发生的播报，终场后从 `matchHistory` 的 `id` 调用 `get_match(matchId)`。到下一轮时才补算此前未开始的比赛；友谊赛保留手动推进与跳过。

## 4. 推荐流程

1. `GET /api/agent/state`。
2. 用 `auto_lineup` 或 `set_lineup` 确定首发和战术，并按需用 `set_auto_subs` 设置下场自动换人；`state.lineupAnalysis` 有合法性和位置折损。
3. 对精力足够的球员 `start_training`，每次先用 `preview_training` 看收益，再 `training_action`；遇到事件用 `training_event_choice`；最后 `confirm_training`。
4. `start_league` 后等待真实时间并轮询 `get_match`；比赛继续时可用 `set_match_tactics` / `substitute`。友谊赛可以使用 `advance_match` 或 `play_match`。
5. 用 `get_match` 看完整记录和复盘。
6. 重复 1–5，直到赛季结束。

## 5. MCP

本仓库自带 stdio MCP 服务 `mcp/index.ts`，工具名与上面的动作一致，另有 `get_state`、`get_player`、`get_docs`。

```bash
FM_AGENT_TOKEN=fm_... FM_SERVER=http://127.0.0.1:8787 npm run mcp
```

Claude Desktop / Cursor 配置示例：

```json
{
  "mcpServers": {
    "fm": {
      "command": "npx",
      "args": ["tsx", "/home/jeb/code/fm/mcp/index.ts"],
      "env": {
        "FM_AGENT_TOKEN": "fm_...",
        "FM_SERVER": "http://127.0.0.1:8787"
      }
    }
  }
}
```
