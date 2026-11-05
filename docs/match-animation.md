# 2D 比赛动画：赛果、轨迹、回放分离

## 为什么不直接增加判定回合

`npm run match:profile` 默认对种子 2024–2043 的 20 场采样，平均约 226.45 个动作/场。联赛压缩到 600 秒后，一次动作平均约 2.65 秒。每隔几秒决定一次传射并不等于画面也只能隔几秒更新。

原播放层把整个动作的球员和球一起从上一次绘制位置线性滑到新快照：中途来的数据会重新启动飞球；联赛每步还额外加 800ms，容易一直落后于比赛时钟。这一轮没有增加传射判定、改变属性规则或放慢正常播放。

## 实现

1. **赛果层**：`MatchEngine` 保持原决策/结果随机流。动作前后只采集位置，记录触球路径、定位球和进球边界。状态内保留最近 12 个动作，避免联网客户端一次收到多步时丢掉中间动作；不会把整场坐标存进每个历史战报。
2. **编舞层**：`src/game/match/visualization.ts` 是不依赖 DOM 的时间采样器。球员先按单调三次跑位曲线得到“引擎希望他在哪”，再交给 `src/game/match/motion.ts` 的 10 Hz 运动层：每人按自己的最高速度、加速度和转向速率去追这个目标，所以慢球员会掉队、急转会甩出去一点。球有处理球、出脚、飞行、接球阶段，高球按踢球速度档位给抛物线高度。插值不重新决定球权、碰撞、射门或进球。
3. **播放层**：独立时钟消费动作队列，`requestAnimationFrame` 按时间采样；运动层固定 0.1 秒推进一次，两次 tick 之间插值给屏幕刷新率（与 FM24 观战器一致）。重复 render/SSE 不重启动画。暂停冻结当前画面；进球先到球门，下一次开球才切中圈；友谊赛终场动作播放结束再进赛后页。长期断线缺失轨迹时就地切入，不编造横穿全场的补帧。
4. **友谊赛**：在隔离副本上预演剩余动作，供后续跑位衔接使用；原状态、随机数、事件和赛果不变。教练换人/调整战术后废弃旧计划，重新预演。
5. **联赛**：只播放服务器已经提交的轨迹，不向客户端发送未来赛果，不在客户端预演联赛，不暂停现实比赛钟。时长按真实动作跨度计算，不再额外增加每步 800ms。
6. **后台 AI 对阵**：不采集没人观看的动作坐标，避免批量世界模拟产生无用对象。

画面可切换“比赛 / 战术轨迹”。后者显示无门将阵型包络与跑动方向，属于表现层分析，不影响比赛规则。

## soccerAnimate：确实可接数据，但不是赛果引擎

