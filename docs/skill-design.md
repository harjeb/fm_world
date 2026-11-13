# 属性评分链路与技能设计手册

给「想加技能」的人看的一页纸：先讲引擎到底拿哪些属性算分、怎么算成一个 0–100 的评分、这个评分又怎么变成成功率；再讲现有技能挂在哪些位置、加一个新技能要动哪些文件。

结论先说：**属性只有 22 个，别再新增；新技能 = 现有属性评分 × 一个上下文条件 × 一个小加成。**

---

## 1. 属性总表

属性定义在 `src/game/types.ts`（`FIELD_ATTRIBUTES` / `GK_ATTRIBUTES`），共 22 个：18 个外场 + 4 个门将。

### 1.1 刻度：存档值 ≠ 比赛值

`src/game/scale.ts`：

| 类别 | 存档范围 | 比赛/评分范围 | 换算 |
|---|---|---|---|
| 主属性 | 0–1500 | 0–100 | `value / 15`（`MAIN_ATTR_SCALE`） |
| 隐藏属性 | 0–20 | 0–100 | `value * 5`（`HIDDEN_ATTR_SCALE`） |

「主属性」是按位置浮动的一组，不是固定的：

- 外场（`MAIN_FIELD_ATTRS`）：`passing, shooting, dribbling, tackling, strength, speed, acceleration`
- 门将（`MAIN_GK_ATTRS`）：`reflexes, handling, rushing, oneOnOne, passing, composure`

也就是说，同一个 `composure` 在外场是隐藏属性、在门将身上是主属性；存档刻度不同，`caOf()` 用 `attrRating()` 统一换算后再算 CA。**做技能时只需要关心 0–100 的比赛值。** 外场球员的 4 个门将属性上限记 0（`attrLimit`），别指望外场球员的 `reflexes` 有值。

### 1.2 哪些属性真的参与结算

按「出现在结算代码里的次数」排序（`src/game/match/*.ts` + `ca.ts`）。**`k` 是体力折损系数**（`effectiveAttr` 里的体能敏感度，不是 CA）：

| 属性 | 体力折损 k | 主要用途 |
|---|---|---|
| `composure` | 0.5 | 传球评分、射门精度、射门技术选择、点球大战 |
| `acceleration` | 0.75 | 盘带胜负、争抢二点球、追赶判定 |
| `anticipation` | 0.5 | 拦截线路、争顶、二点球、接球半径、封堵 |
| `speed` | 0.75 | 二点球、追赶半径 |
| `defPos` | 不到 0.5 | 拦截人选、封堵、门将站位、争顶 |
| `heading` | 0.5 | 头球射门、争顶权重 |
| `agility` | 0.75 | 盘带、防守、拦截评分、射门脚法平衡 |
| `strength` | 0.75 | 盘带护球、争顶、射门技术 |
| `firstTouch` | 0.5 | 接球、逆足惩罚、射门脚法平衡 |
| `shooting` | 0.5 | 射门 |
| `tackling` | 0.5 | 抢断、犯规判定 |
| `dribbling` | 0.5 | 过人 |
| `offBall` | 0.5 | 争顶、二点球 |
| `reflexes` | 0.5 | 门将扑救、点球 |
| `oneOnOne` | 0.5 | 单刀/点球门将评分 |
| `rushing` | 0.5 | 出击、门将争顶/二点球 |
| `handling` | 0.5 | 门将争顶/二点球、扑救脱手 |
| `vision` | 0.5 | **决策阶段**：能不能“看见”这条传球线路 |
| `endurance` | **0** | 体力消耗斜率（越高越省体力） |
| `decisions` | 0.5 | **决策阶段**：选择噪声 σ |
| `teamwork` | 0.5 | **决策阶段**：线路识别分（权重 0.1） |

`endurance / decisions / teamwork / vision` 不进对抗评分，而是影响「选什么动作」——想做“球商型”技能就挂在这四个上。

> CA 只跟「有多少条属性、每条多高」有关（`caOf()` 对外场取 18 条、门将取 22 条的平均平方），**每一格属性都算钱**。这就是不要加新属性的直接理由：加一条 = 全库球员 CA 重新标定。

