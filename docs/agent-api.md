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

状态里和手动界面一致地公开：0–1500 原始主属性、位置、CA、年龄、估值 `marketValue`、合同 `contract`（`wage`、`expiresSeason`）、技能、性格、训练日志（最近 24 条）、待处理事件及成功率、自动培养设置 `autoTraining`、阵容合法性/位置折损、比赛历史、挑战历史、历年联赛成绩 `seasonHistory`（级别、名次、战绩、冠军）、前 5 轮赛程、转会窗口 `market.transferWindowOpen`、可谈判的 AI 球员 `market.clubOffers`。全服其他球队和分区用 `get_world` 读取。**球员的隐藏属性当前值不会返回给 Agent；事件提示或日志可能提及相关成长。**

## 3. 动作

### 球员与阵容

- `get_player` — 查看球员详情，含培养历史；隐藏属性不返回。
  - `playerId`

- `auto_lineup` — 自动按阵型选人。
  - `formationId?`: `"4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "5-3-2" | "4-1-4-1" | "3-4-3" | "4-1-2-1-2"`
- `set_lineup` — 提交完整阵容。
  ```json
  {
    "action": "set_lineup",
    "lineup": {
      "formationId": "4-4-2",
      "starters": [{ "slotId": "gk", "playerId": "...", "role": "gk_line" }],
      "bench": ["playerId1", "playerId2", "playerId3"],
      "tactics": { "attack": "balanced", "passing": "mixed", "tempo": "normal", "line": "mid", "press": "mid" }
    }
  }
  ```
  `slotId` 与可选职责见 `state.formations`、`state.roles`。首发必须 11 人（占满阵型的 11 个位置）、1 名门将，替补最多 7 人。边路位置（`W`）同时包括边后卫、边前卫和边锋，站得靠后的是边后卫（默认职责 `w_back`）。也可在顶层同时传 `autoSubs`，以便一次保存新阵容和匹配的新换人计划。已有定时计划若与新阵容冲突，须修改或清除计划后才能保存。

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
  `timed` 最多 5 条，`atMinute` 为比赛显示分钟（大于 0、小于 90），指定的首发和替补须属于当前阵容，不能重复使用同一人。旧存档的 `atSeconds` 仍按旧 10 分钟比赛尺度兼容读取，新调用请使用 `atMinute`。到时后在下一个比赛事件边界执行；在此之前被换下或替补已不可用则该计划失效。`staminaBelow` 为 1–99 的百分比，严格低于时启用，`null` 为关闭。伤病和体力规则面向全队，自动挑选能胜任该位置、没有受伤的可用替补；定时换人也不会换上伤员。体力换人只选择体力不低于阈值的替补，避免刚换上又立即换下；没有合适替补则不换。按伤病、定时、体力顺序处理，自动与手动共用 5 次。设置仅影响下一场，`state.autoSubs` 是下场计划、`activeMatch.autoSubs` 是本场剩余计划。旧档默认关闭。

### 培养

- `start_next_season` — 联机时由服务器全服统一结算；你的赛季结束且全服各队比赛都完成后，才能开始下一赛季。服务器到赛季结束时间也会自动推进，所有账号同步新赛程、升降级与 AI 名册；`state.season.index` 表示赛季编号。
- `start_training` — 开始一轮 30 时段培养，消耗 30 精力（精力每个游戏日恢复 50 点，按经过的时间连续恢复，满 100 为止；不满的球员只恢复一成），不消耗金币；每轮都从原始属性开始，成长不跨轮累积。无 `scheduleVersion` 的旧 18/30 次课程保留旧规则。陪练队友由系统自动选 6 名（按阵型其他位置，中卫、边路、中场、前锋轮流挑，练外场必带 1 名其他门将；整轮固定，下一轮重新随机）：每个时段这 6 人会随机分到当天的各个选项里（含 `rest`，合计 6 人，有的选项可能没有人）：选哪个选项拿哪个选项上的人，训练项目每名队友每项正成长主属性加 N 点（N = 开始这一轮时七座设施里最低的等级，1–5；没有设施快照的旧课程仍是 2），站在恢复上的每人多恢复 4 点训练体力；他们不消耗精力、不生成 session；交流赛/队内赛只有一个选项，6 人全在上面；交流赛用当前保存的 11 人首发，培养中的球员一定上场（不在首发时顶替同位置 CA 最低的人）。`partnerIds` 参数已不再生效。
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

