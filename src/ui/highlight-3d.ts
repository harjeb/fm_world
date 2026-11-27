/**
 * 赛后复盘与全服聊天战报「3D 进球 / 高光特写剧场」（按需懒加载 Three.js 与 matchday.glb）。
 *
 * 复用点球/任意球实验室的球场、球网波动物理、门将扑救 IK 与球员骨骼网格，
 * 支持主客场球衣动态换装、助攻传球/边路传中冲顶/任意球绕人墙/神扑/中柱多镜头连播，
 * 以及 360° 拖拽自由视角、机位预设与 0.5× 慢动作回看。
 */
import './penalty/training.css'
import { sanitizeChatColor, type ChatSharedMatch } from '../game/chat.ts'
import {
  buildHighlight3DClipsFromRecord,
  buildHighlight3DClipsFromSharedMatch,
  sampleHighlight3DFrame,
  type ActorPose3D,
  type Highlight3DClip,
  type Highlight3DTeam,
  type RosterActorHint,
} from '../game/highlight-3d.ts'
import { clamp } from '../game/penalty/practice.ts'
import { PLAYER_TEAM_ID } from '../game/season.ts'
import type { MatchRecord, Player } from '../game/types.ts'
import { clubLook, crest, distinctKit } from './components.ts'
import { esc, pveModeLabel } from './format.ts'
import { lockSetPieceFrame } from './penalty/frame-lock.ts'
import { loadMatchday } from './penalty/matchday.ts'
import { createGround } from './penalty/scene.ts'
import { game } from './state.ts'

type RigActor = Awaited<ReturnType<Awaited<ReturnType<typeof loadMatchday>>['spawnKitFigure']>>

