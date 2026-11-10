import type { AttrKey, Attributes, BaseTraitId, Foot, Position, PositionTable, Player, SkillId, StyleId, TraitId } from '../types.ts'
import { starTraitId, traitNameOf } from './star-traits.ts'
import { ALL_ATTRIBUTES, GK_ATTRIBUTES, POSITIONS } from '../types.ts'
import { caCeilingOf, caOf } from '../ca.ts'
import { attrLimit, attrMax, attrStorage } from '../scale.ts'
import { CEILING_JITTER, ceilingRoom, normalizeCeilings, profileFromWeights } from './attr-profile.ts'
import { fmProfileFor } from './fm-profiles.generated.ts'
import { curatedProfileFor } from './profiles-curated.ts'
import { canLearnSkill, TRAITS } from './skills.ts'
import { EXTRA_SEEDS } from './extra-stars.ts'

export type PlayerSeed = {
  id: string
  name: string
  enName: string
  country: string
  era: string
  tier: number
  pos: Position
  style: StyleId
  foot: Foot
  height: number
}

export type SeedTuple = [
  name: string,
  enName: string,
  country: string,
  era: string,
  tier: number,
  pos: Position,
  style: StyleId,
  foot?: Foot,
  height?: number,
]

/**
 * 1990 年代至当前的 200 名真实球星姓名。
 * 属性、潜力和位置由下方生成器按位置/风格生成，是玩法原型数据，不是真实球员能力还原。
 * 正式发行前需要单独确认姓名与肖像授权。
 */
