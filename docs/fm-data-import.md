# FM 数据导入（属性上限画像）

目标：让真实球星的**每项属性上限**来自真实数据，而不是按风格猜。

## 一、`AUTFabis FM24 Data Spreadsheet v2.rar` 里有什么

| 文件 | 实际内容 |
|---|---|
| `AUTFabi's FM24 Data Spreadsheet v2.xlsx`（65 MB） | **空模板**。19 个工作表全是公式，`Squad` / `Control Group` / `Shortlist` 三张录入表里只有一格写着 `Paste here` |
| `AUTFabi's FM24 Squad View.fmf` 等 3 个视图 | FM 的「视图配置」，导入游戏后决定导出哪些列 |
| `AUTFabi's FM24 Top 5 Leagues Filter*.fmf` | FM 的筛选配置 |

验证方式：`Data Table` 的 2749×219 个单元格里只有 150 个空 `<v/>` 标签（即公式没有缓存值），
`xl/sharedStrings.xml` 只有 9 KB，装不下 2749 个姓名。所以**这个 rar 不含任何球员数据**，
它是「把 FM 数据粘进去才算出来」的分析表。

## 二、怎么把数据填进去

### 路线 0（数据最全，推荐）：直接读游戏数据库导出的宽表

FM 的数据库导出可以直接喂给导入器，不用开存档：

```bash
npm run fm:import -- "FM24_24.3_官方数据库_球员属性_实验性.csv" "2013-14_球员属性_实验性.csv"
```

- 单表 22 万行、90 列，表头形如 `技术_传球_passing`、`精神_决断_decisions`，
  带 `当前能力_CA_原始` / `潜力_PA_原始` / `出生日期_推测`。
- 属性 `0` 表示「未设定」（该球员没这一项），导入时丢弃；`PA` 为负数表示随机范围，只作参考不参与画像。
- 可一次传多份表（官方库 + 复古库），同一球员取 CA 更高的一行。
- 解析是流式的（`iterateFmRows`），22 万行 × 90 列不会一次性进内存。

### 路线 A（推荐，直接用 CSV）

1. FM24 里打开任意存档 → 球队 → 阵容界面 → 视图 → 导入视图 → 选 `AUTFabi's FM24 Squad View.fmf`
2. 全选阵容表格 → 复制
3. 粘贴到一个纯文本文件，存成 `squad.tsv`（FM 复制出来是制表符分隔）
4. 运行：

```bash
npm run fm:import -- squad.tsv
```

### 路线 B（用那张 xlsx）

1. 同上第 1–2 步复制
2. 打开 xlsx，把内容粘到 `Squad` 表的 A1（那格写着 `Paste here`）
3. Excel 会自动算出 `Data Table`（含每 90 分钟数据与百分位）
4. 把 `Data Table` 另存为 CSV，再走 `npm run fm:import -- xxx.csv`

## 三、导入器做了什么

`scripts/import-fm.ts` → 读表 → `src/game/data/fm-csv.ts` 解析 → `profileFromFm()` 转画像 →
写入 `src/game/data/fm-profiles.generated.ts`。

- **只影响属性上限**（`player.ceilings`），不改当前属性、CA、PA、比赛表现。
- 键是球员英文名，与本作 `PlayerSeed.enName` 对齐；对不上的球员自动回退到按风格推导的画像。
- 上限公式：`tier` 决定「多强」，画像决定「强在哪」。招牌维度上限更高，弱点更低。
- 解析容错：制表符 / 逗号 / 分号自动识别；带 BOM、带引号姓名、FM 重复表头都能处理；
  1–20 以外的数值（统计列）会被丢弃。
- `--all` 模式跳过名单匹配，把表里所有球员按原名写进画像（适合导入自家球队）。

### 球员名匹配（`src/game/data/fm-match.ts`）

外部表写的是全名（`Cristiano Ronaldo dos Santos Aveiro`），种子写的是常用名（`Cristiano Ronaldo`），
所以匹配分五层，越往后越松：

1. **精确**（归一化后）：去重音、去标点、忽略大小写，`Jr`/`Jr.`/`Junior` 视为同一个词；
2. **首尾一致**：`Thiago Silva` → `Thiago Emiliano da Silva`（不会错配到 `Thiago Silva de Paiva`）；
3. **有序前缀**：`Cristiano Ronaldo` → `Cristiano Ronaldo dos Santos Aveiro`；
4. **缩写名**：种子里写 `N. Kanté`/`T. Müller`/`M. Reus` 时，按「首字母一致 + 姓一致」找，
   并要求 CA ≥ 100（`N'Golo Kanté` CA 160 胜出，不会被 `Cédric Kanté` 抢走）；
