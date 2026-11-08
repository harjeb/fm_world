/**
 * 新引擎（pes2d 物理 + 现有结算内核）的游戏适配器：对游戏和界面暴露和 `MatchEngine` 同样的接口
 * （`state / step / advanceTo / simulate / serialize / setTactics / substitute / availableBench / getTeam / snapshot`），
 * 这样赛程、实时联赛、友谊赛、战报、服务器都不用改成另一套写法，只要在创建和读档的地方选对引擎。
 *
 * 存档是一份 `MatchState`（和现有引擎同一种类型，`rulesVersion = 4`），外加 `pes` 字段里的物理比赛存档。
 * 状态里的时钟、比分、统计、文字直播（log / commentary）、球员体力每个模拟秒都会同步，所以比赛页的数据条和文字直播照常工作。
 */
import { MatchEngine } from '../match/engine.ts'
import type { MatchLogEntry, MatchMentality } from '../types.ts'
import type { MatchEngineOptions, MatchPlayerState, MatchSide, MatchState, MatchTeamState, StepResult } from '../match/types.ts'
import { PesGame } from './game.ts'
import type { PesSettlementJSON } from './settle.ts'
import type { PesMatchSnapshot } from './spec.ts'

export const PES_RULES_VERSION = 4

interface PesSaved {
  snapshot: PesMatchSnapshot
  extra: PesSettlementJSON['extra']
}

/** 这份比赛状态是新引擎存的吗。 */
export function isPesState(state: unknown): state is MatchState & { pes: PesSaved } {
  return !!state && typeof state === 'object' && (state as MatchState).rulesVersion === PES_RULES_VERSION && !!(state as { pes?: unknown }).pes
}

export class PesEngine {
  readonly kind = 'pes' as const
  readonly ruleSet = 'pes' as const
  readonly game: PesGame

  constructor(source: MatchEngineOptions | PesGame) {
    this.game = source instanceof PesGame
      ? source
      : new PesGame({
        seed: source.seed,
        home: source.home,
        away: source.away,
        knockout: source.knockout,
        durationSeconds: source.durationSeconds,
        offside: source.offside,
      })
  }

  /** 读档：`state` 必须是 `serialize()` 出来的那种。 */
  static restore(state: MatchState, _knockout = false): PesEngine {
    if (!isPesState(state)) throw new Error('不是新引擎的比赛存档')
    const { pes, ...game } = structuredClone(state)
    const snapshot: PesMatchSnapshot = { ...pes.snapshot, contact: { game, extra: pes.extra } satisfies PesSettlementJSON }
    return new PesEngine(PesGame.restore(snapshot))
  }

  get state(): MatchState {
    return this.game.state
  }

  /** 完整存档：游戏层的 MatchState（纯数据）+ 物理比赛存档。 */
  serialize(): MatchState {
    const snapshot = this.game.serialize()
    const contact = snapshot.contact as PesSettlementJSON
    snapshot.contact = null
    return { ...contact.game, pes: { snapshot, extra: contact.extra } satisfies PesSaved }
  }

  /** 推进约 1 个模拟秒；`realtime` 只是为了和现有引擎的签名一致。 */
  step(_realtime = false): StepResult {
    const logLength = this.state.log.length
    this.game.advance(1)
    return { state: this.state, entry: this.state.log.length > logLength ? this.state.log[this.state.log.length - 1] : null, finished: this.state.finished }
  }

  /**
   * 推进到目标比赛时刻（模拟秒）：比赛时钟没到 target 就继续走物理步，到了就停。
   * 最多只会越过 target 一个物理步（1/60 秒），文字直播的时钟精确到 0.1 秒，所以不会出现 target 之后的条目。
   * 死球（界外、角球、开球）期间时钟不走，会连着走到球重新发出。
   */
  advanceTo(targetClock: number): { changed: boolean; entries: MatchLogEntry[] } {
    const logStart = this.state.log.length
    let steps = 0
    while (!this.game.finished && this.game.match.time < targetClock && steps < 400_000) {
      this.game.step()
      steps++
    }
    return { changed: steps > 0, entries: this.state.log.slice(logStart) }
  }

  simulate(): MatchState {
    return this.game.run()
  }

  /** `eventClock`：联赛里这次调整对应的比赛时刻（现实时钟换算），播报按它记；不给就用比赛当前时刻。 */
  setTactics(mentality: MatchMentality, side: MatchSide = 'home', eventClock?: number): { ok: boolean; error?: string } {
    return this.game.setTactics(mentality, side, eventClock)
  }

  substitute(outId: string, inId: string, side: MatchSide = 'home', eventClock?: number, autoReason?: 'injury' | 'timed' | 'stamina'): { ok: boolean; error?: string } {
    return this.game.substitute(outId, inId, side, autoReason, eventClock)
  }

  availableBench(side: MatchSide = 'home'): MatchPlayerState[] {
    return this.game.availableBench(side)
  }

  getTeam(side: MatchSide): MatchTeamState {
    return this.state.teams[side === 'home' ? 0 : 1]
  }

  snapshot() {
    return {
      clock: this.state.clock,
      half: this.state.half,
      score: { ...this.state.score },
      ball: { ...this.state.ball },
      players: this.state.teams.flatMap((team) => team.players.filter((player) => player.onPitch).map((player) => ({
        id: player.id,
        name: player.name,
        number: player.number,
        side: player.side,
        x: player.x,
        y: player.y,
        stamina: player.stamina,
        position: player.position,
        onPitch: player.onPitch,
      }))),
    }
  }
}

/** 游戏和界面里“一场比赛的引擎”：现有的 MatchEngine 或新引擎。 */
export type GameEngine = MatchEngine | PesEngine

/** 按存档的样子选引擎：新引擎存的是 rulesVersion 4 带 pes 字段的状态，其余都是现有引擎。 */
export function restoreEngine(state: MatchState, knockout: boolean): GameEngine {
  return isPesState(state) ? PesEngine.restore(state, knockout) : MatchEngine.restore(state, knockout)
}
