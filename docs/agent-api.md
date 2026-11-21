# FM Agent API

FM 世界（11 人制足球经理）的 Agent 接入协议。Agent 使用**永久 Agent 令牌**，不需要玩家的账号密码。

## 1. 获取令牌

玩家在游戏右上角「登录 / 注册」→ 已登录状态 →「复制给 AI（令牌 + 文档 + 简介）」。复制的是一整段接入说明：`fm_...` 令牌、本文档地址（`/api/agent/docs`，无需鉴权）、游戏简介和起步流程，直接粘贴给能发 HTTP 请求的 Agent 即可。令牌只保存在服务器账号中，「重置令牌」会使旧令牌立即失效。

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

状态里和手动界面一致地公开：0–1500 原始主属性、位置与 `detailedPositions`、CA、年龄与年龄战术/动作曲线 `ageProfile`（不改动面板属性，仅影响个体战术执行度、受压出球、1v1 过人/抢断、终结与门将关键球扑救、吃牌控制及低体力稳定性；门将曲线延后 3 岁）、估值 `marketValue`、合同 `contract`（`wage`、`expiresSeason`）、技能、性格、训练日志（最近 24 条）、待处理事件及成功率、自动培养设置 `autoTraining`、共享培养点 `trainingPoints` 与档位 `trainingPointTiers`、阵容合法性/位置折损/年龄结构建议 `lineupAnalysis.ageSummary`、比赛历史、挑战历史、历年联赛成绩 `seasonHistory`（级别、名次、战绩、冠军）、前 5 轮赛程、转会窗口 `market.transferWindowOpen`、可谈判的 AI 球员 `market.clubOffers`、球探配置 `scouting` 和报告 `scoutReports`、奖杯与杯赛奖励 `honors`、以及巅峰之路与传奇挑战进度 `pve`（已通关数、今日剩余次数、属性突破卡、50 关奖励状态及传奇战绩）。全服其他球队和分区用 `get_world` 读取，巅峰 100 关与 50 支传奇队完整目录用 `get_pve` 读取。**球员的隐藏属性当前值不会返回给 Agent；事件提示、日志或球探估计可能提及相关成长。**

## 3. 动作

### 球员与阵容

- `get_player` — 查看球员详情，含培养历史；隐藏属性不返回。
  - `playerId`

- `auto_lineup` — 自动按阵型选人。
  - `formationId?`: `"4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "5-3-2" | "4-1-4-1" | "3-4-3" | "4-1-2-1-2"`
- `set_lineup` — 提交完整阵容（支持 11 套战术风格模板、十二项战术指令与 14 套下场比赛计划）。
  ```json
  {
    "action": "set_lineup",
    "lineup": {
      "formationId": "4-4-2",
      "starters": [{ "slotId": "gk", "playerId": "...", "role": "gk_line" }],
      "bench": ["playerId1", "playerId2", "playerId3"],
      "tacticalStyle": "highPress",
      "matchPlan": "allOutWin",
      "tacticalInstructions": {
        "possession": { "focus": "balanced", "passing": "mixed", "tempo": "fast", "width": "normal" },
        "transition": { "onGain": "counter", "onLoss": "counterpress" },
        "defense": { "line": "high", "engagement": "high", "intensity": "high" },
        "advanced": {
          "possession": { "receiving": "mixed", "crossTiming": "balanced" },
          "defense": { "width": "normal" }
        }
      }
    }
  }
  ```
  `slotId` 与可选职责见 `state.formations`、`state.roles`；全部可用战术风格模板（`blank / control / highPress / tikiTaka / verticalTiki / wingPlay / longBall / fluidCounter / directCounter / catenaccio / parkBus`）及展开指令见 `state.tacticalStyles`，全部可用下场比赛计划（`standard / allOutWin / parkTheBus / fastStart / protectLead / lateSiege / counterTrap / highPressBlitz / wingBombard / controlTempo / conserveStamina / underdogGrind / twoGoalCushion / cupHoldout`）见 `state.matchPlans`，当前阵容的战术执行度（0.50–1.00）见 `state.lineupAnalysis.tacticalFamiliarity`。仅传 `tacticalStyle` 时自动展开该风格模板指令；同时传 `tacticalInstructions` 时可逐项微调（`tactics` 五字段会自动同步）；传 `matchPlan`（或传 `"standard"` / `null` 恢复常规部署）时会在赛季联赛与挑战赛中按分钟和比分自动触发阶段变阵并影响联赛赛后体能消耗；可选 `customPositions`（`{ "st": { "x": 0.6, "y": 0.45 } }`，`x/y` 在 `0–1` 之间，传 `null` 恢复默认摆位）；旧调用只传 `tactics` 仍兼容。首发必须 11 人（占满阵型的 11 个位置）、1 名门将，替补最多 7 人。边路位置（`W`）同时包括边后卫、边前卫和边锋，站得靠后的是边后卫（默认职责 `w_back`）。也可在顶层同时传 `autoSubs`，以便一次保存新阵容和匹配的新换人计划。已有定时计划若与新阵容冲突，须修改或清除计划后才能保存。

- `save_lineup_preset` — 保存新阵容预设或覆盖已有阵容预设（已保存预设列表见 `state.lineup.presets`，最多 30 套；每条含 `id`、`name`、`createdAt`、`lineup`）。
  ```json
  { "action": "save_lineup_preset", "name": "联赛主力高位压迫" }
  ```
  ```json
  {
    "action": "save_lineup_preset",
    "presetId": "preset-xxx",
    "name": "可选同时改名",
    "lineup": { "formationId": "4-3-3", "starters": ["..."], "bench": ["..."], "tacticalStyle": "highPress", "matchPlan": "fastStart" }
  }
  ```
  - `presetId?`: 传入已有预设 ID（来自 `state.lineup.presets[].id`）时原地覆盖该预设；此时 `name` 可选（传入则同时改名并校验重名，省略则沿用原名）。
  - `name?`: 预设名称（1–20 字，去首尾空格，同一存档内不区分大小写判重）；未传 `presetId` 时必填。
  - `overwrite?`: 布尔值，默认 `false`。未传 `presetId` 时，若已存在同名预设且 `overwrite: true`，则原地覆盖该同名预设（保留原 `id`）；若不存在同名预设则新建。
  - `lineup?`: 可选完整阵容对象（格式与 `set_lineup.lineup` 一致）。省略时保存当前生效的 `state.lineup`；传入时只校验该 `lineup` 并写入预设，**不改动当前生效阵容**（因此开赛前 30 分钟锁阵期间也可保存/覆盖预设）。
  - 返回 `result`: `{ preset, overwritten, presets }`。