5. **只给姓 / 单名**：`Parejo` → `Dani Parejo`、`Rodrygo` → `Rodrygo Silva de Goes`，
   要求 CA ≥ 130（否则 `Rodri` 会撞上 `Rodri Wyn Davies` CA 18），且**位置要对得上**。

还有一层 **0 层：手工别名表**（`FM_NAME_ALIASES`）。种子里写的是绰号、数据库里只有法定全名时，
任何规则都接不上，只能逐条对应——但也最容易核对，所以只收录**已在导出表里验证存在**的球员：

| 种子 | 数据库全名 | CA |
|---|---|---|
| `Nani` | Luís Carlos Almeida da Cunha | 115 |
| `Koke` | Jorge Resurrección Merodio | 157 |
| `Rodri` | Rodrigo Hernández Cascante | 180 |
| `Casemiro` | Carlos Henrique Casimiro | 157 |
| `Canales` | Sergio Canales Madrazo | 155 |
| `L. Díaz` | Luis Fernando Díaz Marulanda | 162 |
| `Hulk` | Givanildo Vieira de Sousa | 156 |
| `M. Thuram` | Marcus Lilian Thuram-Ulien | 157 |

（共 31 条，见 `src/game/data/fm-match.ts` 的 `ALIAS_SOURCE`。要加新的就照抄一行，
键写种子里的 `enName`，值写导出表 `姓名` 列的原样全名；命中会单独统计，便于核对。）

位置校验（`positionFamilies`）把 FM 的位置代码归到本作五个位置族（`DC/SW`→CB、`DL/WB/ML/AMR`→W、
`DM/MC/AMC`→CM、`ST`→ST），只在最松的几条规则上生效，门将则一律校验：
`Pepe`（CB）不会匹配到边锋 `Simone Pepe`，`Pau López` 也不会撞上中卫 `Pau Cendrós López`。

两条额外保险：

- **年代窗口**：种子的 `era`（如 `1990s`）按巅峰 20–34 岁反推出生年份区间，超窗的同名候选直接排除——
  `Peter Schmeichel`（1963）不会匹配到儿子 `Kasper Peter Schmeichel`（1986）。
- **连字符不拆词**：`Roy-Keane Avontuur` 归一化成 `roykeane avontuur`，不会被 `Roy Keane` 误配。

当前覆盖率：**411 / 500**（放宽规则命中 230 名，别名表 31 名）。
剩下的 89 名是导出表里**根本没有这个人**——一半是 2013 赛季前就退役的传奇
（`Oliver Kahn`、`Paolo Maldini`、`Zinedine Zidane`、`Ronaldinho`），
一半是这份导出表漏掉的现役球员（`Joshua Kimmich`、`Jamal Musiala`、`Pedri`、`Gavi`，
表里只有 `Laurin Kimmich` 这类同名小将）。

## 三之二、第 2 类：手工画像（补满剩下 89 名）

导入表补不上的那 89 名，改成**手写画像**，放在 `src/game/data/profiles-curated.ts`。
理由不是「要 100% 覆盖」，而是**风格画像会让同风格的人长得一模一样**：
罗纳尔多和因扎吉都是 `st_poacher`，但一个靠爆发力强吃，一个靠预判捡漏，
天花板就不该是同一个形状。

写法与 FM 画像完全一致——只写「这个人强在哪」，不搬数值：

```ts
'Filippo Inzaghi': { offBall: 1, anticipation: 1, shooting: 0.9, composure: 0.8, firstTouch: 0.7, speed: 0.6 },
'Ronaldo Nazário': { shooting: 1, dribbling: 1, acceleration: 0.95, offBall: 0.9, firstTouch: 0.9, composure: 0.85, strength: 0.8 },
```

规则：
- 键是属性名，值是 0–1 的相对权重，**最大值归一化成 1**（和 `profileFromWeights` 同一套）；
- 不必写全 18 项，没写的按默认权重 `0.3` 处理，与 FM 画像一致；
- 门将画像写门将维度（`reflexes`/`handling`/`rushing`/`oneOnOne`），也可以带 `passing`/`decisions`；
- **只改上限形状**，当前属性、CA、身高、惯用脚全部不受影响。

