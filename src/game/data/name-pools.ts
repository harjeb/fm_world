/**
 * 随机球员的姓名池：英文名和中文译名成对写，中文永远由英文名翻译而来。
 * 名和姓是随机组合，不指向特定的真实人物。
 */
type Part = readonly [en: string, zh: string]

/**
 * western：英文“名 姓”，中文“名·姓”。
 * japanese：英文“名 姓”，中文“姓名”连写。
 * surname-first：中韩写法，英文和中文都是姓在前。
 */
type NameStyle = 'western' | 'japanese' | 'surname-first'

type NamePool = {
  country: string
  weight: number
  style: NameStyle
  first: readonly Part[]
  last: readonly Part[]
}

export const NAME_POOLS: readonly NamePool[] = [
  {
    country: '中国', weight: 16, style: 'surname-first',
    first: [['Ziang', '子昂'], ['Yuhang', '宇航'], ['Jiashu', '嘉树'], ['Mingyuan', '明远'], ['Yiming', '一鸣'], ['Haoran', '浩然'], ['Siyuan', '思远'], ['Zeyu', '泽宇'], ['Yichen', '奕辰'], ['Wenbo', '文博'], ['Qihang', '启航'], ['Tianyou', '天佑'], ['Junchi', '俊驰'], ['Bowen', '博文'], ['Chengyu', '承宇'], ['Yifan', '亦凡'], ['Xinghe', '星河'], ['Jingxing', '景行'], ['Zhixing', '知行'], ['Xiuyuan', '修远'], ['Yuchen', '雨辰'], ['Muye', '牧野'], ['Ruogu', '若谷'], ['Yunzhou', '云舟']],
    last: [['Tian', '田'], ['Lin', '林'], ['Chen', '陈'], ['Zhou', '周'], ['Zhao', '赵'], ['Xu', '许'], ['Shen', '沈'], ['Han', '韩'], ['Yang', '杨'], ['Ye', '叶'], ['Su', '苏'], ['Lu', '陆'], ['Cheng', '程'], ['Fang', '方'], ['Jiang', '江'], ['Tang', '唐'], ['Wei', '魏'], ['Feng', '冯'], ['Luo', '罗'], ['He', '何'], ['Gao', '高'], ['Peng', '彭'], ['Zhong', '钟'], ['Qin', '秦']],
  },
  {
    country: '英格兰', weight: 10, style: 'western',
    first: [['Noah', '诺亚'], ['Liam', '利亚姆'], ['Ethan', '伊桑'], ['Owen', '欧文'], ['Finn', '芬恩'], ['Leo', '利奥'], ['Harry', '哈里'], ['Jack', '杰克'], ['Callum', '卡勒姆'], ['Jamie', '杰米'], ['Ryan', '瑞安'], ['Lewis', '刘易斯'], ['Ben', '本'], ['Milo', '米洛'], ['Ezra', '埃兹拉'], ['Kai', '凯']],
    last: [['Hart', '哈特'], ['Vale', '维尔'], ['Bennett', '贝内特'], ['Cole', '科尔'], ['Foster', '福斯特'], ['Turner', '特纳'], ['Hughes', '休斯'], ['Shaw', '肖'], ['Reid', '里德'], ['Barker', '巴克'], ['Mason', '梅森'], ['Holt', '霍尔特'], ['Price', '普赖斯'], ['Parker', '帕克'], ['Fletcher', '弗莱彻'], ['Dawson', '道森']],
  },
  {
    country: '西班牙', weight: 8, style: 'western',
    first: [['Mateo', '马特奥'], ['Diego', '迭戈'], ['Hugo', '乌戈'], ['Pablo', '巴勃罗'], ['Alvaro', '阿尔瓦罗'], ['Sergio', '塞尔吉奥'], ['Iker', '伊克尔'], ['Javier', '哈维尔'], ['Adrian', '阿德里安'], ['Marcos', '马科斯'], ['Nico', '尼科'], ['Dario', '达里奥']],
    last: [['Navarro', '纳瓦罗'], ['Reyes', '雷耶斯'], ['Ortega', '奥尔特加'], ['Romero', '罗梅罗'], ['Molina', '莫利纳'], ['Castro', '卡斯特罗'], ['Vega', '维加'], ['Herrera', '埃雷拉'], ['Cano', '卡诺'], ['Prieto', '普列托'], ['Gallardo', '加拉多'], ['Pascual', '帕斯夸尔']],
  },
  {
    country: '巴西', weight: 8, style: 'western',
    first: [['Rafael', '拉斐尔'], ['Bruno', '布鲁诺'], ['Andre', '安德烈'], ['Thiago', '蒂亚戈'], ['Caio', '凯奥'], ['Gustavo', '古斯塔沃'], ['Lucas', '卢卡斯'], ['Joao', '若昂'], ['Felipe', '费利佩'], ['Vitor', '维托尔'], ['Matheus', '马特乌斯'], ['Renan', '雷南']],
    last: [['Silva', '席尔瓦'], ['Costa', '科斯塔'], ['Ferreira', '费雷拉'], ['Serra', '塞拉'], ['Almeida', '阿尔梅达'], ['Moura', '莫拉'], ['Pires', '皮雷斯'], ['Teixeira', '特谢拉'], ['Barbosa', '巴尔博扎'], ['Nunes', '努内斯'], ['Cardoso', '卡多佐'], ['Ribeiro', '里贝罗']],
  },
  {
    country: '阿根廷', weight: 5, style: 'western',
    first: [['Nicolas', '尼古拉斯'], ['Facundo', '法昆多'], ['Santiago', '圣地亚哥'], ['Agustin', '阿古斯丁'], ['Joaquin', '华金'], ['Tomas', '托马斯'], ['Franco', '佛朗哥'], ['Ignacio', '伊格纳西奥'], ['Gonzalo', '贡萨洛'], ['Emiliano', '埃米利亚诺'], ['Ramiro', '拉米罗']],
    last: [['Benitez', '贝尼特斯'], ['Acosta', '阿科斯塔'], ['Paredes', '帕雷德斯'], ['Sosa', '索萨'], ['Rojas', '罗哈斯'], ['Medina', '梅迪纳'], ['Aguirre', '阿吉雷'], ['Ledesma', '莱德斯马'], ['Quiroga', '基罗加'], ['Cabrera', '卡夫雷拉']],
  },
  {
    country: '意大利', weight: 7, style: 'western',
    first: [['Luca', '卢卡'], ['Marco', '马尔科'], ['Matteo', '马泰奥'], ['Nicolo', '尼科洛'], ['Davide', '达维德'], ['Lorenzo', '洛伦佐'], ['Simone', '西莫内'], ['Andrea', '安德烈亚'], ['Federico', '费德里科'], ['Giacomo', '贾科莫'], ['Riccardo', '里卡尔多']],
    last: [['Rossi', '罗西'], ['Bianchi', '比安基'], ['Marchetti', '马尔凯蒂'], ['Ricci', '里奇'], ['Greco', '格雷科'], ['Conti', '孔蒂'], ['Moretti', '莫雷蒂'], ['Fontana', '丰塔纳'], ['Galli', '加利'], ['Rinaldi', '里纳尔迪'], ['Ferri', '费里'], ['Barone', '巴罗内']],
  },
  {
    country: '法国', weight: 7, style: 'western',
    first: [['Theo', '泰奥'], ['Louis', '路易'], ['Adrien', '阿德里安'], ['Maxime', '马克西姆'], ['Bastien', '巴斯蒂安'], ['Julien', '朱利安'], ['Antoine', '安托万'], ['Enzo', '恩佐'], ['Mathis', '马蒂斯'], ['Clement', '克莱芒'], ['Yanis', '亚尼斯']],
    last: [['Moreau', '莫罗'], ['Lefevre', '勒费弗尔'], ['Girard', '吉拉尔'], ['Fournier', '富尼耶'], ['Rousseau', '卢梭'], ['Mercier', '梅西耶'], ['Perrin', '佩兰'], ['Gauthier', '戈蒂埃'], ['Lambert', '朗贝尔'], ['Marchand', '马尔尚'], ['Dupuis', '迪皮伊'], ['Renard', '勒纳尔']],
  },
  {
    country: '德国', weight: 7, style: 'western',
    first: [['Felix', '费利克斯'], ['Jonas', '约纳斯'], ['Emil', '埃米尔'], ['Elias', '埃利亚斯'], ['Lukas', '卢卡斯'], ['Niklas', '尼克拉斯'], ['Tim', '蒂姆'], ['Moritz', '莫里茨'], ['Jan', '扬'], ['Paul', '保罗'], ['Leon', '莱昂'], ['Fabian', '法比安']],
    last: [['Keller', '凯勒'], ['Brandt', '布兰特'], ['Voss', '福斯'], ['Falk', '法尔克'], ['Krause', '克劳泽'], ['Vogel', '福格尔'], ['Lehmann', '莱曼'], ['Hartmann', '哈特曼'], ['Richter', '里希特'], ['Weiss', '魏斯'], ['Becker', '贝克尔'], ['Albrecht', '阿尔布雷希特']],
  },
  {
    country: '瑞典', weight: 5, style: 'western',
    first: [['Oscar', '奥斯卡'], ['Erik', '埃里克'], ['Lars', '拉尔斯'], ['Magnus', '马格努斯'], ['Henrik', '亨里克'], ['Anders', '安德斯'], ['Mikkel', '米克尔'], ['Axel', '阿克塞尔'], ['Viktor', '维克托'], ['Sander', '桑德'], ['Jesper', '耶斯佩尔']],
    last: [['Lind', '林德'], ['Berg', '贝里'], ['Dahl', '达尔'], ['Lund', '隆德'], ['Holm', '霍尔姆'], ['Nilsson', '尼尔松'], ['Larsen', '拉森'], ['Strand', '斯特兰德'], ['Lindqvist', '林德奎斯特'], ['Sandberg', '桑德贝里'], ['Ekstrom', '埃克斯特伦'], ['Nygren', '尼格伦']],
  },
  {
    country: '克罗地亚', weight: 5, style: 'western',
    first: [['Ivan', '伊万'], ['Nikola', '尼古拉'], ['Marko', '马尔科'], ['Filip', '菲利普'], ['Dusan', '杜尚'], ['Milan', '米兰'], ['Stefan', '斯特凡'], ['Petar', '彼得'], ['Ante', '安特'], ['Josip', '约西普']],
    last: [['Novak', '诺瓦克'], ['Kovac', '科瓦奇'], ['Horvat', '霍尔瓦特'], ['Jovanovic', '约万诺维奇'], ['Markovic', '马尔科维奇'], ['Babic', '巴比奇'], ['Ilic', '伊利奇'], ['Radic', '拉迪奇'], ['Vukovic', '武科维奇'], ['Simic', '西米奇']],
  },
  {
    country: '保加利亚', weight: 2, style: 'western',
    first: [['Georgi', '格奥尔基'], ['Dimitar', '迪米塔尔'], ['Hristo', '赫里斯托'], ['Boris', '鲍里斯'], ['Martin', '马丁']],
    last: [['Petrov', '彼得罗夫'], ['Sokolov', '索科洛夫'], ['Popov', '波波夫'], ['Ivanov', '伊万诺夫'], ['Angelov', '安格洛夫']],
  },
  {
    country: '尼日利亚', weight: 5, style: 'western',
    first: [['Chidi', '奇迪'], ['Emeka', '埃梅卡'], ['Tunde', '通德'], ['Kelechi', '凯莱奇'], ['Obinna', '奥比纳'], ['Uche', '乌切'], ['Ade', '阿德'], ['Ifeanyi', '伊费亚尼']],
    last: [['Okafor', '奥卡福'], ['Adeyemi', '阿德耶米'], ['Balogun', '巴洛贡'], ['Nwosu', '恩沃苏'], ['Eze', '埃泽'], ['Okoye', '奥科耶'], ['Onyeka', '奥涅卡'], ['Ajayi', '阿贾伊']],
  },
  {
    country: '塞内加尔', weight: 4, style: 'western',
    first: [['Moussa', '穆萨'], ['Ibrahima', '伊布拉希马'], ['Cheikh', '谢赫'], ['Mamadou', '马马杜'], ['Ousmane', '乌斯曼'], ['Abdou', '阿卜杜'], ['Malick', '马利克'], ['Seydou', '塞杜']],
    last: [['Diallo', '迪亚洛'], ['Ndiaye', '恩迪亚耶'], ['Sarr', '萨尔'], ['Diop', '迪奥普'], ['Fall', '法尔'], ['Gueye', '盖耶'], ['Cisse', '西塞'], ['Ba', '巴']],
  },
  {
    country: '加纳', weight: 3, style: 'western',
    first: [['Kwame', '夸梅'], ['Kofi', '科菲'], ['Yaw', '亚乌'], ['Kwesi', '奎西'], ['Ebenezer', '埃比尼泽'], ['Prince', '普林斯']],
    last: [['Mensah', '门萨'], ['Owusu', '奥乌苏'], ['Asante', '阿桑特'], ['Addo', '阿多'], ['Osei', '奥塞'], ['Amoah', '阿莫阿']],
  },
  {
    country: '土耳其', weight: 4, style: 'western',
    first: [['Emre', '埃姆雷'], ['Hakan', '哈坎'], ['Mehmet', '梅赫梅特'], ['Burak', '布拉克'], ['Kerem', '凯雷姆'], ['Yusuf', '优素福'], ['Arda', '阿尔达'], ['Cenk', '琴克']],
    last: [['Arslan', '阿尔斯兰'], ['Yilmaz', '耶尔马兹'], ['Demir', '德米尔'], ['Aydin', '艾登'], ['Kaya', '卡亚'], ['Sahin', '沙欣'], ['Celik', '切利克'], ['Ozturk', '厄兹蒂尔克']],
  },
  {
    country: '摩洛哥', weight: 4, style: 'western',
    first: [['Samir', '萨米尔'], ['Omar', '奥马尔'], ['Karim', '卡里姆'], ['Tarek', '塔里克'], ['Nabil', '纳比勒'], ['Yassine', '亚辛'], ['Hamza', '哈姆扎'], ['Ayoub', '阿尤布']],
    last: [['Haddad', '哈达德'], ['Mansour', '曼苏尔'], ['Benali', '贝纳利'], ['Saleh', '萨利赫'], ['Khalil', '哈利勒'], ['Amrani', '阿姆拉尼'], ['Idrissi', '伊德里西'], ['Chakir', '沙基尔']],
  },
  {
    country: '印度', weight: 2, style: 'western',
    first: [['Ravi', '拉维'], ['Arjun', '阿尔琼'], ['Rohan', '罗汉'], ['Sunil', '苏尼尔']],
    last: [['Sharma', '夏尔马'], ['Singh', '辛格'], ['Nair', '奈尔'], ['Patel', '帕特尔']],
  },
  {
    country: '日本', weight: 5, style: 'japanese',
    first: [['Kenta', '健太'], ['Yuki', '悠希'], ['Haruto', '阳斗'], ['Sota', '飒太'], ['Ren', '莲'], ['Riku', '陆'], ['Takumi', '拓海'], ['Daiki', '大辉'], ['Kaito', '海斗'], ['Shota', '翔太'], ['Yuto', '优斗'], ['Naoki', '直树']],
    last: [['Sato', '佐藤'], ['Mori', '森'], ['Tanaka', '田中'], ['Suzuki', '铃木'], ['Takahashi', '高桥'], ['Ito', '伊藤'], ['Yamada', '山田'], ['Nakamura', '中村'], ['Kobayashi', '小林'], ['Kato', '加藤'], ['Yoshida', '吉田'], ['Matsuda', '松田']],
  },
  {
    country: '韩国', weight: 4, style: 'surname-first',
    first: [['Minjun', '敏俊'], ['Jihoon', '志勋'], ['Seojun', '书俊'], ['Hyunwoo', '贤宇'], ['Dohyun', '道贤'], ['Junho', '俊昊'], ['Woojin', '宇镇'], ['Sungmin', '成珉'], ['Jaewon', '在元'], ['Taehee', '泰熙']],
    last: [['Kim', '金'], ['Lee', '李'], ['Park', '朴'], ['Choi', '崔'], ['Jung', '郑'], ['Kang', '姜'], ['Yoon', '尹'], ['Hwang', '黄']],
  },
]

