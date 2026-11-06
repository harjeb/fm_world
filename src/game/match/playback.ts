import type { MatchPlaybackPose, MatchState } from './types.ts'

export const PLAYBACK_FRAME_LIMIT = 12
/** v3 每 0.1 秒一帧、保留 18 秒逻辑时间：联赛 15× 下约 1.2 秒，够跨过同步间隔。 */
export const PLAYBACK_FRAME_LIMIT_V3 = 180

const round2 = (value: number) => Math.round(value * 100) / 100

/** 只复制当前场上位置；快照与比赛状态之间不共享可变对象。坐标到厘米，够画也不需要发长小数。 */
export function capturePlaybackPose(state: MatchState): MatchPlaybackPose {
  return {
    clock: state.clock,
    ball: { ...state.ball, x: round2(state.ball.x), y: round2(state.ball.y) },
    players: state.teams.flatMap((team) =>
      [...team.players, ...team.bench]
        .filter((player) => player.onPitch)
        .map(({ id, x, y }) => ({ id, x: round2(x), y: round2(y) })),
    ),
  }
}