- `apply_lineup_preset` — 将指定预设应用为当前阵容（开赛前 30 分钟锁阵期间不可用）。
  - `presetId`: 来自 `state.lineup.presets[].id`。
  - `autoSubs?`: 可选同时提交匹配的自动换人计划；若省略且原自动换人规则与预设阵容冲突，会与手动界面一致自动清空冲突规则并在 `result.clearedAutoSubs` 返回 `true`。
  - 返回 `result`: `{ preset, lineup, autoSubs, clearedAutoSubs }`。

- `rename_lineup_preset` — 重命名已有阵容预设（不改动当前生效阵容）。
  - `presetId`: 来自 `state.lineup.presets[].id`。
  - `name`: 新名称（1–20 字，不可与其他预设重名）。
  - 返回 `result`: `{ preset, presets }`。

- `delete_lineup_preset` — 删除已有阵容预设（不改动当前生效阵容）。
  - `presetId`: 来自 `state.lineup.presets[].id`。
  - 返回 `result`: `{ deleted: true, presetId, presets }`。

- `set_auto_subs` — 设置下一场比赛使用的自动换人计划，支持全局体力筛选位置、最早分钟、替补挑选策略及按位置/槽位/球员/比分触发的条件换人，例如：
  ```json
  {
    "action": "set_auto_subs",
    "plan": {
      "timed": [{ "atMinute": 30, "outId": "首发球员ID", "inId": "替补球员ID" }],
      "staminaBelow": 60,
      "preMatchStaminaBelow": 75,
      "staminaPositions": ["W", "CM", "ST"],
      "staminaMinMinute": 55,
      "preferBy": "proficiency",
      "conditionRules": [
        {
          "targetKind": "position",
          "targetValue": "ST",
          "staminaBelow": 70,
          "minMinute": 60,
          "scoreState": "trailing"
        }
      ],
      "onInjury": true
    }
  }
  ```
  `timed` 最多 5 条，`atMinute` 为比赛显示分钟（大于 0、小于 90），指定的首发和替补须属于当前阵容，不能重复使用同一人。旧存档的 `atSeconds` 仍按旧 10 分钟比赛尺度兼容读取，新调用请使用 `atMinute`。`staminaBelow` 为 1–99 的百分比，严格低于时启用，`null` 为关闭；可选 `staminaPositions`（`GK / CB / W / CM / ST` 子集）限制全局体力换人只替换指定位置（例如不换门将和中卫），可选 `staminaMinMinute`（0–89）限制最早触发分钟，可选 `preferBy`（`"proficiency"` 位置熟练优先 / `"stamina"` 充沛体力优先 / `"ca"` 综合能力优先）。可选 `conditionRules`（最多 5 条）按 `targetKind`（`"any" | "position" | "slot" | "player"`）、`targetValue`、`staminaBelow`、可选 `minMinute`、可选 `scoreState`（`"any" | "leading" | "drawing" | "trailing" | "not_leading"`）以及可选指定替补 `inId` 触发。按伤病、定时、条件规则、全局体力顺序处理，自动与手动共用 5 次。设置作为后续比赛的默认计划，`state.autoSubs` 是默认计划、`activeMatch.autoSubs` 是本场剩余计划。旧档默认关闭。

  可选 `preMatchStaminaBelow`（1–99，`null` 或省略为关闭）独立控制赛前轮换。联机联赛及正式杯赛在开球前 30 分钟锁定时，按预计开球体能替换低于阈值的首发；仅从替补席选择健康、未停赛、该位置熟练且体能不低于阈值的球员。无合适替补则保留原首发。单机联赛在开球时执行；挑战赛满体能，不轮换。赛前轮换不消耗场内 5 次换人额度，只影响本场，不改保存阵容；因此失去适用球员的定时或条件规则本场会跳过，原计划保留。

### 培养

- `start_next_season` — 联机时由服务器全服统一结算；你的赛季结束且全服各队比赛都完成后，才能开始下一赛季。服务器到赛季结束时间也会自动推进，所有账号同步新赛程、升降级与 AI 名册；`state.season.index` 表示赛季编号。
- `set_training_books` — 保存指定球员的技能书配置；`playerId`，`bookKeys` 为最多 4 个 `state.legendBooks[].key`（例如 `lg_drill_master:rainbow`），传空数组清空。位置不符、原始技能已掌握、同一技能重复选不同档位或库存不存在会被拒绝；技能槽满时可配置，成功学习时需替换同类技能。
- `buy_shop_book` — 消耗商店点数（100 点/本）兑换当季商店上架的金技能书；参数 `{ skillId }`，来自 `state.shop.catalog[].id`（每赛季全服统一轮换 8 外场 + 2 门将 + 2 辅助共 12 本非传奇金书，永久入库不消耗；已有同技能金/彩书不可重复买）。商店点数来自赛季结束排名结算（按联赛级别与排名发放，二级上游约 4 本、顶级上游可全换 10 本）以及巅峰之路每关首通额外点数（1–100 关共 3660 点，历史已通关自动补发）。
- `start_training` — 开始一轮 30 时段培养，消耗 30 精力（精力每个游戏日恢复 50 点，按经过的时间连续恢复，满 100 为止；不满的球员只恢复一成），不消耗金币；每轮都从原始属性开始，成长不跨轮累积。可投入共享培养点 `points`（0 / 10 / 20 / 30）提高品质概率，开始时立即扣除；`state.trainingPoints` 为余额，`trainingSessions[].qualityBonusPoints` 和 `qualityChances` 显示本轮投入与当前概率。无 `scheduleVersion` 的旧 18/30 次课程保留旧规则。陪练队友由系统自动选 6 名（按阵型其他位置，中卫、边路、中场、前锋轮流挑，练外场必带 1 名其他门将；整轮固定，下一轮重新随机）：每个时段这 6 人会随机分到当天的各个选项里（含 `rest`，合计 6 人，有的选项可能没有人）：选哪个选项拿哪个选项上的人，训练项目每名队友每项正成长主属性加 N 点（N = 开始这一轮时七座设施里最低的等级，1–5；没有设施快照的旧课程仍是 2），站在恢复上的每人多恢复 4 点训练体力；他们不消耗精力、不生成 session；交流赛/队内赛只有一个选项，6 人全在上面；交流赛用当前保存的 11 人首发，培养中的球员一定上场（不在首发时顶替同位置 CA 最低的人）。`partnerIds` 参数已不再生效。
  - `playerId`
  - `bookKeys?`: 可选，指定并保存本轮配置；省略则使用该球员已保存的配置。配置在 `state.trainingBooksByPlayer`，本轮快照在 `state.trainingSessions[].books`。
  - `points?`: 0 / 10 / 20 / 30，默认 0；必须是 `state.trainingPointTiers[].points` 之一且余额足够。

  **只有培养中的交流赛后**：技能书、本轮随机最多 5 名共同培养队友、该位置的基础技能按 50:30:20 的来源权重逐项抽取，去重后最多 3 选 1；某类没有候选时剩余权重重新归一化。队友只来自本轮陪练或本次共同训练球员，玩家不选导师；`skillTeacherIds` 显示本轮抽中的人，选项中 `source`（`"book" | "teammate" | "basic"`）/ `skillId` / `mentorName` 显示来源与技能。已掌握技能不出现；少于 3 个按实际数量显示。基础技能学习必定成功并获得银档，书看属性，队友看位置、疲劳和导师档位；失败可在下次交流赛重试，书永久保留。满槽选项的 `replaceOptions` 列出可替换同类技能，成功才替换。队内赛、联赛和挑战赛均不触发，普通事件排队处理；技能属于本轮产出的球员卡。
