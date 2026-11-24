// Deterministic 3D set-piece environment presets & physics modifiers (pure TS, shared by client & server).

export type WindCompass = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export type WeatherId = 'clear' | 'rain' | 'snow' | 'sandstorm'
export type SurfaceId = 'grass' | 'mud' | 'snow' | 'sand'

export interface PitchEnvironment {
  id: string
  label: string
  subtitle: string
  windDir: WindCompass
  /** Wind speed in m/s (0..22). */
  windSpeed: number
  weather: WeatherId
  surface: SurfaceId
}

export const WEATHER_LABELS: Record<WeatherId, string> = {
  clear: '晴朗夜场',
  rain: '倾盆暴雨',
  snow: '凛冬暴雪',
  sandstorm: '狂沙风暴',
}

export const SURFACE_LABELS: Record<SurfaceId, string> = {
  grass: '标准草皮',
  mud: '泥泞草地',
  snow: '积雪球场',
  sand: '松软沙地',
}

/**
 * Meteorological wind convention in stadium space:
 * - Goal line is z = 0, penalty/free-kick spot is +z (striker faces -z toward goal; +x is striker's right).
 * - North is behind the goal (-z). "东风 (E)" blows FROM East (+x) TO West (-x), i.e. toward striker's left (-x).
 * - "北风 (N)" blows FROM North (-z) TO South (+z), i.e. headwind (+z); "南风 (S)" is tailwind (-z).
 * - `screenDeg`: rotation angle (degrees, 0 = up/tailwind, 90 = right, 180 = down/headwind, -90 = left) for HUD arrow showing where wind pushes the ball on screen from kicker's view.
 */
export const WIND_DIRECTIONS: Record<
  WindCompass,
  { label: string; hint: string; vx: number; vz: number; screenDeg: number }
> = {
  N: { label: '北风', hint: '迎面逆风', vx: 0, vz: 1, screenDeg: 180 },
  NE: { label: '东北风', hint: '左偏逆风', vx: -Math.SQRT1_2, vz: Math.SQRT1_2, screenDeg: -135 },
  E: { label: '东风', hint: '向左侧横风', vx: -1, vz: 0, screenDeg: -90 },
  SE: { label: '东南风', hint: '左偏顺风', vx: -Math.SQRT1_2, vz: -Math.SQRT1_2, screenDeg: -45 },
  S: { label: '南风', hint: '背后顺风', vx: 0, vz: -1, screenDeg: 0 },
  SW: { label: '西南风', hint: '右偏顺风', vx: Math.SQRT1_2, vz: -Math.SQRT1_2, screenDeg: 45 },
  W: { label: '西风', hint: '向右侧横风', vx: 1, vz: 0, screenDeg: 90 },
  NW: { label: '西北风', hint: '右偏逆风', vx: Math.SQRT1_2, vz: Math.SQRT1_2, screenDeg: 135 },
}

export const ENVIRONMENT_PRESETS: Record<string, PitchEnvironment> = {
  standard: {
    id: 'standard',
    label: '标准晴夜',
    subtitle: '无风 · 晴朗夜场 · 标准草皮',
    windDir: 'S',
    windSpeed: 0,
    weather: 'clear',
    surface: 'grass',
  },
  sahara: {
    id: 'sahara',
    label: '狂沙风暴',
    subtitle: '东北风 18m/s · 沙尘暴 · 松软沙地',
    windDir: 'NE',
    windSpeed: 18,
    weather: 'sandstorm',
    surface: 'sand',
  },
  blizzard: {
    id: 'blizzard',
    label: '凛冬极寒',
    subtitle: '西北风 14m/s · 暴雪 · 积雪球场',
    windDir: 'NW',
    windSpeed: 14,
    weather: 'snow',
    surface: 'snow',
  },
  monsoon: {
    id: 'monsoon',
    label: '梅雨泥战',
    subtitle: '东南风 11m/s · 暴雨 · 泥泞草地',
    windDir: 'SE',
    windSpeed: 11,
    weather: 'rain',
    surface: 'mud',
  },
  gale: {
    id: 'gale',
    label: '海湾妖风',
    subtitle: '东风 16m/s · 晴朗夜场 · 标准草皮',
    windDir: 'E',
    windSpeed: 16,
    weather: 'clear',
    surface: 'grass',
  },
  winter_tailwind: {
    id: 'winter_tailwind',
    label: '冬歇雪夜',
    subtitle: '南风 8m/s · 飘雪 · 积雪球场',
    windDir: 'S',
    windSpeed: 8,
    weather: 'snow',
    surface: 'snow',
  },
}