---

## 2. 评分链路：从属性到 0–100 评分

三段，全部在 `src/game/ca.ts` 和 `src/game/match/ratings.ts`：

```
存档属性 ──attrRating()──► 0–100 基础值
         ──effectiveAttr()──► 体能折损 × 位置熟练度
         ──MatchRatings.eff()──► 球星特性 / 光环 / 基础特性 / 受伤
         ──► 这一瞬间的有效评分（1–100）
```

### 2.1 体能折损与位置熟练度

`effectiveAttr()`（`src/game/ca.ts`）：

```
k = endurance ? 0 : (physical ? 0.75 : 0.5)
fatigue  = 1 - k * (1 - 体力比)
position = 0.6 + 0.4 * (熟练度 / 100)      // POSITION_FLOOR = 0.6
评分 = clamp(基础值 * fatigue * position, 1, 100)
```

- **体能**：身体类（加速/速度/敏捷/力量）最多掉 75%，技术类最多掉 50%，`endurance` 自己不掉。
  所以“体力见底时技术还在、身体没了”是引擎的既有设计，技能最好别重复这个方向。
- **位置熟练度**：客串位置最低 ×0.6，满熟练 ×1.0。给技能挂 `position` 条件相当于白送一个 0.6–1.0 的乘数，别叠。

### 2.2 特性与光环

`MatchRatings.eff(player, key, ctx)`：

- 球星特性（`STAR_TRAITS`，`kind: 'attr' | 'hotStreak'`）满足 `when` 条件时加 `bonus / 15` 分；
- 光环（`aura`）/ 威慑（`intimidate`）按步缓存到 `state.teamTraits`，只影响对应属性；
- 20 个基础特性（`TRAITS`）按 `effect` 命中属性，**并且只在 `ctx` 条件成立时生效**；
- 受伤球员整体 ×0.7，最后 `clamp(1, 100)`。

`ctx`（`MatchEventContext`）就是给技能的“上下文词表”：

```
inBox  wide  crossing  aerial  passing  longRange
pressured  ownHalf  finalThird  oneOnOne  penalty
```

**新技能想要条件化，优先复用它，而不是在 `eff()` 里加分支。**

### 2.3 评分 → 概率

对抗类判定基本都是同一个形状（`resolution.ts`）：

```
p = sigmoid( logit(p0) + (a - d + c) / 30 )
```

- `a` = 主动方评分加权和，`d` = 被动方评分加权和，`c` = 距离/压迫/逆足等常数修正；
- **30 分评分差 = 1 个 logit 单位**；
- 灵敏度随基准变化：基准 0.6 时每 +1 分约 +0.80pp，0.72 时约 +0.67pp，0.86 时约 +0.40pp。

所以现有技能给的 `+4 ~ +5 分`，实际就是 **+2 ~ +4 个百分点**。写文案时按这个量级说，别写“大幅提升”。

---

## 3. 每个判定用到的属性

全部出自 `src/game/match/resolution.ts`（旧引擎与新 2D 引擎共用）。

### 3.1 传球（`passModel`）

```
a = 0.70·passing(+crossing) + 0.20·composure + 0.10·接球人 firstTouch(+finalThird)
d = 0.75·拦截者 tackling + 0.25·拦截者 agility + min(12, 次拦截者加成)
c = -max(0, 距离-12)·0.35 + 接球人身旁空间 - 压迫·0.8 - 逆足4 + 传中2 - 直塞2 - 长传2
p0 = 短传0.86 / 长传0.74 / 直塞0.60 / 传中0.64
```

- 拦截者的**预判/站位/敏捷**决定“够不够得着”（`findLineInterceptors`：`0.4·anticipation + 0.3·defPos + 0.3·agility`）。
- 落点偏离、出界、无人区由 `passOdds()` 二次分配，不涉及新属性。
- **可挂点**：`a`（出球质量）、`d`（拦截质量）、`c`（情境修正）、`p0`（基础难度）。

### 3.2 盘带过人（`dribbleModel`）