const TOTAL_WEIGHT = NAME_POOLS.reduce((sum, pool) => sum + pool.weight, 0)

export type RandomName = { name: string; enName: string; country: string }

function compose(pool: NamePool, first: Part, last: Part): RandomName {
  switch (pool.style) {
    case 'western':
      return { name: `${first[1]}·${last[1]}`, enName: `${first[0]} ${last[0]}`, country: pool.country }
    case 'japanese':
      return { name: `${last[1]}${first[1]}`, enName: `${first[0]} ${last[0]}`, country: pool.country }
    case 'surname-first':
      return { name: `${last[1]}${first[1]}`, enName: `${last[0]} ${first[0]}`, country: pool.country }
  }
}

type NameRng = { float(): number; int(maxExclusive: number): number }

/** family 是英文姓，用来避免同一支球队里出现太多同姓的人。 */
export function pickRandomName(rng: NameRng): RandomName & { family: string } {
  let roll = rng.float() * TOTAL_WEIGHT
  const pool = NAME_POOLS.find((item) => (roll -= item.weight) < 0) ?? NAME_POOLS[0]
  const last = pool.last[rng.int(pool.last.length)]
  return { ...compose(pool, pool.first[rng.int(pool.first.length)], last), family: last[0] }
}

function findPart(parts: 'first' | 'last', en: string): { part: Part; pool: NamePool } | null {
  for (const pool of NAME_POOLS) {
    const part = pool[parts].find((item) => item[0] === en)
    if (part) return { part, pool }
  }
  return null
}

/**
 * 把英文名翻译成中文名和国籍；查不到时返回 null。
 * 旧存档里名和姓是混搭的（比如 Rafael Okafor），这时分别查表，用间隔号连接，国籍跟姓走。
 */
export function translateRandomName(enName: string): RandomName | null {
  const words = enName.split(' ')
  if (words.length !== 2) return null
  const [a, b] = words
  for (const pool of NAME_POOLS) {
    const [firstEn, lastEn] = pool.style === 'surname-first' ? [b, a] : [a, b]
    const first = pool.first.find((item) => item[0] === firstEn)
    const last = pool.last.find((item) => item[0] === lastEn)
    if (first && last) return compose(pool, first, last)
  }
  const first = findPart('first', a)
  const last = findPart('last', b)
  if (!first || !last) return null
  return { name: `${first.part[1]}·${last.part[1]}`, enName, country: last.pool.country }
}