### 球员卡

球员和球员卡是两种东西。球员是人：姓名、年龄、合同、`condition`（比赛体能）、`energy`（训练精力）、伤病和停赛都属于球员，换卡不会改变。球员卡是一轮培养的成果：属性、位置熟练度、性格和技能，生成后不再变化。

一轮培养结束时新卡自动进入库存 `state.cards`，换上之前球员继续用原来的卡；不处理培养结果也可以直接开始下一轮。每轮培养都从原始属性开始，卡和卡之间互不影响。

`state.roster[]` 的 `attrs`、`positions`、`skills`、`personality` 始终是当前装备的卡（或原始属性）的值，另有 `equippedCardId`（`null` 表示原始属性）和 `cardIds`。`state.cards[]` 每张卡有 `id`、`playerId`、`playerName`、`serial`（这名球员的第几张）、`routeId`、`ca`、可见主属性 `attrs`、`positions`、`personality`、`skills`、`skillTiers`、`equipped`、`ownerInSquad`。

- `equip_card` — 给球员换卡，只能装备他自己的卡。比赛进行中不能换。换卡不会让阵容失效，新卡在当前位置熟练度低只是属性折损更多。
  - `playerId`
  - `cardId`: `state.cards[].id`；`null` 表示换回原始属性
- `delete_card` — 从库存删除一张卡；正在装备的卡不能删。
  - `cardId`

球员的 `traitId`、`traitName`、`traitEffect` 是特性及其效果说明。500 名真实球星每人一个专属特性，随机球员用通用特性；特性属于球员本人，不随球员卡变化。

球员离队后他的卡仍留在库存（`ownerInSquad: false`），不能装备；他回队后可以继续使用。他离队时带走的是当时装备的那套属性。估值只看他的原始属性（球员卡不影响身价），挂牌上限、`state.market.freeAgents[].price` 和买回价都用这个数。

任何球员都能被安排到任何位置，`set_lineup`、`set_auto_subs` 的定时规则和 `substitute` 都不受位置限制；没学过的位置熟练度为 0，属性按 60% 发挥，`state.lineupAnalysis.validation.warnings` 会提示。外场球员没有门将属性，踢门将几乎扑不到球。受伤和体力自动换人只选学过该位置的替补。

新课程的 `state.trainingSessions[]` 提供 `date`（下一时段的 week、day、dayLabel、slot）、`options`（id、label、desc、stamina、group 和可选 parameters）、`lowMoodWeeks` 和 `exchangeMatches`。15 天每周 7 天、每天两个时段；周一上午强制 AI 交流赛，周五上午强制队内赛、下午强制休整（选项 id 仍是 `rest`，但不恢复体力），其余时段从每日随机选项（含休息）中选择。交流赛和队内赛不消耗训练体力。交流赛使用当前的首发、替补及已装备的属性，不使用培养中的成果；仅在执行时模拟产生结果，不改变联赛体能、伤病或赛程，也不受赛季伤病限制。组队行动共享比分，单独培养各自模拟。失利使参与该行动的球员下周一至周三正向属性成长减少 50%，包括设施、队友和事件成长；事件提示为基础值。固定比赛消耗至多 25 训练体力，不足时耗尽剩余体力而不中断课程。

旧课程训练请求：`{ "kind": "protection", "focus": "prevention" | "resilience" }` 用于伤病防护；`{ "kind": "inherit", "mentorId": "球员ID", "skill": "技能ID" }` 用于导师技能传承。导师须在当前 `roster`，可从球员的 `skills` 和 `skillTiers` 查看可用技能及等级；具体资格以预览和执行规则为准。预览不修改培养状态。

新课程中 `group: true` 的选项及旧课程的 `drill`、`combo`、`match` 可附加 `teammateIds: string[]`，选择同版本、同日程种子及同一行动次数的进行中培养队友同步训练；队友不可有待处理事件，所有参与者必须符合规则。无效 ID、重复或不符合条件的组会返回错误，不会静默忽略。预览使用相同的组验证，错误通过 `error` 返回；成功的 `plan.quality`（若有）包含 `label` 和 `multiplier`，收益仅展示可见主属性。执行后可通过各参与者的状态查看事件和进度。