const BASE_SEEDS: SeedTuple[] = [
  // 门将 20
  ['布冯', 'Gianluigi Buffon', '意大利', '1990s', 5, 'GK', 'gk_wall', 'R', 193],
  ['卡恩', 'Oliver Kahn', '德国', '1990s', 5, 'GK', 'gk_wall', 'R', 188],
  ['舒梅切尔', 'Peter Schmeichel', '丹麦', '1990s', 5, 'GK', 'gk_wall', 'R', 191],
  ['范德萨', 'Edwin van der Sar', '荷兰', '1990s', 4, 'GK', 'gk_sweeper', 'R', 197],
  ['卡西利亚斯', 'Iker Casillas', '西班牙', '2000s', 5, 'GK', 'gk_shotstopper', 'R', 185],
  ['切赫', 'Petr Čech', '捷克', '2000s', 5, 'GK', 'gk_wall', 'R', 196],
  ['塞萨尔', 'Júlio César', '巴西', '2000s', 4, 'GK', 'gk_shotstopper', 'R', 186],
  ['诺伊尔', 'Manuel Neuer', '德国', '2010s', 5, 'GK', 'gk_sweeper', 'R', 193],
  ['德赫亚', 'David de Gea', '西班牙', '2010s', 4, 'GK', 'gk_shotstopper', 'R', 192],
  ['库尔图瓦', 'Thibaut Courtois', '比利时', '2010s', 5, 'GK', 'gk_wall', 'R', 199],
  ['奥布拉克', 'Jan Oblak', '斯洛文尼亚', '2010s', 5, 'GK', 'gk_wall', 'R', 188],
  ['特尔施特根', 'Marc-André ter Stegen', '德国', '2010s', 4, 'GK', 'gk_sweeper', 'R', 187],
  ['洛里', 'Hugo Lloris', '法国', '2010s', 4, 'GK', 'gk_shotstopper', 'R', 188],
  ['纳瓦斯', 'Keylor Navas', '哥斯达黎加', '2010s', 3, 'GK', 'gk_shotstopper', 'R', 185],
  ['阿利松', 'Alisson Becker', '巴西', '2010s', 5, 'GK', 'gk_sweeper', 'R', 193],
  ['埃德森', 'Ederson Moraes', '巴西', '2010s', 4, 'GK', 'gk_sweeper', 'R', 188],
  ['多纳鲁马', 'Gianluigi Donnarumma', '意大利', '2020s', 4, 'GK', 'gk_wall', 'R', 196],
  ['迈尼昂', 'Mike Maignan', '法国', '2020s', 4, 'GK', 'gk_sweeper', 'R', 191],
  ['马丁内斯', 'Emiliano Martínez', '阿根廷', '2020s', 3, 'GK', 'gk_shotstopper', 'R', 195],
  ['拉亚', 'David Raya', '西班牙', '2020s', 3, 'GK', 'gk_sweeper', 'R', 183],

  // 中卫 30
  ['马尔蒂尼', 'Paolo Maldini', '意大利', '1990s', 5, 'CB', 'cb_cover', 'L', 186],
  ['卡纳瓦罗', 'Fabio Cannavaro', '意大利', '1990s', 5, 'CB', 'cb_stopper', 'R', 175],
  ['内斯塔', 'Alessandro Nesta', '意大利', '1990s', 5, 'CB', 'cb_cover', 'R', 187],
  ['斯塔姆', 'Jaap Stam', '荷兰', '1990s', 4, 'CB', 'cb_stopper', 'R', 190],
  ['德塞利', 'Marcel Desailly', '法国', '1990s', 4, 'CB', 'cb_stopper', 'R', 185],
  ['布兰克', 'Laurent Blanc', '法国', '1990s', 4, 'CB', 'cb_ballplaying', 'R', 192],
  ['坎贝尔', 'Sol Campbell', '英格兰', '1990s', 4, 'CB', 'cb_stopper', 'R', 188],
  ['卢西奥', 'Lúcio', '巴西', '2000s', 4, 'CB', 'cb_stopper', 'R', 188],
  ['费迪南德', 'Rio Ferdinand', '英格兰', '2000s', 5, 'CB', 'cb_ballplaying', 'R', 189],
  ['维迪奇', 'Nemanja Vidić', '塞尔维亚', '2000s', 5, 'CB', 'cb_stopper', 'R', 190],
  ['特里', 'John Terry', '英格兰', '2000s', 5, 'CB', 'cb_stopper', 'R', 187],
  ['普约尔', 'Carles Puyol', '西班牙', '2000s', 5, 'CB', 'cb_stopper', 'R', 178],
  ['皮克', 'Gerard Piqué', '西班牙', '2010s', 5, 'CB', 'cb_ballplaying', 'R', 194],
  ['拉莫斯', 'Sergio Ramos', '西班牙', '2000s', 5, 'CB', 'cb_stopper', 'R', 184],
  ['佩佩', 'Pepe', '葡萄牙', '2010s', 4, 'CB', 'cb_stopper', 'R', 187],
  ['卡瓦略', 'Ricardo Carvalho', '葡萄牙', '2000s', 4, 'CB', 'cb_cover', 'R', 183],
  ['蒂亚戈·席尔瓦', 'Thiago Silva', '巴西', '2010s', 5, 'CB', 'cb_cover', 'R', 181],
  ['基耶利尼', 'Giorgio Chiellini', '意大利', '2010s', 5, 'CB', 'cb_stopper', 'L', 187],
  ['博努奇', 'Leonardo Bonucci', '意大利', '2010s', 4, 'CB', 'cb_ballplaying', 'R', 191],
  ['胡梅尔斯', 'Mats Hummels', '德国', '2010s', 4, 'CB', 'cb_ballplaying', 'R', 191],
  ['博阿滕', 'Jérôme Boateng', '德国', '2010s', 4, 'CB', 'cb_cover', 'R', 192],
  ['范戴克', 'Virgil van Dijk', '荷兰', '2010s', 5, 'CB', 'cb_cover', 'L', 193],
  ['瓦拉内', 'Raphaël Varane', '法国', '2010s', 4, 'CB', 'cb_cover', 'R', 191],
  ['吕迪格', 'Antonio Rüdiger', '德国', '2020s', 4, 'CB', 'cb_stopper', 'R', 190],
  ['鲁本·迪亚斯', 'Rúben Dias', '葡萄牙', '2020s', 5, 'CB', 'cb_cover', 'R', 187],
  ['萨利巴', 'William Saliba', '法国', '2020s', 4, 'CB', 'cb_cover', 'R', 192],
  ['阿劳霍', 'Ronald Araújo', '乌拉圭', '2020s', 3, 'CB', 'cb_stopper', 'R', 191],
  ['格瓦迪奥尔', 'Joško Gvardiol', '克罗地亚', '2020s', 4, 'CB', 'cb_ballplaying', 'L', 185],
  ['巴斯托尼', 'Alessandro Bastoni', '意大利', '2020s', 4, 'CB', 'cb_ballplaying', 'L', 190],
  ['马尔基尼奥斯', 'Marquinhos', '巴西', '2010s', 4, 'CB', 'cb_cover', 'R', 183],

  // 边路（含边后卫）18
  ['卡福', 'Cafu', '巴西', '1990s', 5, 'W', 'fb_attacking', 'R', 176],
  ['罗伯特·卡洛斯', 'Roberto Carlos', '巴西', '1990s', 5, 'W', 'fb_attacking', 'L', 168],
  ['利扎拉祖', 'Bixente Lizarazu', '法国', '1990s', 4, 'W', 'fb_attacking', 'L', 169],
  ['赞布罗塔', 'Gianluca Zambrotta', '意大利', '1990s', 4, 'W', 'fb_attacking', 'R', 181],
  ['阿什利·科尔', 'Ashley Cole', '英格兰', '2000s', 5, 'W', 'fb_attacking', 'L', 176],
  ['拉姆', 'Philipp Lahm', '德国', '2000s', 5, 'W', 'fb_playmaker', 'R', 170],
  ['阿尔维斯', 'Dani Alves', '巴西', '2000s', 5, 'W', 'fb_attacking', 'R', 172],
  ['马塞洛', 'Marcelo', '巴西', '2010s', 5, 'W', 'fb_attacking', 'L', 174],
  ['沃克', 'Kyle Walker', '英格兰', '2010s', 4, 'W', 'fb_attacking', 'R', 183],
  ['阿尔巴', 'Jordi Alba', '西班牙', '2010s', 4, 'W', 'fb_attacking', 'L', 170],
  ['阿诺德', 'Trent Alexander-Arnold', '英格兰', '2010s', 5, 'W', 'fb_playmaker', 'R', 180],
  ['罗伯逊', 'Andrew Robertson', '苏格兰', '2010s', 4, 'W', 'fb_attacking', 'L', 178],
  ['特里皮尔', 'Kieran Trippier', '英格兰', '2010s', 3, 'W', 'fb_playmaker', 'R', 178],
  ['阿方索·戴维斯', 'Alphonso Davies', '加拿大', '2020s', 4, 'W', 'fb_attacking', 'L', 183],
  ['哈基米', 'Achraf Hakimi', '摩洛哥', '2020s', 4, 'W', 'fb_attacking', 'R', 181],
  ['特奥·埃尔南德斯', 'Theo Hernández', '法国', '2020s', 4, 'W', 'fb_attacking', 'L', 184],
  ['坎塞洛', 'João Cancelo', '葡萄牙', '2020s', 4, 'W', 'fb_playmaker', 'R', 182],
  ['弗林蓬', 'Jeremie Frimpong', '荷兰', '2020s', 3, 'W', 'fb_attacking', 'R', 171],

  // 边锋 32
  ['菲戈', 'Luís Figo', '葡萄牙', '1990s', 5, 'W', 'w_crosser', 'R', 180],
  ['吉格斯', 'Ryan Giggs', '威尔士', '1990s', 5, 'W', 'w_dribbler', 'L', 179],
  ['贝克汉姆', 'David Beckham', '英格兰', '1990s', 5, 'W', 'w_crosser', 'R', 180],
  ['内德维德', 'Pavel Nedvěd', '捷克', '1990s', 5, 'W', 'w_engine', 'R', 177],
  ['皮雷', 'Robert Pirès', '法国', '2000s', 4, 'W', 'w_crosser', 'R', 185],
  ['罗本', 'Arjen Robben', '荷兰', '2000s', 5, 'W', 'w_dribbler', 'L', 180],
  ['里贝里', 'Franck Ribéry', '法国', '2000s', 5, 'W', 'w_dribbler', 'R', 170],
  ['梅西', 'Lionel Messi', '阿根廷', '2000s', 5, 'W', 'w_playmaker', 'L', 170],
  ['C罗', 'Cristiano Ronaldo', '葡萄牙', '2000s', 5, 'W', 'w_finisher', 'R', 187],
  ['罗纳尔迪尼奥', 'Ronaldinho', '巴西', '2000s', 5, 'W', 'w_playmaker', 'R', 182],
  ['内马尔', 'Neymar Jr', '巴西', '2010s', 5, 'W', 'w_dribbler', 'R', 175],
  ['贝尔', 'Gareth Bale', '威尔士', '2010s', 5, 'W', 'w_finisher', 'L', 185],
  ['阿扎尔', 'Eden Hazard', '比利时', '2010s', 5, 'W', 'w_dribbler', 'R', 175],
  ['迪马利亚', 'Ángel Di María', '阿根廷', '2010s', 5, 'W', 'w_crosser', 'L', 180],
  ['萨拉赫', 'Mohamed Salah', '埃及', '2010s', 5, 'W', 'w_finisher', 'L', 175],
  ['马内', 'Sadio Mané', '塞内加尔', '2010s', 5, 'W', 'w_finisher', 'R', 175],
  ['斯特林', 'Raheem Sterling', '英格兰', '2010s', 4, 'W', 'w_dribbler', 'R', 172],
  ['格纳布里', 'Serge Gnabry', '德国', '2010s', 4, 'W', 'w_finisher', 'R', 176],
  ['科曼', 'Kingsley Coman', '法国', '2010s', 4, 'W', 'w_dribbler', 'R', 180],
  ['桑乔', 'Jadon Sancho', '英格兰', '2010s', 3, 'W', 'w_dribbler', 'R', 180],
  ['福登', 'Phil Foden', '英格兰', '2020s', 4, 'W', 'w_playmaker', 'L', 171],
  ['萨卡', 'Bukayo Saka', '英格兰', '2020s', 4, 'W', 'w_crosser', 'L', 178],
  ['维尼修斯', 'Vinícius Júnior', '巴西', '2020s', 5, 'W', 'w_dribbler', 'R', 176],
  ['罗德里戈', 'Rodrygo', '巴西', '2020s', 4, 'W', 'w_finisher', 'R', 174],
  ['拉菲尼亚', 'Raphinha', '巴西', '2020s', 4, 'W', 'w_crosser', 'L', 176],
  ['亚马尔', 'Lamine Yamal', '西班牙', '2020s', 4, 'W', 'w_playmaker', 'L', 180],
  ['登贝莱', 'Ousmane Dembélé', '法国', '2020s', 4, 'W', 'w_dribbler', 'R', 178],
  ['克瓦拉茨赫利亚', 'Khvicha Kvaratskhelia', '格鲁吉亚', '2020s', 4, 'W', 'w_dribbler', 'R', 183],
  ['莱奥', 'Rafael Leão', '葡萄牙', '2020s', 4, 'W', 'w_dribbler', 'R', 188],
  ['尼科·威廉姆斯', 'Nico Williams', '西班牙', '2020s', 3, 'W', 'w_dribbler', 'R', 181],
  ['奥利塞', 'Michael Olise', '法国', '2020s', 4, 'W', 'w_playmaker', 'L', 183],
  ['孙兴慜', 'Son Heung-min', '韩国', '2010s', 5, 'W', 'w_finisher', 'R', 183],

  // 中场 50
  ['齐达内', 'Zinedine Zidane', '法国', '1990s', 5, 'CM', 'cm_playmaker', 'R', 185],
  ['卡卡', 'Kaká', '巴西', '2000s', 5, 'CM', 'cm_mezzala', 'R', 186],
  ['皮尔洛', 'Andrea Pirlo', '意大利', '2000s', 5, 'CM', 'cm_playmaker', 'R', 177],
  ['哈维', 'Xavi Hernández', '西班牙', '2000s', 5, 'CM', 'cm_playmaker', 'R', 170],
  ['伊涅斯塔', 'Andrés Iniesta', '西班牙', '2000s', 5, 'CM', 'cm_creator', 'R', 171],
  ['布斯克茨', 'Sergio Busquets', '西班牙', '2010s', 5, 'CM', 'cm_destroyer', 'R', 189],
  ['杰拉德', 'Steven Gerrard', '英格兰', '2000s', 5, 'CM', 'cm_box2box', 'R', 185],
  ['兰帕德', 'Frank Lampard', '英格兰', '2000s', 5, 'CM', 'cm_box2box', 'R', 184],
  ['斯科尔斯', 'Paul Scholes', '英格兰', '1990s', 5, 'CM', 'cm_playmaker', 'R', 170],
  ['维埃拉', 'Patrick Vieira', '法国', '1990s', 5, 'CM', 'cm_destroyer', 'R', 192],
  ['马克莱莱', 'Claude Makélélé', '法国', '1990s', 5, 'CM', 'cm_destroyer', 'R', 174],
  ['坎特', "N'Golo Kanté", '法国', '2010s', 5, 'CM', 'cm_destroyer', 'R', 168],
  ['莫德里奇', 'Luka Modrić', '克罗地亚', '2010s', 5, 'CM', 'cm_playmaker', 'R', 172],
  ['克罗斯', 'Toni Kroos', '德国', '2010s', 5, 'CM', 'cm_playmaker', 'R', 183],
  ['德布劳内', 'Kevin De Bruyne', '比利时', '2010s', 5, 'CM', 'cm_creator', 'R', 181],
  ['大卫·席尔瓦', 'David Silva', '西班牙', '2010s', 5, 'CM', 'cm_creator', 'L', 173],
  ['法布雷加斯', 'Cesc Fàbregas', '西班牙', '2000s', 4, 'CM', 'cm_creator', 'R', 179],
  ['阿隆索', 'Xabi Alonso', '西班牙', '2000s', 5, 'CM', 'cm_playmaker', 'R', 183],
  ['马斯切拉诺', 'Javier Mascherano', '阿根廷', '2000s', 5, 'CM', 'cm_destroyer', 'R', 174],
  ['亚亚·图雷', 'Yaya Touré', '科特迪瓦', '2000s', 5, 'CM', 'cm_box2box', 'R', 188],
  ['博格巴', 'Paul Pogba', '法国', '2010s', 4, 'CM', 'cm_playmaker', 'R', 191],
  ['巴拉克', 'Michael Ballack', '德国', '2000s', 5, 'CM', 'cm_box2box', 'R', 189],
  ['施魏因斯泰格', 'Bastian Schweinsteiger', '德国', '2000s', 4, 'CM', 'cm_box2box', 'R', 183],
  ['厄齐尔', 'Mesut Özil', '德国', '2010s', 5, 'CM', 'cm_creator', 'L', 180],
  ['罗德里', 'Rodri', '西班牙', '2020s', 5, 'CM', 'cm_destroyer', 'R', 191],
  ['赖斯', 'Declan Rice', '英格兰', '2020s', 4, 'CM', 'cm_destroyer', 'R', 188],
  ['贝林厄姆', 'Jude Bellingham', '英格兰', '2020s', 5, 'CM', 'cm_box2box', 'R', 186],
  ['佩德里', 'Pedri', '西班牙', '2020s', 4, 'CM', 'cm_playmaker', 'R', 174],
  ['加维', 'Gavi', '西班牙', '2020s', 3, 'CM', 'cm_engine', 'R', 173],
  ['维尔茨', 'Florian Wirtz', '德国', '2020s', 4, 'CM', 'cm_creator', 'R', 176],
  ['穆西亚拉', 'Jamal Musiala', '德国', '2020s', 4, 'CM', 'cm_mezzala', 'R', 184],
  ['德容', 'Frenkie de Jong', '荷兰', '2010s', 4, 'CM', 'cm_playmaker', 'R', 181],
  ['基米希', 'Joshua Kimmich', '德国', '2010s', 4, 'CM', 'cm_playmaker', 'R', 177],
  ['格雷茨卡', 'Leon Goretzka', '德国', '2010s', 3, 'CM', 'cm_box2box', 'R', 189],
  ['布鲁诺·费尔南德斯', 'Bruno Fernandes', '葡萄牙', '2010s', 4, 'CM', 'cm_creator', 'R', 179],
  ['蒂亚戈', 'Thiago Alcântara', '西班牙', '2010s', 4, 'CM', 'cm_playmaker', 'R', 174],
  ['若日尼奥', 'Jorginho', '意大利', '2010s', 4, 'CM', 'cm_playmaker', 'R', 180],
  ['维拉蒂', 'Marco Verratti', '意大利', '2010s', 4, 'CM', 'cm_playmaker', 'R', 165],
  ['京多安', 'İlkay Gündoğan', '德国', '2010s', 4, 'CM', 'cm_box2box', 'R', 180],
  ['罗伊·基恩', 'Roy Keane', '爱尔兰', '1990s', 5, 'CM', 'cm_destroyer', 'R', 178],
  ['雷东多', 'Fernando Redondo', '阿根廷', '1990s', 4, 'CM', 'cm_playmaker', 'L', 186],
  ['西多夫', 'Clarence Seedorf', '荷兰', '1990s', 4, 'CM', 'cm_box2box', 'R', 176],
  ['戴维斯', 'Edgar Davids', '荷兰', '1990s', 4, 'CM', 'cm_destroyer', 'L', 169],
  ['加图索', 'Gennaro Gattuso', '意大利', '2000s', 4, 'CM', 'cm_destroyer', 'R', 177],
  ['马特乌斯', 'Lothar Matthäus', '德国', '1990s', 5, 'CM', 'cm_box2box', 'R', 174],
  ['哈吉', 'Gheorghe Hagi', '罗马尼亚', '1990s', 4, 'CM', 'cm_creator', 'L', 174],
  ['鲁伊·科斯塔', 'Rui Costa', '葡萄牙', '1990s', 4, 'CM', 'cm_creator', 'R', 180],
  ['贝隆', 'Juan Sebastián Verón', '阿根廷', '1990s', 4, 'CM', 'cm_playmaker', 'R', 186],
  ['德科', 'Deco', '葡萄牙', '2000s', 4, 'CM', 'cm_playmaker', 'R', 174],
  ['奥科查', 'Jay-Jay Okocha', '尼日利亚', '1990s', 4, 'CM', 'cm_mezzala', 'R', 175],

  // 前锋 50
  ['罗纳尔多', 'Ronaldo Nazário', '巴西', '1990s', 5, 'ST', 'st_finisher', 'R', 183],
  ['罗马里奥', 'Romário', '巴西', '1990s', 5, 'ST', 'st_poacher', 'R', 167],
  ['贝贝托', 'Bebeto', '巴西', '1990s', 4, 'ST', 'st_false9', 'R', 176],
  ['巴蒂斯图塔', 'Gabriel Batistuta', '阿根廷', '1990s', 5, 'ST', 'st_finisher', 'R', 185],
  ['克林斯曼', 'Jürgen Klinsmann', '德国', '1990s', 4, 'ST', 'st_finisher', 'R', 182],
  ['博格坎普', 'Dennis Bergkamp', '荷兰', '1990s', 5, 'ST', 'st_false9', 'R', 183],
  ['希勒', 'Alan Shearer', '英格兰', '1990s', 5, 'ST', 'st_target', 'R', 183],
  ['佐拉', 'Gianfranco Zola', '意大利', '1990s', 4, 'ST', 'st_false9', 'R', 168],
  ['维阿', 'George Weah', '利比里亚', '1990s', 4, 'ST', 'st_runner', 'R', 185],
  ['斯托伊奇科夫', 'Hristo Stoichkov', '保加利亚', '1990s', 4, 'ST', 'st_finisher', 'L', 178],
  ['巴乔', 'Roberto Baggio', '意大利', '1990s', 5, 'ST', 'st_false9', 'R', 174],
  ['皮耶罗', 'Alessandro Del Piero', '意大利', '1990s', 5, 'ST', 'st_false9', 'R', 173],
  ['托蒂', 'Francesco Totti', '意大利', '1990s', 5, 'ST', 'st_false9', 'R', 180],
  ['劳尔', 'Raúl González', '西班牙', '1990s', 5, 'ST', 'st_poacher', 'L', 180],
  ['欧文', 'Michael Owen', '英格兰', '1990s', 4, 'ST', 'st_runner', 'R', 173],
  ['克鲁伊维特', 'Patrick Kluivert', '荷兰', '1990s', 4, 'ST', 'st_target', 'R', 188],
  ['亨利', 'Thierry Henry', '法国', '1990s', 5, 'ST', 'st_runner', 'R', 188],
  ['范尼', 'Ruud van Nistelrooy', '荷兰', '2000s', 5, 'ST', 'st_poacher', 'R', 188],
  ['舍甫琴科', 'Andriy Shevchenko', '乌克兰', '2000s', 5, 'ST', 'st_finisher', 'R', 183],
  ['因扎吉', 'Filippo Inzaghi', '意大利', '2000s', 5, 'ST', 'st_poacher', 'R', 181],
  ['维埃里', 'Christian Vieri', '意大利', '2000s', 4, 'ST', 'st_target', 'L', 185],
  ['特雷泽盖', 'David Trezeguet', '法国', '2000s', 4, 'ST', 'st_poacher', 'R', 190],
  ['克洛泽', 'Miroslav Klose', '德国', '2000s', 5, 'ST', 'st_poacher', 'R', 182],
  ['埃托奥', "Samuel Eto'o", '喀麦隆', '2000s', 5, 'ST', 'st_runner', 'R', 180],
  ['德罗巴', 'Didier Drogba', '科特迪瓦', '2000s', 5, 'ST', 'st_target', 'R', 188],
  ['伊布拉希莫维奇', 'Zlatan Ibrahimović', '瑞典', '2000s', 5, 'ST', 'st_target', 'R', 195],
  ['鲁尼', 'Wayne Rooney', '英格兰', '2000s', 5, 'ST', 'st_false9', 'R', 176],
  ['范佩西', 'Robin van Persie', '荷兰', '2000s', 5, 'ST', 'st_finisher', 'L', 187],
  ['苏亚雷斯', 'Luis Suárez', '乌拉圭', '2010s', 5, 'ST', 'st_finisher', 'R', 182],
  ['卡瓦尼', 'Edinson Cavani', '乌拉圭', '2010s', 4, 'ST', 'st_runner', 'R', 184],
  ['阿圭罗', 'Sergio Agüero', '阿根廷', '2010s', 5, 'ST', 'st_poacher', 'R', 173],
  ['伊瓜因', 'Gonzalo Higuaín', '阿根廷', '2010s', 4, 'ST', 'st_finisher', 'R', 186],
  ['特维斯', 'Carlos Tevez', '阿根廷', '2010s', 4, 'ST', 'st_runner', 'R', 173],
  ['本泽马', 'Karim Benzema', '法国', '2010s', 5, 'ST', 'st_false9', 'R', 185],
  ['莱万多夫斯基', 'Robert Lewandowski', '波兰', '2010s', 5, 'ST', 'st_finisher', 'R', 185],
  ['格列兹曼', 'Antoine Griezmann', '法国', '2010s', 5, 'ST', 'st_false9', 'L', 176],
  ['凯恩', 'Harry Kane', '英格兰', '2010s', 5, 'ST', 'st_false9', 'R', 188],
  ['卢卡库', 'Romelu Lukaku', '比利时', '2010s', 4, 'ST', 'st_target', 'L', 191],
  ['姆巴佩', 'Kylian Mbappé', '法国', '2010s', 5, 'ST', 'st_runner', 'R', 178],
  ['哈兰德', 'Erling Haaland', '挪威', '2020s', 5, 'ST', 'st_runner', 'L', 195],
  ['劳塔罗·马丁内斯', 'Lautaro Martínez', '阿根廷', '2020s', 4, 'ST', 'st_finisher', 'R', 174],
  ['奥斯梅恩', 'Victor Osimhen', '尼日利亚', '2020s', 4, 'ST', 'st_runner', 'R', 185],
  ['弗拉霍维奇', 'Dušan Vlahović', '塞尔维亚', '2020s', 3, 'ST', 'st_target', 'L', 190],
  ['阿尔瓦雷斯', 'Julián Álvarez', '阿根廷', '2020s', 4, 'ST', 'st_false9', 'R', 170],
  ['伊萨克', 'Alexander Isak', '瑞典', '2020s', 4, 'ST', 'st_runner', 'R', 192],
  ['迭戈·科斯塔', 'Diego Costa', '西班牙', '2010s', 4, 'ST', 'st_target', 'R', 188],
  ['法尔考', 'Radamel Falcao', '哥伦比亚', '2010s', 4, 'ST', 'st_poacher', 'R', 177],
  ['迪巴拉', 'Paulo Dybala', '阿根廷', '2010s', 4, 'ST', 'st_false9', 'L', 177],
  ['坎通纳', 'Eric Cantona', '法国', '1990s', 5, 'ST', 'st_false9', 'R', 188],
  ['里瓦尔多', 'Rivaldo', '巴西', '1990s', 5, 'ST', 'st_false9', 'L', 186],
]