```
a = 0.40·dribbling + 0.22·agility + 0.18·strength + 0.20·acceleration
d = 0.60·tackling + 0.15·agility + 0.10·strength + 0.15·acceleration
c = -2·压迫 -3·逆足   （防守方是上抢中卫/后腰再 -1）
p0 = 0.72，夹在 0.12–0.95
```

### 3.3 射门（`shotModel` / `shotOdds`）

```
射正：onTarget = 场景 base + clamp((precision-50)·0.002, ±0.1) - 逆足0.02
precision = 0.70·shooting + 0.30·composure      （头球：0.70·heading + 0.30·composure）
进球：goalGiven = 场景 base + (finishScore - gkScore)·0.003
finishScore 头球 = 0.55·heading + 0.25·shooting + 0.20·composure
finishScore 地面 = 0.75·shooting + 0.25·composure
gkScore = 0.65·reflexes + 0.35·defPos          （单刀/点球改成 0.55·oneOnOne + 0.30·reflexes + 0.15·defPos）
封堵：0.45·defPos + 0.35·anticipation + 距离项
```

注意 `finishScore - gkScore` 的系数只有 **0.003**：射门端想靠属性堆出明显收益，比传球端难得多，所以现有射门技能都是直接改 `onTarget / goalGiven` 的百分点（`box_hunter`：+4pp / +3pp 银档），而不是加评分。

### 3.4 争顶与二点球

```
争顶权重（进攻）= 0.45·heading + 0.25·strength + 0.20·anticipation + 0.10·offBall + 身高项
争顶权重（防守）= 0.40·heading + 0.30·strength + 0.20·defPos + 0.10·anticipation
门将参与      = 0.40·rushing + 0.30·handling + 0.20·anticipation + 10
二点球        = 0.35·anticipation + 0.2·(CB?defPos:offBall) + 0.2·strength + 0.07·speed + 0.08·acceleration + 身高项
到达半径      = 4.5 + 0.035·anticipation + 0.01·speed + 0.01·acceleration
```

权重最后会乘 0.85–1.15（争顶）或 0.75–1.25（二点球）的随机扰动，**在权重里加 5 分相当于把胜率抬 2–4 个点**。

### 3.5 点球大战（`shootoutKickOdds`）

```
射门端 = 0.6·shooting + 0.4·composure
门将端 = 0.6·reflexes + 0.4·oneOnOne
p = 0.7 + (射门端-60)/250 - (门将端-55)/400，夹在 0.5–0.9
```

### 3.6 伤病（`injuryOdds` / `recoveryDays`）

```
风险 = (0.012 + 疲劳·0.025) · (0.5 + 伤病倾向/20) · (预防? 0.7 : 1)
恢复 = 档位随机天数 · (韧性? 0.7 : 1)
```

### 3.7 体力（`engine.ts` 移动结算）

```
drain = (移动·0.028 + 0.018) · 压迫强度 · staminaFactor / (0.7 + endurance/180)
```

---

## 4. 原有 15 个基础技能一览

注册表：`src/game/data/skills.ts`（`SKILLS`）。主技能槽 4 个、辅助槽 2 个（`skillCategory` 里只有两个伤病技能算辅助）。