参考 [Dato-Futbol/soccerAnimate](https://github.com/Dato-Futbol/soccerAnimate)，核查版本 `407aed5`。

它是 R/ggplot2/gganimate 的 tracking-data 可视化工具，支持 base、convexhull、voronoi、delaunay；不会从一条“某球员射门”的事件自动生成全队跑位。这里独立生成合成轨迹，再调用原包公开 API；没有把其 GPL 的 R 实现翻译或复制到网页项目。

浏览器和导出器使用同一个位置采样函数。导出为 **25fps 的 Metrica tidy-data 兼容表**：

- 字段：`period,frame,time,second,player,x,y,team,is_gk,dx,dy,v_mod,speed`，另带 `height,source_id`。
- `time` 是 600 秒回放时钟，`second=floor(time)`；不是屏幕显示的 90 分钟比赛钟。
- 网页坐标转换成 105×68 米、Y 轴向上的绘图坐标。上游部分球场/分析函数仍硬编码 105×68，因此不只依赖其自定义球场尺寸参数。
- `dx/dy` 使用过去 20 个 25fps 样本，即 0.8 秒跨度。定位球重置不跨段计算速度。
- 这些是**按比赛事件重建的合成轨迹**，不是采集的真实足球 tracking data。`speed` 是压缩回放坐标速度，不应作为真实运动生理数据。

### 导出 10 秒片段

```bash
npm run match:tracking -- --seed 2024 --from 0 --to 10 --out artifacts/match.csv
```

同时输出 `artifacts/match.csv.json`，记录比分、动作数、帧率、球场尺寸及数据性质。范围为 `0 <= from < to <= 600`。完整十分钟表较大，建议先用短片段预览。

### 用原版 R 包渲染 GIF

需要另装 R；项目不会在启动时自动下载 R 或 R 包：

```r
install.packages("remotes")
remotes::install_github("Dato-Futbol/soccerAnimate")
```

```bash
Rscript scripts/render-soccer-animate.R artifacts/match.csv artifacts/match base
Rscript scripts/render-soccer-animate.R artifacts/match.csv artifacts/match-hull convexhull
```

CSV 已是整理好的米制表，直接交给 `soccer_animate(tidy_data=...)`；不要再次调用 `get_tidy_data()`，否则会重复缩放/翻转。

**验证边界**：已测试 CSV 字段、时间采样、坐标和浏览器播放；当前开发环境没有 `Rscript`，因此尚未实际运行原版包生成 GIF。这是可选离线渲染适配，不是已经嵌入浏览器的 R 引擎。

## 为什么是 10 Hz 运动层，而不是更多判定回合

见 [`2d-animation-research.md`](2d-animation-research.md)：把 226 步/场做到 10 Hz 需要 9,000 步，进球率会从 4.9 球涨到约 194 球（除非把每个动作的概率全部重标定）；而同样的 9,000 个位置采样可以在渲染时按属性免费生成，判定一步都不用加。

## RoboCup Soccer Simulator：借鉴分层，而不是替换比赛规则

参考 [rcsoccersim.github.io](https://rcsoccersim.github.io)、[rcssserver](https://github.com/rcsoccersim/rcssserver)、[rcssmonitor](https://github.com/rcsoccersim/rcssmonitor)。

源码核查：`rcssserver/src/serverparam.cpp` 默认模拟周期 100ms；`serializermonitor.cpp` 的状态流含球及球员位置、速度与朝向。`rcssmonitor/src/log_player.cpp` 使用独立定时器消费日志，显示与模拟分离。

有帮助的是“权威仿真 → 状态记录 → 实时监视/离线回放”的边界。100ms 是其模拟周期，不是网页必须采用的动画帧率。所查官方 monitor 是 C++/Qt5 桌面程序；没有找到可直接导入的官方 JS/WASM 播放组件，也没有证实其监视器提供帧间平滑插值。

因此本项目不引入其碰撞、运动学、裁判或 agent 协议来重算比赛，也不复制其 GPL/LGPL 桌面代码。目前未做 RCG 导入/导出，不能声称 soccerAnimate 原生读取 RCG。FM 自己的事件轨迹是共同数据源，网页和 R 可视化各自消费。

## 其他参考与许可

- `cyntler/football2d` 的草皮与中线 Canvas 分层绘制经 MIT 许可改编，见 `src/ui/football2d-field.ts` 与根目录 `THIRD_PARTY_NOTICES.md`。没有采用其中逐帧随机移动球的占位逻辑。
- Unity `matinaghaei/2D-Soccer-Game` 与 Godot `rotexpro/Football-Manager-Project` 的物理/AI 引擎不能直接当成 TypeScript 回放器；没有将它们移植进本次功能。

## 验证命令

```bash
npx vitest run tests/match-replay.test.ts tests/match-playback.test.ts tests/match-timing.test.ts tests/match-motion.test.ts tests/step-count.test.ts
npm run smoke:animation
npm run match:profile
npm run build
```

动画 smoke 会启动独立 Vite 与无头浏览器、使用隔离临时配置，不影响正常账号/存档。Windows 自动查找 Chrome/Edge，Linux 查找常见 Chromium 路径，也可设置 `FM_CHROME`。检查连续绘制密度、DOM 重绘不换 canvas、暂停、教练战术、终场动作播放与比分不变；截图存到临时目录。