const SEEDS: SeedTuple[] = [...BASE_SEEDS, ...EXTRA_SEEDS]

const STYLE_KEYS: Record<StyleId, Partial<Record<AttrKey, number>>> = {
  gk_wall: { reflexes: 1, handling: 0.95, oneOnOne: 0.85, composure: 0.8, defPos: 0.7, passing: 0.5 },
  gk_shotstopper: { reflexes: 1, oneOnOne: 0.95, handling: 0.8, composure: 0.75, anticipation: 0.7, passing: 0.5 },
  gk_sweeper: { rushing: 1, reflexes: 0.85, passing: 0.85, anticipation: 0.85, oneOnOne: 0.75, decisions: 0.8 },
  cb_stopper: { tackling: 1, strength: 0.95, heading: 0.85, defPos: 0.9, anticipation: 0.75, composure: 0.6, teamwork: 0.6 },
  cb_cover: { defPos: 1, anticipation: 0.95, tackling: 0.85, speed: 0.7, acceleration: 0.6, teamwork: 0.7, passing: 0.5 },
  cb_ballplaying: { passing: 0.95, composure: 0.9, vision: 0.8, defPos: 0.85, anticipation: 0.8, firstTouch: 0.75, decisions: 0.8 },
  fb_attacking: { acceleration: 1, speed: 0.9, offBall: 0.85, dribbling: 0.75, passing: 0.7, tackling: 0.6, defPos: 0.55, endurance: 0.8 },
  fb_playmaker: { passing: 1, vision: 0.85, offBall: 0.75, decisions: 0.75, teamwork: 0.7, acceleration: 0.65, defPos: 0.55, firstTouch: 0.7 },
  w_dribbler: { dribbling: 1, acceleration: 0.95, agility: 0.9, speed: 0.85, offBall: 0.8, passing: 0.6, composure: 0.6 },
  w_crosser: { passing: 1, vision: 0.85, offBall: 0.8, teamwork: 0.7, acceleration: 0.7, dribbling: 0.65, firstTouch: 0.7 },
  w_finisher: { shooting: 1, offBall: 0.9, acceleration: 0.9, composure: 0.85, dribbling: 0.8, speed: 0.8 },
  w_playmaker: { vision: 1, passing: 0.95, decisions: 0.9, dribbling: 0.85, offBall: 0.8, firstTouch: 0.85, composure: 0.7 },
  w_engine: { endurance: 1, teamwork: 0.9, offBall: 0.8, tackling: 0.65, acceleration: 0.7, passing: 0.65, defPos: 0.6 },
  cm_playmaker: { passing: 1, vision: 0.95, decisions: 0.9, firstTouch: 0.85, composure: 0.8, teamwork: 0.7, offBall: 0.6 },
  cm_creator: { vision: 1, passing: 0.95, decisions: 0.9, dribbling: 0.8, firstTouch: 0.8, offBall: 0.75, composure: 0.7 },
  cm_destroyer: { defPos: 1, tackling: 0.95, anticipation: 0.9, teamwork: 0.85, endurance: 0.8, strength: 0.7, passing: 0.55 },
  cm_box2box: { endurance: 1, offBall: 0.9, teamwork: 0.85, passing: 0.75, tackling: 0.7, acceleration: 0.7, shooting: 0.65, decisions: 0.65 },
  cm_mezzala: { dribbling: 0.9, passing: 0.85, offBall: 0.85, vision: 0.8, shooting: 0.7, acceleration: 0.7, firstTouch: 0.75 },
  cm_engine: { endurance: 1, teamwork: 0.9, defPos: 0.75, passing: 0.7, offBall: 0.75, tackling: 0.7 },
  st_finisher: { shooting: 1, composure: 0.9, offBall: 0.9, firstTouch: 0.8, acceleration: 0.8, heading: 0.7 },
  st_poacher: { shooting: 1, offBall: 0.95, anticipation: 0.85, acceleration: 0.85, composure: 0.8, firstTouch: 0.75 },
  st_target: { strength: 1, heading: 0.95, firstTouch: 0.85, shooting: 0.8, teamwork: 0.75, passing: 0.65 },
  st_runner: { acceleration: 1, speed: 0.95, offBall: 0.9, shooting: 0.8, dribbling: 0.7, composure: 0.65 },
  st_false9: { firstTouch: 1, passing: 0.9, vision: 0.85, decisions: 0.85, shooting: 0.8, offBall: 0.75, dribbling: 0.75 },
}