| 技能 | 触发条件 | 挂点与数值（银档） |
|---|---|---|
| 穿线者 `through_ball` | 直塞，且前方有接应跑位 | 传球 `a += 5` |
| 稳健分球 `safe_pass` | 短传且受压 > 2.5 | 传球 `a += 4` |
| 一脚出球 `one_touch` | 刚接球、选传球、8 米内无压迫 | 处理时间 `-1.0 秒` |
| 禁区猎手 `box_hunter` | 禁区内起脚 | `onTarget +0.04`，`goalGiven +0.03` |
| 重炮手 `long_shot` | 禁区外起脚 | `onTarget +0.035`，`goalGiven +0.02` |
| 逆足训练 `weak_foot` | 本步用逆足 | 传球 `c += 3`，盘带 `c += 2`，逆足射门惩罚 `-3`，逆足出脚概率 `+0.12` |
| 扫荡者 `sweeper` | 实际参与拦截/抢断 | 拦截 `d += 4`，防守 `d += 3`，点球大战门将 `+0.015` |
| 铁肺 `iron_lung` | 每次跑动 | `drain ×(1 - 5%)` |
| 空中霸主 `aerial` | 参与争顶 | 争顶权重 `+5` |
| 边路飞翼 `wing_runner` | 边路盘带 | 盘带 `a += 5` |
| 出击门将 `gk_sweeper` | 对方身后球进入可争夺区 | 出击上限 24 → 28.8 → **33.6 米** |
| 门线神扑 `gk_reflexes` | 门将面对射门 | `gkScore += 5`；点球大战同 |
| 点球专家 `penalty_specialist` | 主罚点球 | `onTarget +0.05`，`goalGiven +0.04`；点球大战 `+0.06` |
| 伤病预防 `injury_prevention`（辅助） | 受伤判定 | 风险向“已预防”插值 100% |
| 伤病韧性 `injury_resilience`（辅助） | 受伤后 | 恢复天数向 ×0.7 插值 100% |

档位倍率 `skillTierMultiplier()`（`src/game/match/team.ts`）：**银 1 / 金 1.2 / 彩 1.4**。
例外：`iron_lung` 用 `1 - (0.05 + (mult-1)·0.25)`，所以是 5% / 10% / 15%；`injury_*` 用插值，所以是 30% / 36% / 42%。

---

> **传奇技能书（`lg_*`）**：50 个传奇技能与逐队掉落、门槛、培养书槽、学习事件见 [`legend-challenge.md`](./legend-challenge.md)。它们不是新的属性，也不占独立槽位：学会后占现有 4 个主技能槽，金/彩档倍率为 1 / 1.4。

### 4.1 按位置的基础技能池（每位置 6 项）

同一技能可跨位置共享；每场交流赛后的选项从位置基础技能、技能书、随机最多 5 名实际培养队友三类按 20:50:30 权重抽取。同技能去重，已掌握技能不会出现，基础技能学习必定成功并获得银档。场上效果走新旧引擎共享的 `SettlementKernel`，只在非旧规则路径生效并记录技能统计。

| 位置 | 六项基础技能（★为新增） |
|---|---|
| GK 门将 | 门线神扑、出击门将、★稳健抱球、★高球控制、★单刀封角、★长传发动 |
| CB 中卫 | 扫荡者、空中霸主、稳健分球、★线路预判、★禁区封堵、★补位保护 |
| W 边路 | 边路飞翼、逆足训练、一脚出球、★精准传中、★肋部接应、★边路回追 |
| CM 中场 | 穿线者、稳健分球、一脚出球、铁肺、★长传调度、★高压护球 |
| ST 前锋 | 禁区猎手、重炮手、空中霸主、点球专家、逆足训练、★前插接应 |

新增技能银档数值：稳健抱球 +8 个百分点；高球控制、单刀封角各 +5 评分；长传发动、精准传中、肋部接应、边路回追、长传调度、高压护球、前插接应各 +4 评分；线路预判的线路评分 +4、防守评分 +3；禁区封堵、补位保护各 +5 评分。金/彩按 1.2 / 1.4 倍，具体条件和数值以 `src/game/data/skill-effects.ts` 为准。

## 5. 加一个新技能的清单

按顺序改，缺一步就会「技能存在但不生效」，或者「生效但测试红」。

1. **类型**：`src/game/types.ts` 的 `SkillId` 联合类型加 id（kebab/snake 均可，现有全是 snake）。
2. **注册表**：`src/game/data/skills.ts` 的 `SKILLS` 加 `{ id, name, desc, condition, cost }`。若为辅助类，同步改 `skillCategory()`。
3. **文案数值**：`src/game/data/skill-effects.ts` 的 `SKILL_EFFECTS` 加函数，参数 `m` 是档位倍率（银 1 / 彩 1.4），返回**银档**数值字符串。非倍率型（像铁肺）另加 `skillTierNote` 分支。
   > 这两个文件被 `tests/skill-effects.test.ts` 全量遍历：每个 id × 3 档都必须有数字、不能有浮点尾巴、不能 NaN。没写的技能会直接红。
