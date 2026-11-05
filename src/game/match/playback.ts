import type { MatchPlaybackPose, MatchState } from './types.ts'

export const PLAYBACK_FRAME_LIMIT = 12

/** 只复制当前场上位置；快照与比赛状态之间不共享可变对象。 */
export function capturePlaybackPose(state: MatchState): MatchPlaybackPose {
  return {
    clock: state.clock,
    ball: { ...state.ball },
    players: state.teams.flatMap((team) =>
      [...team.players, ...team.bench]
        .filter((player) => player.onPitch)
        .map(({ id, x, y }) => ({ id, x, y })),
    ),
  }
}
