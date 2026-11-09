/** 内联线性图标，统一 20×20 网格、1.6 描边，跟随文字颜色。 */
const PATHS = {
  home: 'M3 3h6v7H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 12h6v5H3z',
  cards: 'M7.5 2.5h9v12.5h-9zM7.5 5.5H3.5v12h9V15',
  grip: 'M7.5 5v.01M12.5 5v.01M7.5 10v.01M12.5 10v.01M7.5 15v.01M12.5 15v.01',
  chevron: 'M5 8l5 5 5-5',
  up: 'M10 16V4M5 9l5-5 5 5',
  down: 'M10 4v12M5 11l5 5 5-5',
  lineup: 'M3.5 2.5h13v15h-13zM3.5 10h13M10 7.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM7 2.5v2.8h6V2.5M7 17.5v-2.8h6v2.8',
  academy: 'M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 17c0-3 2.2-5 5-5s5 2 5 5M13 3.4a3 3 0 0 1 0 5.2M14.5 12.4c1.9.6 3 2.4 3 4.6',
  training: 'M3 14.5l4.5-4.5 3 3L17 6.5M12.5 6.5H17V11',
  season: 'M3.5 5h13v12h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5',
  world: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM2.5 10h15M10 2.5c2.2 2 3.2 4.6 3.2 7.5s-1 5.5-3.2 7.5c-2.2-2-3.2-4.6-3.2-7.5s1-5.5 3.2-7.5z',
  challenge: 'M11 2.5 5 11h4.5L9 17.5 15 9h-4.5L11 2.5z',
  review: 'M4 17V10M10 17V3.5M16 17v-5.5M2.5 17.5h15',
  club: 'M3 17h14M4.5 17V8.5M15.5 17V8.5M8.2 17V8.5M11.8 17V8.5M2.5 8.5 10 3l7.5 5.5z',
  live: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM8.3 7l4.6 3-4.6 3z',
  user: 'M10 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 17.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6',
  plus: 'M10 4v12M4 10h12',
  close: 'M5 5l10 10M15 5 5 15',
  left: 'M12.5 4.5 7 10l5.5 5.5',
  right: 'M7.5 4.5 13 10l-5.5 5.5',
  clock: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10 5.8V10l2.8 1.8',
  lock: 'M5.5 9V7a4.5 4.5 0 0 1 9 0v2M4 9h12v8H4zM10 12v2',
  coin: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM7 6.5l3 3.7 3-3.7M10 10.2V14M7.6 11.4h4.8',
  alert: 'M10 3l8 14H2zM10 8.2v4.2M10 14.6v.2',
  check: 'M4 10.5l4 4 8-9',
  cross: 'M8 3h4v5h5v4h-5v5H8v-5H3V8h5z',
  star: 'M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z',
  info: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10 9v4.6M10 6.3v.2',
  search: 'M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM13 13l4 4',
  swap: 'M4 7h11l-3-3M16 13H5l3 3',
  flag: 'M5 17.5V3M5 3.5h10l-2.2 3.5 2.2 3.5H5',
  pause: 'M6.5 4v12M13.5 4v12',
  skip: 'M4.5 4.5l7.5 5.5-7.5 5.5zM15.5 4.5v11',
  coach: 'M6 4H4.5v13.5h11V4H14M7 2.5h6v3H7zM7.5 9.5h5M7.5 13h5',
  stadium: 'M2.5 8c0-2 3.4-3.5 7.5-3.5s7.5 1.5 7.5 3.5v4.5c0 2-3.4 3.5-7.5 3.5s-7.5-1.5-7.5-3.5zM2.5 8c0 2 3.4 3.5 7.5 3.5s7.5-1.5 7.5-3.5',
  cap: 'M10 4 2 8l8 4 8-4zM5.5 10v4c2.7 1.8 6.3 1.8 9 0v-4',
  bag: 'M4.5 7h11l1 10.5h-13zM7.5 9V5.5a2.5 2.5 0 0 1 5 0V9',
  badge: 'M10 2.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM7 11.5l-1 6 4-2 4 2-1-6',
  newgame: 'M4 10a6 6 0 1 1 1.8 4.3M4 15v-4h4',
  tactics: 'M3 17.5 3 8l4.5 2.5V8L12 10.5V8l5 3-5 3v-2.5L7.5 15v2.5z',
  psychology: 'M10 3.2a4.4 4.4 0 0 1 4.2 5.7c.8.9 1.3 2 1.3 3.2 0 2.6-2.1 4.7-4.7 4.7-1.6 0-3-.8-3.9-2M10 3.2a4.4 4.4 0 0 0-4.2 5.7c-.8.9-1.3 2-1.3 3.2 0 1.1.4 2.2 1.1 3M8.4 9.6h.2M11.6 9.6h.2M8.6 12.8c.9.6 2 .6 2.9 0',
} as const

export type IconName = keyof typeof PATHS | 'play'

export function icon(name: IconName, size = 16): string {
  const attrs = `class="ico" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"`
  if (name === 'play') return `<svg ${attrs} fill="currentColor"><path d="M6 3.8 16 10 6 16.2z"/></svg>`
  return `<svg ${attrs} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[name]}"/></svg>`
}