- `preview_training` — 预览下一次行动，不写入存档；与执行使用同一套规则。
  - `playerId`
  - `request`: 同 `training_action`
- `training_action` — 执行一次训练行动。
  - `playerId`
  - 新日历 `request`: `{ "kind": "activity", "activityId": "选项ID", "teammateIds": ["球员ID"], "position": "CM" }`；除 `kind` 和 `activityId` 外均可省略，参数按选项要求填写，队友仅用于允许组队的活动。
  - 旧课程 `request`: `{ "kind": "drill", "attr": "passing" }`、`{ "kind": "combo", "focus": "attack" | "defense" }`、`{ "kind": "position", "position": "DL", "detailed": true }`、`{ "kind": "match" }`、`{ "kind": "rest" }` 或 `{ "kind": "mentor" }`。位置训练支持细分 `GK / DL / DC / DR / WBL / WBR / DM / ML / MC / MR / AML / AMC / AMR / ST`；使用 `detailed: true` 明确训练细分位置（尤其 `ST`），旧 `CB / W / CM / ST` 请求不带该字段仍按原规则处理。新日历的 `activityId: "position"` 同样接受细分位置和 `detailed: true`。球员、培养候选和球员卡的 `detailedPositions` 提供细分熟练度，旧档缺失项回退对应粗位置。
- `training_event_choice` — 处理训练事件。
  - `playerId`
  - `optionId`: 来自 `state.trainingSessions[].pendingEvent.options[].id`
  - `replaceSkill?`: 技能槽满时，从该选项的 `replaceOptions` 选择同类已学技能 ID；失败不会替换。
- `confirm_training` — 把刚练出的新卡装备到球员身上，并收起培养结果。
  - `playerId`
- `keep_training` — 不换卡，新卡留在库存，并收起培养结果。
  - `playerId`
- `discard_training` — 从库存删除刚练出的新卡，并收起培养结果。
  - `playerId`
- `set_auto_training` — 设置这名球员的自动培养策略，和培养页「自动策略」弹窗一致；只改传了的字段，返回新设置。
  - `playerId`
  - `mode?`: `"priority"`（按优先级依次练满）| `"targets"`（把主属性补到目标值）| `"max"`（每次选成长最多的一项）
  - `priority?`: 属性英文名数组；缺少的主属性会自动补在后面
  - `resetPriority?`: `true` 时恢复默认优先级（先练这名球员的 2 个主要属性）
  - `targets?`: `{ "passing": 1200, ... }`，0–1500，和已有目标合并
- `run_auto_training` — 按自动培养策略连续推进**进行中**的一轮（自动挑训练、自动处理事件），直到本轮结束、出错或用完步数；和培养页的「自动培养」开关一样，不会自己开始新一轮。返回每一步的 `kind` / `label`。
  - `playerId`
  - `maxSteps?`: 1–200，默认 60

### 青训

`state.youth` 提供在营名单、当前能力星级 `abilityStars`、潜力星级 `potentialStars`（0–5，支持半星）、培养方向、近期成长记录和本期候选人；不公开精确 CA 或青训上限。星级为固定青训基础能力尺度，不随一线队换卡变化。`roster[].youthOrigin` 是永久青训出身标记。

- `youth_action` — 参数放在 `youth` 对象内：
  - `action`: `plan`（培养方向）、`recruit_position`（下期重点招募位置）、`sign`（免费签入）、`call_up`（临时征召）、`return`（返回青训营）、`promote`（正式提拔）、`release`（青训解约）。
  - `playerId`: 除 `recruit_position` 外必填，来自 `state.youth.members` 或候选人。
  - `plan`: `plan` 操作必填，包含 `position` 与 `focus`。
  - `position`: 细分位置 `GK/DL/DC/DR/WBL/WBR/DM/ML/MC/MR/AML/AMC/AMR/ST`；`recruit_position` 在 `youth.position` 传入。
  - `focus`: `balanced/pace/strength/endurance/dribbling/passing/finishing/defending/saves/handling/distribution`；门将与外场位置不能互转，后三项能力方向仅门将可选。

示例：`{"action":"youth_action","youth":{"action":"plan","playerId":"…","plan":{"position":"DM","focus":"passing"}}}`。

初始免费 6 人，容量 8；每现实周提供 5 名固定候选人，可留 2 人，不累计名额。每 24 小时自动成长，离线补算；改方向从下个周期生效。正式比赛按开球顺序每周期最多计入 90 分钟，友谊赛和重复挑战不计。18 岁所在赛季结束停止成长。

临时征召加入一线队、继续青训，但不能制作或装备球员卡；征召与提拔后工资 100 金币/联赛轮。正式提拔不可逆，基础属性定型，开放现有培养卡体系，满一周后可转会。上下放保留体能和伤停；解约不返资源、不补发青年。名单操作遵守比赛中与赛前锁阵限制。

### 球员卡

球员和球员卡是两种东西。球员是人：姓名、年龄、合同、`condition`（比赛体能）、`energy`（训练精力）、伤病和停赛都属于球员，换卡不会改变。球员卡是一轮培养的成果：属性、位置熟练度、性格和技能，生成后不再变化。