function poseActorRig(rig: RigActor, pose: ActorPose3D): void {
  if (!pose.visible) {
    rig.root.visible = false
    return
  }
  rig.root.visible = true
  const sc = rig.root.scale.y
  rig.root.position.set(pose.x, 0.96 * sc, pose.z)

  switch (pose.mode) {
    case 'idle': {
      const breathe = Math.sin(pose.phase * 2.6) * 0.02
      const rootX = -0.06 + breathe * 0.4
      rig.root.rotation.set(rootX, pose.yaw, 0, 'YXZ')
      rig.legs[0].rotation.set(0.11, 0, -0.05)
      rig.knees[0].rotation.set(-0.2, 0, 0)
      rig.ankles[0].rotation.set(-(rootX + 0.11 - 0.2), 0, 0.05)
      rig.legs[1].rotation.set(-0.12, 0, 0.05)
      rig.knees[1].rotation.set(-0.22, 0, 0)
      rig.ankles[1].rotation.set(-(rootX - 0.12 - 0.22) * 0.85, 0, -0.05)
      rig.arms[0].rotation.set(0.1 + breathe, 0, -0.15)
      rig.elbows[0].rotation.set(0.46, 0, 0)
      rig.arms[1].rotation.set(-0.08 - breathe, 0, 0.15)
      rig.elbows[1].rotation.set(0.48, 0, 0)
      rig.plant(pose.lift)
      break
    }
    case 'sprint': {
      const stride = Math.sin(pose.phase * Math.PI * 2)
      const rootX = -0.16
      rig.root.rotation.set(rootX, pose.yaw, -0.05 * stride, 'YXZ')
      rig.legs[0].rotation.set(0.48 * stride, 0, -0.04)
      rig.legs[1].rotation.set(-0.48 * stride, 0, 0.04)
      rig.knees[0].rotation.set(-0.16 - 0.62 * Math.max(0, -stride), 0, 0)
      rig.knees[1].rotation.set(-0.16 - 0.62 * Math.max(0, stride), 0, 0)
      rig.ankles[0].rotation.set(-0.12, 0, 0)
      rig.ankles[1].rotation.set(-0.12, 0, 0)
      rig.arms[0].rotation.set(-0.45 * stride, 0, -0.18)
      rig.arms[1].rotation.set(0.45 * stride, 0, 0.18)
      rig.elbows[0].rotation.set(0.86, 0, 0)
      rig.elbows[1].rotation.set(0.86, 0, 0)
      rig.plant(pose.lift)
      break
    }
    case 'pass': {
      const w = clamp(pose.phase, 0, 1)
      const swing = -0.38 + 0.96 * w
      const rootX = -0.1 + 0.06 * w
      rig.root.rotation.set(rootX, pose.yaw - 0.1 * w, 0.09 * w, 'YXZ')
      rig.legs[0].rotation.set(0.14, 0, -0.06)
      rig.knees[0].rotation.set(-0.24, 0, 0)
      rig.ankles[0].rotation.set(-(rootX + 0.14 - 0.24), 0, 0.06)
      rig.legs[1].rotation.set(swing, 0, 0.14)
      rig.knees[1].rotation.set(-0.42 * (1 - w * 0.65), 0, 0)
      rig.ankles[1].rotation.set(-0.14, 0, 0.12)
      rig.arms[0].rotation.set(0.28, 0, -0.42)
      rig.arms[1].rotation.set(-0.24 * w, 0, 0.25)
      rig.elbows[0].rotation.set(0.54, 0, 0)
      rig.elbows[1].rotation.set(0.58, 0, 0)
      rig.plant(0)
      break
    }
    case 'kick_windup': {
      const w = clamp(pose.phase, 0, 1)
      const swing = w < 0.38 ? -0.66 * (w / 0.38) : -0.66 + 1.58 * ((w - 0.38) / 0.62)
      const rootX = -0.15 + 0.11 * w
      rig.root.rotation.set(rootX, pose.yaw - 0.13 * w, 0.13 * w, 'YXZ')
      rig.legs[0].rotation.set(0.15, 0, -0.06)
      rig.knees[0].rotation.set(-0.24, 0, 0)
      rig.ankles[0].rotation.set(-(rootX + 0.15 - 0.24), 0, 0.06)
      rig.legs[1].rotation.set(swing, 0, 0.08)
      rig.knees[1].rotation.set(w < 0.5 ? -0.68 : -0.68 * (1 - (w - 0.5) * 1.4), 0, 0)
      rig.ankles[1].rotation.set(-0.22, 0, 0)
      rig.arms[0].rotation.set(0.32, 0, -0.46 - 0.28 * w)
      rig.arms[1].rotation.set(-0.36 * w, 0, 0.28)
      rig.elbows[0].rotation.set(0.55, 0, 0)
      rig.elbows[1].rotation.set(0.65, 0, 0)
      rig.plant(0)
      break
    }
    case 'kick_follow': {
      const s = clamp(pose.phase, 0, 1)
      const ease = s * (2 - s)
      const rootX = -0.04 * (1 - ease) - 0.05 * ease
      rig.root.rotation.set(rootX, pose.yaw - 0.12 * (1 - ease), 0.12 * (1 - ease), 'YXZ')
      const hipL = 0.15 * (1 - ease) + 0.17 * ease
      const kneeL = -0.24 * (1 - ease) - 0.2 * ease
      rig.legs[0].rotation.set(hipL, 0, -0.06)
      rig.knees[0].rotation.set(kneeL, 0, 0)
      rig.ankles[0].rotation.set(-(rootX + hipL + kneeL), 0, 0.06)
      const hipR = 0.92 * (1 - ease) - 0.14 * ease
      const kneeR = -0.2 * (1 - ease) - 0.22 * ease - Math.sin(s * Math.PI) * 0.22
      rig.legs[1].rotation.set(hipR, 0, 0.07)
      rig.knees[1].rotation.set(kneeR, 0, 0)
      rig.ankles[1].rotation.set(-0.2 * (1 - ease) - (rootX + hipR + kneeR) * 0.85 * ease, 0, -0.05)
      rig.arms[0].rotation.set(0.32 * (1 - ease) + 0.1 * ease, 0, -0.74 * (1 - ease) - 0.16 * ease)
      rig.arms[1].rotation.set(-0.36 * (1 - ease) - 0.06 * ease, 0, 0.28 * (1 - ease) + 0.16 * ease)
      rig.elbows[0].rotation.set(0.55 * (1 - ease) + 0.45 * ease, 0, 0)
      rig.elbows[1].rotation.set(0.65 * (1 - ease) + 0.48 * ease, 0, 0)
      rig.plant(pose.lift)
      break
    }
    case 'header_jump': {
      const airRatio = clamp(pose.lift / 0.5, 0.15, 1)
      const hp = clamp(pose.phase, 0, 1)
      // 起跳后仰蓄力 → 空中甩头冲顶前压
      const snap = hp < 0.5 ? 0.18 * (hp / 0.5) : 0.18 - 0.34 * ((hp - 0.5) / 0.5)
      rig.root.rotation.set(snap, pose.yaw, 0, 'YXZ')
      rig.legs[0].rotation.set(-0.18 * airRatio, 0, -0.08)
      rig.legs[1].rotation.set(-0.24 * airRatio, 0, 0.08)
      rig.knees[0].rotation.set(-0.68 * airRatio, 0, 0)
      rig.knees[1].rotation.set(-0.76 * airRatio, 0, 0)
      rig.ankles[0].rotation.set(-0.18, 0, 0)
      rig.ankles[1].rotation.set(-0.18, 0, 0)
      rig.arms[0].rotation.set(0.25, 0, -0.62 * airRatio - 0.15)
      rig.arms[1].rotation.set(0.25, 0, 0.62 * airRatio + 0.15)
      rig.elbows[0].rotation.set(0.72, 0, 0)
      rig.elbows[1].rotation.set(0.72, 0, 0)
      rig.plant(pose.lift)
      break
    }
    case 'wall': {
      const jump = clamp(pose.lift / 0.44, 0, 1)
      rig.root.rotation.set(-0.04, pose.yaw, 0, 'YXZ')
      rig.legs[0].rotation.set(0.05, 0, -0.04)
      rig.legs[1].rotation.set(0.05, 0, 0.04)
      rig.knees[0].rotation.set(-0.14 - 0.28 * jump, 0, 0)
      rig.knees[1].rotation.set(-0.14 - 0.28 * jump, 0, 0)
      rig.ankles[0].rotation.set(0.08, 0, 0)
      rig.ankles[1].rotation.set(0.08, 0, 0)
      rig.arms[0].rotation.set(0.26, 0, 0.18)
      rig.arms[1].rotation.set(0.26, 0, -0.18)
      rig.elbows[0].rotation.set(0.52, 0, 0)
      rig.elbows[1].rotation.set(0.52, 0, 0)
      rig.plant(pose.lift)
      break
    }
    case 'celebrate': {
      const t = pose.phase
      const stride = Math.sin(t * 9.5) * 0.34
      const pump = Math.sin(t * 7.5) * 0.16
      const bounce = Math.abs(Math.sin(t * 9.5)) * 0.045
      rig.root.rotation.set(0.06, pose.yaw, -0.04 * stride, 'YXZ')
      rig.legs[0].rotation.set(stride, 0, -0.05)
      rig.legs[1].rotation.set(-stride, 0, 0.05)
      rig.knees[0].rotation.set(-0.18 - 0.45 * Math.max(0, -stride), 0, 0)
      rig.knees[1].rotation.set(-0.18 - 0.45 * Math.max(0, stride), 0, 0)
      rig.ankles[0].rotation.set(-0.1, 0, 0)
      rig.ankles[1].rotation.set(-0.1, 0, 0)
      // 双臂振臂高呼庆祝！
      rig.arms[0].rotation.set(2.38 + pump, 0, -0.46)
      rig.arms[1].rotation.set(2.38 - pump, 0, 0.46)
      rig.elbows[0].rotation.set(0.4, 0, 0)
      rig.elbows[1].rotation.set(0.4, 0, 0)
      rig.plant(bounce)
      break
    }
  }
}