const STYLE_TRAIT: Record<StyleId, BaseTraitId> = {
  gk_wall: 'wall',
  gk_shotstopper: 'shotstopper',
  gk_sweeper: 'sweeper',
  cb_stopper: 'iron',
  cb_cover: 'anchor',
  cb_ballplaying: 'metronome',
  fb_attacking: 'overlap',
  fb_playmaker: 'crosser',
  w_dribbler: 'dribbler',
  w_crosser: 'crosser',
  w_finisher: 'finisher',
  w_playmaker: 'visionary',
  w_engine: 'engine',
  cm_playmaker: 'metronome',
  cm_creator: 'visionary',
  cm_destroyer: 'shield',
  cm_box2box: 'engine',
  cm_mezzala: 'link',
  cm_engine: 'engine',
  st_finisher: 'cold_blood',
  st_poacher: 'poacher',
  st_target: 'target',
  st_runner: 'pace',
  st_false9: 'link',
}

const STYLE_SKILL: Record<StyleId, SkillId> = {
  gk_wall: 'gk_reflexes',
  gk_shotstopper: 'gk_reflexes',
  gk_sweeper: 'gk_sweeper',
  cb_stopper: 'sweeper',
  cb_cover: 'sweeper',
  cb_ballplaying: 'safe_pass',
  fb_attacking: 'wing_runner',
  fb_playmaker: 'safe_pass',
  w_dribbler: 'wing_runner',
  w_crosser: 'weak_foot',
  w_finisher: 'box_hunter',
  w_playmaker: 'through_ball',
  w_engine: 'iron_lung',
  cm_playmaker: 'through_ball',
  cm_creator: 'through_ball',
  cm_destroyer: 'sweeper',
  cm_box2box: 'iron_lung',
  cm_mezzala: 'one_touch',
  cm_engine: 'iron_lung',
  st_finisher: 'box_hunter',
  st_poacher: 'box_hunter',
  st_target: 'aerial',
  st_runner: 'one_touch',
  st_false9: 'one_touch',
}