4. **结算挂点**（二选一，别两边都加）：
   - 对抗类 → `src/game/match/resolution.ts`：`passModel` / `dribbleModel` / `shotModel` / `shootoutKickOdds` / `aerialContestants` / `looseBallContestants` / `injuryOdds` / `recoveryDays`；
   - 行为类 → `src/game/match/engine.ts`：体力消耗、处理时间、跑位目标、决策噪声。
5. **打点统计**：条件成立/不成立都要调 `markSkill(player, id, condition, applied)`，否则赛后「技能触发统计」（`state.skillStats` → 复盘页）永远显示 0 次。参考 `box_hunter` 的 `if / else if` 双分支写法。
6. **获取途径**（至少给一条，否则玩家永远拿不到）：
   - 培养事件：`training.ts` 的 `EventEffect.skill` / `routeSkill`；
   - 球星招牌：`players.ts` 的 `STYLE_SKILL` 映射（挂了就是彩虹档）；
   - 传承：导师有该技能即可被学，档位由 `inheritanceChances()` 掷。
7. **UI**：`skillTag()` / `skillGroups()` / `skillTierLabel()` 会自动读注册表与档位，通常不用改；新增辅助技能要确认 `academy.ts` 的「其余技能」折叠逻辑没漏。
8. **测试**：跑 `npm test`。重点看
   - `tests/skill-effects.test.ts`（文案全量遍历）
   - `tests/skill-tiers.test.ts`（档位 → 倍率）
   - `tests/resolution-kernel.test.ts`（结算内核）
   - `npm run typecheck`

> ⚠️ 兼容红线：`resolution.ts` 同时服务旧引擎，`npm run pes:equiv` 要求同种子逐位一致。如果新技能在**旧规则路径**（`hooks.legacyRules`）里也会触发，就必须放在 `if (!legacyRules)` 分支内，或者给旧路径单独加 `legacyShotModel` 的实现。

---

## 6. 设计守则（踩过的坑）

1. **不要加新属性。** 22 个属性已经覆盖了传球/盘带/射门/争顶/门将/体能/球商六条线；加属性会牵动 CA 计算（`caOf` 按属性条数取平均）、属性上限、训练成长、AI 估价、导入导出，成本远超收益。想要新维度，用「属性 + 上下文条件」表达。
2. **一个技能只改一处。** 同时改 `a` 和 `d`、或者同时改 `onTarget` 和 `goalGiven`，实际收益是叠乘的，容易做出“必进球”技能。现有技能里只有 `box_hunter` / `long_shot` / `penalty_specialist` 双改，因为射门端单改一项收益太小。
3. **条件要能在 `eff` 之外判定。** `passModel` 里的 `type`、`pressure`、`wideZone()`、`inBox()`、`progressOf()` 都是现成的；不要为了一个技能去改 `MatchEventContext`。
4. **数值量级对齐现有技能**：评分类 `+3 ~ +5`，百分点类 `+0.02 ~ +0.05`，时间类 `~1 秒`，体力类 `5%`。超出这个范围先想想是不是该做成档位差异。
5. **别忘了“未触发也要计数”。** 玩家看的是「条件出现过几次 / 生效几次」，只有 `applied` 没有 `conditions`，UI 会显示成一个永远 100% 生效的技能。
6. **门将技能要检查三处**：`shotModel`（阵地射门）、`shootoutKickOdds`（点球大战）、`aerialContestants` / `looseBallContestants`（出击与二点球）。只改一处会出现“联赛神扑、点球大战隐身”。

---

## 7. 常用命令

```bash
npm test                 # 全量单测
npm run typecheck        # tsc
npm run pes:equiv        # 旧引擎逐位一致（改 resolution.ts 后必跑）
npm run balance          # 大批量模拟，看进球率/胜平负分布
```

改完平衡性相关的技能（射门、门将、争顶权重），至少跑一次 `npm run balance`。调试目标见 [`match-scoring-rebalance-plan.md`](match-scoring-rebalance-plan.md)：两队合计射门 18–30 次、场均总进球 2–5 球，且不允许出现“大量无意义远射凑数”。
