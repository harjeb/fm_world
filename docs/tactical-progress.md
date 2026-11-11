# 战术风格与球队指令：当前进度

> 当前分支：`docs/tactical-style-effects`。本文件是本次代码提交时的交接记录；
> 数值均为固定夹具下的小样本探索，不代表正式验收、克制已经成立或平衡已完成。
> 完整数据和统计口径见 [验证报告](./tactical-validation-report.md) §11–13。

## 一、已完成

### 1. 首版九项与实验性熟练度

- `src/game/pes/tactics.ts` 已定义持球方向 / 传球 / 节奏 / 宽度、得球 / 失球转换、
  防线 / 逼抢线 / 压迫频率，包含中性配置、旧模板、可编辑指令和校验。
- 新指令实验的执行强度使用 `0.35 + 0.65 × familiarity`；防线和部分决策另有失误处理。
  **当前输入仍是整队一个熟练度值**，并不是球员四个指令族的持久化训练系统；覆盖和单调性尚不完整。
- 没有 `instructions` 的球队继续选择旧五滑杆分支；但历史版本路由 / 旧回放还须系统验证，
  不能只凭局部测试承诺所有旧比赛逐位一致。

### 2. 上抢任务、身后球和无球宽度

- `src/game/pes/sim.ts`：修复第二上抢者与盯人名额冲突、失效任务和移动目标的清理；
  已记录正确的本方槽位冲突埋点。**第二上抢者专门封堵接应线的 A2 分工尚未实现。**
- `advanced.possession.receiving=space`：开放比赛可生成地面身后球候选，按计划落点估算可达性，
  越位使用出脚时球员实际位置。传球仍是出脚时预结算，并非飞行途中重新判定拦截。
- `advanced.defense.width=narrow/normal/wide`：只作用于合格的盯人 / 阵形目标；上抢、协防与拦截有优先级。
  新开实验比赛的 `defenseCompactness=0.25`、`defenseMarkBuffer=3`；旧快照缺参数时按原值 `0.15 / 1.5` 回退。
- `STYLE_LIST_REV2` 是**显式选择**的候选模板，不回写旧模板或已保存阵容。现有正式战术 UI 和服务端尚未接入。

### 3. 尽早传中（实验性、默认关闭）

- 支持显式设置 `advanced.possession.crossTiming=early`；`balanced` 或缺省保持中性，`late` 尚不支持。
- 对合格候选增加受熟练度影响的有限选择倾向，并扩展可行区域；不直接修改传球成功率。
- 它**没有自动加入**旧模板或 `STYLE_LIST_REV2`；尚未开放 UI / 服务端。详见验证报告 §13.3。

### 4. 可复现实验与诊断

- `scripts/tactics-experiment.ts`：风格 / 矩阵 / 熟练度实验，支持严格镜像、统一属性及 `--revision 2`。
- `scripts/tactics-ablation.ts`：同对手 / 阵容下的单项、组合和熟练度消融；
  `scripts/tactics-followup.ts`：4-4-2 与 4-3-3 的窄防守、边路接球和前插漏斗。
- `scripts/tactics-cross-experiment.ts`、`scripts/tactics-cross-contrasts.ts`：尽早传中及配对差中之差。
- 埋点只观察已有行为：区分预裁决成功与实际接球；不会增加 RNG 抽取。旧 `tactics-diagnostics.ts`
  因宽度对照混入不同对手、任务 pid 口径错误已停用；旧报告中“冲突清零 / 收窄 0.5–0.9 米”的结论已撤回。

## 二、目前观察到什么