const SECONDARY_POSITIONS: Record<Position, Position[]> = {
  GK: [],
  CB: ['W', 'CM'],
  W: ['CB', 'ST', 'CM'],
  CM: ['W', 'CB', 'ST'],
  ST: ['W', 'CM'],
}

function hashString(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function noise(rng: () => number, amount: number): number {
  return (rng() * 2 - 1) * amount
}

function styleWeight(style: StyleId, attr: AttrKey, isGk: boolean): number {
  const specific = STYLE_KEYS[style][attr]
  if (specific !== undefined) return specific
  if (isGk) {
    if (attr === 'passing' || attr === 'decisions' || attr === 'defPos') return 0.55
    if ((GK_ATTRIBUTES as readonly string[]).includes(attr)) return 0.7
    return 0.25
  }
  if ((GK_ATTRIBUTES as readonly string[]).includes(attr)) return 0
  return 0.3
}

export function styleWeightsFor(style: StyleId, isGk: boolean): Partial<Record<AttrKey, number>> {
  const weights: Partial<Record<AttrKey, number>> = {}
  for (const key of ALL_ATTRIBUTES) {
    weights[key] = !isGk && (GK_ATTRIBUTES as readonly string[]).includes(key) ? 0 : styleWeight(style, key, isGk)
  }
  return weights
}

export function styleSkillFor(style: StyleId): SkillId {
  return STYLE_SKILL[style]
}

export function styleTraitFor(style: StyleId): BaseTraitId {
  return STYLE_TRAIT[style]
}

function clampRating(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value * 10) / 10))
}