一轮培养结束时新卡自动进入库存 `state.cards`，换上之前球员继续用原来的卡；不处理培养结果也可以直接开始下一轮。每轮培养都从原始属性开始，卡和卡之间互不影响。

`state.roster[]` 的 `attrs`、`positions`、`skills`、`personality` 始终是当前装备的卡（或原始属性）的值，另有 `equippedCardId`（`null` 表示原始属性）和 `cardIds`。`state.cards[]` 每张卡有 `id`、`playerId`、`playerName`、`serial`（这名球员的第几张）、`routeId`、`ca`、可见主属性 `attrs`、`positions`、`detailedPositions`、`personality`、`skills`、`skillTiers`、`equipped`、`ownerInSquad`、`recycleLocked` 和 `recyclePoints`（不可回收时为 `null`）。

- `equip_card` — 给球员换卡，只能装备他自己的卡。比赛进行中不能换。换卡不会让阵容失效，新卡在当前位置熟练度低只是属性折损更多。
  - `playerId`
  - `cardId`: `state.cards[].id`；`null` 表示换回原始属性
- `delete_card` — 从库存删除一张卡；正在装备的卡不能删。回收和删除都不返还费用/培养点，区别是回收会增加 `state.trainingPoints`。
  - `cardId`
- `recycle_cards` — 回收未装备、未锁定且不在待处理培养结果中的卡，获得共享培养点（显示 CA 每 100 分 1 点，最低 1 点）。不可逆；已回收的卡不能再被旧存档写回。
  - `cardIds`: 非空且不重复的 `state.cards[].id` 数组
- `lock_card` — 锁定或解锁一张库存卡的回收状态；已装备的卡也可以提前上锁，挂牌出售成交时仍会销毁。
  - `cardId`
  - `locked`: 布尔值

球员的 `traitId`、`traitName`、`traitEffect` 是特性及其效果说明。500 名真实球星每人一个专属特性，随机球员用通用特性；特性属于球员本人，不随球员卡变化。

球员离队后他的卡仍留在库存（`ownerInSquad: false`），不能装备；他回队后可以继续使用。他离队时带走的是当时装备的那套属性。估值只看他的原始属性（球员卡不影响身价），挂牌上限、`state.market.freeAgents[].price` 和买回价都用这个数。

任何球员都能被安排到任何位置，`set_lineup`、`set_auto_subs` 的定时规则和 `substitute` 都不受位置限制；没学过的位置熟练度为 0，属性按 60% 发挥，`state.lineupAnalysis.validation.warnings` 会提示。外场球员没有门将属性，踢门将几乎扑不到球。受伤和体力自动换人只选学过该位置的替补。

新课程的 `state.trainingSessions[]` 提供 `date`（下一时段的 week、day、dayLabel、slot）、`options`（id、label、desc、stamina、group 和可选 parameters）、`lowMoodWeeks` 和 `exchangeMatches`。15 天每周 7 天、每天两个时段；周一上午强制 AI 交流赛，周五上午强制队内赛、下午强制休整（选项 id 仍是 `rest`，但不恢复体力），其余时段从每日随机选项（含休息）中选择。交流赛和队内赛不消耗训练体力。交流赛使用当前的首发、替补及已装备的属性，不使用培养中的成果；仅在执行时模拟产生结果，不改变联赛体能、伤病或赛程，也不受赛季伤病限制。组队行动共享比分，单独培养各自模拟。失利使参与该行动的球员下周一至周三正向属性成长减少 50%，包括设施、队友和事件成长；事件提示为基础值。固定比赛消耗至多 25 训练体力，不足时耗尽剩余体力而不中断课程。

旧课程训练请求：`{ "kind": "protection", "focus": "prevention" | "resilience" }` 用于伤病防护。独立 `inherit` 技能传承课已取消，新旧课程均不能执行；队友技能改为通过交流赛后的技能选择获取。预览不修改培养状态。

新课程中 `group: true` 的选项及旧课程的 `drill`、`combo`、`match` 可附加 `teammateIds: string[]`，选择同版本、同日程种子及同一行动次数的进行中培养队友同步训练；队友不可有待处理事件，所有参与者必须符合规则。无效 ID、重复或不符合条件的组会返回错误，不会静默忽略。预览使用相同的组验证，错误通过 `error` 返回；成功的 `plan.quality`（若有）包含 `label` 和 `multiplier`，收益仅展示可见主属性。执行后可通过各参与者的状态查看事件和进度。

事件提示按课程基础倍率换算，不包含设施或低落情绪影响。属性训练品质按球员与行动确定性判定：失败 ×0、一般 ×0.7、成功 ×1、大成功 ×1.3、完美成功 ×1.6。体力高于 30 时，投入共享培养点 0 / 10 / 20 / 30 点的大成功概率分别为 8% / 12% / 16% / 20%，完美概率分别为 1% / 2% / 3% / 5%；悟性金 / 彩各自对两项概率叠加 5 / 7 个百分点，只挤占普通成功。体力 ≥60 时一般概率为 0，低于 60 时随体力下降线性上升，至体力 0 时封顶 40%；体力 ≤30 时大成功和完美概率为 0，失败概率从体力 30 的 5% 升至体力 0 的 50%，其余为成功。每位其他队友提供每项原始主属性 +2，隐藏属性按比例缩放，设施加成另计。旧行动的 `drill`、`combo`、`match` 分别消耗 12、16、25 点课程体力；新课程每个选项公布消耗，固定比赛最多消耗 25，恢复加 30。课程体力与开始课程消耗的球员精力不同：`stamina = 100 - fatigue`。

行动次数、实际 `actionsTotal`、`stamina`、疲劳、待处理事件都在 `state.trainingSessions` 中。事件未处理时不能继续训练。`facilityLevels` 是开始课程时的设施快照，数值是**阶段**（1–25，每个等级 5 个阶段）；旧课程若没有快照则没有建筑加成。升级从下一次培养生效。主属性及其收益返回原始数值，主属性范围 0–1500，但每名球员每项属性都有自己的上限（存档在 `player.ceilings`），培养到该项上限即停，不再统一到 1500；这改变了 API 的数值语义，调用方须调整。隐藏属性当前值不公开，范围为 0–20；比赛和 CA 仍使用内部 0–100 评分。事件选项提示列出未含设施加成的基础成长，实际成长还受上限影响。球场对所有属性提供额外成长，医疗对身体、青训对技术、心理辅导室对决断/团队合作/镇定、战术研究室对视野/预判/无球跑动/防守站位提供额外成长；球迷商店和赞助商只提高每轮余额收入，不再影响培养。每次行动或事件仅对基础成长为正的属性加成，并分两段独立判定：每个等级的第 5 阶段必定触发，等级内其余阶段的概率从该等级的下限线性上升（1 级 20%、2 级 50%、3 级 70%、4 级 80%、5 级 85% 起步，到该级第 5 阶段的 100%）。新球队从 1 级第 1 阶段开始，旧存档按原等级换算成阶段（1 级 = 第 5 阶段）。球场每级 +2，对应设施每级 +5；等级由阶段决定（第 1–5 阶段为 1 级，第 6–10 阶段为 2 级，以此类推）。例如医疗位于第 11 阶段（3 级第 1 阶段）时，有 70% 概率为每项符合条件的身体主属性额外 +15，球场另计；没触发就没有该设施加成。隐藏属性加成按 20/1500 缩放。休息、位置训练及无成长不加成；上限截断成长但不降低现有属性。已有快照的课程下一行动使用新规则。