事件提示按课程基础倍率换算，不包含设施或低落情绪影响。属性训练每名参与者独立确定品质：一般 50% ×0.7、成功 30% ×1、大成功 15% ×1.3、完美成功 5% ×1.6；结果是确定性的。每位其他队友提供每项原始主属性 +2，隐藏属性按比例缩放，设施加成另计。旧行动的 `drill`、`combo`、`match` 分别消耗 12、16、25 点课程体力；新课程每个选项公布消耗，固定比赛最多消耗 25，恢复加 30。课程体力与开始课程消耗的球员精力不同：`stamina = 100 - fatigue`。

行动次数、实际 `actionsTotal`、`stamina`、疲劳、待处理事件都在 `state.trainingSessions` 中。事件未处理时不能继续训练。`facilityLevels` 是开始课程时的设施快照，数值是**阶段**（1–25，每个等级 5 个阶段）；旧课程若没有快照则没有建筑加成。升级从下一次培养生效。主属性及其收益返回原始数值，主属性范围 0–1500，但每名球员每项属性都有自己的上限（存档在 `player.ceilings`），培养到该项上限即停，不再统一到 1500；这改变了 API 的数值语义，调用方须调整。隐藏属性当前值不公开，范围为 0–20；比赛和 CA 仍使用内部 0–100 评分。事件选项提示列出未含设施加成的基础成长，实际成长还受上限影响。球场对所有属性提供额外成长，医疗对身体、青训对技术、心理辅导室对决断/团队合作/镇定、战术研究室对视野/预判/无球跑动/防守站位提供额外成长；球迷商店和赞助商只提高每轮余额收入，不再影响培养。每次行动或事件仅对基础成长为正的属性加成，并分两段独立判定：每个等级的第 5 阶段必定触发，等级内其余阶段的概率从该等级的下限线性上升（1 级 20%、2 级 50%、3 级 70%、4 级 80%、5 级 85% 起步，到该级第 5 阶段的 100%）。新球队从 1 级第 1 阶段开始，旧存档按原等级换算成阶段（1 级 = 第 5 阶段）。球场每级 +2，对应设施每级 +5；等级由阶段决定（第 1–5 阶段为 1 级，第 6–10 阶段为 2 级，以此类推）。例如医疗位于第 11 阶段（3 级第 1 阶段）时，有 70% 概率为每项符合条件的身体主属性额外 +15，球场另计；没触发就没有该设施加成。隐藏属性加成按 20/1500 缩放。休息、位置训练及无成长不加成；上限截断成长但不降低现有属性。已有快照的课程下一行动使用新规则。

### 经济与市场

`state.economy` 提供余额、球迷数、设施 `stage`（1–25）、`level`、`stageInLevel`、`growthChance`、`roundIncome` 及 `upgradeCost`；`state.market.freeAgents` 和 `state.market.listings` 提供价格及经过可见字段过滤的球员信息。市场是**本地 NPC 市场，不是跨账号交易**；赛季结束后不能新挂牌。每轮收入 = 1500 + 球迷 × 2 + 各设施收入（按阶段比例并随球迷最多放大 4 倍），另有每球 500 和胜场奖金（1000 + 球迷数 35%）；友谊赛没有收入也没有球迷变化。

