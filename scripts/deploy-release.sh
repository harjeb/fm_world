#!/usr/bin/env bash
# 安全发布脚本：
# 1. 发布前强制检查是否有玩家在线（/api/health 在线人数 + :8787 活跃连接），有玩家在线直接拒绝重启。
# 2. 检查是否处于开球/计算比赛窗口，避免打断比赛结算。
# 3. 以不可变发布目录 + 停服备份 + SQLite 校验 + 失败自动回滚流程切换上线。
#
# 用法：
#   bash scripts/deploy-release.sh --check-only   # 仅检查当前是否允许重启
#   bash scripts/deploy-release.sh                # 确认无人在线且不在比赛窗口后发布 HEAD
set -Eeuo pipefail
umask 077

repo=/root/workspace/fm_world
service=fm-world.service
drop=/etc/systemd/system/fm-world.service.d/90-production-release.conf
local_url=http://127.0.0.1:8787
public_url=https://fm.fzhj.pro
check_only=0
if [[ ${1:-} == "--check-only" ]]; then
  check_only=1
fi

check_online_players() {
  local health_json
  health_json=$(curl -fsS --max-time 6 "$local_url/api/health")
  python3 - "$health_json" <<'PY'
import json, subprocess, sys

health = json.loads(sys.argv[1])
online_players = health.get("onlinePlayers")
online_conns = health.get("onlineConnections")
recent_browser = health.get("recentBrowserPlayers")

# 同时兜底检查本机 :8787 的已建立连接数（兼容旧版未输出 onlinePlayers 字段的服务端）
ss_out = subprocess.run(
    ["ss", "-Htn", "state", "established", "(", "sport", "=", ":8787", ")"],
    capture_output=True, text=True, check=False,
).stdout
tcp_conns = len([line for line in ss_out.splitlines() if line.strip()])

if online_players is not None:
    print(f"在线检查：SSE 在线玩家={online_players}，SSE 连接={online_conns}，近2分钟活跃浏览器玩家={recent_browser}，TCP活跃连接={tcp_conns}")
    if (online_players or 0) > 0 or (online_conns or 0) > 0 or (recent_browser or 0) > 0:
        print("拒绝重启：当前仍有玩家在线，禁止重启游戏服务！")
        sys.exit(2)
else:
    print(f"在线检查（兼容模式）：TCP活跃连接={tcp_conns}")
    if tcp_conns > 0:
        print("拒绝重启：检测到 :8787 仍有活跃玩家连接，禁止重启游戏服务！")
        sys.exit(2)
PY
}

safe_window() {
  python3 - "$repo/data/match-jobs/index.json" <<'PY'
import json, sys, time
with open(sys.argv[1]) as file:
    jobs = json.load(file)
now = time.time() * 1000
for job in jobs:
    status = job["status"]
    kickoff = job["kickoffAt"]
    if status in ("running", "queued") or kickoff - 120000 <= now <= kickoff + 600000 or (status == "ready" and kickoff <= now):
        sys.exit(1)
PY
}

check_online_players
if ! safe_window; then
  echo "拒绝重启：当前处于比赛锁定/计算/直播窗口内！"
  exit 3
fi
echo "在线与比赛窗口检查通过：当前无人在线且非比赛窗口。"

if [[ $check_only -eq 1 ]]; then
  exit 0
fi

rev=$(git -C "$repo" rev-parse HEAD)
short=${rev:0:7}
[[ $(git -C "$repo" rev-parse origin/main) == "$rev" ]] || { echo "请先将 HEAD 推送至 origin/main"; exit 1; }
[[ -z $(git -C "$repo" status --porcelain) ]] || { echo "工作区有未提交改动，终止发布"; exit 1; }
test -s "$repo/dist/index.html" || { echo "缺少构建产物 dist/index.html，请先运行 npm run build:safe"; exit 1; }

ts=$(date -u +%Y%m%d-%H%M%S)
release="/opt/fm-world/releases/${ts}-${short}"
backup="/var/backups/fm-world/${ts}-${short}"

exec 9>/opt/fm-world/.deploy.lock
flock -n 9 || { echo "另一部署已占用发布锁"; exit 1; }

echo "== 准备发布目录 $release"
mkdir -p "$release"
git -C "$repo" archive "$rev" | tar -x -C "$release"
cp -a --reflink=auto "$repo/node_modules" "$release/node_modules"
cp -a --reflink=auto "$repo/dist" "$release/dist"
printf "FM_STATIC_DIR=%s/dist\n" "$release" > "$release/service.env"
chmod 600 "$release/service.env"
printf "%s\n" "$rev" > "$release/.verified-commit"
chmod 600 "$release/.verified-commit"