export const ENVIRONMENT_LIST: readonly PitchEnvironment[] = Object.values(ENVIRONMENT_PRESETS)

/** One unified environment per season for 3D set-piece events (S3 starts with standard night pitch). */
const SEASON_ENV_ROTATION = ['standard', 'sahara', 'blizzard', 'monsoon', 'gale', 'winter_tailwind'] as const

export function seasonEnvironmentFor(seasonIndex: number): PitchEnvironment {
  const offset = Math.max(0, Math.floor(seasonIndex) - 3)
  const key = SEASON_ENV_ROTATION[offset % SEASON_ENV_ROTATION.length]
  return ENVIRONMENT_PRESETS[key]
}

export interface EnvironmentPhysics {
  /** World-space wind velocity (m/s). +x = striker right, +z = headwind toward spot, -z = tailwind toward goal. */
  windX: number
  windZ: number
  /** Multiplier on `drive` power sweet-spot width (muddy footing narrows heavy strikes). */
  driveGreenScale: number
  /** Multiplier on `chip` / lofted scoop sweet-spot width (sand allows clean scoop under ball). */
  chipGreenScale: number
  /** Multiplier on meter cycle duration (<1 = faster cursor in freezing blizzard). */
  cycleScale: number
  /** Speed multiplier for low skimming / ground shots (snow skids faster; mud & sand bog down). */
  groundSpeedScale: number
  /** Goalkeeper push-off acceleration multiplier on slippery/soft surfaces. */
  keeperAccelScale: number
  /** Wet-glove handling penalty (0..0.35; positive reduces clean catch radius, causing more parries/spills). */
  wetGlovePenalty: number
  /** Use high-visibility winter orange match ball. */
  hiVisBall: boolean
}

export function isStandardEnvironment(env?: PitchEnvironment | null): boolean {
  return !env || (env.windSpeed === 0 && env.weather === 'clear' && env.surface === 'grass')
}

export function environmentPhysics(env?: PitchEnvironment | null): EnvironmentPhysics {
  if (!env || isStandardEnvironment(env)) {
    return {
      windX: 0,
      windZ: 0,
      driveGreenScale: 1,
      chipGreenScale: 1,
      cycleScale: 1,
      groundSpeedScale: 1,
      keeperAccelScale: 1,
      wetGlovePenalty: 0,
      hiVisBall: false,
    }
  }
  const dir = WIND_DIRECTIONS[env.windDir]
  const speed = Math.max(0, Math.min(24, env.windSpeed))
  return {
    windX: dir.vx * speed,
    windZ: dir.vz * speed,
    driveGreenScale: env.surface === 'mud' ? 0.82 : env.surface === 'snow' ? 0.92 : 1,
    chipGreenScale: env.surface === 'sand' ? 1.22 : env.surface === 'mud' ? 0.9 : 1,
    cycleScale: env.weather === 'snow' ? 0.9 : env.weather === 'sandstorm' ? 0.94 : 1,
    groundSpeedScale:
      env.surface === 'snow'
        ? 1.16
        : env.surface === 'mud'
          ? 0.76
          : env.surface === 'sand'
            ? 0.72
            : env.weather === 'rain'
              ? 1.07
              : 1,
    keeperAccelScale:
      env.surface === 'mud' ? 0.89 : env.surface === 'sand' ? 0.87 : env.surface === 'snow' ? 0.92 : 1,
    wetGlovePenalty: env.weather === 'rain' ? 0.22 : env.weather === 'snow' ? 0.1 : 0,
    hiVisBall: env.surface === 'snow',
  }
}

export function environmentHudSummary(env: PitchEnvironment): {
  windText: string
  detailText: string
  screenDeg: number
  hasWind: boolean
} {
  const dir = WIND_DIRECTIONS[env.windDir]
  const hasWind = env.windSpeed > 0.1
  return {
    windText: hasWind ? `${dir.label} ${Math.round(env.windSpeed)}m/s` : '无风 0m/s',
    detailText: `${WEATHER_LABELS[env.weather]} · ${SURFACE_LABELS[env.surface]}`,
    screenDeg: dir.screenDeg,
    hasWind,
  }
}