优先级链：`fmProfileFor`（FM 导入）→ `curatedProfileFor`（手工）→ 风格画像。
三者都在随机源之外计算，因此不会让 500 名球员的其他数据漂移。

要加人：在表格里加一行即可，键写种子里的 `enName`。`tests/curated-profiles.test.ts` 会检查
每份画像都有形状、门将/外场维度不串、以及「同一风格的两名球员上限形状确实不同」。

## 四、属性维度映射

FM 的 36 项属性里，只有有明确对应的才参与映射（其余如 `Bravery`、`Leadership`、`Flair`、
`Eccentricity` 本作没有对应维度，直接忽略）。同维度多个来源取最高分。

| 本作维度 | FM 属性 |
|---|---|
| `passing` 传球 | Passing, Crossing, Corners, Free Kick Taking, Long Throws, Kicking |
| `shooting` 射门 | Finishing, Long Shots |
| `dribbling` 盘带 | Dribbling |
| `firstTouch` 停球 | First Touch, Technique |
| `heading` 头球 | Heading |
| `tackling` 抢断 | Tackling |
| `defPos` 防守站位 | Marking, Positioning |
| `vision` 视野 | Vision |
| `decisions` 决断 | Decisions, Concentration |
| `offBall` 无球跑动 | Off The Ball |
| `anticipation` 预判 | Anticipation |
| `composure` 镇定 | Composure, Penalty Taking |
| `teamwork` 团队合作 | Teamwork, Work Rate |
| `strength` 强壮 | Strength |
| `speed` 速度 | Pace |
| `acceleration` 爆发力 | Acceleration |
| `agility` 灵活 | Agility, Balance |
| `endurance` 耐力 | Stamina, Natural Fitness |
| `reflexes` 反应 | Reflexes |
| `handling` 手控球 | Handling |
| `rushing` 出击 | Rushing Out, Command Of Area |
| `oneOnOne` 一对一 | One On Ones |

表头别名（英文全名、FM 列表短名 `Pac`/`Fin`/`Pas`、中文版表头 `速度`/`射门`/`传球`）
统一在 `src/game/data/attr-profile.ts` 的 `FM_HEADER_ALIASES` 里维护。

## 五、验收

导入后 `npm test` 会跑两组用例：

- `tests/fm-import.test.ts`（8 例）：分隔符、BOM、引号、重复表头、越界值丢弃、纯统计表不产出、
  中文表头、不同画像给出不同上限形状；
- `tests/fm-match.test.ts`（14 例）：中英混排表头、CA/PA 与出生年份解析、`Passing` 不被误判成 `PA` 列、
  首尾一致 / 前缀 / 缩写名 / 只给姓 / 单段名五条放宽规则、位置校验、年代窗口、连字符不拆词、
  别名表（`Koke`、`Canales`）。

手检一名球员：

```bash
npx tsx -e "import {createPlayerFromSeed, PLAYER_SEEDS} from './src/game/data/players.ts'; \
const s = PLAYER_SEEDS.find(x => x.enName === 'Gianluigi Buffon'); \
const p = createPlayerFromSeed(s); console.log(p.ceilings)"
```

## 六、已知限制

- 只映射 22 个维度中的一部分，未覆盖的维度回退到默认权重 `0.3`（不是 0，避免上限过低压死成长）。
- FM 存档 `.fm` 不解析：它是 zstd 容器 + 私有序列化，字符串表还是字节逆序，抽属性属于逆向工程，
  版本一更新就失效。本方案走「FM 界面导出 → 表格」，稳定且不需要破解格式。
- 名字匹配是启发式的：表里没有的人（`Oliver Kahn`、`Paolo Maldini`…）会漏配，
  单段名（`Jonny`）和重名老将仍可能配到同名后辈，导入后应人工扫一眼「放宽规则命中」列表。
- 数据覆盖取决于导出表：本作 500 个种子里 411 名能拿到真实画像，其余仍按风格画像生成上限。
- 复古库（2013-14）的 `出生日期_存档` 有 **+10 年**的误差（`Philippe Coutinho Correia` 记成 2002，实际 1992，
  同行的 `年龄` 列是 21）。这个误差只影响「同名候选的年代过滤」，不影响最终人选——
  但它也是为什么年代窗口只是筛选条件之一，而不是唯一判据。
- 两份导出表互补才能到这个覆盖率：FM24 库有现役与新生代，2013-14 库补上了
  2013 年在役的老将（`Andrea Pirlo`、`Steven Gerrard`、`Didier Drogba`…），导入时两份一起传。