### 球探

`state.scouting.levels` 给出 1–5 级球探的费用、耗时游戏日和隐藏属性最大误差；`state.scoutReports` 含进行中和已完成报告。考察其他球队/自由市场球员时立即扣费，到期前不返回位置、估计属性或星级；完成后返回 `estimatedAttrs`、`positions`、`detailedPositions`、`isGk` 和相对本队的 `positionRatings`（明细位置、职责、评分、参照分和 0–5 星）。报告基于估计属性，本队阵容变化会改变星级；每个目标同一时刻只能有一份未完成报告，最多保存 500 份。自由市场目标会暂留市场，删除报告可能提前结束暂留。

- `start_scouting` — 委托球探考察其他球队或自由市场球员。`source`: `club`（考察装备版本）、`transfer`（考察可转会的原始版本）或 `market`；`clubId` 在 club/transfer 时必填。不能考察本队球员。
  - `playerId`
  - `source`
  - `level`: 1–5
  - `clubId?`: `source` 为 club/transfer 时必填，来自 `get_world` 的 `clubs[].id`
- `get_scout_reports` — 读取球探配置和全部可见报告，不写存档。
- `delete_scout_report` — 删除一份已完成的报告，不退费；进行中的报告不能删除。
  - `reportId`

### 经济与市场

`state.economy` 提供余额、球迷数、设施 `stage`（1–25）、`level`、`stageInLevel`、`growthChance`、`roundIncome` 及 `upgradeCost`（球场额外返回 `homeOnly: true` 与 `homeAtmosphereRating`）；`state.market.freeAgents` 和 `state.market.listings` 提供价格及经过可见字段过滤的球员信息。市场是**本地 NPC 市场，不是跨账号交易**；赛季结束后不能新挂牌。每轮收入 = 1500 + 联赛转播分成 + 球迷 × 2 + 各设施收入（按阶段比例并随球迷最多放大 4 倍；其中**球场门票仅联赛主场发放**），另有每球 500 和胜场奖金（1000 + 球迷数 35%）；友谊赛与 PvE 挑战赛不计常规轮次收入或涨粉。联赛与杯赛中，主队按球场阶段在 2D 引擎获得微弱主场氛围加成（LV1 约 +15 至 LV5 满级约 +45 主属性有效值）。

- `upgrade_facility` — `facilityId`: `stadium`、`academy`、`medical`、`psychology`、`tactics`、`shop` 或 `sponsor`。第 2 赛季起同时消耗俱乐部余额与董事会本季独立发放的「设施预算」（设施预算不与转会预算/工资帽互通）。
- `board_choose_ambition` — 选择或切换董事会赛季目标档位。`state.board` 包含 `confidence`（信任度 15–100）、`lastGrade`（上季评级 `S/A/B/C/D`）、`active`（第 2 赛季起激活）、`current`（当季目标、剩余转会/设施预算、有效工资帽、商业帽加成、滑块区间 `sliderBounds` 与 `canSwitchAmbition`）、`pendingChoice`、`offseasonPreview` 与历年 `history`。
  - `ambition`: `"safe"`（稳妥档，预算 0.85× / 工资帽 0.90×）| `"expected"`（基准推荐档，1.00×）| `"ambitious"`（野心档，预算 1.25× / 工资帽 1.12×，奖金更高但失利扣更多信任度）
  - `scope?`: `"offseason"`（休赛期预选下赛季）| `"current"`（开季第 1–3 轮切换本季档位，按差额补退预算与余额）
  - `lock?`: 布尔值，开季第 1–3 轮传 `true` 可提前锁定本季目标
- `board_adjust_budget` — 转会预算 ↔ 每轮基础工资帽双向滑块（严格按 38:1 换算，绝不触碰独立设施预算）：
  - `transferDelta`: 安全整数；正值表示将富余工资帽转为转会预算（下限为初始工资帽 50% 及当前全队工资需求），负值表示将转会预算转为工资帽（不得动用领先竞拍占用资金）。
