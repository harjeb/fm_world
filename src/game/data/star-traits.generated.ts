import type { StarTrait } from './star-traits.ts'

/**
 * 500 名球星的专属特性。由 scripts/generate-star-traits.ts 生成（npm run traits:gen）。
 * 想单独调整某个球星可以直接改这里，但再次生成会覆盖。
 */
export const STAR_TRAITS: Record<string, StarTrait> = {
  star_p001: { name: '闪击魔掌', when: 'early', kind: 'attr', attr: 'reflexes', chance: 95, bonus: 585 }, // 布冯
  star_p002: { name: '王牌长城', when: 'any', kind: 'attr', attr: 'reflexes', chance: 50, bonus: 225 }, // 卡恩
  star_p003: { name: '小禁区守关人', when: 'any', kind: 'save', scope: 'inBox', goal: 3 }, // 舒梅切尔
  star_p004: { name: '本能鬼手', when: 'any', kind: 'attr', attr: 'reflexes', chance: 50, bonus: 185 }, // 范德萨
  star_p005: { name: '压哨长城', when: 'late', kind: 'attr', attr: 'reflexes', chance: 90, bonus: 585 }, // 卡西利亚斯
  star_p006: { name: '绝对守关人', when: 'any', kind: 'save', scope: 'any', goal: 3 }, // 切赫
  star_p007: { name: '隔空飞鱼', when: 'any', kind: 'save', scope: 'longRange', goal: 4 }, // 塞萨尔
  star_p008: { name: '天生绝技', when: 'any', kind: 'skillBoost', pct: 70 }, // 诺伊尔
  star_p009: { name: '电梯球飞鱼', when: 'any', kind: 'save', scope: 'freeKick', goal: 10 }, // 德赫亚
  star_p010: { name: '任意球对决者', when: 'any', kind: 'save', scope: 'freeKick', goal: 14 }, // 库尔图瓦
  star_p011: { name: '无双魔掌', when: 'any', kind: 'attr', attr: 'reflexes', chance: 12, bonus: 700 }, // 奥布拉克
  star_p012: { name: '巅峰钢筋', when: 'any', kind: 'injury', risk: 70 }, // 特尔施特根
  star_p013: { name: '绝对长城', when: 'any', kind: 'attr', attr: 'reflexes', chance: 25, bonus: 320 }, // 洛里
  star_p014: { name: '读秒闪扑', when: 'late', kind: 'save', scope: 'longRange', goal: 5 }, // 纳瓦斯
  star_p015: { name: '独闯镇关', when: 'any', kind: 'save', scope: 'oneOnOne', goal: 8 }, // 阿利松
  star_p016: { name: '直面单挑王', when: 'any', kind: 'save', scope: 'oneOnOne', goal: 7 }, // 埃德森
  star_p017: { name: '远征镇关', when: 'away', kind: 'attr', attr: 'oneOnOne', chance: 30, bonus: 480 }, // 多纳鲁马
  star_p018: { name: '主场神扑', when: 'home', kind: 'save', scope: 'header', goal: 14 }, // 迈尼昂
  star_p019: { name: '独闯长城', when: 'any', kind: 'save', scope: 'oneOnOne', goal: 6 }, // 马丁内斯
  star_p020: { name: '易边出击', when: 'secondHalf', kind: 'attr', attr: 'rushing', chance: 55, bonus: 240 }, // 拉亚
  star_p021: { name: '逼抢下调度师', when: 'any', kind: 'pass', scope: 'pressured', success: 5 }, // 马尔蒂尼
  star_p022: { name: '本能带头大哥', when: 'any', kind: 'aura', attr: 'tackling', bonus: 55 }, // 卡纳瓦罗
  star_p023: { name: '绝对大魔王', when: 'any', kind: 'intimidate', attr: 'shooting', bonus: 50 }, // 内斯塔
  star_p024: { name: '本能拦路虎', when: 'any', kind: 'defend', success: 7 }, // 斯塔姆
  star_p025: { name: '坐镇獠牙', when: 'home', kind: 'defend', success: 8 }, // 德塞利
  star_p026: { name: '长传导演', when: 'any', kind: 'pass', scope: 'long', success: 8 }, // 布兰克
  star_p027: { name: '绝对梦魇', when: 'any', kind: 'intimidate', attr: 'passing', bonus: 40 }, // 坎贝尔
  star_p028: { name: '主场坦克', when: 'home', kind: 'attr', attr: 'strength', chance: 30, bonus: 600 }, // 卢西奥
  star_p029: { name: '巅峰穿花', when: 'any', kind: 'attr', attr: 'dribbling', chance: 70, bonus: 345 }, // 费迪南德
  star_p030: { name: '防区战斧', when: 'ownHalf', kind: 'attr', attr: 'tackling', chance: 40, bonus: 645 }, // 维迪奇
  star_p031: { name: '巅峰君子', when: 'any', kind: 'card', risk: 55 }, // 特里
  star_p032: { name: '天生手下留情', when: 'any', kind: 'card', risk: 90 }, // 普约尔
  star_p033: { name: '开局獠牙', when: 'early', kind: 'defend', success: 12 }, // 皮克
  star_p034: { name: '无双清道夫', when: 'any', kind: 'attr', attr: 'tackling', chance: 70, bonus: 345 }, // 拉莫斯
  star_p035: { name: '王牌清道夫', when: 'any', kind: 'defend', success: 8 }, // 佩佩
  star_p036: { name: '无双硬骨头', when: 'any', kind: 'injury', risk: 40 }, // 卡瓦略
  star_p037: { name: '巅峰穿针', when: 'any', kind: 'attr', attr: 'passing', chance: 70, bonus: 345 }, // 蒂亚戈·席尔瓦
  star_p038: { name: '主场铁闸', when: 'home', kind: 'defend', success: 12 }, // 基耶利尼
  star_p039: { name: '传奇登峰', when: 'any', kind: 'skillBoost', pct: 44 }, // 博努奇
  star_p040: { name: '胶着精神支柱', when: 'level', kind: 'aura', attr: 'strength', bonus: 50 }, // 胡梅尔斯
  star_p041: { name: '魔鬼主场断路', when: 'home', kind: 'attr', attr: 'tackling', chance: 30, bonus: 600 }, // 博阿滕
  star_p042: { name: '客场之续航者', when: 'away', kind: 'stamina', drain: 45 }, // 范戴克
  star_p043: { name: '王牌猎犬', when: 'any', kind: 'defend', success: 5 }, // 瓦拉内
  star_p044: { name: '高空磐石', when: 'aerial', kind: 'attr', attr: 'strength', chance: 60, bonus: 600 }, // 吕迪格
  star_p045: { name: '闪击带头大哥', when: 'early', kind: 'aura', attr: 'tackling', bonus: 100 }, // 鲁本·迪亚斯
  star_p046: { name: '客场之压迫感', when: 'away', kind: 'intimidate', attr: 'passing', bonus: 70 }, // 萨利巴
  star_p047: { name: '高空炮手', when: 'any', kind: 'shot', scope: 'header', onTarget: 15, goal: 10 }, // 阿劳霍
  star_p048: { name: '主场之队魂', when: 'home', kind: 'aura', attr: 'passing', bonus: 60 }, // 格瓦迪奥尔
  star_p049: { name: '终场一击', when: 'late', kind: 'shot', scope: 'longRange', onTarget: 16, goal: 7 }, // 巴斯托尼
  star_p050: { name: '满血追风', when: 'fresh', kind: 'attr', attr: 'speed', chance: 35, bonus: 600 }, // 马尔基尼奥斯
  star_p051: { name: '领跑引线', when: 'ahead', kind: 'pass', scope: 'cross', success: 15 }, // 卡福
  star_p052: { name: '定位球重炮', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 13, goal: 11 }, // 罗伯特·卡洛斯
  star_p053: { name: '二番断路', when: 'secondHalf', kind: 'defend', success: 12 }, // 利扎拉祖
  star_p054: { name: '收割拦路虎', when: 'ahead', kind: 'defend', success: 12 }, // 赞布罗塔
  star_p055: { name: '魔鬼主场变奏', when: 'home', kind: 'attr', attr: 'dribbling', chance: 80, bonus: 540 }, // 阿什利·科尔
  star_p056: { name: '招牌回魂', when: 'any', kind: 'secondWind', stamina: 53 }, // 拉姆
  star_p057: { name: '巅峰引擎', when: 'any', kind: 'stamina', drain: 37 }, // 阿尔维斯
  star_p058: { name: '传奇滑步', when: 'any', kind: 'dribble', success: 13 }, // 马塞洛
  star_p059: { name: '巅峰旗手', when: 'any', kind: 'aura', attr: 'acceleration', bonus: 40 }, // 沃克
  star_p060: { name: '终场拦路虎', when: 'late', kind: 'defend', success: 12 }, // 阿尔巴
  star_p061: { name: '招牌续航者', when: 'any', kind: 'stamina', drain: 40 }, // 阿诺德
  star_p062: { name: '锁定舞者', when: 'ahead', kind: 'dribble', success: 18 }, // 罗伯逊
  star_p063: { name: '落叶球炮手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 11, goal: 8 }, // 特里皮尔
  star_p064: { name: '回马快马', when: 'secondHalf', kind: 'attr', attr: 'speed', chance: 90, bonus: 400 }, // 阿方索·戴维斯
  star_p065: { name: '王牌统帅', when: 'any', kind: 'aura', attr: 'tackling', bonus: 25 }, // 哈基米
  star_p066: { name: '无双永动机', when: 'any', kind: 'stamina', drain: 30 }, // 特奥·埃尔南德斯
  star_p067: { name: '反扑铁骑', when: 'behind', kind: 'defend', success: 12 }, // 坎塞洛
  star_p068: { name: '招牌穿针', when: 'any', kind: 'attr', attr: 'passing', chance: 10, bonus: 500 }, // 弗林蓬
  star_p069: { name: '王牌马拉松', when: 'any', kind: 'stamina', drain: 27 }, // 菲戈
  star_p070: { name: '满血舞者', when: 'fresh', kind: 'attr', attr: 'dribbling', chance: 35, bonus: 700 }, // 吉格斯
  star_p071: { name: '定位球杀手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 18, goal: 14 }, // 贝克汉姆
  star_p072: { name: '王牌舞步', when: 'any', kind: 'dribble', success: 10 }, // 内德维德
  star_p073: { name: '传中引线', when: 'any', kind: 'pass', scope: 'cross', success: 10 }, // 皮雷
  star_p074: { name: '王牌续航者', when: 'any', kind: 'stamina', drain: 35 }, // 罗本
  star_p075: { name: '背水舞步', when: 'behind', kind: 'dribble', success: 18 }, // 里贝里
  star_p076: { name: '魔术弧重炮', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 14, goal: 13 }, // 梅西
  star_p077: { name: '落叶球重炮', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 18, goal: 13 }, // C罗
  star_p078: { name: '电梯球一击', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 16, goal: 10 }, // 罗纳尔迪尼奥
  star_p079: { name: '招牌老狐狸', when: 'any', kind: 'drawFoul', pct: 69 }, // 内马尔
  star_p080: { name: '电梯球神射', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 13, goal: 14 }, // 贝尔
  star_p081: { name: '天生造犯规机器', when: 'any', kind: 'drawFoul', pct: 104 }, // 阿扎尔
  star_p082: { name: '固守长传手', when: 'ownHalf', kind: 'attr', attr: 'passing', chance: 50, bonus: 540 }, // 迪马利亚
  star_p083: { name: '单刀枪手', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 13, goal: 6 }, // 萨拉赫
  star_p084: { name: '巅峰爆发', when: 'any', kind: 'hotStreak', bonus: 305 }, // 马内
  star_p085: { name: '破僵变奏', when: 'level', kind: 'dribble', success: 17 }, // 斯特林
  star_p086: { name: '王牌贴线', when: 'any', kind: 'onside', chance: 40 }, // 格纳布里
  star_p087: { name: '绝对集大成', when: 'any', kind: 'skillBoost', pct: 42 }, // 科曼
  star_p088: { name: '本能发条', when: 'any', kind: 'stamina', drain: 16 }, // 桑乔
  star_p089: { name: '敌营灵蛇', when: 'away', kind: 'attr', attr: 'dribbling', chance: 50, bonus: 600 }, // 福登
  star_p090: { name: '招牌造极', when: 'any', kind: 'skillBoost', pct: 53 }, // 萨卡
  star_p091: { name: '无双狙击手', when: 'any', kind: 'shot', scope: 'any', onTarget: 5, goal: 5 }, // 维尼修斯
  star_p092: { name: '胶着狙击手', when: 'level', kind: 'shot', scope: 'inBox', onTarget: 13, goal: 6 }, // 罗德里戈
  star_p093: { name: '主场之导演', when: 'home', kind: 'pass', scope: 'cross', success: 15 }, // 拉菲尼亚
  star_p094: { name: '王牌滑步', when: 'any', kind: 'dribble', success: 8 }, // 亚马尔
  star_p095: { name: '敌营神射', when: 'away', kind: 'shot', scope: 'oneOnOne', onTarget: 14, goal: 8 }, // 登贝莱
  star_p096: { name: '巅峰连击', when: 'any', kind: 'hotStreak', bonus: 175 }, // 克瓦拉茨赫利亚
  star_p097: { name: '二番滑步', when: 'secondHalf', kind: 'dribble', success: 16 }, // 莱奥
  star_p098: { name: '传奇亢奋', when: 'any', kind: 'goalRecover', stamina: 19 }, // 尼科·威廉姆斯
  star_p099: { name: '胶着精灵', when: 'level', kind: 'dribble', success: 13 }, // 奥利塞
  star_p100: { name: '均势杀手', when: 'level', kind: 'attr', attr: 'shooting', chance: 55, bonus: 700 }, // 孙兴慜
  star_p101: { name: '绝对盘丝', when: 'any', kind: 'attr', attr: 'dribbling', chance: 10, bonus: 700 }, // 齐达内
  star_p102: { name: '直塞中枢', when: 'any', kind: 'pass', scope: 'through', success: 11 }, // 卡卡
  star_p103: { name: '魔术弧炮手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 18, goal: 11 }, // 皮尔洛
  star_p104: { name: '绝地精神支柱', when: 'behind', kind: 'aura', attr: 'passing', bonus: 90 }, // 哈维
  star_p105: { name: '天生长跑者', when: 'any', kind: 'stamina', drain: 38 }, // 伊涅斯塔
  star_p106: { name: '传奇绞杀', when: 'any', kind: 'defend', success: 10 }, // 布斯克茨
  star_p107: { name: '领跑主心骨', when: 'ahead', kind: 'aura', attr: 'passing', bonus: 90 }, // 杰拉德
  star_p108: { name: '绝对不死鸟', when: 'any', kind: 'injury', risk: 80 }, // 兰帕德
  star_p109: { name: '僵局节拍器', when: 'level', kind: 'pass', scope: 'any', success: 13 }, // 斯科尔斯
  star_p110: { name: '逆境梦魇', when: 'behind', kind: 'intimidate', attr: 'passing', bonus: 100 }, // 维埃拉
  star_p111: { name: '敌营铁骑', when: 'away', kind: 'attr', attr: 'tackling', chance: 50, bonus: 700 }, // 马克莱莱
  star_p112: { name: '敌营顶梁柱', when: 'away', kind: 'aura', attr: 'strength', bonus: 75 }, // 坎特
  star_p113: { name: '魔鬼主场穿针', when: 'home', kind: 'attr', attr: 'passing', chance: 80, bonus: 540 }, // 莫德里奇
  star_p114: { name: '电梯球重炮', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 13, goal: 13 }, // 克罗斯
  star_p115: { name: '后场画师', when: 'ownHalf', kind: 'attr', attr: 'passing', chance: 100, bonus: 310 }, // 德布劳内
  star_p116: { name: '领跑大脑', when: 'ahead', kind: 'pass', scope: 'any', success: 15 }, // 大卫·席尔瓦
  star_p117: { name: '均势妙传', when: 'level', kind: 'pass', scope: 'through', success: 15 }, // 法布雷加斯
  star_p118: { name: '转移节拍器', when: 'any', kind: 'pass', scope: 'long', success: 11 }, // 阿隆索
  star_p119: { name: '招牌拦路虎', when: 'any', kind: 'attr', attr: 'tackling', chance: 100, bonus: 260 }, // 马斯切拉诺
  star_p120: { name: '三十米冷箭', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 8, goal: 5 }, // 亚亚·图雷
  star_p121: { name: '读秒节拍器', when: 'late', kind: 'attr', attr: 'passing', chance: 90, bonus: 600 }, // 博格巴
  star_p122: { name: '本能引擎', when: 'any', kind: 'stamina', drain: 29 }, // 巴拉克
  star_p123: { name: '僵局杀手', when: 'level', kind: 'shot', scope: 'inBox', onTarget: 10, goal: 8 }, // 施魏因斯泰格
  star_p124: { name: '传奇长传手', when: 'any', kind: 'attr', attr: 'passing', chance: 20, bonus: 700 }, // 厄齐尔
  star_p125: { name: '传奇拦路虎', when: 'any', kind: 'defend', success: 6 }, // 罗德里
  star_p126: { name: '敌营猎犬', when: 'away', kind: 'defend', success: 10 }, // 赖斯
  star_p127: { name: '僵局断路', when: 'level', kind: 'defend', success: 10 }, // 贝林厄姆
  star_p128: { name: '小禁区终结者', when: 'inBox', kind: 'attr', attr: 'shooting', chance: 40, bonus: 600 }, // 佩德里
  star_p129: { name: '客场之指挥棒', when: 'away', kind: 'pass', scope: 'through', success: 9 }, // 加维
  star_p130: { name: '魔鬼主场精灵', when: 'home', kind: 'dribble', success: 12 }, // 维尔茨
  star_p131: { name: '破僵猎犬', when: 'level', kind: 'defend', success: 12 }, // 穆西亚拉
  star_p132: { name: '电梯球炮手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 14, goal: 9 }, // 德容
  star_p133: { name: '易边引擎', when: 'secondHalf', kind: 'stamina', drain: 45 }, // 基米希
  star_p134: { name: '固守拦路虎', when: 'ownHalf', kind: 'attr', attr: 'tackling', chance: 30, bonus: 500 }, // 格雷茨卡
  star_p135: { name: '锁定领袖', when: 'ahead', kind: 'aura', attr: 'passing', bonus: 70 }, // 布鲁诺·费尔南德斯
  star_p136: { name: '香蕉球终结者', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 13, goal: 9 }, // 蒂亚戈
  star_p137: { name: '开局重炮', when: 'early', kind: 'shot', scope: 'longRange', onTarget: 16, goal: 13 }, // 若日尼奥
  star_p138: { name: '王牌主心骨', when: 'any', kind: 'aura', attr: 'passing', bonus: 40 }, // 维拉蒂
  star_p139: { name: '隔空狙击手', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 7, goal: 4 }, // 京多安
  star_p140: { name: '客场獠牙', when: 'away', kind: 'attr', attr: 'tackling', chance: 40, bonus: 700 }, // 罗伊·基恩
  star_p141: { name: '大范围长传手', when: 'any', kind: 'pass', scope: 'long', success: 10 }, // 雷东多
  star_p142: { name: '客场巨人', when: 'away', kind: 'attr', attr: 'strength', chance: 100, bonus: 365 }, // 西多夫
  star_p143: { name: '锁定断路', when: 'ahead', kind: 'defend', success: 11 }, // 戴维斯
  star_p144: { name: '防区壁垒', when: 'ownHalf', kind: 'attr', attr: 'tackling', chance: 30, bonus: 600 }, // 加图索
  star_p145: { name: '传奇第二春', when: 'any', kind: 'secondWind', stamina: 54 }, // 马特乌斯
  star_p146: { name: '香蕉球冷箭', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 13, goal: 10 }, // 哈吉
  star_p147: { name: '身后中枢', when: 'any', kind: 'pass', scope: 'through', success: 8 }, // 鲁伊·科斯塔
  star_p148: { name: '客场妙传', when: 'away', kind: 'attr', attr: 'passing', chance: 50, bonus: 600 }, // 贝隆
  star_p149: { name: '任意球中枢', when: 'any', kind: 'pass', scope: 'freeKick', success: 12 }, // 德科
  star_p150: { name: '远征快马', when: 'away', kind: 'attr', attr: 'speed', chance: 70, bonus: 485 }, // 奥科查
  star_p151: { name: '背水猎手', when: 'behind', kind: 'shot', scope: 'inBox', onTarget: 18, goal: 11 }, // 罗纳尔多
  star_p152: { name: '主场之杀手', when: 'home', kind: 'attr', attr: 'shooting', chance: 60, bonus: 680 }, // 罗马里奥
  star_p153: { name: '领跑节拍器', when: 'ahead', kind: 'attr', attr: 'passing', chance: 60, bonus: 600 }, // 贝贝托
  star_p154: { name: '后程冷箭', when: 'secondHalf', kind: 'attr', attr: 'shooting', chance: 40, bonus: 700 }, // 巴蒂斯图塔
  star_p155: { name: '招牌杀手', when: 'any', kind: 'shot', scope: 'any', onTarget: 5, goal: 3 }, // 克林斯曼
  star_p156: { name: '禁区枪手', when: 'any', kind: 'shot', scope: 'inBox', onTarget: 8, goal: 6 }, // 博格坎普
  star_p157: { name: '巅峰导演', when: 'any', kind: 'attr', attr: 'passing', chance: 40, bonus: 540 }, // 希勒
  star_p158: { name: '定位球狙击手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 14, goal: 8 }, // 佐拉
  star_p159: { name: '本能回魂', when: 'any', kind: 'secondWind', stamina: 38 }, // 维阿
  star_p160: { name: '反扑穿云箭', when: 'behind', kind: 'attr', attr: 'shooting', chance: 60, bonus: 600 }, // 斯托伊奇科夫
  star_p161: { name: '越墙利刃', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 19, goal: 11 }, // 巴乔
  star_p162: { name: '落叶球枪手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 16, goal: 11 }, // 皮耶罗
  star_p163: { name: '落叶球终结者', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 19, goal: 14 }, // 托蒂
  star_p164: { name: '禁区神射', when: 'any', kind: 'shot', scope: 'inBox', onTarget: 10, goal: 5 }, // 劳尔
  star_p165: { name: '二番起爆', when: 'secondHalf', kind: 'attr', attr: 'acceleration', chance: 50, bonus: 600 }, // 欧文
  star_p166: { name: '反扑利刃', when: 'behind', kind: 'shot', scope: 'inBox', onTarget: 11, goal: 9 }, // 克鲁伊维特
  star_p167: { name: '独闯穿云箭', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 10, goal: 6 }, // 亨利
  star_p168: { name: '门前终结者', when: 'any', kind: 'shot', scope: 'inBox', onTarget: 8, goal: 5 }, // 范尼
  star_p169: { name: '绝对幻影', when: 'any', kind: 'dribble', success: 11 }, // 舍甫琴科
  star_p170: { name: '远征弹射', when: 'away', kind: 'attr', attr: 'acceleration', chance: 50, bonus: 700 }, // 因扎吉
  star_p171: { name: '门前杀手', when: 'inBox', kind: 'attr', attr: 'shooting', chance: 50, bonus: 600 }, // 维埃里
  star_p172: { name: '面门狙击手', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 9, goal: 5 }, // 特雷泽盖
  star_p173: { name: '传奇重炮', when: 'any', kind: 'attr', attr: 'shooting', chance: 12, bonus: 700 }, // 克洛泽
  star_p174: { name: '直面狙击手', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 10, goal: 8 }, // 埃托奥
  star_p175: { name: '王牌大师', when: 'any', kind: 'skillBoost', pct: 43 }, // 德罗巴
  star_p176: { name: '传奇杀手', when: 'any', kind: 'shot', scope: 'any', onTarget: 6, goal: 3 }, // 伊布拉希莫维奇
  star_p177: { name: '远程穿云箭', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 10, goal: 6 }, // 鲁尼
  star_p178: { name: '单刀狙击手', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 11, goal: 6 }, // 范佩西
  star_p179: { name: '招牌精通', when: 'any', kind: 'skillBoost', pct: 72 }, // 苏亚雷斯
  star_p180: { name: '直面冷箭', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 10, goal: 7 }, // 卡瓦尼
  star_p181: { name: '顶级利刃', when: 'any', kind: 'shot', scope: 'header', onTarget: 20, goal: 16 }, // 阿圭罗
  star_p182: { name: '面门冷箭', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 8, goal: 7 }, // 伊瓜因
  star_p183: { name: '绝对偷袭者', when: 'any', kind: 'onside', chance: 49 }, // 特维斯
  star_p184: { name: '绝杀主心骨', when: 'late', kind: 'aura', attr: 'passing', bonus: 100 }, // 本泽马
  star_p185: { name: '无双坦克', when: 'any', kind: 'attr', attr: 'strength', chance: 80, bonus: 310 }, // 莱万多夫斯基
  star_p186: { name: '收割长传手', when: 'ahead', kind: 'pass', scope: 'pressured', success: 15 }, // 格列兹曼
  star_p187: { name: '主场之灵蛇', when: 'home', kind: 'attr', attr: 'dribbling', chance: 50, bonus: 700 }, // 凯恩
  star_p188: { name: '均势一击', when: 'level', kind: 'attr', attr: 'shooting', chance: 50, bonus: 600 }, // 卢卡库
  star_p189: { name: '王牌幽灵', when: 'any', kind: 'onside', chance: 72 }, // 姆巴佩
  star_p190: { name: '无双身后鬼', when: 'any', kind: 'onside', chance: 74 }, // 哈兰德
  star_p191: { name: '天生回光', when: 'any', kind: 'secondWind', stamina: 44 }, // 劳塔罗·马丁内斯
  star_p192: { name: '主场冷箭', when: 'home', kind: 'attr', attr: 'shooting', chance: 35, bonus: 600 }, // 奥斯梅恩
  star_p193: { name: '门前狙击手', when: 'inBox', kind: 'attr', attr: 'shooting', chance: 100, bonus: 355 }, // 弗拉霍维奇
  star_p194: { name: '王牌老狐狸', when: 'any', kind: 'drawFoul', pct: 73 }, // 阿尔瓦雷斯
  star_p195: { name: '巅峰闪电', when: 'any', kind: 'attr', attr: 'speed', chance: 10, bonus: 600 }, // 伊萨克
  star_p196: { name: '破僵重炮', when: 'level', kind: 'attr', attr: 'shooting', chance: 35, bonus: 600 }, // 迭戈·科斯塔
  star_p197: { name: '主场枪手', when: 'home', kind: 'shot', scope: 'inBox', onTarget: 8, goal: 6 }, // 法尔考
  star_p198: { name: '定位球神射', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 10, goal: 12 }, // 迪巴拉
  star_p199: { name: '招牌统帅', when: 'any', kind: 'aura', attr: 'dribbling', bonus: 40 }, // 坎通纳
  star_p200: { name: '绝杀炮手', when: 'late', kind: 'attr', attr: 'shooting', chance: 90, bonus: 700 }, // 里瓦尔多
  star_p201: { name: '巅峰指挥棒', when: 'any', kind: 'attr', attr: 'passing', chance: 15, bonus: 700 }, // 卡塞米罗
  star_p202: { name: '远征猎犬', when: 'away', kind: 'defend', success: 12 }, // 恩戈洛·坎特
  star_p203: { name: '绝地狙击手', when: 'behind', kind: 'shot', scope: 'longRange', onTarget: 18, goal: 7 }, // 法比尼奥
  star_p204: { name: '天生煞星', when: 'any', kind: 'intimidate', attr: 'shooting', bonus: 65 }, // 卡利杜·库利巴利
  star_p205: { name: '易边断路', when: 'secondHalf', kind: 'defend', success: 10 }, // 托马斯·穆勒
  star_p206: { name: '穿透大脑', when: 'any', kind: 'pass', scope: 'through', success: 10 }, // 尼科洛·巴雷拉
  star_p207: { name: '巅峰净手', when: 'any', kind: 'card', risk: 50 }, // 米兰·什克里尼亚尔
  star_p208: { name: '主场之钢钉', when: 'home', kind: 'defend', success: 10 }, // 谢尔盖·米林科维奇-萨维奇
  star_p209: { name: '无双指挥棒', when: 'any', kind: 'pass', scope: 'any', success: 8 }, // 艾默里克·拉波尔特
  star_p210: { name: '远征妙传', when: 'away', kind: 'pass', scope: 'freeKick', success: 15 }, // 马塞洛·布罗佐维奇
  star_p211: { name: '任意球穿云箭', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 14, goal: 14 }, // 大卫·阿拉巴
  star_p212: { name: '背水单挑王', when: 'behind', kind: 'save', scope: 'inBox', goal: 7 }, // 爱德华·门迪
  star_p213: { name: '招牌灵蛇', when: 'any', kind: 'dribble', success: 14 }, // 奇罗·因莫比莱
  star_p214: { name: '开局精神支柱', when: 'early', kind: 'aura', attr: 'tackling', bonus: 80 }, // 沃伊切赫·什琴斯尼
  star_p215: { name: '透支坦克', when: 'tired', kind: 'attr', attr: 'strength', chance: 80, bonus: 645 }, // 达尼·帕雷霍
  star_p216: { name: '巅峰坦克', when: 'any', kind: 'attr', attr: 'strength', chance: 12, bonus: 600 }, // 马泰斯·德利赫特
  star_p217: { name: '压哨冷箭', when: 'late', kind: 'attr', attr: 'shooting', chance: 90, bonus: 600 }, // 帕特里克·希克
  star_p218: { name: '魔鬼主场手术刀', when: 'home', kind: 'pass', scope: 'freeKick', success: 15 }, // 孟菲斯·德佩
  star_p219: { name: '抢先中枢', when: 'early', kind: 'pass', scope: 'any', success: 10 }, // 纳比勒·费基尔
  star_p220: { name: '客场之穿花', when: 'away', kind: 'dribble', success: 16 }, // 扬尼克·卡拉斯科
  star_p221: { name: '坐镇导演', when: 'home', kind: 'pass', scope: 'through', success: 15 }, // 菲利普·科斯蒂奇
  star_p222: { name: '敌营旗手', when: 'away', kind: 'aura', attr: 'strength', bonus: 60 }, // 赫拉德·莫雷诺
  star_p223: { name: '香蕉球飞鱼', when: 'any', kind: 'save', scope: 'freeKick', goal: 13 }, // 彼得·古拉西
  star_p224: { name: '客场炮手', when: 'away', kind: 'shot', scope: 'longRange', onTarget: 12, goal: 8 }, // 马尔科·罗伊斯
  star_p225: { name: '抢先飞鱼', when: 'early', kind: 'save', scope: 'inBox', goal: 7 }, // 扬·索默
  star_p226: { name: '巅峰重炮', when: 'any', kind: 'attr', attr: 'shooting', chance: 40, bonus: 435 }, // 亚戈·阿斯帕斯
  star_p227: { name: '锁定噩梦', when: 'ahead', kind: 'intimidate', attr: 'tackling', bonus: 85 }, // 杰米·瓦尔迪
  star_p228: { name: '前场第一步', when: 'attackingThird', kind: 'attr', attr: 'acceleration', chance: 100, bonus: 550 }, // 若昂·菲利克斯
  star_p229: { name: '本能幽灵', when: 'any', kind: 'onside', chance: 39 }, // 穆萨·迪亚比
  star_p230: { name: '读秒舞步', when: 'late', kind: 'attr', attr: 'dribbling', chance: 90, bonus: 600 }, // 里斯·詹姆斯
  star_p231: { name: '绝杀引线', when: 'late', kind: 'pass', scope: 'short', success: 15 }, // 桑德罗·托纳利
  star_p232: { name: '客场穿云箭', when: 'away', kind: 'shot', scope: 'freeKick', onTarget: 18, goal: 14 }, // 梅森·芒特
  star_p233: { name: '无双枪手', when: 'any', kind: 'attr', attr: 'shooting', chance: 8, bonus: 600 }, // 马丁·厄德高
  star_p234: { name: '回马带头大哥', when: 'secondHalf', kind: 'aura', attr: 'strength', bonus: 70 }, // 菲卡约·托莫里
  star_p235: { name: '绝对手热', when: 'any', kind: 'hotStreak', bonus: 260 }, // 路易斯·迪亚斯
  star_p236: { name: '客场之盘丝', when: 'away', kind: 'dribble', success: 18 }, // 米克尔·奥亚萨瓦尔
  star_p237: { name: '绝对导演', when: 'any', kind: 'attr', attr: 'passing', chance: 20, bonus: 600 }, // 尤里·蒂勒曼斯
  star_p238: { name: '传奇泥鳅', when: 'any', kind: 'drawFoul', pct: 74 }, // 杰克·格拉利什
  star_p239: { name: '传奇续航者', when: 'any', kind: 'stamina', drain: 26 }, // 洛伦佐·佩莱格里尼
  star_p240: { name: '天生不倒翁', when: 'any', kind: 'injury', risk: 50 }, // 马科斯·略伦特
  star_p241: { name: '二番铁钳', when: 'secondHalf', kind: 'defend', success: 8 }, // 哈坎·恰尔汗奥卢
  star_p242: { name: '穿透节拍器', when: 'any', kind: 'pass', scope: 'through', success: 9 }, // 伊克尔·穆尼亚因
  star_p243: { name: '坐镇调度师', when: 'home', kind: 'attr', attr: 'passing', chance: 45, bonus: 600 }, // 托马斯·帕尔特伊
  star_p244: { name: '王牌猎手', when: 'any', kind: 'attr', attr: 'shooting', chance: 10, bonus: 600 }, // 丹尼·卡瓦哈尔
  star_p245: { name: '敌营大脑', when: 'away', kind: 'pass', scope: 'through', success: 14 }, // 乔尔·马蒂普
  star_p246: { name: '单刀闪扑', when: 'any', kind: 'save', scope: 'oneOnOne', goal: 9 }, // 科恩·卡斯特尔斯
  star_p247: { name: '读秒追风', when: 'late', kind: 'attr', attr: 'speed', chance: 90, bonus: 600 }, // 斯特凡·德弗赖
  star_p248: { name: '腹地节拍器', when: 'attackingThird', kind: 'attr', attr: 'passing', chance: 60, bonus: 600 }, // 塞尔吉奥·卡纳莱斯
  star_p249: { name: '魔鬼主场一击', when: 'home', kind: 'attr', attr: 'shooting', chance: 30, bonus: 600 }, // 洛伦佐·因西涅
  star_p250: { name: '远征炮手', when: 'away', kind: 'shot', scope: 'header', onTarget: 20, goal: 20 }, // 斯特凡·萨维奇
  star_p251: { name: '敌营枪手', when: 'away', kind: 'shot', scope: 'inBox', onTarget: 8, goal: 6 }, // 维萨姆·本耶德尔
  star_p252: { name: '破僵领袖', when: 'level', kind: 'aura', attr: 'passing', bonus: 75 }, // 亚辛·布努
  star_p253: { name: '易边弹射', when: 'secondHalf', kind: 'attr', attr: 'acceleration', chance: 40, bonus: 600 }, // 杜尚·塔迪奇
  star_p254: { name: '世界波一击', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 8, goal: 3 }, // 亚历杭德罗·戈麦斯
  star_p255: { name: '客场猎手', when: 'away', kind: 'shot', scope: 'any', onTarget: 6, goal: 4 }, // 德里斯·梅尔滕斯
  star_p256: { name: '回马猫爪', when: 'secondHalf', kind: 'save', scope: 'oneOnOne', goal: 10 }, // 萨米尔·汉达诺维奇
  star_p257: { name: '主场之中枢', when: 'home', kind: 'pass', scope: 'cross', success: 10 }, // 科迪·加克波
  star_p258: { name: '乘胜猫爪', when: 'ahead', kind: 'attr', attr: 'reflexes', chance: 60, bonus: 450 }, // 格雷戈·科贝尔
  star_p259: { name: '巅峰带头大哥', when: 'any', kind: 'aura', attr: 'tackling', bonus: 35 }, // 卡洛斯·索莱尔
  star_p260: { name: '背水穿云箭', when: 'behind', kind: 'shot', scope: 'any', onTarget: 9, goal: 9 }, // 加布里埃尔·热苏斯
  star_p261: { name: '绝对第二春', when: 'any', kind: 'secondWind', stamina: 47 }, // 康拉德·莱默尔
  star_p262: { name: '背水绞杀', when: 'behind', kind: 'defend', success: 11 }, // 保·托雷斯
  star_p263: { name: '本能再燃', when: 'any', kind: 'secondWind', stamina: 35 }, // 鲁本·内维斯
  star_p264: { name: '背水滑步', when: 'behind', kind: 'attr', attr: 'dribbling', chance: 60, bonus: 600 }, // 法比安·鲁伊斯
  star_p265: { name: '乘胜铁闸', when: 'ahead', kind: 'attr', attr: 'tackling', chance: 60, bonus: 600 }, // 米克尔·梅里诺
  star_p266: { name: '客场之铁钳', when: 'away', kind: 'defend', success: 8 }, // 皮埃尔-埃米尔·霍伊别尔
  star_p267: { name: '巅峰梦魇', when: 'any', kind: 'intimidate', attr: 'dribbling', bonus: 40 }, // 普雷斯内尔·金彭贝
  star_p268: { name: '腹地魔术师', when: 'attackingThird', kind: 'attr', attr: 'dribbling', chance: 50, bonus: 600 }, // 费兰·门迪
  star_p269: { name: '僵局铁钳', when: 'level', kind: 'defend', success: 8 }, // 何塞·希门尼斯
  star_p270: { name: '传奇暗影', when: 'any', kind: 'onside', chance: 48 }, // 里卡多·佩雷拉
  star_p271: { name: '读秒带头大哥', when: 'late', kind: 'aura', attr: 'tackling', bonus: 100 }, // 路易斯·阿尔贝托
  star_p272: { name: '破僵节拍器', when: 'level', kind: 'attr', attr: 'passing', chance: 100, bonus: 400 }, // 科克
  star_p273: { name: '本能穿花', when: 'any', kind: 'dribble', success: 12 }, // 杜万·萨帕塔
  star_p274: { name: '传奇精神支柱', when: 'any', kind: 'aura', attr: 'tackling', bonus: 40 }, // 乔丹·亨德森
  star_p275: { name: '易边调度师', when: 'secondHalf', kind: 'pass', scope: 'long', success: 14 }, // 卢卡什·赫拉德茨基
  star_p276: { name: '读秒鬼手', when: 'late', kind: 'attr', attr: 'reflexes', chance: 90, bonus: 470 }, // 奥利弗·鲍曼
  star_p277: { name: '无双净手', when: 'any', kind: 'card', risk: 70 }, // 保利尼奥
  star_p278: { name: '传中穿针', when: 'any', kind: 'pass', scope: 'cross', success: 9 }, // 胡安·夸德拉多
  star_p279: { name: '收割旗手', when: 'ahead', kind: 'aura', attr: 'strength', bonus: 75 }, // 尼科·施洛特贝克
  star_p280: { name: '抢先鬼手', when: 'early', kind: 'attr', attr: 'reflexes', chance: 95, bonus: 385 }, // 阿隆·拉姆斯代尔
  star_p281: { name: '抢先妙传', when: 'early', kind: 'pass', scope: 'short', success: 13 }, // 卢卡斯·帕奎塔
  star_p282: { name: '冷静调度师', when: 'any', kind: 'pass', scope: 'pressured', success: 4 }, // 曼努埃尔·洛卡特利
  star_p283: { name: '破僵终结者', when: 'level', kind: 'shot', scope: 'inBox', onTarget: 6, goal: 5 }, // 努赛尔·马兹拉维
  star_p284: { name: '绝杀妙传', when: 'late', kind: 'attr', attr: 'passing', chance: 90, bonus: 500 }, // 塔米·亚伯拉罕
  star_p285: { name: '天生复苏', when: 'any', kind: 'secondWind', stamina: 32 }, // 阿尔诺·丹朱马
  star_p286: { name: '近身猎手', when: 'any', kind: 'shot', scope: 'inBox', onTarget: 4, goal: 4 }, // 本·奇尔韦尔
  star_p287: { name: '门前神射', when: 'any', kind: 'shot', scope: 'inBox', onTarget: 5, goal: 3 }, // 詹姆斯·麦迪逊
  star_p288: { name: '招牌精灵', when: 'any', kind: 'attr', attr: 'dribbling', chance: 100, bonus: 170 }, // 邓弗里斯
  star_p289: { name: '主场变奏', when: 'home', kind: 'dribble', success: 9 }, // 亚历克斯·格里马尔多
  star_p290: { name: '巅峰零牌', when: 'any', kind: 'card', risk: 45 }, // 约纳坦·塔
  star_p291: { name: '巅峰进球瘾', when: 'any', kind: 'goalRecover', stamina: 28 }, // 蒂莫·维尔纳
  star_p292: { name: '直面重炮', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 7, goal: 4 }, // 何塞·加亚
  star_p293: { name: '前场导演', when: 'attackingThird', kind: 'attr', attr: 'passing', chance: 50, bonus: 500 }, // 奥塔维奥
  star_p294: { name: '客场游龙', when: 'away', kind: 'dribble', success: 9 }, // 罗宾·戈森斯
  star_p295: { name: '巅峰闪扑', when: 'any', kind: 'attr', attr: 'reflexes', chance: 35, bonus: 195 }, // 乔丹·皮克福德
  star_p296: { name: '终场狙击手', when: 'late', kind: 'shot', scope: 'longRange', onTarget: 15, goal: 5 }, // 卢卡·迪涅
  star_p297: { name: '回马断路', when: 'secondHalf', kind: 'defend', success: 9 }, // 马蒂亚斯·金特尔
  star_p298: { name: '禁区炮手', when: 'any', kind: 'shot', scope: 'inBox', onTarget: 4, goal: 3 }, // 拉斐尔·格雷罗
  star_p299: { name: '隔空穿云箭', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 6, goal: 4 }, // 塞尔吉·达德尔
  star_p300: { name: '乘胜魔掌', when: 'ahead', kind: 'attr', attr: 'reflexes', chance: 60, bonus: 365 }, // 索里亚
  star_p301: { name: '主场猎犬', when: 'home', kind: 'defend', success: 9 }, // 杰弗里·孔多比亚
  star_p302: { name: '巅峰马拉松', when: 'any', kind: 'stamina', drain: 23 }, // 莱昂纳多·斯皮纳佐拉
  star_p303: { name: '腹背坦克', when: 'ownHalf', kind: 'attr', attr: 'strength', chance: 50, bonus: 355 }, // 威利·奥尔班
  star_p304: { name: '隔空利刃', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 5, goal: 2 }, // 威尔弗里德·扎哈
  star_p305: { name: '魔鬼主场大脑', when: 'home', kind: 'pass', scope: 'cross', success: 9 }, // 菲利佩·库蒂尼奥
  star_p306: { name: '巅峰优雅', when: 'any', kind: 'card', risk: 30 }, // 科斯塔斯·马诺拉斯
  star_p307: { name: '天生断路', when: 'any', kind: 'defend', success: 4 }, // 史蒂文·博古伊斯
  star_p308: { name: '坐镇利刃', when: 'home', kind: 'shot', scope: 'oneOnOne', onTarget: 11, goal: 8 }, // 安德烈·克拉马里奇
  star_p309: { name: '绝对手术刀', when: 'any', kind: 'pass', scope: 'any', success: 3 }, // 加布里埃尔·保利斯塔
  star_p310: { name: '单刀重炮', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 6, goal: 4 }, // 劳尔·希门尼斯
  star_p311: { name: '主场之顶梁柱', when: 'home', kind: 'aura', attr: 'passing', bonus: 40 }, // 塞巴斯蒂安·科茨
  star_p312: { name: '绝杀铁钳', when: 'late', kind: 'defend', success: 10 }, // 塞萨尔·阿斯皮利奎塔
  star_p313: { name: '锐气魔术师', when: 'fresh', kind: 'attr', attr: 'dribbling', chance: 100, bonus: 320 }, // 尤里·贝尔奇切
  star_p314: { name: '主场之重炮', when: 'home', kind: 'shot', scope: 'freeKick', onTarget: 12, goal: 14 }, // 马尔科·阿瑙托维奇
  star_p315: { name: '长传画师', when: 'any', kind: 'pass', scope: 'long', success: 6 }, // 托比·阿尔德韦雷尔德
  star_p316: { name: '魔鬼主场顶梁柱', when: 'home', kind: 'aura', attr: 'tackling', bonus: 40 }, // 樊尚·孔帕尼
  star_p317: { name: '直塞大脑', when: 'any', kind: 'pass', scope: 'through', success: 6 }, // 鲁伊·帕特里西奥
  star_p318: { name: '无双终结者', when: 'any', kind: 'shot', scope: 'any', onTarget: 4, goal: 3 }, // 迪米特里·帕耶
  star_p319: { name: '背水利刃', when: 'behind', kind: 'attr', attr: 'shooting', chance: 60, bonus: 500 }, // 奥利维耶·吉鲁
  star_p320: { name: '破僵战斧', when: 'level', kind: 'defend', success: 6 }, // 劳尔·阿尔比奥尔
  star_p321: { name: '远征游龙', when: 'away', kind: 'dribble', success: 15 }, // 德扬·库卢塞夫斯基
  star_p322: { name: '闪击利刃', when: 'early', kind: 'shot', scope: 'inBox', onTarget: 13, goal: 8 }, // 尼科洛·扎尼奥洛
  star_p323: { name: '传奇铁打', when: 'any', kind: 'injury', risk: 45 }, // 埃德蒙·塔普索巴
  star_p324: { name: '僵局盘丝', when: 'level', kind: 'attr', attr: 'dribbling', chance: 35, bonus: 500 }, // 布鲁诺·吉马良斯
  star_p325: { name: '王牌回血', when: 'any', kind: 'goalRecover', stamina: 27 }, // 大卫·劳姆
  star_p326: { name: '走廊手术刀', when: 'any', kind: 'pass', scope: 'cross', success: 5 }, // 佩德罗·贡萨尔维斯
  star_p327: { name: '天生爆发', when: 'any', kind: 'hotStreak', bonus: 130 }, // 阿兰·圣马克西曼
  star_p328: { name: '抢先断路', when: 'early', kind: 'defend', success: 10 }, // 丹尼斯·扎卡里亚
  star_p329: { name: '客场之枪手', when: 'away', kind: 'shot', scope: 'longRange', onTarget: 9, goal: 3 }, // 马丁·特里尔
  star_p330: { name: '抢先炮手', when: 'early', kind: 'attr', attr: 'shooting', chance: 95, bonus: 500 }, // 阿德南·亚努扎伊
  star_p331: { name: '乘胜断路', when: 'ahead', kind: 'attr', attr: 'tackling', chance: 90, bonus: 500 }, // 安德烈-弗兰克·赞博·安古伊萨
  star_p332: { name: '满血中枢', when: 'fresh', kind: 'attr', attr: 'passing', chance: 35, bonus: 500 }, // 詹卢卡·曼奇尼
  star_p333: { name: '锁定导演', when: 'ahead', kind: 'attr', attr: 'passing', chance: 100, bonus: 485 }, // 卢卡斯·托雷拉
  star_p334: { name: '易边队魂', when: 'secondHalf', kind: 'aura', attr: 'tackling', bonus: 30 }, // 科朗坦·托利索
  star_p335: { name: '王牌长跑者', when: 'any', kind: 'stamina', drain: 22 }, // 吉多·罗德里格斯
  star_p336: { name: '越墙终结者', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 8, goal: 7 }, // 詹姆斯·沃德-普劳斯
  star_p337: { name: '招牌跑不死', when: 'any', kind: 'stamina', drain: 24 }, // 托马斯·绍切克
  star_p338: { name: '招牌杀红眼', when: 'any', kind: 'hotStreak', bonus: 155 }, // 克里姆·德米尔拜
  star_p339: { name: '抢先统帅', when: 'early', kind: 'aura', attr: 'tackling', bonus: 50 }, // 奥季塞亚斯·弗拉霍迪莫斯
  star_p340: { name: '反扑穿花', when: 'behind', kind: 'dribble', success: 15 }, // 博尔哈·伊格莱西亚斯
  star_p341: { name: '领跑绞杀', when: 'ahead', kind: 'defend', success: 9 }, // 哈里·马奎尔
  star_p342: { name: '读秒变奏', when: 'late', kind: 'dribble', success: 18 }, // 赫苏斯·科罗纳
  star_p343: { name: '无双泥鳅', when: 'any', kind: 'drawFoul', pct: 70 }, // 约纳斯·霍夫曼
  star_p344: { name: '均势画师', when: 'level', kind: 'pass', scope: 'through', success: 11 }, // 尼古拉斯·塔利亚菲科
  star_p345: { name: '替补变奏', when: 'subbedOn', kind: 'dribble', success: 15 }, // 文琴佐·格里福
  star_p346: { name: '王牌鬼步', when: 'any', kind: 'dribble', success: 7 }, // 埃米尔·福斯贝里
  star_p347: { name: '无双绝技', when: 'any', kind: 'skillBoost', pct: 27 }, // 马里奥·格策
  star_p348: { name: '回马长城', when: 'secondHalf', kind: 'save', scope: 'oneOnOne', goal: 9 }, // 尼克·波普
  star_p349: { name: '远征长传手', when: 'away', kind: 'pass', scope: 'any', success: 8 }, // 亚历山大·拉卡泽特
  star_p350: { name: '抢先调度师', when: 'early', kind: 'pass', scope: 'pressured', success: 13 }, // 马特乌斯·乌里韦
  star_p351: { name: '无双拦路虎', when: 'any', kind: 'attr', attr: 'tackling', chance: 60, bonus: 255 }, // 马克·巴尔特拉
  star_p352: { name: '反扑清道夫', when: 'behind', kind: 'defend', success: 9 }, // 克里斯·斯莫林
  star_p353: { name: '反扑灵蛇', when: 'behind', kind: 'attr', attr: 'dribbling', chance: 60, bonus: 500 }, // 卡洛斯·维拉
  star_p354: { name: '坐镇中枢', when: 'home', kind: 'pass', scope: 'short', success: 8 }, // 加比
  star_p355: { name: '王牌战车', when: 'any', kind: 'attr', attr: 'strength', chance: 30, bonus: 445 }, // 萨米·赫迪拉
  star_p356: { name: '压哨鬼手', when: 'late', kind: 'attr', attr: 'reflexes', chance: 90, bonus: 380 }, // 米卡埃尔·朗德罗
  star_p357: { name: '背水顶梁柱', when: 'behind', kind: 'aura', attr: 'strength', bonus: 55 }, // 尼古拉斯·奥塔门迪
  star_p358: { name: '二番队魂', when: 'secondHalf', kind: 'aura', attr: 'strength', bonus: 45 }, // 埃韦尔·巴内加
  star_p359: { name: '新锐变奏', when: 'fresh', kind: 'attr', attr: 'dribbling', chance: 35, bonus: 500 }, // 安德烈-皮埃尔·吉尼亚克
  star_p360: { name: '敌营壁垒', when: 'away', kind: 'attr', attr: 'tackling', chance: 100, bonus: 295 }, // 扬·费尔通亨
  star_p361: { name: '传奇净手', when: 'any', kind: 'card', risk: 40 }, // 若昂·穆蒂尼奥
  star_p362: { name: '传奇战车', when: 'any', kind: 'attr', attr: 'strength', chance: 100, bonus: 170 }, // 萨米埃尔·埃托奥
  star_p363: { name: '后程穿花', when: 'secondHalf', kind: 'dribble', success: 9 }, // 努诺·门德斯
  star_p364: { name: '后场断路', when: 'ownHalf', kind: 'attr', attr: 'tackling', chance: 20, bonus: 500 }, // 布巴卡尔·卡马拉
  star_p365: { name: '巅峰钢钉', when: 'any', kind: 'attr', attr: 'tackling', chance: 80, bonus: 205 }, // 马泰奥·贡多齐
  star_p366: { name: '易边画师', when: 'secondHalf', kind: 'pass', scope: 'freeKick', success: 15 }, // 韦斯顿·麦肯尼
  star_p367: { name: '巅峰登峰', when: 'any', kind: 'skillBoost', pct: 37 }, // 哈维·巴恩斯
  star_p368: { name: '僵局重炮', when: 'level', kind: 'shot', scope: 'longRange', onTarget: 10, goal: 5 }, // 里德勒·巴库
  star_p369: { name: '王牌盘丝', when: 'any', kind: 'dribble', success: 9 }, // 史蒂文·贝尔温
  star_p370: { name: '魔鬼主场战斧', when: 'home', kind: 'attr', attr: 'tackling', chance: 35, bonus: 500 }, // 克萨韦尔·施拉格尔
  star_p371: { name: '本能杀红眼', when: 'any', kind: 'hotStreak', bonus: 195 }, // 多米尼克·卡尔弗特-勒温
  star_p372: { name: '魔鬼主场中枢', when: 'home', kind: 'pass', scope: 'through', success: 12 }, // 弗洛里安·诺伊豪斯
  star_p373: { name: '本能进球瘾', when: 'any', kind: 'goalRecover', stamina: 25 }, // 贾罗德·鲍文
  star_p374: { name: '魔鬼主场妙传', when: 'home', kind: 'pass', scope: 'long', success: 12 }, // 斯科特·麦克托米奈
  star_p375: { name: '主场之狙击手', when: 'home', kind: 'shot', scope: 'oneOnOne', onTarget: 11, goal: 6 }, // 优素福·恩-内斯里
  star_p376: { name: '板凳穿花', when: 'subbedOn', kind: 'dribble', success: 18 }, // 卢克·肖
  star_p377: { name: '传奇回魂', when: 'any', kind: 'secondWind', stamina: 39 }, // 马哈茂德·达胡德
  star_p378: { name: '客场之清道夫', when: 'away', kind: 'defend', success: 6 }, // 阿莱西奥·罗马尼奥利
  star_p379: { name: '防区断路', when: 'ownHalf', kind: 'attr', attr: 'tackling', chance: 35, bonus: 470 }, // 库尔特·祖马
  star_p380: { name: '锋线鬼步', when: 'attackingThird', kind: 'attr', attr: 'dribbling', chance: 50, bonus: 500 }, // 里克·卡斯多普
  star_p381: { name: '收割导演', when: 'ahead', kind: 'attr', attr: 'passing', chance: 60, bonus: 500 }, // 萨达尔·阿兹蒙
  star_p382: { name: '巅峰顶梁柱', when: 'any', kind: 'aura', attr: 'shooting', bonus: 35 }, // 赫拉德·德乌洛费乌
  star_p383: { name: '收割灵蛇', when: 'ahead', kind: 'dribble', success: 13 }, // 汉斯·哈特波尔
  star_p384: { name: '定位球猎手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 9, goal: 8 }, // 弗雷德
  star_p385: { name: '头槌飞鱼', when: 'any', kind: 'save', scope: 'header', goal: 14 }, // 马克·弗莱肯
  star_p386: { name: '香蕉球重炮', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 9, goal: 7 }, // 弗拉迪米尔·曹法尔
  star_p387: { name: '坐镇重炮', when: 'home', kind: 'attr', attr: 'shooting', chance: 30, bonus: 500 }, // 乔治尼奥·维纳尔杜姆
  star_p388: { name: '坐镇清道夫', when: 'home', kind: 'defend', success: 6 }, // 凯文·坎普尔
  star_p389: { name: '主场节拍器', when: 'home', kind: 'pass', scope: 'pressured', success: 6 }, // 戴利·布林德
  star_p390: { name: '绝对穿针', when: 'any', kind: 'attr', attr: 'passing', chance: 8, bonus: 500 }, // 埃克托·埃雷拉
  star_p391: { name: '回马铁钳', when: 'secondHalf', kind: 'defend', success: 6 }, // 霍纳坦·比埃拉
  star_p392: { name: '王牌铁人', when: 'any', kind: 'injury', risk: 35 }, // 大卫·奥斯皮纳
  star_p393: { name: '闹中引线', when: 'any', kind: 'pass', scope: 'pressured', success: 3 }, // 艾蒂安·卡普埃
  star_p394: { name: '王牌压线', when: 'any', kind: 'onside', chance: 31 }, // 浩克
  star_p395: { name: '本能钢筋', when: 'any', kind: 'injury', risk: 30 }, // 马雷克·哈姆西克
  star_p396: { name: '背水调度师', when: 'behind', kind: 'attr', attr: 'passing', chance: 60, bonus: 500 }, // 马克斯·克鲁泽
  star_p397: { name: '死战猛犸', when: 'tired', kind: 'attr', attr: 'strength', chance: 50, bonus: 500 }, // 何塞·路易斯·莫拉莱斯
  star_p398: { name: '招牌稳手', when: 'any', kind: 'attr', attr: 'handling', chance: 45, bonus: 160 }, // 西蒙·米尼奥莱
  star_p399: { name: '敌营钢钉', when: 'away', kind: 'defend', success: 9 }, // 胡安·米兰达
  star_p400: { name: '领跑对决者', when: 'ahead', kind: 'attr', attr: 'oneOnOne', chance: 60, bonus: 365 }, // 吉列尔莫·奥乔亚
  star_p401: { name: '本能队魂', when: 'any', kind: 'aura', attr: 'strength', bonus: 35 }, // 若泽·丰特
  star_p402: { name: '客场之变奏', when: 'away', kind: 'dribble', success: 11 }, // 多米尼克·索博斯洛伊
  star_p403: { name: '王牌大魔王', when: 'any', kind: 'intimidate', attr: 'passing', bonus: 25 }, // 韦斯利·福法纳
  star_p404: { name: '穿透导演', when: 'any', kind: 'pass', scope: 'through', success: 7 }, // 马克桑斯·卡克雷
  star_p405: { name: '主场导演', when: 'home', kind: 'pass', scope: 'through', success: 11 }, // 维蒂尼亚
  star_p406: { name: '招牌长跑者', when: 'any', kind: 'stamina', drain: 21 }, // 埃兹里·孔萨
  star_p407: { name: '无双连击', when: 'any', kind: 'hotStreak', bonus: 160 }, // 卢卡·约维奇
  star_p408: { name: '客场之神扑', when: 'away', kind: 'attr', attr: 'reflexes', chance: 35, bonus: 345 }, // 迪恩·亨德森
  star_p409: { name: '主场之魔术师', when: 'home', kind: 'dribble', success: 14 }, // 巴勃罗·福纳尔斯
  star_p410: { name: '跨越穿针', when: 'any', kind: 'pass', scope: 'long', success: 5 }, // 约翰·麦金
  star_p411: { name: '元气中枢', when: 'fresh', kind: 'attr', attr: 'passing', chance: 55, bonus: 500 }, // 内马尼亚·马克西莫维奇
  star_p412: { name: '开局门神', when: 'early', kind: 'attr', attr: 'reflexes', chance: 100, bonus: 370 }, // 保·洛佩斯
  star_p413: { name: '后程灵蛇', when: 'secondHalf', kind: 'dribble', success: 11 }, // 阿尔卡迪乌什·米利克
  star_p414: { name: '锋线变奏', when: 'attackingThird', kind: 'attr', attr: 'dribbling', chance: 80, bonus: 500 }, // 乔尼·奥托
  star_p415: { name: '王牌不死鸟', when: 'any', kind: 'injury', risk: 55 }, // 马丁·欣特雷格
  star_p416: { name: '绝对穿花', when: 'any', kind: 'dribble', success: 6 }, // 塞尔日·奥里耶
  star_p417: { name: '无双二次呼吸', when: 'any', kind: 'secondWind', stamina: 30 }, // 阿卜杜拉耶·杜库雷
  star_p418: { name: '飞边弹簧', when: 'wide', kind: 'attr', attr: 'acceleration', chance: 30, bonus: 500 }, // 费利佩·安德森
  star_p419: { name: '主场泰坦', when: 'home', kind: 'attr', attr: 'strength', chance: 50, bonus: 500 }, // 格拉尼特·扎卡
  star_p420: { name: '易边舞者', when: 'secondHalf', kind: 'dribble', success: 14 }, // 胡安米
  star_p421: { name: '天生铁闸', when: 'any', kind: 'attr', attr: 'tackling', chance: 5, bonus: 500 }, // 曼努埃尔·兰奇尼
  star_p422: { name: '绝对马拉松', when: 'any', kind: 'stamina', drain: 17 }, // 尼古拉·斯坦丘
  star_p423: { name: '终场炮手', when: 'late', kind: 'attr', attr: 'shooting', chance: 90, bonus: 500 }, // 达维德·扎帕科斯塔
  star_p424: { name: '读秒发条', when: 'late', kind: 'stamina', drain: 43 }, // 塞尔吉奥·奥利韦拉
  star_p425: { name: '世界波杀手', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 6, goal: 2 }, // 希梅·弗尔萨利科
  star_p426: { name: '绝杀顶梁柱', when: 'late', kind: 'aura', attr: 'tackling', bonus: 65 }, // 斯文·本德
  star_p427: { name: '转移画师', when: 'any', kind: 'pass', scope: 'long', success: 7 }, // 大卫·路易斯
  star_p428: { name: '王牌带头大哥', when: 'any', kind: 'aura', attr: 'tackling', bonus: 20 }, // 比森特·瓜伊塔
  star_p429: { name: '主场之魔掌', when: 'home', kind: 'save', scope: 'longRange', goal: 5 }, // 史蒂夫·曼丹达
  star_p430: { name: '奇兵枪手', when: 'subbedOn', kind: 'shot', scope: 'inBox', onTarget: 10, goal: 8 }, // 彼罗·因卡皮耶
  star_p431: { name: '破僵盘丝', when: 'level', kind: 'dribble', success: 11 }, // 克里斯托夫·鲍姆加特纳
  star_p432: { name: '后程顶梁柱', when: 'secondHalf', kind: 'aura', attr: 'speed', bonus: 45 }, // 穆罕默德·西马坎
  star_p433: { name: '无双火力', when: 'any', kind: 'hotStreak', bonus: 165 }, // 佩德罗·内图
  star_p434: { name: '魔术弧猎手', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 9, goal: 9 }, // 迪奥戈·达洛特
  star_p435: { name: '魔鬼主场终结者', when: 'home', kind: 'attr', attr: 'shooting', chance: 45, bonus: 500 }, // 卢卡斯·恩梅查
  star_p436: { name: '本能暗影', when: 'any', kind: 'onside', chance: 46 }, // 诺亚·朗
  star_p437: { name: '飞边盘丝', when: 'wide', kind: 'attr', attr: 'dribbling', chance: 100, bonus: 295 }, // 博尔纳·索萨
  star_p438: { name: '无双阴影', when: 'any', kind: 'intimidate', attr: 'passing', bonus: 35 }, // 康斯坦丁诺斯·马夫罗帕诺斯
  star_p439: { name: '绝对带头大哥', when: 'any', kind: 'aura', attr: 'passing', bonus: 20 }, // 马库斯·图拉姆
  star_p440: { name: '开局画师', when: 'early', kind: 'pass', scope: 'cross', success: 15 }, // 巴勃罗·马费奥
  star_p441: { name: '绝对连珠炮', when: 'any', kind: 'hotStreak', bonus: 170 }, // 萨沙·卡莱季奇
  star_p442: { name: '抢先魔掌', when: 'early', kind: 'save', scope: 'inBox', goal: 5 }, // 亚历山大·尼贝尔
  star_p443: { name: '独闯终结者', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 6, goal: 5 }, // 恩内斯·乌纳尔
  star_p444: { name: '死战铁闸', when: 'tired', kind: 'attr', attr: 'tackling', chance: 40, bonus: 500 }, // 菲利普·林哈特
  star_p445: { name: '后场壁垒', when: 'ownHalf', kind: 'attr', attr: 'tackling', chance: 50, bonus: 355 }, // 巴勃罗·罗萨里奥
  star_p446: { name: '防区妙传', when: 'ownHalf', kind: 'attr', attr: 'passing', chance: 100, bonus: 205 }, // 穆萨·尼亚卡泰
  star_p447: { name: '王牌中枢', when: 'any', kind: 'attr', attr: 'passing', chance: 20, bonus: 500 }, // 斯特凡诺·森西
  star_p448: { name: '纵深瞬移', when: 'attackingThird', kind: 'attr', attr: 'acceleration', chance: 50, bonus: 500 }, // 蒂莫西·卡斯塔涅
  star_p449: { name: '均势舞步', when: 'level', kind: 'dribble', success: 15 }, // 亚历山大·米特罗维奇
  star_p450: { name: '绝杀穿花', when: 'late', kind: 'dribble', success: 15 }, // 米格尔·阿尔米隆
  star_p451: { name: '云端狙击手', when: 'any', kind: 'shot', scope: 'header', onTarget: 14, goal: 11 }, // 帕特里克·班福德
  star_p452: { name: '本能统帅', when: 'any', kind: 'aura', attr: 'shooting', bonus: 20 }, // 阿拉桑·普莱亚
  star_p453: { name: '无双再燃', when: 'any', kind: 'secondWind', stamina: 40 }, // 杰西·林加德
  star_p454: { name: '客场之灵蛇', when: 'away', kind: 'dribble', success: 12 }, // 卡尔·托科·埃坎比
  star_p455: { name: '弧线长传手', when: 'any', kind: 'pass', scope: 'cross', success: 7 }, // 詹姆斯·塔弗尼尔
  star_p456: { name: '客场之统帅', when: 'away', kind: 'aura', attr: 'passing', bonus: 30 }, // 塞巴斯蒂安·罗德
  star_p457: { name: '反扑压迫感', when: 'behind', kind: 'intimidate', attr: 'passing', bonus: 65 }, // 马科斯·罗霍
  star_p458: { name: '读秒铜墙', when: 'late', kind: 'attr', attr: 'strength', chance: 90, bonus: 500 }, // 西德内
  star_p459: { name: '后程中枢', when: 'secondHalf', kind: 'pass', scope: 'short', success: 8 }, // 热雷米·图拉朗
  star_p460: { name: '王牌二次呼吸', when: 'any', kind: 'secondWind', stamina: 31 }, // 卢卡斯·佩雷斯
  star_p461: { name: '近身终结者', when: 'inBox', kind: 'attr', attr: 'shooting', chance: 40, bonus: 500 }, // 奥迪翁·伊哈洛
  star_p462: { name: '乘胜稳手', when: 'ahead', kind: 'attr', attr: 'handling', chance: 60, bonus: 365 }, // 马文·希茨
  star_p463: { name: '绝对净手', when: 'any', kind: 'card', risk: 35 }, // 丹特
  star_p464: { name: '王牌登峰', when: 'any', kind: 'skillBoost', pct: 45 }, // 克劳迪奥·布拉沃
  star_p465: { name: '绝对大脑', when: 'any', kind: 'pass', scope: 'any', success: 4 }, // 马克桑斯·拉克鲁瓦
  star_p466: { name: '独闯重炮', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 8, goal: 4 }, // 穆萨·巴罗
  star_p467: { name: '魔术弧终结者', when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 12, goal: 6 }, // 伊斯梅拉·萨尔
  star_p468: { name: '坐镇舞步', when: 'home', kind: 'dribble', success: 11 }, // 堂安律
  star_p469: { name: '三十米重炮', when: 'any', kind: 'shot', scope: 'longRange', onTarget: 4, goal: 4 }, // 安德里亚·日夫科维奇
  star_p470: { name: '远征灵蛇', when: 'away', kind: 'dribble', success: 14 }, // 本亚明·亨里希斯
  star_p471: { name: '前场奔雷', when: 'attackingThird', kind: 'attr', attr: 'speed', chance: 55, bonus: 500 }, // 布赖斯·门德斯
  star_p472: { name: '本能威压', when: 'any', kind: 'intimidate', attr: 'dribbling', bonus: 25 }, // 马克斯·基尔曼
  star_p473: { name: '满血奔雷', when: 'fresh', kind: 'attr', attr: 'speed', chance: 70, bonus: 430 }, // 桑蒂·米纳
  star_p474: { name: '背水游龙', when: 'behind', kind: 'dribble', success: 13 }, // 黄喜灿
  star_p475: { name: '远征猎手', when: 'away', kind: 'attr', attr: 'shooting', chance: 55, bonus: 480 }, // 伊万·托尼
  star_p476: { name: '锐气舞者', when: 'fresh', kind: 'attr', attr: 'dribbling', chance: 45, bonus: 500 }, // 马特·塔吉特
  star_p477: { name: '替补快马', when: 'subbedOn', kind: 'attr', attr: 'speed', chance: 100, bonus: 500 }, // 杰森·德纳耶尔
  star_p478: { name: '无双带头大哥', when: 'any', kind: 'aura', attr: 'speed', bonus: 35 }, // 法比安·舍尔
  star_p479: { name: '无双顶梁柱', when: 'any', kind: 'aura', attr: 'passing', bonus: 30 }, // 保罗·奥利维拉
  star_p480: { name: '客场之引擎', when: 'away', kind: 'stamina', drain: 36 }, // 萨利姆·道萨里
  star_p481: { name: '远征画师', when: 'away', kind: 'attr', attr: 'passing', chance: 35, bonus: 500 }, // 谢库·库亚特
  star_p482: { name: '客场引线', when: 'away', kind: 'pass', scope: 'cross', success: 8 }, // 乌戈·马略
  star_p483: { name: '无双进球瘾', when: 'any', kind: 'goalRecover', stamina: 18 }, // 马里奥·巴洛特利
  star_p484: { name: '抢先阴影', when: 'early', kind: 'intimidate', attr: 'dribbling', bonus: 65 }, // 帕斯卡尔·格罗斯
  star_p485: { name: '僵局利刃', when: 'level', kind: 'shot', scope: 'any', onTarget: 5, goal: 5 }, // 达里奥·贝内德托
  star_p486: { name: '绝对引线', when: 'any', kind: 'attr', attr: 'passing', chance: 25, bonus: 500 }, // 穆萨·西索科
  star_p487: { name: '高空重炮', when: 'any', kind: 'shot', scope: 'header', onTarget: 12, goal: 11 }, // 斯特万·约韦蒂奇
  star_p488: { name: '三角画师', when: 'any', kind: 'pass', scope: 'short', success: 6 }, // 维托洛
  star_p489: { name: '绝对杀红眼', when: 'any', kind: 'hotStreak', bonus: 135 }, // 奥斯卡·德马科斯
  star_p490: { name: '招牌威压', when: 'any', kind: 'intimidate', attr: 'passing', bonus: 30 }, // 菲利普·梅克塞斯
  star_p491: { name: '收割战斧', when: 'ahead', kind: 'attr', attr: 'tackling', chance: 60, bonus: 500 }, // 索克拉蒂斯·帕帕斯塔索普洛斯
  star_p492: { name: '招牌爆发', when: 'any', kind: 'hotStreak', bonus: 145 }, // 费尔南多·托雷斯
  star_p493: { name: '胶着妙传', when: 'level', kind: 'attr', attr: 'passing', chance: 50, bonus: 500 }, // 安德烈斯·瓜尔达多
  star_p494: { name: '小禁区神射', when: 'inBox', kind: 'attr', attr: 'shooting', chance: 50, bonus: 500 }, // 克里斯蒂安·斯图亚尼
  star_p495: { name: '替补神射', when: 'subbedOn', kind: 'shot', scope: 'any', onTarget: 8, goal: 5 }, // 凯文·加梅罗
  star_p496: { name: '敌营重炮', when: 'away', kind: 'attr', attr: 'shooting', chance: 60, bonus: 445 }, // 纳尼
  star_p497: { name: '制空铜墙', when: 'aerial', kind: 'attr', attr: 'strength', chance: 70, bonus: 500 }, // 迭戈·戈丁
  star_p498: { name: '客场之猎手', when: 'away', kind: 'shot', scope: 'oneOnOne', onTarget: 9, goal: 8 }, // 阿尔瓦罗·内格雷多
  star_p499: { name: '顶级长城', when: 'any', kind: 'save', scope: 'header', goal: 12 }, // 本·福斯特
  star_p500: { name: '王牌戏精', when: 'any', kind: 'drawFoul', pct: 43 }, // 约纳坦·布卡特
}