export interface Highlight3DTheaterOptions {
  competitionLabel: string
  homeTeam: Highlight3DTeam
  awayTeam: Highlight3DTeam
  clips: Highlight3DClip[]
  initialIndex?: number
}

export async function openHighlight3DTheater(opts: Highlight3DTheaterOptions): Promise<void> {
  if (opts.clips.length === 0 || document.querySelector('.penalty-lab')) return

  const d = document.createElement('dialog')
  d.className = 'penalty-lab highlight3d-lab'
  d.setAttribute('aria-labelledby', 'hl3d-dialog-title')
  d.innerHTML = `
    <header class="lab-head">
      <div class="lab-title">
        <span class="lab-eyebrow">🎬 3D<span class="hl3d-long"> 高光特写剧场</span></span>
        <h2 id="hl3d-dialog-title">${esc(opts.homeTeam.name)} vs ${esc(opts.awayTeam.name)}</h2>
        <span class="lab-club">${esc(opts.competitionLabel)} · 共 ${opts.clips.length} 镜</span>
      </div>
      <button class="leave" type="button">关闭<span class="hl3d-long">剧场</span></button>
    </header>
    <div class="pitch3">
      <div class="hl3d-stage">
        <div class="ground"></div>
        <div class="hl3d-loading" data-hl3d-loading>正在布置 3D 球场与双方球衣模型…</div>
        <div class="hl3d-scorebug" data-hl3d-scorebug data-goal-flash="false">
          <span class="hl3d-sb-team">${crest(opts.homeTeam, 20)}<b>${esc(opts.homeTeam.name)}</b></span>
          <span class="hl3d-sb-score" data-hl3d-score>0 : 0</span>
          <span class="hl3d-sb-team"><b>${esc(opts.awayTeam.name)}</b>${crest(opts.awayTeam, 20)}</span>
          <span class="hl3d-sb-clock" data-hl3d-clock>1'</span>
        </div>
      </div>
      <div class="hl3d-cambar" role="toolbar" aria-label="3D 摄像机位">
        <button type="button" class="cam-chip is-active" data-cam-preset="default">🎬 导演跟拍</button>
        <button type="button" class="cam-chip" data-cam-preset="behind_goal">🥅 门后</button>
        <button type="button" class="cam-chip" data-cam-preset="side">📐 侧面</button>
        <button type="button" class="cam-chip" data-cam-preset="bird">🦅 俯瞰</button>
        <button type="button" class="cam-chip" data-hl3d-slow>0.5× 慢镜</button>
      </div>
      <div class="hl3d-lowerthird" data-hl3d-lt data-impact="none">
        <div class="hl3d-lt-main">
          <div class="hl3d-lt-top">
            <span class="hl3d-lt-badge" data-hl3d-badge></span>
            <span class="hl3d-lt-title" data-hl3d-title></span>
          </div>
          <div class="hl3d-lt-sub" data-hl3d-sub></div>
        </div>
        <span class="hl3d-lt-hint">拖拽画面旋转视角 · 滚轮缩放</span>
      </div>
    </div>
    <div class="hl3d-controls">
      <div class="hl3d-scrub-row">
        <div class="hl3d-scrub-wrap">
          <input type="range" class="hl3d-scrub" min="0" max="1000" step="1" value="0" data-hl3d-scrub aria-label="当前镜头进度" />
          <i class="hl3d-impact-tick" data-hl3d-tick style="left:60%" title="触球/破门时刻"></i>
        </div>
        <span class="hl3d-time" data-hl3d-time>0.0s / 0.0s</span>
      </div>
      <div class="hl3d-btn-bar">
        <div class="hl3d-btn-group">
          <button type="button" class="hl3d-btn" data-hl3d-act="prev" aria-label="上一镜" ${opts.clips.length <= 1 ? 'disabled' : ''}>⏮<span class="hl3d-long"> 上一镜</span></button>
          <button type="button" class="hl3d-btn is-primary" data-hl3d-act="toggle">⏸ 暂停</button>
          <button type="button" class="hl3d-btn" data-hl3d-act="replay" aria-label="重播本球">↻ 重播<span class="hl3d-long">本球</span></button>
          <button type="button" class="hl3d-btn" data-hl3d-act="next" aria-label="下一镜" ${opts.clips.length <= 1 ? 'disabled' : ''}><span class="hl3d-long">下一镜 </span>⏭</button>
        </div>
        <div class="hl3d-btn-group">
          <button type="button" class="hl3d-btn is-active" data-hl3d-act="auto" title="播完当前镜头后自动切到下一段高光"><span class="hl3d-long">自动</span>连播：开</button>
        </div>
      </div>
      <div class="hl3d-strip" role="tablist" aria-label="高光镜头列表">
        ${opts.clips
          .map(
            (c, idx) =>
              `<button type="button" class="hl3d-clip-pill ${idx === 0 ? 'is-active' : ''}" data-hl3d-clip="${idx}" title="${esc(c.title)}">${esc(c.badge.split(' ')[0])} ${esc(c.chipLabel)}</button>`,
          )
          .join('')}
      </div>
    </div>
  `

  document.body.append(d)
  d.showModal()

  const abort = new AbortController()
  const stageWrap = d.querySelector<HTMLElement>('.hl3d-stage')!
  const stage = d.querySelector<HTMLElement>('.ground')!
  const loadingEl = d.querySelector<HTMLElement>('[data-hl3d-loading]')!
  const scorebugEl = d.querySelector<HTMLElement>('[data-hl3d-scorebug]')!
  const scoreTextEl = d.querySelector<HTMLElement>('[data-hl3d-score]')!
  const clockTextEl = d.querySelector<HTMLElement>('[data-hl3d-clock]')!
  const ltEl = d.querySelector<HTMLElement>('[data-hl3d-lt]')!
  const badgeEl = d.querySelector<HTMLElement>('[data-hl3d-badge]')!
  const titleEl = d.querySelector<HTMLElement>('[data-hl3d-title]')!
  const subEl = d.querySelector<HTMLElement>('[data-hl3d-sub]')!
  const scrubEl = d.querySelector<HTMLInputElement>('[data-hl3d-scrub]')!
  const tickEl = d.querySelector<HTMLElement>('[data-hl3d-tick]')!
  const timeEl = d.querySelector<HTMLElement>('[data-hl3d-time]')!
  const toggleBtn = d.querySelector<HTMLButtonElement>('[data-hl3d-act="toggle"]')!
  const autoBtn = d.querySelector<HTMLButtonElement>('[data-hl3d-act="auto"]')!
  const slowBtn = d.querySelector<HTMLButtonElement>('[data-hl3d-slow]')!
  const presetBtns = [...d.querySelectorAll<HTMLButtonElement>('[data-cam-preset]')]
  const clipBtns = [...d.querySelectorAll<HTMLButtonElement>('[data-hl3d-clip]')]

  const unlockFrame = lockSetPieceFrame(d, stageWrap, abort.signal)

  let closed = false
  let rafId = 0
  let cleanupScene: (() => void) | null = null

  const closeTheater = () => {
    if (closed) return
    closed = true
    cancelAnimationFrame(rafId)
    abort.abort()
    unlockFrame()
    cleanupScene?.()
    if (d.open) d.close()
    d.remove()
  }

  d.querySelector<HTMLButtonElement>('.leave')!.addEventListener('click', closeTheater, { signal: abort.signal })
  d.addEventListener('close', closeTheater, { signal: abort.signal })

  let art: Awaited<ReturnType<typeof loadMatchday>>
  let view: ReturnType<typeof createGround>
  let assisterRig: RigActor
  let defenderRigs: RigActor[]

  try {
    art = await loadMatchday(opts.homeTeam)
    if (closed) {
      art.dispose()
      return
    }
    // 预热客队队徽缓存并生成助攻队友 + 4 名防守球员骨骼实例
    assisterRig = await art.spawnKitFigure(opts.homeTeam)
    defenderRigs = await Promise.all(
      Array.from({ length: 4 }, () => art.spawnKitFigure(opts.awayTeam)),
    )
    if (closed) {
      art.dispose()
      return
    }
    view = createGround(
      stage,
      art,
      `${opts.homeTeam.name} vs ${opts.awayTeam.name}  ·  FM WORLD 3D REPLAY`,
    )
    view.extras.add(assisterRig.root, ...defenderRigs.map((r) => r.root))
    cleanupScene = () => view.dispose()
    loadingEl.hidden = true
  } catch (err) {
    loadingEl.textContent = `当前浏览器环境未启用 WebGL 3D 渲染（${err instanceof Error ? err.message : '不可用'}）`
    return
  }

  let clipIdx = clamp(opts.initialIndex ?? 0, 0, opts.clips.length - 1)
  let elapsed = 0
  let playing = true
  let autoAdvance = true
  let slowMo = false
  let scrubbing = false
  let lastBannerText = ''
  let rekitToken = 0
  let activePreset: 'default' | 'behind_goal' | 'side' | 'bird' | 'free' = 'default'

  function syncButtons() {
    toggleBtn.textContent = playing ? '⏸ 暂停' : elapsed >= opts.clips[clipIdx].totalSec - 0.02 ? '↻ 重播' : '▶ 继续'
    autoBtn.classList.toggle('is-active', autoAdvance)
    autoBtn.innerHTML = autoAdvance ? '<span class="hl3d-long">自动</span>连播：开' : '<span class="hl3d-long">自动</span>连播：关'
    slowBtn.classList.toggle('is-active', slowMo)
    clipBtns.forEach((b, idx) => b.classList.toggle('is-active', idx === clipIdx))
    presetBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.camPreset === activePreset))
  }

  async function loadClip(nextIdx: number, autoPlay = true) {
    clipIdx = ((nextIdx % opts.clips.length) + opts.clips.length) % opts.clips.length
    const clip = opts.clips[clipIdx]
    elapsed = 0
    playing = autoPlay
    const myToken = ++rekitToken

    // 更新底部电视字幕条与时间轴爆点刻度
    badgeEl.textContent = clip.badge
    titleEl.textContent = clip.title
    subEl.textContent = clip.subtitle
    const impactPct = clamp(((clip.leadInSec + clip.flightSec) / clip.totalSec) * 100, 5, 95)
    tickEl.style.left = `${impactPct.toFixed(1)}%`

    if (activePreset === 'default') {
      view.resetCamera()
    }
    syncButtons()
    clipBtns[clipIdx]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })

    // 换装：主攻手与助攻者穿进攻方球衣，门将与后卫穿防守方球衣
    await Promise.all([
      art.kickerRig.rekit(clip.attackTeam, clip.striker),
      art.keeperRig.rekit(clip.defendTeam, clip.keeper),
      clip.assister ? assisterRig.rekit(clip.attackTeam, clip.assister) : Promise.resolve(),
      ...defenderRigs.map((rig, i) =>
        clip.defenders[i] ? rig.rekit(clip.defendTeam, clip.defenders[i]) : Promise.resolve(),
      ),
    ])
    if (closed || myToken !== rekitToken) return
    paintAt(elapsed)
  }

  function paintAt(tSec: number) {
    const clip = opts.clips[clipIdx]
    const frame = sampleHighlight3DFrame(clip, tSec)

    // 1. 摆好全员骨骼姿态与门将手套 IK
    poseActorRig(art.kickerRig, frame.striker)
    poseActorRig(assisterRig, frame.assister)
    for (let i = 0; i < defenderRigs.length; i++) {
      const defPose = frame.defenders[i]
      if (defPose) poseActorRig(defenderRigs[i], defPose)
      else defenderRigs[i].root.visible = false
    }
    art.poseKeeper(frame.keeperPose, frame.keeperPose.landed)

    // 2. 更新球场环场 LED 广告牌文字（仅在文案变化时重绘纹理）
    const nextBanner = frame.bannerActive
      ? clip.isGoal
        ? `GOAL!  ${clip.minuteLabel} ${clip.striker.name}  ·  ${clip.scoreAfter.home}:${clip.scoreAfter.away}`
        : clip.kind === 'save'
          ? `GREAT SAVE!  ${clip.keeper.name}`
          : `WOODWORK!  ${clip.minuteLabel} ${clip.striker.name}`
      : `${opts.homeTeam.name} vs ${opts.awayTeam.name}  ·  ${opts.competitionLabel}`
    if (nextBanner !== lastBannerText) {
      lastBannerText = nextBanner
      view.setBanner(nextBanner)
    }

    // 3. 更新电视转播比分牌与字幕状态
    scoreTextEl.textContent = `${frame.liveScore.home} : ${frame.liveScore.away}`
    clockTextEl.textContent = clip.minuteLabel
    scorebugEl.dataset.goalFlash = frame.bannerActive && clip.isGoal ? 'true' : 'false'
    ltEl.dataset.impact = !frame.bannerActive
      ? 'none'
      : clip.isGoal
        ? 'goal'
        : clip.outcome === 'frame'
          ? 'frame'
          : 'save'

    if (!scrubbing) {
      scrubEl.value = String(Math.round((tSec / clip.totalSec) * 1000))
    }
    timeEl.textContent = `${tSec.toFixed(1)}s / ${clip.totalSec.toFixed(1)}s`

    // 4. 更新皮球尾迹、导演机位并渲染
    view.path(frame.trail, false)
    view.setCinemaCamera(frame.cinemaCam.pos, frame.cinemaCam.look, frame.cinemaCam.fov, clip.spot)
    view.drawScene(frame.ball, frame.netHit, frame.sinceImpact, tSec, Math.sign(clip.curve || 1))
  }

  // 3D 视口自由拖拽旋转 / 双指缩放平移 / 滚轮缩放
  const pointers = new Map<number, { x: number; y: number; button: number; shift: boolean }>()
  let lastPinchDist = 0
  const evOpts: AddEventListenerOptions = { signal: abort.signal }

  stage.addEventListener('contextmenu', (e) => e.preventDefault(), evOpts)
  stage.addEventListener(
    'pointerdown',
    (e) => {
      stage.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    },
    evOpts,
  )
  stage.addEventListener(
    'pointermove',
    (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      prev.x = e.clientX
      prev.y = e.clientY
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (lastPinchDist > 8 && dist > 8) view.zoomCamera(lastPinchDist / dist)
        lastPinchDist = dist
        view.panCamera(dx * 0.5, dy * 0.5)
      } else if (prev.button === 2 || prev.button === 1 || prev.shift || e.shiftKey) {
        view.panCamera(dx, dy)
      } else {
        view.orbitCamera(dx * 0.0068, dy * 0.0052)
      }
      activePreset = 'free'
      syncButtons()
      if (!playing) paintAt(elapsed)
    },
    evOpts,
  )
  const releasePtr = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) lastPinchDist = 0
  }
  stage.addEventListener('pointerup', releasePtr, evOpts)
  stage.addEventListener('pointercancel', releasePtr, evOpts)
  stage.addEventListener('lostpointercapture', releasePtr, evOpts)
  stage.addEventListener(
    'wheel',
    (e) => {
      if (e.cancelable) e.preventDefault()
      view.zoomCamera(e.deltaY > 0 ? 1.09 : 0.92)
      activePreset = 'free'
      syncButtons()
      if (!playing) paintAt(elapsed)
    },
    { passive: false, signal: abort.signal },
  )

  // 按钮与进度条交互
  d.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('button')
      if (!btn) return
      const preset = btn.dataset.camPreset as 'default' | 'behind_goal' | 'side' | 'bird' | undefined
      if (preset) {
        activePreset = preset
        view.setCameraPreset(preset)
        syncButtons()
        paintAt(elapsed)
        return
      }
      if (btn.hasAttribute('data-hl3d-slow')) {
        slowMo = !slowMo
        syncButtons()
        return
      }
      if (btn.dataset.hl3dClip !== undefined) {
        void loadClip(Number(btn.dataset.hl3dClip), true)
        return
      }
      const act = btn.dataset.hl3dAct
      if (act === 'toggle') {
        const clip = opts.clips[clipIdx]
        if (!playing && elapsed >= clip.totalSec - 0.02) {
          elapsed = 0
        }
        playing = !playing
        syncButtons()
      } else if (act === 'replay') {
        elapsed = 0
        playing = true
        syncButtons()
        paintAt(0)
      } else if (act === 'prev') {
        void loadClip(clipIdx - 1, true)
      } else if (act === 'next') {
        void loadClip(clipIdx + 1, true)
      } else if (act === 'auto') {
        autoAdvance = !autoAdvance
        syncButtons()
      }
    },
    evOpts,
  )

  scrubEl.addEventListener(
    'input',
    () => {
      scrubbing = true
      playing = false
      const clip = opts.clips[clipIdx]
      elapsed = (Number(scrubEl.value) / 1000) * clip.totalSec
      syncButtons()
      paintAt(elapsed)
    },
    evOpts,
  )
  scrubEl.addEventListener(
    'change',
    () => {
      scrubbing = false
    },
    evOpts,
  )

  // 载入首段高光并启动 60fps 渲染循环
  await loadClip(clipIdx, true)
  if (closed) return

  let lastNow = performance.now()
  const tick = (now: number) => {
    if (closed) return
    const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000))
    lastNow = now
    const clip = opts.clips[clipIdx]
    if (playing) {
      elapsed += dt * (slowMo ? 0.45 : 1)
      if (elapsed >= clip.totalSec) {
        if (autoAdvance && opts.clips.length > 1 && clipIdx < opts.clips.length - 1) {
          void loadClip(clipIdx + 1, true)
        } else {
          elapsed = clip.totalSec
          playing = false
          syncButtons()
          paintAt(elapsed)
        }
      } else {
        paintAt(elapsed)
      }
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function buildWorldRosterLookup(): Map<string, RosterActorHint> {
  const map = new Map<string, RosterActorHint>()
  const register = (p: Player, teamName?: string) => {
    const hint: RosterActorHint = {
      id: p.id,
      seedId: p.seedId,
      name: p.name,
      enName: p.enName,
      country: p.country,
      number: p.number,
      height: p.height,
      appearanceId: p.appearanceId,
      attrs: { strength: p.attrs.strength, speed: p.attrs.speed },
    }
    map.set(p.id, hint)
    if (teamName) map.set(`${teamName}:${p.name}`, hint)
    if (!map.has(`name:${p.name}`)) map.set(`name:${p.name}`, hint)
  }
  for (const p of game?.roster ?? []) register(p, game?.clubName)
  for (const m of game?.youth?.members ?? []) register(m.player, game?.clubName)
  for (const t of game?.aiTeams ?? []) {
    for (const p of t.players) register(p, t.name)
  }
  for (const p of game?.freeStars ?? []) register(p)
  return map
}

/** 从赛后复盘战报打开 3D 高光剧场（可选直接定位到第 goalIndex 粒进球）。 */
export async function openRecordHighlight3D(record: MatchRecord, goalIndex?: number): Promise<void> {
  const homeRaw = clubLook(record.homeId).color
  const awayRaw = clubLook(record.awayId).color
  const kits =
    record.homeId === PLAYER_TEAM_ID
      ? { home: homeRaw, away: distinctKit(awayRaw, homeRaw) }
      : { home: distinctKit(homeRaw, awayRaw), away: awayRaw }

  const rosterLookup = buildWorldRosterLookup()
  const clips = buildHighlight3DClipsFromRecord(record, kits, rosterLookup)
  let initialIndex = 0
  if (goalIndex !== undefined && goalIndex >= 0) {
    const goalClips = clips.filter((c) => c.isGoal)
    const targetGoal = goalClips[goalIndex]
    if (targetGoal) initialIndex = targetGoal.index
  }

  const competitionLabel = record.isLeague ? `联赛第 ${record.round ?? 1} 轮` : pveModeLabel(record.mode, record.stage)
  await openHighlight3DTheater({
    competitionLabel,
    homeTeam: { name: record.homeName, color: kits.home },
    awayTeam: { name: record.awayName, color: kits.away },
    clips,
    initialIndex,
  })
}

/** 从全服聊天战报分享卡片打开 3D 进球/高光剧场。 */
export async function openSharedMatchHighlight3D(match: ChatSharedMatch, goalIndex?: number): Promise<void> {
  const homeKit = sanitizeChatColor(match.homeColor)
  const awayKit = distinctKit(sanitizeChatColor(match.awayColor), homeKit)
  const rosterLookup = buildWorldRosterLookup()
  const clips = buildHighlight3DClipsFromSharedMatch(match, { home: homeKit, away: awayKit }, rosterLookup)
  const initialIndex = goalIndex !== undefined ? clamp(goalIndex, 0, Math.max(0, clips.length - 1)) : 0
  await openHighlight3DTheater({
    competitionLabel: match.competition,
    homeTeam: { name: match.homeName, color: homeKit },
    awayTeam: { name: match.awayName, color: awayKit },
    clips,
    initialIndex,
  })
}