- `pay_wage_arrears` — 无参数：补发全部欠薪。每轮结束发工资时先补以前的欠薪再发本轮的，余额不够的部分记在 `state.economy.wageArrears`。**欠薪期间球员在比赛里所有属性减半（只发挥 50%）**，联机按开球前 30 分钟锁定时的状态算。余额必须够一次还清；下次发薪时余额够也会先自动补发。
- `bid_free_agent` — `playerId`、`amount`：竞拍自由球员。自由市场全服共用，`market.freeAgents[].price` 是这名球员现在至少要出的价。第一个出价开始 **1 小时**倒计时，全服可见；每次跟价至少加 5%；**最后 10 分钟内**有人跟价，倒计时重新回到 10 分钟（离结束还早时跟价不改倒计时）；时间到时最高价者得。跟价要交**手续费**：出价的 2%，至少 1,000，出价成功时立即从余额扣除，**不退还**（开拍的第一口不收）；余额必须够「出价 + 手续费」。领先的出价占用余额。`market.auctions` 列出正在进行的竞拍（当前价、领先球队、剩余秒数），`market.recentDeals` 是最近 8 条成交 / 流拍记录（`club` 为 `null` 表示流拍）。电脑球队也会参与竞拍：同位置明显更强、价格远低于阵容均价或人手不足时才会跟价，出价上限是估值乘所在级别系数，并且永远留着底钱，不会为了抬价乱加。
- `list_player` — `playerId`、`price`：正的安全整数价格，且不得高于球员估值（买家只按估值折价收购；建议价 = 估值 × 0.9，按建议价挂牌必定成交）；挂牌还受阵容、训练和比赛规则限制。
- `cancel_listing` — `playerId`：取消挂牌并将球员放回阵容。
- `preview_signing` — 向 AI 球队买人前预览，不写入存档。可以谈 `state.market.clubOffers` 里的球员（世界各赛区所有没有教练执教的 AI 球队的球员，和转会页「从 AI 球队买人」同一份名单），每人带 `status`（`key` 主力 / `rotation` 轮换 / `fringe` 冷板凳）、`ageBand`、`minutesShare`（最近 20 场出场时间占比）、`requiredPremium` 和俱乐部要价 `asking`（非卖品为 `null`）。

  俱乐部放人规则：年轻主力（24 岁及以下）是非卖品，除非最近出场不到 35%；当打之年（25–28 岁）的主力至少多给 50%，29 岁及以上的主力至少多给 30%；轮换球员要多给 10% + 30% × 出场占比（年轻的再加 10%）；冷板凳（出场不到 15%）多给 5% 就能谈。达到要价后溢价越多越容易点头（冷板凳最容易）。对方阵容只剩 18 人或门将不足 2 人时不放人。出场时间来自最近 20 场联赛记录，不足 5 场时按阵容角色估算。
  - `teamId`、`playerId`
  - `offer?`：报价总额，不填按底价 `asking`（估值 × 1.5）
  - `goal?`：承诺的赛季目标 `title` | `promotion`（默认）| `top-half` | `survival`
  - `role?`：承诺的队内定位 `star` | `first-team`（默认）| `rotation`
  - 返回 `value`、`asking`、`forSale`、`balance`，俱乐部这关 `club`（`status`、`age`、`minutesShare`、`requiredPremium`、`chance`、`reasons`、`blocked`），球员这关的诉求 `demands`（想听的 `goal` / `role`、`wantsClubName` 想去的球队、`minTier` 最低联赛级别）、`playerChance` 和 `reasons`，以及两关相乘的总成功率 `chance`，和手动谈判框显示的一样。
- `sign_club_player` — 按 `preview_signing` 的参数正式报价，转会窗口开放时可用；报价不能低于俱乐部要价。俱乐部和球员两关都过才成交：球员加盟、扣除报价，钱进对方账本（不占对方的买进名额）。失败返回 `error`、`club`（俱乐部的概率和理由）、`chance`、`reasons`。同一份报价 + 同一组承诺的结果固定，换报价或承诺才会重新判定。
- `respond_offer` — `offerId`、`accept`（布尔）：回复 AI 俱乐部给你球员的报价（`state.transferOffers` 里 `status: "pending"` 的）。本联赛的 AI 俱乐部会按需给你的球员报价（每轮最多来一份，同时最多 3 份待回复）。接受：球员转走、钱立即到账，阵容至少保留 18 人，正在培养的球员要等培养结束。拒绝：普通报价没有影响；**高价报价**（`high: true`，报价不低于身价 1.3 倍）被拒绝或过期，这名球员会**不满** 16 小时，期间精力恢复只剩一成（球员的 `unhappy` 有截止时间和原因）。报价现实 24 小时内有效，`expiresAt` 之前不回复算拒绝。
- AI 俱乐部每赛季最多**买进** 5 人：竞拍赢下、直接签自由球员、从其他 AI 球队挖人、接受你的报价都算；你从 AI 手里买人、AI 被别人挖走不占名额。联机时 AI 也会按需对自由球员开拍，其他 AI 和玩家照常跟价。
- `renew_contract` — `playerId`：续约 2 年（和俱乐部页一致），工资至少上调到身价工资的 110%；返回新合同。
- `release_player` — `playerId`：解约，球员进入自由市场；阵容至少保留 18 人（一套完整的比赛名单），解约后必须还能组成合法阵容。挂牌出售同样要求至少保留 18 人。

### 比赛

- `start_league` — 仅用于本地单机的手动开赛。联机接口始终拒绝：联赛开球前 30 分钟锁定完整快照，服务器逐场提前计算，开球后按现实时间“直播” 10 分钟，比分在开球 10 分钟后才统一公布，不创建可临场操作的新 `activeMatch`。
- `get_match` — 不传 `matchId` 读取当前比赛（比分、90 分钟显示时钟、统计、场上球员、替补、战术、最近事件和截至当前的 `commentary`）；传 `matchId` 读取完整记录和复盘建议。
- `advance_match` — 适用于友谊赛、巅峰之路与传奇挑战：按步推进（默认 1 步），终场时自动结算。联赛调用会报错。新引擎（`rulesVersion = 4`）一步约等于 1 个模拟秒（整场 900 步）；旧存档里进行中的 v3 比赛一步是一个动作。
  - `steps?`
- `set_match_tactics` — 用于进行中的友谊赛 / 巅峰之路 / 传奇挑战或升级前仍在进行的旧版联赛；新的联机队列比赛不能在锁定后修改。比赛中选择战术心态：`{ "action": "set_match_tactics", "mentality": "attack" }`（全体进攻）、`"balanced"`（均衡）或 `"defend"`（全体防守）。赛中不接受任意五维战术对象；赛前仍可设置完整战术。全体进攻使用直传、快速、高防线、高压；均衡使用均衡方向、混合传球、正常节奏、中防线和中等逼抢；全体防守使用短传、慢节奏、低防线、低压，场上非门将球员的整体站位也会相应前压或后撤。均衡是固定预设，并非恢复自定义的赛前战术。`activeMatch.mentality` 为当前心态，`null` 表示还在使用赛前战术。
- `set_match_auto_subs` — 在进行中的比赛里实时更新本场自动换人设置（`plan` 结构同 `set_auto_subs`，校验对象为当前场上球员与可用替补席；可选 `syncDefault: true` 同步更新 `state.autoSubs`）。
- `substitute` — 进行中的友谊赛 / 巅峰之路 / 传奇挑战（以及升级前仍在进行的旧版联赛）手动换人，与自动换人共用 5 次；新的联机队列比赛请在锁定前设置自动换人。
  - `outId`、`inId`：`get_match` 返回的带主客前缀的比赛球员 ID。
- `coach_pause` — 适用于友谊赛、巅峰之路与传奇挑战：使用一次教练暂停，返回当前比赛。联赛不可暂停。
- `start_friendly` — 和本分区 AI 球队开始一场友谊赛（挑战页）。
  - `teamId`: 来自 `state.teams[].id`
- `start_world_friendly` — 和全服任意一支球队开始友谊赛（世界页「约战」），对手名单由服务器给出，可以约其他教练执教的球队。
  - `clubId`: 来自 `get_world` 的 `clubs[].id`
