#!/usr/bin/env bash
# 小内存机器（2 核 / 2G）上的低占用构建：
# 单核 + 最低 CPU/IO 优先级 + 限制 Node 堆，编译时游戏服务和 SSH 不会被挤死。
# 用法：npm run build:safe
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=768"
export UV_THREADPOOL_SIZE=2
export RAYON_NUM_THREADS=1
export GOMAXPROCS=1

RUN=(nice -n 19)
command -v ionice >/dev/null 2>&1 && RUN+=(ionice -c3)
command -v taskset >/dev/null 2>&1 && RUN+=(taskset -c 0)

echo "== 类型检查（单核、低优先级）"
"${RUN[@]}" npx tsc --noEmit
echo "== 打包（单核、低优先级）"
"${RUN[@]}" npx vite build
echo "== 完成"
