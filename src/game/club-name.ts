/** 俱乐部名字最多几个字（按字符算，中文、字母、数字都算 1 个）。 */
export const CLUB_NAME_MAX = 8

/** 去掉首尾空白，中间连续空白合成一个。 */
export function normalizeClubName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
}

/** 比较重名时忽略大小写和空格：“FC 北京”和“fc北京”算同一个名字。 */
export function clubNameKey(name: string): string {
  return normalizeClubName(name).replace(/\s+/g, '').toLowerCase()
}

/**
 * 新名字不合法时返回原因，合法返回 null。
 * taken 是不能重名的名字（全服其他球队，含 AI 球队和别的教练的球队）。
 */
export function clubNameError(name: string, taken: Iterable<string>): string | null {
  if (!name) return '俱乐部名字不能为空'
  const length = [...name].length
  if (length > CLUB_NAME_MAX) return `俱乐部名字最多 ${CLUB_NAME_MAX} 个字（现在 ${length} 个）`
  // 控制字符和尖括号会破坏显示，直接拒绝。
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return '俱乐部名字不能包含特殊符号'
  const key = clubNameKey(name)
  for (const other of taken) {
    if (clubNameKey(other) === key) return `已经有一支叫「${other}」的球队了，换个名字吧`
  }
  return null
}