function storeAttr(key: AttrKey, rating: number, isGk: boolean): number {
  return Math.round(attrStorage(key, rating, isGk) * 10) / 10
}

function makeAttributes(seed: PlayerSeed, rng: () => number): { attrs: Attributes; ceilings: Attributes } {
  const isGk = seed.pos === 'GK'
  const attrs = {} as Attributes
  const ceilings = {} as Attributes
  // 画像只依赖风格与位置，不消耗随机源，因此先一次性算好再归一化。
  const weights: Partial<Record<AttrKey, number>> = {}
  for (const key of ALL_ATTRIBUTES) {
    weights[key] = !isGk && (GK_ATTRIBUTES as readonly string[]).includes(key) ? 0 : styleWeight(seed.style, key, isGk)
  }
  // 有 FM 导入的画像就用真实的强弱分布；其次是用手工画像（导出表里查无此人的老将/漏掉的人）；
  // 都没有才由风格推导。三者都不消耗随机源。
  const profile = fmProfileFor(seed.enName) ?? curatedProfileFor(seed.enName) ?? profileFromWeights(weights)
  for (const key of ALL_ATTRIBUTES) {
    if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) {
      attrs[key] = 0
      ceilings[key] = 0
      continue
    }
    const weight = styleWeight(seed.style, key, isGk)
    const base = isGk ? 34 + seed.tier * 3.2 : 31 + seed.tier * 4.4
    const span = isGk ? 24 : 27
    let value = base + weight * span + noise(rng, 3.5)
    const heightFactor = (seed.height - 182) / 20
    if (key === 'strength' || key === 'heading') value += heightFactor * 2.5
    if (key === 'acceleration' || key === 'agility' || key === 'speed') value -= heightFactor * 1.8
    if (key === 'composure') value += (seed.tier - 3) * 1.5
    const rating = clampRating(value)
    attrs[key] = storeAttr(key, rating, isGk)
    // 上限：招牌维度更高、弱点维度更低。随机源消耗顺序与旧实现一致（先 noise 后一次 rng）。
    const room = ceilingRoom(profile[key], seed.tier) + rng() * CEILING_JITTER
    ceilings[key] = storeAttr(key, clampRating(rating + room), isGk)
  }
  return { attrs, ceilings }
}

