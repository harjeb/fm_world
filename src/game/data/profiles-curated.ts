import type { AttrKey } from '../types.ts'
import { profileFromWeights, type AttrProfile } from './attr-profile.ts'
import { normalizePlayerName } from './fm-match.ts'

/**
 * 手工画像：给「FM 导出表里查无此人」的球员写一份强弱分布。
 *
 * 这些人的共同点是导出表里没有真实评分（退役过早，或那份导出本身漏了），
 * 走风格画像的话，同风格的球员会长得一样——罗纳尔多和因扎吉都是 `st_poacher`，
 * 上限形状却该完全不同。这里按公开的球员特点逐条写：
 *
 *   - 只写「这个人强在哪」，不写数值表：键是属性名，值是 0-1 的相对权重；
 *   - 不写全 18 项，没写的用默认权重（0.3），和 FM 画像的处理方式一致；
 *   - 不搬 FM 的 1-20 评分，也不追求和 FM 对得上，目的只是「上限有形状」。
 *
 * 要加人：在下面表格里加一行，键写种子里的 `enName`，值写几个招牌属性即可。
 */
const CURATED: Record<string, Partial<Record<AttrKey, number>>> = {
  // 门将
  'Oliver Kahn': { reflexes: 1, oneOnOne: 0.95, handling: 0.9, composure: 0.95, anticipation: 0.85, decisions: 0.8, passing: 0.5 },
  'Peter Schmeichel': { reflexes: 1, oneOnOne: 0.9, handling: 0.9, rushing: 0.85, composure: 0.85, anticipation: 0.8, decisions: 0.8 },
  'Edwin van der Sar': { handling: 1, composure: 0.9, passing: 0.9, decisions: 0.85, reflexes: 0.85, rushing: 0.8, anticipation: 0.8 },

  // 中卫
  'Paolo Maldini': { defPos: 1, tackling: 0.95, anticipation: 0.95, decisions: 0.9, composure: 0.9, passing: 0.75, speed: 0.7 },
  'Fabio Cannavaro': { tackling: 1, defPos: 0.95, anticipation: 0.9, heading: 0.85, composure: 0.8, strength: 0.75, speed: 0.7 },
  'Jaap Stam': { tackling: 1, strength: 0.95, heading: 0.9, defPos: 0.9, anticipation: 0.8, speed: 0.75 },
  'Marcel Desailly': { tackling: 1, defPos: 0.95, strength: 0.9, anticipation: 0.85, speed: 0.8, teamwork: 0.75 },
  'Laurent Blanc': { passing: 1, defPos: 0.9, composure: 0.9, decisions: 0.85, anticipation: 0.85, heading: 0.8, vision: 0.7 },
  'Sol Campbell': { tackling: 1, strength: 0.95, heading: 0.9, defPos: 0.85, anticipation: 0.75, speed: 0.75 },
  'Lúcio': { strength: 1, tackling: 0.95, defPos: 0.85, heading: 0.85, passing: 0.7, speed: 0.7, dribbling: 0.6 },
  'Pepe': { tackling: 1, defPos: 0.95, heading: 0.9, strength: 0.9, anticipation: 0.85, composure: 0.6 },
  'Ronald Araújo': { speed: 1, tackling: 0.9, strength: 0.9, acceleration: 0.85, defPos: 0.8, heading: 0.8 },
  'Joško Gvardiol': { passing: 0.95, defPos: 0.9, speed: 0.9, tackling: 0.85, firstTouch: 0.8, strength: 0.8, dribbling: 0.75 },
  'Alessandro Bastoni': { passing: 1, defPos: 0.9, composure: 0.85, vision: 0.8, firstTouch: 0.8, tackling: 0.75 },

  // 边路 / 边后卫
  'Cafu': { offBall: 1, acceleration: 0.9, endurance: 0.9, dribbling: 0.8, passing: 0.75, tackling: 0.7 },
  'Bixente Lizarazu': { acceleration: 0.95, offBall: 0.9, passing: 0.85, endurance: 0.85, agility: 0.8, tackling: 0.7 },
  'Gianluca Zambrotta': { acceleration: 0.9, endurance: 0.9, offBall: 0.85, tackling: 0.85, passing: 0.75 },
  'Dani Alves': { offBall: 1, passing: 0.95, acceleration: 0.9, dribbling: 0.85, vision: 0.85, endurance: 0.85 },
  'Alphonso Davies': { acceleration: 1, speed: 1, dribbling: 0.85, agility: 0.85, offBall: 0.8, passing: 0.6 },
  'Achraf Hakimi': { acceleration: 0.95, speed: 0.95, offBall: 0.9, endurance: 0.85, passing: 0.8, shooting: 0.7 },
  'Luís Figo': { passing: 1, dribbling: 0.9, vision: 0.9, offBall: 0.85, firstTouch: 0.85, agility: 0.85, shooting: 0.7 },
  'David Beckham': { passing: 1, vision: 0.9, endurance: 0.9, composure: 0.85, teamwork: 0.85, offBall: 0.8, firstTouch: 0.8, speed: 0.4 },
  'Pavel Nedvěd': { endurance: 1, teamwork: 0.9, offBall: 0.85, shooting: 0.8, passing: 0.75, tackling: 0.7, acceleration: 0.7 },
  'Robert Pirès': { passing: 0.95, offBall: 0.9, dribbling: 0.85, firstTouch: 0.85, vision: 0.85, acceleration: 0.75 },
  'Ronaldinho': { dribbling: 1, firstTouch: 1, agility: 0.95, vision: 0.95, passing: 0.9, composure: 0.85, shooting: 0.8 },
  'Nico Williams': { acceleration: 1, dribbling: 0.95, speed: 0.9, agility: 0.9, offBall: 0.8, shooting: 0.65 },

  // 中场
  'Zinedine Zidane': { firstTouch: 1, dribbling: 1, vision: 0.95, passing: 0.95, composure: 0.9, strength: 0.75, offBall: 0.75 },
  'Kaká': { dribbling: 1, acceleration: 0.95, shooting: 0.85, passing: 0.85, offBall: 0.85, firstTouch: 0.85, strength: 0.7 },
  'Xavi Hernández': { passing: 1, vision: 1, decisions: 0.95, firstTouch: 0.9, composure: 0.9, teamwork: 0.8, offBall: 0.7 },
  'Paul Scholes': { passing: 1, vision: 0.9, shooting: 0.85, decisions: 0.85, composure: 0.8, offBall: 0.7, tackling: 0.55 },
  'Patrick Vieira': { tackling: 0.95, strength: 0.95, endurance: 0.9, defPos: 0.8, passing: 0.8, offBall: 0.75, dribbling: 0.65 },
  'Claude Makélélé': { defPos: 1, tackling: 0.95, anticipation: 0.9, teamwork: 0.85, decisions: 0.8, passing: 0.7 },
  'Michael Ballack': { shooting: 0.95, passing: 0.9, strength: 0.85, heading: 0.85, endurance: 0.85, offBall: 0.8, vision: 0.8 },
  'Pedri': { passing: 1, firstTouch: 0.95, vision: 0.9, composure: 0.9, dribbling: 0.8, offBall: 0.75, teamwork: 0.75 },
  'Gavi': { endurance: 1, teamwork: 0.95, tackling: 0.8, dribbling: 0.8, offBall: 0.8, passing: 0.7 },
  'Jamal Musiala': { dribbling: 1, agility: 1, firstTouch: 0.9, acceleration: 0.85, vision: 0.8, offBall: 0.8, shooting: 0.7 },
  'Joshua Kimmich': { passing: 1, vision: 0.9, teamwork: 0.9, decisions: 0.85, endurance: 0.85, offBall: 0.8, tackling: 0.7 },
  'Roy Keane': { teamwork: 1, tackling: 1, endurance: 0.9, defPos: 0.85, composure: 0.8, passing: 0.7 },
  'Gennaro Gattuso': { tackling: 1, defPos: 0.95, teamwork: 0.9, endurance: 0.9, anticipation: 0.85, passing: 0.6 },
  'Lothar Matthäus': { passing: 0.95, shooting: 0.9, vision: 0.9, offBall: 0.85, decisions: 0.85, endurance: 0.85, tackling: 0.8 },
  'Gheorghe Hagi': { vision: 1, passing: 1, firstTouch: 0.9, shooting: 0.85, composure: 0.85, dribbling: 0.8 },
  'Deco': { passing: 0.95, vision: 0.9, dribbling: 0.85, firstTouch: 0.85, offBall: 0.8, composure: 0.8, teamwork: 0.75 },
  'Jay-Jay Okocha': { dribbling: 1, agility: 1, firstTouch: 0.95, passing: 0.8, vision: 0.8, shooting: 0.7 },

  // 前锋
  'Ronaldo Nazário': { shooting: 1, dribbling: 1, acceleration: 0.95, offBall: 0.9, firstTouch: 0.9, composure: 0.85, strength: 0.8 },
  'Romário': { shooting: 1, offBall: 0.95, composure: 0.9, firstTouch: 0.9, agility: 0.9, dribbling: 0.85 },
  'Bebeto': { offBall: 0.95, firstTouch: 0.9, shooting: 0.85, composure: 0.8, dribbling: 0.8, passing: 0.8 },
  'Gabriel Batistuta': { shooting: 1, heading: 0.9, offBall: 0.85, composure: 0.85, strength: 0.8, firstTouch: 0.75 },
  'Jürgen Klinsmann': { shooting: 0.9, offBall: 0.9, heading: 0.85, firstTouch: 0.8, teamwork: 0.8, endurance: 0.8 },
  'Dennis Bergkamp': { firstTouch: 1, vision: 0.95, passing: 0.9, composure: 0.9, shooting: 0.85, offBall: 0.8 },
  'Alan Shearer': { shooting: 0.95, heading: 0.95, strength: 0.95, offBall: 0.85, composure: 0.8, firstTouch: 0.8 },
  'Gianfranco Zola': { firstTouch: 0.95, dribbling: 0.9, agility: 0.85, shooting: 0.85, passing: 0.85, vision: 0.8, offBall: 0.8 },
  'George Weah': { acceleration: 1, speed: 0.95, strength: 0.85, shooting: 0.85, dribbling: 0.85, offBall: 0.8 },
  'Hristo Stoichkov': { shooting: 1, dribbling: 0.85, offBall: 0.85, composure: 0.8, passing: 0.8, acceleration: 0.75 },
  'Roberto Baggio': { firstTouch: 1, dribbling: 0.95, composure: 0.9, shooting: 0.9, vision: 0.9, passing: 0.85 },
  'Alessandro Del Piero': { shooting: 0.95, firstTouch: 0.95, composure: 0.85, passing: 0.85, vision: 0.85, dribbling: 0.8 },
  'Michael Owen': { acceleration: 1, speed: 1, offBall: 0.9, shooting: 0.85, composure: 0.8, dribbling: 0.7 },
  'Patrick Kluivert': { strength: 0.9, firstTouch: 0.9, heading: 0.85, shooting: 0.8, passing: 0.75, dribbling: 0.7 },
  'Ruud van Nistelrooy': { shooting: 1, offBall: 0.95, anticipation: 0.85, firstTouch: 0.85, composure: 0.85, heading: 0.8 },
  'Andriy Shevchenko': { shooting: 1, offBall: 0.9, acceleration: 0.85, speed: 0.85, firstTouch: 0.85, composure: 0.8 },
  'Filippo Inzaghi': { offBall: 1, anticipation: 1, shooting: 0.9, composure: 0.8, firstTouch: 0.7, speed: 0.6 },
  'Christian Vieri': { strength: 1, heading: 0.95, shooting: 0.9, firstTouch: 0.8, offBall: 0.8, composure: 0.7 },
  'Eric Cantona': { firstTouch: 1, composure: 1, vision: 0.95, passing: 0.85, shooting: 0.85, strength: 0.8, offBall: 0.75 },
  'Rivaldo': { firstTouch: 1, dribbling: 0.95, shooting: 0.95, composure: 0.85, passing: 0.85, vision: 0.85 },

  // 2020s 现役（那份 FM24 导出漏了）
  'M. Ødegaard': { vision: 1, passing: 0.95, decisions: 0.9, firstTouch: 0.85, composure: 0.85, offBall: 0.8, teamwork: 0.8 },
  'F. Tomori': { speed: 1, acceleration: 0.9, tackling: 0.85, defPos: 0.8, strength: 0.75, anticipation: 0.75 },
  'Oyarzabal': { offBall: 0.95, shooting: 0.85, firstTouch: 0.85, passing: 0.85, vision: 0.8, composure: 0.8, teamwork: 0.8 },
  'Merino': { heading: 1, strength: 0.85, tackling: 0.85, anticipation: 0.85, teamwork: 0.85, passing: 0.8 },
  'P. Højbjerg': { tackling: 0.95, defPos: 0.85, passing: 0.85, endurance: 0.85, composure: 0.8, teamwork: 0.8 },
  'N. Schlotterbeck': { tackling: 0.9, speed: 0.85, passing: 0.85, defPos: 0.8, strength: 0.8, dribbling: 0.65 },
  'M. Locatelli': { passing: 0.95, decisions: 0.85, vision: 0.8, composure: 0.8, teamwork: 0.8, defPos: 0.75 },
  'T. Abraham': { strength: 0.9, heading: 0.85, shooting: 0.85, offBall: 0.8, firstTouch: 0.75 },
  'A. Danjuma': { acceleration: 1, dribbling: 0.95, agility: 0.85, shooting: 0.8, offBall: 0.75 },
  'Gayà': { offBall: 0.9, passing: 0.85, endurance: 0.85, acceleration: 0.8, tackling: 0.75 },
  'A. Kramarić': { shooting: 0.9, offBall: 0.85, firstTouch: 0.85, passing: 0.8, dribbling: 0.75 },
  'D. Zakaria': { strength: 1, tackling: 0.9, endurance: 0.85, defPos: 0.7, passing: 0.7, dribbling: 0.65 },
  'L. Torreira': { tackling: 0.95, anticipation: 0.9, teamwork: 0.85, defPos: 0.8, passing: 0.75 },
  'M. Uribe': { tackling: 0.9, strength: 0.85, endurance: 0.85, heading: 0.8, teamwork: 0.8, passing: 0.75 },
  'M. Guendouzi': { endurance: 0.95, passing: 0.85, offBall: 0.8, teamwork: 0.75, dribbling: 0.7, tackling: 0.65 },
  'R. Baku': { acceleration: 0.9, passing: 0.85, endurance: 0.85, offBall: 0.8, dribbling: 0.75 },
  'Y. En-Nesyri': { heading: 1, strength: 0.9, shooting: 0.85, offBall: 0.8, acceleration: 0.7 },
  'E. Konsa': { defPos: 0.9, tackling: 0.85, anticipation: 0.85, speed: 0.8, passing: 0.75, strength: 0.7 },
  'M. Hinteregger': { heading: 0.9, tackling: 0.9, strength: 0.85, defPos: 0.8, composure: 0.7 },
  'P. Hincapié': { speed: 0.9, tackling: 0.9, strength: 0.85, defPos: 0.8, heading: 0.75 },
  'L. Nmecha': { acceleration: 0.9, speed: 0.85, shooting: 0.8, offBall: 0.8, dribbling: 0.75 },
  'M. Niakhaté': { tackling: 0.9, strength: 0.9, heading: 0.85, defPos: 0.8, passing: 0.75 },
  'M. Almirón': { acceleration: 0.95, dribbling: 0.9, agility: 0.9, offBall: 0.8, shooting: 0.75 },
  'Santi Mina': { offBall: 0.85, shooting: 0.85, acceleration: 0.8, firstTouch: 0.75, dribbling: 0.75 },
  'S. Al Dawsari': { dribbling: 1, acceleration: 0.95, agility: 0.9, offBall: 0.75, shooting: 0.7 },
  'Vitolo': { dribbling: 0.85, offBall: 0.85, passing: 0.8, acceleration: 0.75, vision: 0.75, shooting: 0.7 },
}

/** 归一化后的索引，键与 `fmProfileFor` 一致（去掉重音、标点、大小写）。 */
let index: Map<string, AttrProfile> | undefined

export function curatedProfileFor(name: string | undefined): AttrProfile | undefined {
  if (!name) return undefined
  if (!index) {
    index = new Map()
    for (const [key, weights] of Object.entries(CURATED)) {
      index.set(normalizePlayerName(key), profileFromWeights(weights))
    }
  }
  return index.get(normalizePlayerName(name))
}

/** 手工画像覆盖的人数，供测试与文档核对。 */
export const CURATED_PROFILE_COUNT = Object.keys(CURATED).length