# 真正停服前再次复核是否有人刚刚上线或进入比赛窗口
check_online_players
safe_window || { echo "出现新的比赛任务，取消重启"; exit 3; }

systemctl is-active --quiet "$service"
pid=$(systemctl show -p MainPID --value "$service")
tr '\0' '\n' < "/proc/$pid/environ" | grep -Fx "FM_DATA_DIR=$repo/data" > /dev/null
mkdir -m 700 -p "$backup"
cp -p "$drop" "$backup/previous-release.conf"
printf "[Service]\nWorkingDirectory=%s\nEnvironmentFile=%s/service.env\n" "$release" "$release" > "$backup/new-release.conf"
curl -fsS --retry 2 --max-time 12 "$local_url/api/health" -o "$backup/health-before.json"

rollback() {
  local rc=$?
  trap - EXIT
  set +e
  echo "发布中止（退出码 $rc），恢复旧程序，不回滚玩家存档"
  systemctl stop "$service"
  if install -m 644 "$backup/previous-release.conf" "$drop.new" && mv -f "$drop.new" "$drop" && systemctl daemon-reload && systemctl start "$service"; then
    for ((i=0; i<30; i++)); do
      if curl -fsS --max-time 3 "$local_url/api/health" -o "$backup/health-rollback.json" 2>/dev/null; then
        echo "旧版本已恢复，源站健康接口可用"
        exit "$rc"
      fi
      sleep 2
    done
  fi
  echo "未能确认旧版本恢复，请立即检查 fm-world.service"
  exit "$rc"
}
trap rollback EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

echo "== 停服并备份存档到 $backup/data"
systemctl stop "$service"
! systemctl is-active --quiet "$service"
mkdir "$backup/data"
cp -a --reflink=auto "$repo/data/." "$backup/data/"
python3 - "$backup/data" <<'PY'
import json, pathlib, sqlite3, sys
path = pathlib.Path(sys.argv[1])
with (path / "world.json").open() as file:
    assert json.load(file)["world"]["divisions"], "missing world divisions"
with sqlite3.connect((path / "accounts.sqlite").as_uri() + "?mode=ro", uri=True) as db:
    assert db.execute("pragma quick_check").fetchall() == [("ok",)], "SQLite quick_check failed"
print("存档备份校验通过")
PY

echo "== 切换版本并启动 $service ($rev)"
install -m 644 "$backup/new-release.conf" "$drop.new"
mv -f "$drop.new" "$drop"
systemctl daemon-reload
systemctl start "$service"
for ((i=0; i<40; i++)); do
  if curl -fsS --max-time 3 "$local_url/api/health" -o "$backup/health.json" 2>/dev/null; then break; fi
  sleep 2
done
python3 - "$backup/health-before.json" "$backup/health.json" <<'PY'
import json, sys
before, after = (json.load(open(name)) for name in sys.argv[1:])
assert after["ok"] and after["accounts"] >= before["accounts"], "health check failed"
print("源站健康，账号数:", after["accounts"])
PY

curl -fsS --max-time 8 "$local_url/" -o "$backup/index-local.html"
cmp "$backup/index-local.html" "$release/dist/index.html"
asset=$(grep -oE '/assets/index-[^"[:space:]]+\.js' "$release/dist/index.html")
curl -fsS --max-time 8 "$local_url$asset" -o "$backup/index-local.js"
cmp "$backup/index-local.js" "$release/dist$asset"
rm -f "$backup/index-local.js"

[[ $(systemctl show -p WorkingDirectory --value "$service") == "$release" ]]
newpid=$(systemctl show -p MainPID --value "$service")
[[ $newpid != 0 && $newpid != "$pid" ]]
[[ $(readlink -f "/proc/$newpid/cwd") == "$release" ]]
systemctl is-active --quiet "$service"
trap - EXIT INT TERM

printf 'release=%s backup=%s pid=%s\n' "$release" "$backup" "$newpid"
curl -fsS --retry 2 --max-time 8 "$public_url/" -o "$backup/index-public.html"
cmp "$backup/index-public.html" "$release/dist/index.html"
curl -fsS --retry 2 --max-time 8 "$public_url/api/health" -o "$backup/health-public.json"
python3 - "$backup/health-public.json" <<'PY'
import json, sys
health = json.load(open(sys.argv[1]))
assert health["ok"]
print("公网首页和健康检查通过")
PY