| 对照 | 小样本观察 | 不应得出的结论 |
| --- | --- | --- |
| 快反 vs 高压，仅切换 `space` | 空当传球会发生，但完整比赛的对位收益区间仍宽 | “快反已经克高压”，或低熟练必然更好 / 更差 |
| 链式 `narrow−normal`，同对手 | 两套镜像阵容中实际无球宽度约减少 4–7 米，进攻方前场边路接球增加 | 总 xG、边路风险和成绩已平衡；两套阵容仅有阵型区别 |
| 双翼常规传中 | 首批 128 场、2577 次合格候选中仅 1 次常规传中；后续 32 场诊断的 632 次候选均未胜出 | 所有阵容 / 参数下传中必然无效 |
| 显式 `early−balanced` | 两套阵型满熟练时每场约多 0.38–1.13 次常规传中；部分场景 xGD 点估计下降 | 已证明优势、熟练度改变了克制，或可以无条件设为默认 |

两套阵型各自内部严格镜像，但 4-3-3 从同一球员池重新自动排阵，与 4-4-2 更换了 4 名首发；
不得将跨组差异归因于阵型本身。现有 8 种子块、未做多重比较校正，区间仅为探索。

## 三、验证状态

- 本次提交前：`npm run typecheck` 通过。
- `npx vitest run src/game/pes/ scripts/tactics-ablation-fixture.test.ts scripts/tactics-experiment-helpers.test.ts`：
  **14 个测试文件，375 通过、4 跳过**。包含同局面传中结算不直接加成、越位方向 / 开关、
  埋点开关 RNG / 快照一致及部分中途恢复测试。
- 没有运行全项目 `npm test`；此前 `tests/server.test.ts` 在 main 已有失败，本次未复测或排查。
- 上述测试**不等于**完整旧回放、所有技能、所有存档版本或线上联赛兼容通过。

## 四、未完成与建议顺序

1. **比赛规则版本与恢复**：为新机制建立可路由的新规则版本，冻结真实 v4 / P1 实现；统一比赛任务、
   快照、参数、技能一次性状态与旧回放，覆盖传球飞行、死球、中场、红牌和换人。
2. **单项验收与平衡**：补未看过的更多种子、技术 / 速度 / 防空画像及更多阵型；
   预注册机会分母和多重比较校正。此前选过参数的数据不能再作为盲验收。
3. **传中与实际落点**：检查成功 / 被拦截 / 出界、空中争顶、第二落点及真实接球；当前传球先预结算，
   不能声称后卫在飞行中能推翻已裁决成功。
4. **前插机会集**：区分真正可前插球员与普通队友，定位空间 / 时机瓶颈；不要只通过提高触发率调胜负。
5. **对位与熟练度**：完成 `Y11−Y10−Y01+Y00` 四格 B0 对照，及双方熟练度 3×3 交互实验；
   报告完整种子块、未校正区间与校正结果，不能把未经对照的 raw xGD 当克制。
6. **产品接入**：统一 schema、服务端校验与旧客户端保护；选择新模板 / 指令的 UI；明确联赛锁阵和后台 AI v2
   支持范围。没有完成前，不将实验预设当作线上默认。

## 五、常用复现命令

```bash
npm run typecheck
npx vitest run src/game/pes/ scripts/tactics-ablation-fixture.test.ts scripts/tactics-experiment-helpers.test.ts

# 4-4-2 / 4-3-3；384 场，8 个种子块，仅探索
npm run tactics:followup -- --n 8 --seed0 20001 --workers 2 --out /tmp/tactics-followup.json

# 尽早传中单项；256 场，8 个种子块，仅探索
npm run tactics:cross-experiment -- --n 8 --seed0 40001 --workers 2 --out /tmp/tactics-cross.json
npm run tactics:cross-contrasts -- /tmp/tactics-cross.json /tmp/tactics-cross-contrasts.json
```

原始结果保存在 `docs/tactics-followup-results.json`、`docs/tactics-cross-experiment-results.json`、
`docs/tactics-cross-contrast-results.json` 以及 `docs/tactics-ablation-*.json`。每次运行记录源码和夹具哈希；
已有数据运行时工作区是 dirty，修改代码后不应冒充同一版本或覆盖历史样本。