function makePositions(seed: PlayerSeed, rng: () => number): PositionTable {
  const table = {} as PositionTable
  const isGk = seed.pos === 'GK'
  for (const pos of POSITIONS) {
    if (pos === 'GK') {
      table[pos] = isGk ? 92 + Math.round(rng() * 7) : 0
      continue
    }
    if (isGk) {
      table[pos] = 0
      continue
    }
    if (pos === seed.pos) {
      table[pos] = 88 + Math.round(rng() * 10)
      continue
    }
    const secondary = SECONDARY_POSITIONS[seed.pos].includes(pos)
    table[pos] = secondary ? 52 + Math.round(rng() * 22) : 28 + Math.round(rng() * 22)
  }
  // 少数球员完全没学过某个外场位置，留给位置训练解锁。
  if (!isGk && rng() < 0.3) {
    const candidates = POSITIONS.filter((p) => p !== 'GK' && p !== seed.pos && table[p] > 0)
    const locked = candidates[Math.floor(rng() * candidates.length)]
    if (locked) table[locked] = 0
  }
  return table
}

function makePersonality(seed: PlayerSeed, rng: () => number): { professionalism: number; ambition: number; adaptability: number } {
  return {
    professionalism: Math.round(Math.max(30, Math.min(95, 52 + seed.tier * 5 + noise(rng, 12)))),
    ambition: Math.round(Math.max(30, Math.min(95, 54 + seed.tier * 4 + noise(rng, 14)))),
    adaptability: Math.round(Math.max(25, Math.min(95, 48 + seed.tier * 3 + noise(rng, 15)))),
  }
}