- `upgrade_facility` — `facilityId`: `stadium`、`academy`、`medical`、`psychology`、`tactics`、`shop` 或 `sponsor`。
- `pay_wage_arrears` — 无参数：补发全部欠薪。每轮结束发工资时先补以前的欠薪再发本轮的，余额不够的部分记在 `state.economy.wageArrears`。**欠薪期间球员在比赛里所有属性减半（只发挥 50%）**，联机按开球前 30 分钟锁定时的状态算。余额必须够一次还清；下次发薪时余额够也会先自动补发。
- `bid_free_agent` — `playerId`、`amount`：竞拍自由球员。自由市场全服共用，`market.freeAgents[].price` 是这名球员现在至少要出的价。第一个出价开始 **1 小时**倒计时，全服可见；每次跟价至少加 5%；**最后 10 分钟内**有人跟价，倒计时重新回到 10 分钟（离结束还早时跟价不改倒计时）；时间到时最高价者得。跟价要交**手续费**：出价的 2%，至少 1,000，出价成功时立即从余额扣除，**不退还**（开拍的第一口不收）；余额必须够「出价 + 手续费」。领先的出价占用余额。`market.auctions` 列出正在进行的竞拍（当前价、领先球队、剩余秒数），`market.recentDeals` 是最近 8 条成交 / 流拍记录（`club` 为 `null` 表示流拍）。电脑球队也会参与竞拍：同位置明显更强、价格远低于阵容均价或人手不足时才会跟价，出价上限是估值乘所在级别系数，并且永远留着底钱，不会为了抬价乱加。
- `list_player` — `playerId`、`price`：正的安全整数价格，且不得高于球员估值（买家只按估值折价收购；建议价 = 估值 × 0.9，按建议价挂牌必定成交）；挂牌还受阵容、训练和比赛规则限制。
- `cancel_listing` — `playerId`：取消挂牌并将球员放回阵容。
- `preview_signing` — 向 AI 球队买人前预览，不写入存档。可以谈 `state.market.clubOffers` 里的球员（本联赛所有没有教练执教的 AI 球队的全部球员，和转会页「从 AI 球队买人」同一份名单），每人带 `status`（`key` 主力 / `rotation` 轮换 / `fringe` 冷板凳）、`ageBand`、`minutesShare`（最近 20 场出场时间占比）、`requiredPremium` 和俱乐部要价 `asking`（非卖品为 `null`）。

  俱乐部放人规则：年轻主力（24 岁及以下）是非卖品，除非最近出场不到 35%；当打之年（25–28 岁）的主力至少多给 50%，29 岁及以上的主力至少多给 30%；轮换球员要多给 10% + 30% × 出场占比（年轻的再加 10%）；冷板凳（出场不到 15%）多给 5% 就能谈。达到要价后溢价越多越容易点头（冷板凳最容易）。对方阵容只剩 18 人或门将不足 2 人时不放人。出场时间来自最近 20 场联赛记录，不足 5 场时按阵容角色估算。
  - `teamId`、`playerId`
  - `offer?`：报价总额，不填按底价 `asking`（估值 × 1.5）
  - `goal?`：承诺的赛季目标 `title` | `promotion`（默认）| `top-half` | `survival`
  - `role?`：承诺的队内定位 `star` | `first-team`（默认）| `rotation`
  - 返回 `value`、`asking`、`forSale`、`balance`，俱乐部这关 `club`（`status`、`age`、`minutesShare`、`requiredPremium`、`chance`、`reasons`、`blocked`），球员这关的诉求 `demands`（想听的 `goal` / `role`、`wantsClubName` 想去的球队、`minTier` 最低联赛级别）、`playerChance` 和 `reasons`，以及两关相乘的总成功率 `chance`，和手动谈判框显示的一样。
- `sign_club_player` — 按 `preview_signing` 的参数正式报价，转会窗口开放时可用；报价不能低于俱乐部要价。俱乐部和球员两关都过才成交：球员加盟、扣除报价，钱进对方账本（不占对方的买进名额）。失败返回 `error`、`club`（俱乐部的概率和理由）、`chance`、`reasons`。同一份报价 + 同一组承诺的结果固定，换报价或承诺才会重新判定。
- `respond_offer` — `offerId`、`accept`（布尔）：回复 AI 俱乐部给你球员的报价（`state.transferOffers` 里 `status: "pending"` 的）。转会窗口里，本联赛的 AI 俱乐部会按需给你的球员报价（每轮最多来一份，同时最多 3 份待回复）。接受：球员转走、钱立即到账，阵容至少保留 18 人，正在培养的球员要等培养结束。拒绝：普通报价没有影响；**高价报价**（`high: true`，报价不低于身价 1.3 倍）被拒绝或过期，这名球员会**不满** 8 个游戏日，期间精力恢复只剩一成（球员的 `unhappy` 有截止时间和原因）。报价 4 个游戏日（现实 24 小时）内有效，`expiresAt` 之前不回复算拒绝；转会窗口关闭时对方撤回。
- AI 俱乐部每赛季最多**买进** 5 人：竞拍赢下、直接签自由球员、从其他 AI 球队挖人、接受你的报价都算；你从 AI 手里买人、AI 被别人挖走不占名额。联机时 AI 也会按需对自由球员开拍，其他 AI 和玩家照常跟价。
- `renew_contract` — `playerId`：续约 2 年（和俱乐部页一致），工资至少上调到身价工资的 110%；返回新合同。
- `release_player` — `playerId`：解约，球员进入自由市场；阵容至少保留 18 人（一套完整的比赛名单），解约后必须还能组成合法阵容。挂牌出售同样要求至少保留 18 人。