- `play_match` — 适用于已有进行中的友谊赛、巅峰之路或传奇挑战：立即模拟至终场并结算（自动更新巅峰通关、里程碑奖励、突破卡与传奇技能书掉落）。联赛不能跳过。
- `simulate_round` — 本地单机只模拟本轮 AI 比赛；联机接口拒绝调用，全服比赛只由后台队列处理。

### 巅峰之路与传奇挑战（PvE）

`state.pve` 返回巅峰之路摘要（`peak.cleared`、`nextStage`、`totalStages`、`dailyLimit`、`dailyAttempts`、`breakthroughCards`、`reward50Ready`、`reward50`、`currentStageDef`）与传奇挑战摘要（`legends.total`、`beaten`、`records`）。PvE 比赛默认全队满体能开球，不消耗联赛体能、不产生赛后伤停；开赛后可通过 `advance_match` / `set_match_tactics` / `set_match_auto_subs` / `substitute` / `coach_pause` / `play_match` 推进并结算，赛果记入 `challengeHistory`。

- `get_pve` — 只读，不写存档。返回巅峰之路全部 100 关目录（含目标 CA、奖励、巅峰技能书掉落及 50 关全明星奖励候选 `reward50Candidates`）和全部 50 支传奇强队列表（含 `id`、档位、掉落传奇技能书 `dropSkill` 与个人历史战绩）。可选传 `stage`（1–100）或 `legendId` 预览该对手完整 16 人名单。
  - `stage?`
  - `legendId?`
- `start_peak_challenge` — 开启一场巅峰之路比赛（淘汰制，平局自动点球决胜；每日上限 10 次，北京时间 00:00 重置）。仅可挑战已通关关卡或当前下一关（`stage <= cleared + 1`）；首次通关自动发放关卡金币/球迷奖励、属性突破卡及 80–100 关巅峰技能书。
  - `stage?`: 1–100，省略时默认挑战下一未通关关卡（`cleared + 1`）
- `start_legend_challenge` — 与一支历史传奇强队开赛（允许平局；战胜对应强队可概率掉落该队专属传奇技能书）。
  - `legendId`: 来自 `get_pve` 的 `legends.teams[].id`（例如 `"barcelona-2010-11"`）
- `use_peak_breakthrough` — 消耗 1 张巅峰属性突破卡，把指定球员一项主属性的个人上限 +100（不超过 2000 硬上限；如该球员正在培养，同步提升本轮候选上限）。
  - `playerId`
  - `attr`: 该球员的主属性英文名（外场：`passing / shooting / dribbling / tackling / strength / speed / acceleration`；门将：`reflexes / handling / rushing / oneOnOne / passing / composure`）
- `claim_peak_reward` — 通关巅峰之路第 50 关后，从全明星阵容中任选 1 人入队（需阵容未满 30 人且队内无重复模板）。
  - `templateId`: 来自 `get_pve` 的 `peak.reward50Candidates[].templateId`

`get_state` / `get_player` 的球员 `injuryUntil` 是预计恢复的 Unix 毫秒时间戳，`null` 表示当前没有伤病；易伤倾向的数值不公开。伤病由比赛对抗产生，基础恢复期为现实 2–120 小时（大多数为 2–10 小时），防护技能和医疗设施可缩短新伤病恢复时间，伤病属于球员本人，换卡不变，联赛、友谊赛和 AI 对局均会应用。`get_match` 的 `injured` 包含赛前未恢复的伤病和本场新伤；带伤上场的有效能力降低 30%，可手动换入伤员或用受伤自动换人尝试将其换下。本场开始时的伤病状态保持到终场。伤病不会影响训练精力、培养行动、培养收益或球员卡属性。旧比赛记录不会被追溯为伤病。

新比赛的完整战报 `record.playerStats` 额外包含射正 `shotsOnTarget`、预期进球 `xg`、创造机会 `chancesCreated`、机会转化 `chancesConverted`、预期助攻 `xa`、抢断尝试 `tackleAttempts`、扑救 `saves` 和游戏估算的赛后评分 `rating`。旧战报及更新前已开始的比赛可能缺少这些字段；缺省表示未知，不是零。计算口径见 [球员表现统计](player-performance.md)。

`commentary` 是按 `seq` 排序的已发生播报，每条含 90 分钟显示时钟、类型、文字、该时刻常规比分，以及（进入点球大战后）`shootoutScore`。多次读取时可用 `seq` 去重。一次 `advance_match` 可能产生多条；比赛结束后从结果的 `record.commentary`，或用 `get_match(matchId)` 获取完整记录。`recentLog` 的射门事件包含 `shotChance`（机会类型、基础射正、保底、上限、距离/角度/压力/封堵），`ratings` 包含最终射正、射正后进球、终结和门将评分。`goalDetails` 记录常规比赛进球（含机会类型 `chance`）：射门位置 `origin`（主队进攻方向为 x 增大，客队相反）、距离、左右脚或头球、射门方式、比赛情境和入球区域 `target`；入球区域左/右以进攻方为视角，不包含点球大战。

联赛每天固定 6 轮：北京时间（UTC+8）02:00 / 06:00 / 10:00 / 14:00 / 18:00 / 22:00 开赛（每 4 小时一轮），一个赛季 38 轮共 6 天 8 小时，常规赛结束后有 16 小时的赛后休整（整 7 天一赛季）；赛季杯赛在 12:00 / 20:00 黄金档加赛，联赛不顺延。`state.season.currentFixture` 和赛程里的 `kickoffAt` 是开赛时间（Unix 毫秒）。开球前 30 分钟，服务器持久化双方阵容、职责、战术、自动换人和球员属性/状态快照；低优先级单任务子进程提前计算，结果不外发。开球后比赛直播 10 分钟（浏览器拿到开球时的初始引擎状态，按现实时钟回放整场，Agent 看不到画面），开球 10 分钟后比分、积分榜和战报才全服统一公布。之后的培养、换卡或转会不会改变本场已锁定的输入，也不会被发布时的旧快照覆盖。关闭网页或断开 Agent 不影响队列；重启复用已保存的输入和结果，未完成任务用原快照继续。读取 `GET /api/agent/state` 查看公布后的比分，再从 `matchHistory` 的 `id` 调用 `get_match(matchId)`。双方教练看到的是同一个任务、同一份比分；提前计算期间不会泄露伤病、停赛或出场记录。友谊赛保留手动推进与跳过。