export function createPlayerFromSeed(seed: PlayerSeed): Player {
  const rng = mulberry32(hashString(`${seed.enName}|${seed.era}|${seed.pos}`))
  const { attrs, ceilings } = makeAttributes(seed, rng)
  const positions = makePositions(seed, rng)
  const personality = makePersonality(seed, rng)
  const isGk = seed.pos === 'GK'
  const initialCa = caOf(attrs, isGk)
  const ceilingCa = caCeilingOf(ceilings, isGk)
  const potential = (seed.tier * 2.2 + rng() * 7 + 1) * 7.5
  let pa = Math.min(ceilingCa - 0.05, initialCa + potential)
  if (pa < initialCa) pa = initialCa
  pa = Math.round(pa * 10) / 10
  // CA is quadratic, so square-root scaling preserves the player's attribute profile.
  const startingCa = Math.max(203, Math.min(297, 85 + initialCa * 0.3))
  const startScale = Math.sqrt(startingCa / initialCa)
  for (const key of ALL_ATTRIBUTES) attrs[key] = Math.round(attrs[key] * startScale * 10) / 10
  // 缩放后重新对齐上限，保证「上限不低于当前属性」这个不变量始终成立。
  const finalCeilings = normalizeCeilings(attrs, ceilings, (key) => attrLimit(key, isGk))
  const skillChance = seed.tier >= 5 ? 0.68 : seed.tier === 4 ? 0.42 : 0.2
  const rolledSkill = rng() < skillChance
  const signatureSkill = seed.era === 'random' ? undefined : STYLE_SKILL[seed.style]
  const skills: SkillId[] = signatureSkill ? [signatureSkill] : rolledSkill ? [STYLE_SKILL[seed.style]] : []
  return {
    id: seed.id,
    seedId: seed.id,
    name: seed.name,
    enName: seed.enName,
    country: seed.country,
    era: seed.era,
    number: Number(seed.id.slice(1)) % 99 + 1,
    foot: seed.foot,
    height: seed.height,
    attrs,
    ceilings: finalCeilings,
    pa,
    positions,
    personality,
    // 真实球星每人一个专属特性，随机球员按打法风格用通用特性。
    traitId: seed.era === 'random' ? STYLE_TRAIT[seed.style] : starTraitId(seed.id),
    skills,
    signatureSkill,
    skillTiers: signatureSkill ? { [signatureSkill]: 'rainbow' } : {},
    condition: 100,
    energy: 100,
    age: 16 + (hashString(seed.id) % 11),
    ...(seed.era === 'random' ? {} : { starKey: seed.id, generation: 0 }),
    version: 0,
    baseAttrs: { ...attrs },
    basePositions: { ...positions },
    basePersonality: { ...personality },
    style: seed.style,
  } as Player
}

export const PLAYER_SEEDS: PlayerSeed[] = SEEDS.map((tuple, index) => {
  const [name, enName, country, era, tier, pos, style, foot = 'R', height] = tuple
  return {
    id: `p${String(index + 1).padStart(3, '0')}`,
    name,
    enName,
    country,
    era,
    tier,
    pos,
    style,
    foot,
    height: height ?? (pos === 'GK' ? 188 : pos === 'CB' ? 187 : pos === 'ST' ? 183 : pos === 'W' ? 178 : 180),
  }
})

export function seedById(id: string): PlayerSeed | undefined {
  return PLAYER_SEEDS.find((seed) => seed.id === id)
}

// shortcut: full legacy main slots keep their skills without a signature; add slot management to let players replace one.
export function addLegacySignature(player: Player): boolean {
  if (player.signatureSkill || !Array.isArray(player.skills)) return false
  const seed = seedById(player.seedId)
  if (!seed || seed.name !== player.name || seed.enName !== player.enName) return false
  const skill = STYLE_SKILL[seed.style]
  if (!player.skills.includes(skill) && !canLearnSkill(player.skills, skill)) return false
  if (!player.skills.includes(skill)) player.skills.push(skill)
  player.signatureSkill = skill
  player.skillTiers = { ...player.skillTiers, [skill]: 'rainbow' }
  if (player.baseSkills && !player.baseSkills.includes(skill)) player.baseSkills.push(skill)
  if (player.baseSkillTiers) player.baseSkillTiers[skill] = 'rainbow'
  return true
}

export function traitName(traitId: TraitId): string {
  return traitNameOf(traitId)
}

export const PLAYER_STYLE_LABEL: Record<StyleId, string> = {
  gk_wall: '门线型门将',
  gk_shotstopper: '扑救型门将',
  gk_sweeper: '清道夫门将',
  cb_stopper: '上抢中卫',
  cb_cover: '拖后中卫',
  cb_ballplaying: '出球中卫',
  fb_attacking: '进攻边卫',
  fb_playmaker: '组织边卫',
  w_dribbler: '突破边锋',
  w_crosser: '传中边路',
  w_finisher: '内切得分手',
  w_playmaker: '组织型边锋',
  w_engine: '跑动型边路',
  cm_playmaker: '组织核心',
  cm_creator: '创造型中场',
  cm_destroyer: '防守中场',
  cm_box2box: '全能中场',
  cm_mezzala: '肋部中场',
  cm_engine: '跑动型中场',
  st_finisher: '终结前锋',
  st_poacher: '抢点前锋',
  st_target: '支点中锋',
  st_runner: '速度前锋',
  st_false9: '伪九号',
}

export const PLAYER_COUNT = SEEDS.length