### 比赛

- `start_league` — 仅用于本地单机的手动开赛。联机接口始终拒绝：联赛开球前 30 分钟锁定完整快照，服务器逐场提前计算，到固定开球时间统一公布，不创建可临场操作的新 `activeMatch`。
- `get_match` — 不传 `matchId` 读取当前比赛（比分、90 分钟显示时钟、统计、场上球员、替补、战术、最近事件和截至当前的 `commentary`）；传 `matchId` 读取完整记录和复盘建议。
- `advance_match` — 仅限友谊赛：按步推进（默认 1 步），终场时自动结算。联赛调用会报错。新引擎（`rulesVersion = 4`）一步约等于 1 个模拟秒（整场 900 步）；旧存档里进行中的 v3 比赛一步是一个动作。
  - `steps?`
- `set_match_tactics` — 用于进行中的友谊赛或升级前仍在进行的旧版联赛；新的联机队列比赛不能在锁定后修改。比赛中选择战术心态：`{ "action": "set_match_tactics", "mentality": "attack" }`（全体进攻）、`"balanced"`（均衡）或 `"defend"`（全体防守）。赛中不接受任意五维战术对象；赛前仍可设置完整战术。全体进攻使用直传、快速、高防线、高压；均衡使用均衡方向、混合传球、正常节奏、中防线和中等逼抢；全体防守使用短传、慢节奏、低防线、低压，场上非门将球员的整体站位也会相应前压或后撤。均衡是固定预设，并非恢复自定义的赛前战术。`activeMatch.mentality` 为当前心态，`null` 表示还在使用赛前战术。
- `substitute` — 进行中的友谊赛（以及升级前仍在进行的旧版联赛）手动换人，与自动换人共用 5 次；新的联机队列比赛请在锁定前设置自动换人。
  - `outId`、`inId`：`get_match` 返回的带主客前缀的比赛球员 ID。
- `coach_pause` — 仅限友谊赛：使用一次教练暂停，返回当前比赛。联赛不可暂停。
- `start_friendly` — 和本分区 AI 球队开始一场友谊赛（挑战页）。
  - `teamId`: 来自 `state.teams[].id`
- `start_world_friendly` — 和全服任意一支球队开始友谊赛（世界页「约战」），对手名单由服务器给出，可以约其他教练执教的球队。
  - `clubId`: 来自 `get_world` 的 `clubs[].id`
- `play_match` — 仅限已有进行中的友谊赛：立即模拟至终场并结算。联赛不能跳过。
- `simulate_round` — 本地单机只模拟本轮 AI 比赛；联机接口拒绝调用，全服比赛只由后台队列处理。

`get_state` / `get_player` 的球员 `injuryUntil` 是预计恢复的 Unix 毫秒时间戳，`null` 表示当前没有伤病；易伤倾向的数值不公开。伤病由比赛对抗产生，基础恢复期为 1–60 个游戏日（大多数为 1–5 日；1 游戏日 = 现实 6 小时），防护技能和医疗设施可缩短新伤病恢复时间，伤病属于球员本人，换卡不变，联赛、友谊赛和 AI 对局均会应用。`get_match` 的 `injured` 包含赛前未恢复的伤病和本场新伤；带伤上场的有效能力降低 30%，可手动换入伤员或用受伤自动换人尝试将其换下。本场开始时的伤病状态保持到终场。伤病不会影响训练精力、培养行动、培养收益或球员卡属性。旧比赛记录不会被追溯为伤病。