**赛季杯赛**：`state.seasonCups` / `get_world.seasonCups` 提供各正式赛季杯赛的已公开签表、小组积分榜、赛程及已公布比赛的射手、助攻和精简个人统计；未来赛果不会提前下发。跨级杯名为「星联杯」；常规 4 项杯赛冠军提供俱乐部主属性上限加成（社区 +100 / 联盟 +150 / 冠军 +200 / 星联 +250），**多项奖杯上限唯一生效、只取最高值不叠加**。常规赛第 38 轮全部结束后，**「升级杯」（`id: "promotion"`）**自动在 16 小时赛后休整期内分轮排期并纳入 `seasonCups`（赛前 30 分钟锁阵、2D 实时直播与复盘，不发放金币，决出 3 支二级球队升入一级联赛，可通过 `promotedIds` 读取已锁定升级球队）。第 2 赛季起新增 16 队「传奇杯」（上赛季冠军联赛最终前 4 + 12 支真实历史最强俱乐部，一俱乐部一支，首发 CA 1300–1600，ID 以 `lcup-` 为前缀，可通过 `GET /api/world/club?id=lcup-...` 查看完整名单）：开季即完成分组，赛程从第 5 轮起一直延续至赛季结束前（决赛于赛季收官阶段压轴举行），采用欧冠赛制——4 组 × 4 队单循环小组赛（3 轮，允许平局，不发参赛金币）+ 各组前 2 名晋级 8 强（1/4 决赛与半决赛主客场两回合按总比分决胜、总比分战平于次回合点球，决赛单场决胜；淘汰赛每轮发放一次参赛金，冠军另获 3,000,000 金币；**首次夺冠不叠加主属性上限，改为发放唯一彩书《传奇之星》（`lg_legend_star:rainbow`）**——培养前带入 4 格书槽之一即全程生效、不占球员实战技能槽，每次常规行动 10% 独立触发彩色事件，从 2 项随机未满上限主属性中二选一直接 +100，每轮最多 3 次）。`state.honors` 返回俱乐部 `trophies`、当前 `cupCeilingBonus`、已领取的 `cupCeilingClaims` 和杯赛金币账本 `seasonCupGoldClaims`。

`state.lineupAnalysis.starters[]` 的 `detailedPosition` 是该战术槽对应的细分位置，`proficiency` 按该细分位置熟练度计算；`state.formations[].slots[]` 也返回 `detailedPosition`。

**联赛技能书掉落**：比赛公布时，服务器为每支真人执教的球队独立判定（AI 球队不参与）：双方所有上场球员每人掉落概率 = 5% × 上场分钟 / 90，命中后从该球员技能中随机一项、按其技能档位（最高封顶金色，彩虹技能掉落为金书，保留球员身上彩技的唯一性）转为技能书放入 `state.legendBooks`；库存已有同档或更高档的同技能书不会再掉，不设每场上限（11 人制满场期望约 1 本）。随机数由比赛种子 + 比赛 ID + 球队决定，可重放、不受刷新影响。`matchHistory[].bookDrops` 列出本场掉落（`playerName`、`side`、`id`、`tier`、`minutes`、`key`、`name`），无掉落时为空数组。基础技能书也可在 `set_training_books` 中配置，门槛为对应单项属性（主属性 银 600 / 金 750 / 彩 900，隐藏属性 银 8 / 金 11 / 彩 14）。

### 全服世界

- `get_world` — 读取全服快照，和世界页 / 球队详情一致：`ownClubId`、`clubs[]`（`id`、`name`、`tier`、`conference`、`managed` 是否有教练执教、`rating` RANK、`players` 公开名单、电脑球队的 `facilities`）以及 `divisions[]`（各分区 `round`、`table`、`fixtures`）。只读。
- `get_chat` — 读取全服聊天记录（最多返回最新的 50 条消息，含发送教练 `username`、所属俱乐部 `clubId` / `clubName`、消息 `text` 与时间戳 `at`）。只读。
- `send_chat` — `text`：在全服聊天频道发送一条消息（单条最多 200 字，自动折叠换行，含发言间隔限制）。
- `rename_club` — `name`：联机时修改俱乐部名字。最多 8 个字（按字符算），去掉首尾空格；不能和全服任何其他球队重名（AI 球队或其他教练的球队，比较时忽略大小写和空格）；比赛进行中不能改。改名后全服看到的都是新名字。普通存档保存不能修改俱乐部名字。
球队只能在注册时选择，注册完成后不能换队，Agent 也不能例外。注册前可用 `GET /api/registration/clubs` 预览可接管的二级球队及连续两个完整赛季无人上线后释放的各级别球队名单，在 `POST /api/register` 中传入 `clubId` 确认；旧的 `choose_club` 操作与 `/api/world/choose-club` 接口均返回错误。注册只继承球队已经存在的全服战绩及已锁定比赛，不重算历史，不增加注册准备期，正式联赛固定在北京时间 02:00 / 06:00 / 10:00 / 14:00 / 18:00 / 22:00 开球。

## 4. 推荐流程

1. `GET /api/agent/state`。
2. 用 `auto_lineup` 或 `set_lineup` 确定首发和战术，并按需用 `set_auto_subs` 设置下场自动换人；`state.lineupAnalysis` 有合法性和位置折损。
3. 对精力足够的球员 `start_training`，每次先用 `preview_training` 看收益，再 `training_action`；遇到事件用 `training_event_choice`；最后 `confirm_training`。
4. 联机联赛开赛前 30 分钟锁定完整比赛快照，后台提前计算，到开赛时间才统一公布；要在锁定前排好阵容、装备好球员卡并设置 `set_auto_subs`，之后从 `matchHistory` / `get_match` 看结果。单机可以 `start_league` 手动开赛。友谊赛、巅峰之路（`start_peak_challenge`）与传奇挑战（`start_legend_challenge`）随时可开，并可用 `advance_match` 或 `play_match` 推进结算。
5. 用 `get_match` 看完整记录和复盘。
6. 重复 1–5，直到赛季结束。

## 5. MCP

本仓库自带 stdio MCP 服务 `mcp/index.ts`，工具名与上面的动作一致（含 `get_world`、`get_pve`、`start_peak_challenge`、`start_legend_challenge`、`use_peak_breakthrough`、`claim_peak_reward`、`preview_signing`、`sign_club_player`、`run_auto_training`、`start_scouting`、`get_scout_reports`、`recycle_cards`、`lock_card`、`get_chat`、`send_chat`、`set_match_auto_subs` 等），另有 `get_state`、`get_docs`。

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