`commentary` 是按 `seq` 排序的已发生播报，每条含 90 分钟显示时钟、类型、文字、该时刻常规比分，以及（进入点球大战后）`shootoutScore`。多次读取时可用 `seq` 去重。一次 `advance_match` 可能产生多条；比赛结束后从结果的 `record.commentary`，或用 `get_match(matchId)` 获取完整记录。`recentLog` 的射门事件包含 `shotChance`（机会类型、基础射正、保底、上限、距离/角度/压力/封堵），`ratings` 包含最终射正、射正后进球、终结和门将评分。`goalDetails` 记录常规比赛进球（含机会类型 `chance`）：射门位置 `origin`（主队进攻方向为 x 增大，客队相反）、距离、左右脚或头球、射门方式、比赛情境和入球区域 `target`；入球区域左/右以进攻方为视角，不包含点球大战。

联赛每天两轮：北京时间（UTC+8）12:00 和 20:00 开赛，相邻两轮隔 8 小时或 16 小时，一个赛季 38 轮约 19 天，常规赛结束后有 12 个游戏日（现实 3 天）的赛后休整。`state.season.currentFixture` 和赛程里的 `kickoffAt` 是开赛时间（Unix 毫秒）。开球前 30 分钟，服务器持久化双方阵容、职责、战术、自动换人和球员属性/状态快照；低优先级单任务子进程提前计算，结果不外发，到开球时间才全服统一公布。之后的培养、换卡或转会不会改变本场已锁定的输入，也不会被发布时的旧快照覆盖。关闭网页或断开 Agent 不影响队列；重启复用已保存的输入和结果，未完成任务用原快照继续。读取 `GET /api/agent/state` 查看公布后的比分，再从 `matchHistory` 的 `id` 调用 `get_match(matchId)`。双方教练看到的是同一个任务、同一份比分；提前计算期间不会泄露伤病、停赛或出场记录。友谊赛保留手动推进与跳过。

### 全服世界

- `get_world` — 读取全服快照，和世界页 / 球队详情一致：`ownClubId`、`clubs[]`（`id`、`name`、`tier`、`conference`、`managed` 是否有教练执教、`rating` RANK、`players` 公开名单、电脑球队的 `facilities`）以及 `divisions[]`（各分区 `round`、`table`、`fixtures`）。只读。
- `rename_club` — `name`：联机时修改俱乐部名字。最多 8 个字（按字符算），去掉首尾空格；不能和全服任何其他球队重名（AI 球队或其他教练的球队，比较时忽略大小写和空格）；比赛进行中不能改。改名后全服看到的都是新名字。普通存档保存不能修改俱乐部名字。
球队只能在注册时选择，注册完成后不能换队，Agent 也不能例外。注册前可用 `GET /api/registration/clubs` 预览空缺二级球队的公开名单，在 `POST /api/register` 中传入 `clubId` 确认；旧的 `choose_club` 操作与 `/api/world/choose-club` 接口均返回错误。注册只继承球队已经存在的全服战绩及已锁定比赛，不重算历史，不增加注册准备期，正式开球时间始终固定为北京时间 12:00 / 20:00。

## 4. 推荐流程

1. `GET /api/agent/state`。
2. 用 `auto_lineup` 或 `set_lineup` 确定首发和战术，并按需用 `set_auto_subs` 设置下场自动换人；`state.lineupAnalysis` 有合法性和位置折损。
3. 对精力足够的球员 `start_training`，每次先用 `preview_training` 看收益，再 `training_action`；遇到事件用 `training_event_choice`；最后 `confirm_training`。
4. 联机联赛开赛前 30 分钟锁定完整比赛快照，后台提前计算，到开赛时间才统一公布；要在锁定前排好阵容、装备好球员卡并设置 `set_auto_subs`，之后从 `matchHistory` / `get_match` 看结果。单机可以 `start_league` 手动开赛。友谊赛可以使用 `advance_match` 或 `play_match`。
5. 用 `get_match` 看完整记录和复盘。
6. 重复 1–5，直到赛季结束。

## 5. MCP

本仓库自带 stdio MCP 服务 `mcp/index.ts`，工具名与上面的动作一致（含 `get_world`、`preview_signing`、`sign_club_player`、`run_auto_training` 等），另有 `get_state`、`get_docs`。

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
