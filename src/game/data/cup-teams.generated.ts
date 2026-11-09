// 由 scripts/generate-cup-teams.ts 生成，请勿手改。
// 全局种子 0xc0ffee，所有玩家共享同一批随机队。
import type { LegendTeamDef } from './legend-teams.ts'

export const CUP_TEAM_POOLS: Record<'casual' | 'league' | 'champions', LegendTeamDef[]> = {
  "casual": [
    {
      "id": "cup-casual-01",
      "club": "银翼足球会",
      "clubEn": "银翼足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 600,
      "players": [
        [
          "马泰奥·孔蒂",
          "Matteo Conti",
          "意大利",
          "GK",
          "gk_wall",
          65,
          "L"
        ],
        [
          "卢卡斯·里贝罗",
          "Lucas Ribeiro",
          "巴西",
          "CB",
          "cb_stopper",
          65,
          "R"
        ],
        [
          "埃利亚斯·哈特曼",
          "Elias Hartmann",
          "德国",
          "CB",
          "cb_stopper",
          65,
          "L"
        ],
        [
          "菲利普·科瓦奇",
          "Filip Kovac",
          "克罗地亚",
          "CB",
          "cb_stopper",
          63,
          "R"
        ],
        [
          "法昆多·罗哈斯",
          "Facundo Rojas",
          "阿根廷",
          "W",
          "fb_playmaker",
          63,
          "R"
        ],
        [
          "程修远",
          "Cheng Xiuyuan",
          "中国",
          "CM",
          "cm_creator",
          63,
          "R"
        ],
        [
          "伊桑·帕克",
          "Ethan Parker",
          "英格兰",
          "CM",
          "cm_destroyer",
          63,
          "R"
        ],
        [
          "布鲁诺·皮雷斯",
          "Bruno Pires",
          "巴西",
          "W",
          "w_engine",
          62,
          "R"
        ],
        [
          "安特·约万诺维奇",
          "Ante Jovanovic",
          "克罗地亚",
          "W",
          "fb_playmaker",
          62,
          "R"
        ],
        [
          "许泽宇",
          "Xu Zeyu",
          "中国",
          "ST",
          "st_finisher",
          62,
          "R"
        ],
        [
          "金贤宇",
          "Kim Hyunwoo",
          "韩国",
          "W",
          "w_playmaker",
          62,
          "R"
        ],
        [
          "凯奥·巴尔博扎",
          "Caio Barbosa",
          "巴西",
          "GK",
          "gk_wall",
          59,
          "R"
        ],
        [
          "埃米尔·凯勒",
          "Emil Keller",
          "德国",
          "CB",
          "cb_cover",
          59,
          "R"
        ],
        [
          "尼科洛·里奇",
          "Nicolo Ricci",
          "意大利",
          "W",
          "w_dribbler",
          59,
          "R"
        ],
        [
          "古斯塔沃·努内斯",
          "Gustavo Nunes",
          "巴西",
          "CM",
          "cm_box2box",
          59,
          "R"
        ],
        [
          "约西普·武科维奇",
          "Josip Vukovic",
          "克罗地亚",
          "ST",
          "st_target",
          59,
          "R"
        ]
      ]
    },
    {
      "id": "cup-casual-02",
      "club": "风暴联",
      "clubEn": "风暴联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 621,
      "players": [
        [
          "马尔科·里奇",
          "Marco Ricci",
          "意大利",
          "GK",
          "gk_wall",
          66,
          "R"
        ],
        [
          "里卡尔多·马尔凯蒂",
          "Riccardo Marchetti",
          "意大利",
          "CB",
          "cb_stopper",
          66,
          "R"
        ],
        [
          "保罗·阿尔布雷希特",
          "Paul Albrecht",
          "德国",
          "CB",
          "cb_ballplaying",
          66,
          "L"
        ],
        [
          "杜尚·霍尔瓦特",
          "Dusan Horvat",
          "克罗地亚",
          "CB",
          "cb_ballplaying",
          64,
          "L"
        ],
        [
          "埃米尔·法尔克",
          "Emil Falk",
          "德国",
          "W",
          "w_playmaker",
          64,
          "R"
        ],
        [
          "郑贤宇",
          "Jung Hyunwoo",
          "韩国",
          "CM",
          "cm_playmaker",
          64,
          "R"
        ],
        [
          "布鲁诺·席尔瓦",
          "Bruno Silva",
          "巴西",
          "CM",
          "cm_creator",
          64,
          "L"
        ],
        [
          "蒂亚戈·塞拉",
          "Thiago Serra",
          "巴西",
          "CM",
          "cm_playmaker",
          63,
          "R"
        ],
        [
          "米克尔·尼格伦",
          "Mikkel Nygren",
          "瑞典",
          "W",
          "fb_attacking",
          63,
          "R"
        ],
        [
          "华金·梅迪纳",
          "Joaquin Medina",
          "阿根廷",
          "ST",
          "st_false9",
          63,
          "R"
        ],
        [
          "马马杜·萨尔",
          "Mamadou Sarr",
          "塞内加尔",
          "ST",
          "st_finisher",
          63,
          "R"
        ],
        [
          "利亚姆·巴克",
          "Liam Barker",
          "英格兰",
          "GK",
          "gk_sweeper",
          60,
          "R"
        ],
        [
          "尼科洛·比安基",
          "Nicolo Bianchi",
          "意大利",
          "CB",
          "cb_ballplaying",
          60,
          "R"
        ],
        [
          "杨天佑",
          "Yang Tianyou",
          "中国",
          "W",
          "w_engine",
          60,
          "R"
        ],
        [
          "古斯塔沃·努内斯",
          "Gustavo Nunes",
          "巴西",
          "CM",
          "cm_destroyer",
          60,
          "R"
        ],
        [
          "森悠希",
          "Yuki Mori",
          "日本",
          "ST",
          "st_poacher",
          60,
          "R"
        ]
      ]
    },
    {
      "id": "cup-casual-03",
      "club": "霜原雄狮",
      "clubEn": "霜原雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "normal",
        "line": "mid",
        "press": "high"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 643,
      "players": [
        [
          "约纳斯·阿尔布雷希特",
          "Jonas Albrecht",
          "德国",
          "GK",
          "gk_sweeper",
          67,
          "R"
        ],
        [
          "奇迪·奥卡福",
          "Chidi Okafor",
          "尼日利亚",
          "W",
          "w_crosser",
          67,
          "R"
        ],
        [
          "萨米尔·哈达德",
          "Samir Haddad",
          "摩洛哥",
          "CB",
          "cb_ballplaying",
          67,
          "R"
        ],
        [
          "乌戈·卡诺",
          "Hugo Cano",
          "西班牙",
          "CB",
          "cb_cover",
          65,
          "R"
        ],
        [
          "奥斯卡·林德",
          "Oscar Lind",
          "瑞典",
          "W",
          "fb_attacking",
          65,
          "R"
        ],
        [
          "伊桑·弗莱彻",
          "Ethan Fletcher",
          "英格兰",
          "CM",
          "cm_mezzala",
          65,
          "L"
        ],
        [
          "阿古斯丁·阿科斯塔",
          "Agustin Acosta",
          "阿根廷",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "尼克拉斯·魏斯",
          "Niklas Weiss",
          "德国",
          "CM",
          "cm_box2box",
          64,
          "R"
        ],
        [
          "陈承宇",
          "Chen Chengyu",
          "中国",
          "CM",
          "cm_creator",
          64,
          "R"
        ],
        [
          "刘易斯·哈特",
          "Lewis Hart",
          "英格兰",
          "ST",
          "st_target",
          64,
          "L"
        ],
        [
          "高桥健太",
          "Kenta Takahashi",
          "日本",
          "ST",
          "st_false9",
          64,
          "R"
        ],
        [
          "冯云舟",
          "Feng Yunzhou",
          "中国",
          "GK",
          "gk_shotstopper",
          61,
          "R"
        ],
        [
          "苏尼尔·辛格",
          "Sunil Singh",
          "印度",
          "CB",
          "cb_ballplaying",
          61,
          "R"
        ],
        [
          "佐藤大辉",
          "Daiki Sato",
          "日本",
          "W",
          "w_dribbler",
          61,
          "R"
        ],
        [
          "欧文·里德",
          "Owen Reid",
          "英格兰",
          "CM",
          "cm_playmaker",
          61,
          "R"
        ],
        [
          "塔里克·贝纳利",
          "Tarek Benali",
          "摩洛哥",
          "ST",
          "st_runner",
          61,
          "L"
        ]
      ]
    },
    {
      "id": "cup-casual-04",
      "club": "青锋矿工",
      "clubEn": "青锋矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "slow",
        "line": "low",
        "press": "low"
      },
      "color": "#fde100",
      "accent": "#000000",
      "note": "PvE 生成球队",
      "targetCa": 664,
      "players": [
        [
          "朴成珉",
          "Park Sungmin",
          "韩国",
          "GK",
          "gk_shotstopper",
          68,
          "L"
        ],
        [
          "埃利亚斯·魏斯",
          "Elias Weiss",
          "德国",
          "W",
          "w_crosser",
          68,
          "L"
        ],
        [
          "卡勒姆·梅森",
          "Callum Mason",
          "英格兰",
          "CB",
          "cb_stopper",
          68,
          "R"
        ],
        [
          "奇迪·奥卡福",
          "Chidi Okafor",
          "尼日利亚",
          "CB",
          "cb_cover",
          66,
          "R"
        ],
        [
          "哈里·弗莱彻",
          "Harry Fletcher",
          "英格兰",
          "W",
          "fb_playmaker",
          66,
          "L"
        ],
        [
          "马泰奥·格雷科",
          "Matteo Greco",
          "意大利",
          "CM",
          "cm_playmaker",
          66,
          "L"
        ],
        [
          "阿卜杜·西塞",
          "Abdou Cisse",
          "塞内加尔",
          "CM",
          "cm_mezzala",
          66,
          "R"
        ],
        [
          "安特·巴比奇",
          "Ante Babic",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          65,
          "R"
        ],
        [
          "伊克尔·埃雷拉",
          "Iker Herrera",
          "西班牙",
          "CM",
          "cm_playmaker",
          65,
          "R"
        ],
        [
          "米兰·科瓦奇",
          "Milan Kovac",
          "克罗地亚",
          "ST",
          "st_runner",
          65,
          "R"
        ],
        [
          "朱利安·戈蒂埃",
          "Julien Gauthier",
          "法国",
          "ST",
          "st_target",
          65,
          "L"
        ],
        [
          "冯嘉树",
          "Feng Jiashu",
          "中国",
          "GK",
          "gk_wall",
          62,
          "R"
        ],
        [
          "凯莱奇·奥涅卡",
          "Kelechi Onyeka",
          "尼日利亚",
          "CB",
          "cb_stopper",
          62,
          "R"
        ],
        [
          "埃兹拉·普赖斯",
          "Ezra Price",
          "英格兰",
          "W",
          "w_playmaker",
          62,
          "R"
        ],
        [
          "马特乌斯·里贝罗",
          "Matheus Ribeiro",
          "巴西",
          "CM",
          "cm_mezzala",
          62,
          "R"
        ],
        [
          "马克西姆·莫罗",
          "Maxime Moreau",
          "法国",
          "ST",
          "st_runner",
          62,
          "L"
        ]
      ]
    },
    {
      "id": "cup-casual-05",
      "club": "长弓竞技会",
      "clubEn": "长弓竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "fast",
        "line": "mid",
        "press": "mid"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 686,
      "players": [
        [
          "埃米尔·福斯",
          "Emil Voss",
          "德国",
          "GK",
          "gk_wall",
          69,
          "R"
        ],
        [
          "菲利普·伊利奇",
          "Filip Ilic",
          "克罗地亚",
          "CB",
          "cb_ballplaying",
          69,
          "R"
        ],
        [
          "江修远",
          "Jiang Xiuyuan",
          "中国",
          "CB",
          "cb_cover",
          69,
          "R"
        ],
        [
          "西莫内·费里",
          "Simone Ferri",
          "意大利",
          "CB",
          "cb_stopper",
          67,
          "R"
        ],
        [
          "埃利亚斯·凯勒",
          "Elias Keller",
          "德国",
          "W",
          "w_engine",
          67,
          "R"
        ],
        [
          "扬·克劳泽",
          "Jan Krause",
          "德国",
          "CM",
          "cm_destroyer",
          67,
          "R"
        ],
        [
          "安德烈·努内斯",
          "Andre Nunes",
          "巴西",
          "CM",
          "cm_creator",
          67,
          "L"
        ],
        [
          "路易·莫罗",
          "Louis Moreau",
          "法国",
          "W",
          "w_finisher",
          66,
          "R"
        ],
        [
          "钟承宇",
          "Zhong Chengyu",
          "中国",
          "W",
          "w_playmaker",
          66,
          "R"
        ],
        [
          "费德里科·莫雷蒂",
          "Federico Moretti",
          "意大利",
          "ST",
          "st_finisher",
          66,
          "R"
        ],
        [
          "莫里茨·阿尔布雷希特",
          "Moritz Albrecht",
          "德国",
          "W",
          "w_crosser",
          66,
          "L"
        ],
        [
          "夸梅·阿多",
          "Kwame Addo",
          "加纳",
          "GK",
          "gk_shotstopper",
          63,
          "R"
        ],
        [
          "金敏俊",
          "Kim Minjun",
          "韩国",
          "CB",
          "cb_cover",
          63,
          "R"
        ],
        [
          "拉维·帕特尔",
          "Ravi Patel",
          "印度",
          "W",
          "fb_attacking",
          63,
          "R"
        ],
        [
          "朱利安·富尼耶",
          "Julien Fournier",
          "法国",
          "CM",
          "cm_box2box",
          63,
          "L"
        ],
        [
          "伊克尔·卡斯特罗",
          "Iker Castro",
          "西班牙",
          "ST",
          "st_runner",
          63,
          "R"
        ]
      ]
    },
    {
      "id": "cup-casual-06",
      "club": "白塔联队",
      "clubEn": "白塔联队",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "fast",
        "line": "low",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 707,
      "players": [
        [
          "程奕辰",
          "Cheng Yichen",
          "中国",
          "GK",
          "gk_sweeper",
          70,
          "R"
        ],
        [
          "亨里克·达尔",
          "Henrik Dahl",
          "瑞典",
          "CB",
          "cb_cover",
          70,
          "R"
        ],
        [
          "埃里克·贝里",
          "Erik Berg",
          "瑞典",
          "CB",
          "cb_stopper",
          70,
          "R"
        ],
        [
          "迪米塔尔·伊万诺夫",
          "Dimitar Ivanov",
          "保加利亚",
          "CB",
          "cb_stopper",
          68,
          "R"
        ],
        [
          "斯特凡·马尔科维奇",
          "Stefan Markovic",
          "克罗地亚",
          "W",
          "fb_attacking",
          68,
          "L"
        ],
        [
          "迪米塔尔·安格洛夫",
          "Dimitar Angelov",
          "保加利亚",
          "CM",
          "cm_destroyer",
          68,
          "R"
        ],
        [
          "中村海斗",
          "Kaito Nakamura",
          "日本",
          "CM",
          "cm_creator",
          68,
          "L"
        ],
        [
          "乌戈·雷耶斯",
          "Hugo Reyes",
          "西班牙",
          "W",
          "w_playmaker",
          67,
          "R"
        ],
        [
          "杜尚·诺瓦克",
          "Dusan Novak",
          "克罗地亚",
          "W",
          "fb_playmaker",
          67,
          "R"
        ],
        [
          "本·巴克",
          "Ben Barker",
          "英格兰",
          "ST",
          "st_poacher",
          67,
          "R"
        ],
        [
          "奇迪·奥科耶",
          "Chidi Okoye",
          "尼日利亚",
          "W",
          "fb_playmaker",
          67,
          "R"
        ],
        [
          "拉尔斯·达尔",
          "Lars Dahl",
          "瑞典",
          "GK",
          "gk_wall",
          64,
          "R"
        ],
        [
          "埃比尼泽·阿桑特",
          "Ebenezer Asante",
          "加纳",
          "CB",
          "cb_cover",
          64,
          "R"
        ],
        [
          "保罗·魏斯",
          "Paul Weiss",
          "德国",
          "W",
          "w_playmaker",
          64,
          "R"
        ],
        [
          "卢卡·巴罗内",
          "Luca Barone",
          "意大利",
          "CM",
          "cm_destroyer",
          64,
          "R"
        ],
        [
          "田明远",
          "Tian Mingyuan",
          "中国",
          "ST",
          "st_target",
          64,
          "L"
        ]
      ]
    },
    {
      "id": "cup-casual-07",
      "club": "东岭足球会",
      "clubEn": "东岭足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "slow",
        "line": "low",
        "press": "low"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 729,
      "players": [
        [
          "伊藤大辉",
          "Daiki Ito",
          "日本",
          "GK",
          "gk_wall",
          72,
          "L"
        ],
        [
          "奎西·阿桑特",
          "Kwesi Asante",
          "加纳",
          "W",
          "fb_attacking",
          72,
          "R"
        ],
        [
          "维托尔·特谢拉",
          "Vitor Teixeira",
          "巴西",
          "CB",
          "cb_cover",
          72,
          "R"
        ],
        [
          "彼得·巴比奇",
          "Petar Babic",
          "克罗地亚",
          "CB",
          "cb_ballplaying",
          70,
          "L"
        ],
        [
          "克莱芒·勒费弗尔",
          "Clement Lefevre",
          "法国",
          "W",
          "w_finisher",
          70,
          "L"
        ],
        [
          "费利克斯·凯勒",
          "Felix Keller",
          "德国",
          "CM",
          "cm_box2box",
          70,
          "R"
        ],
        [
          "伊格纳西奥·阿科斯塔",
          "Ignacio Acosta",
          "阿根廷",
          "CM",
          "cm_box2box",
          70,
          "L"
        ],
        [
          "拉尔斯·林德",
          "Lars Lind",
          "瑞典",
          "W",
          "w_playmaker",
          69,
          "R"
        ],
        [
          "江俊驰",
          "Jiang Junchi",
          "中国",
          "CM",
          "cm_playmaker",
          69,
          "R"
        ],
        [
          "洛伦佐·费里",
          "Lorenzo Ferri",
          "意大利",
          "W",
          "w_crosser",
          69,
          "R"
        ],
        [
          "亨里克·达尔",
          "Henrik Dahl",
          "瑞典",
          "ST",
          "st_finisher",
          69,
          "R"
        ],
        [
          "李敏俊",
          "Lee Minjun",
          "韩国",
          "GK",
          "gk_sweeper",
          66,
          "L"
        ],
        [
          "阿卜杜·西塞",
          "Abdou Cisse",
          "塞内加尔",
          "CB",
          "cb_cover",
          66,
          "R"
        ],
        [
          "伊克尔·加拉多",
          "Iker Gallardo",
          "西班牙",
          "W",
          "fb_attacking",
          66,
          "L"
        ],
        [
          "朴敏俊",
          "Park Minjun",
          "韩国",
          "CM",
          "cm_mezzala",
          66,
          "R"
        ],
        [
          "拉维·帕特尔",
          "Ravi Patel",
          "印度",
          "ST",
          "st_target",
          66,
          "R"
        ]
      ]
    },
    {
      "id": "cup-casual-08",
      "club": "远帆海港",
      "clubEn": "远帆海港",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "slow",
        "line": "high",
        "press": "high"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 750,
      "players": [
        [
          "伊桑·科尔",
          "Ethan Cole",
          "英格兰",
          "GK",
          "gk_sweeper",
          73,
          "R"
        ],
        [
          "莫里茨·福格尔",
          "Moritz Vogel",
          "德国",
          "W",
          "w_crosser",
          73,
          "R"
        ],
        [
          "阿尔瓦罗·卡斯特罗",
          "Alvaro Castro",
          "西班牙",
          "CB",
          "cb_stopper",
          73,
          "R"
        ],
        [
          "伊桑·霍尔特",
          "Ethan Holt",
          "英格兰",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "卢卡斯·阿尔梅达",
          "Lucas Almeida",
          "巴西",
          "W",
          "fb_playmaker",
          71,
          "R"
        ],
        [
          "苏明远",
          "Su Mingyuan",
          "中国",
          "CM",
          "cm_creator",
          71,
          "R"
        ],
        [
          "朱利安·卢梭",
          "Julien Rousseau",
          "法国",
          "CM",
          "cm_box2box",
          71,
          "R"
        ],
        [
          "方泽宇",
          "Fang Zeyu",
          "中国",
          "W",
          "fb_attacking",
          70,
          "L"
        ],
        [
          "米克尔·埃克斯特伦",
          "Mikkel Ekstrom",
          "瑞典",
          "CM",
          "cm_box2box",
          70,
          "R"
        ],
        [
          "拉米罗·梅迪纳",
          "Ramiro Medina",
          "阿根廷",
          "W",
          "w_dribbler",
          70,
          "R"
        ],
        [
          "拉尔斯·林德",
          "Lars Lind",
          "瑞典",
          "ST",
          "st_poacher",
          70,
          "R"
        ],
        [
          "埃米尔·阿尔布雷希特",
          "Emil Albrecht",
          "德国",
          "GK",
          "gk_wall",
          67,
          "L"
        ],
        [
          "巴勃罗·奥尔特加",
          "Pablo Ortega",
          "西班牙",
          "CB",
          "cb_stopper",
          67,
          "R"
        ],
        [
          "贡萨洛·基罗加",
          "Gonzalo Quiroga",
          "阿根廷",
          "W",
          "w_crosser",
          67,
          "R"
        ],
        [
          "奇迪·埃泽",
          "Chidi Eze",
          "尼日利亚",
          "CM",
          "cm_mezzala",
          67,
          "R"
        ],
        [
          "高桥直树",
          "Naoki Takahashi",
          "日本",
          "ST",
          "st_poacher",
          67,
          "R"
        ]
      ]
    }
  ],
  "league": [
    {
      "id": "cup-league-01",
      "club": "长弓先锋",
      "clubEn": "长弓先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "low",
        "press": "low"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 780,
      "players": [
        [
          "埃里克·桑德贝里",
          "Erik Sandberg",
          "瑞典",
          "GK",
          "gk_sweeper",
          74,
          "R"
        ],
        [
          "朴敏俊",
          "Park Minjun",
          "韩国",
          "CB",
          "cb_ballplaying",
          74,
          "R"
        ],
        [
          "钟修远",
          "Zhong Xiuyuan",
          "中国",
          "CB",
          "cb_ballplaying",
          74,
          "R"
        ],
        [
          "诺亚·维尔",
          "Noah Vale",
          "英格兰",
          "CB",
          "cb_ballplaying",
          72,
          "R"
        ],
        [
          "马克西姆·吉拉尔",
          "Maxime Girard",
          "法国",
          "W",
          "w_dribbler",
          72,
          "L"
        ],
        [
          "西莫内·比安基",
          "Simone Bianchi",
          "意大利",
          "CM",
          "cm_mezzala",
          72,
          "L"
        ],
        [
          "亚乌·阿多",
          "Yaw Addo",
          "加纳",
          "CM",
          "cm_playmaker",
          72,
          "L"
        ],
        [
          "马尔科·莫雷蒂",
          "Marco Moretti",
          "意大利",
          "CM",
          "cm_destroyer",
          71,
          "R"
        ],
        [
          "芬恩·巴克",
          "Finn Barker",
          "英格兰",
          "W",
          "w_finisher",
          71,
          "R"
        ],
        [
          "马泰奥·莫雷蒂",
          "Matteo Moretti",
          "意大利",
          "ST",
          "st_finisher",
          71,
          "R"
        ],
        [
          "恩佐·莫罗",
          "Enzo Moreau",
          "法国",
          "ST",
          "st_poacher",
          71,
          "R"
        ],
        [
          "彭修远",
          "Peng Xiuyuan",
          "中国",
          "GK",
          "gk_wall",
          68,
          "L"
        ],
        [
          "埃米利亚诺·帕雷德斯",
          "Emiliano Paredes",
          "阿根廷",
          "CB",
          "cb_stopper",
          68,
          "R"
        ],
        [
          "伊万·霍尔瓦特",
          "Ivan Horvat",
          "克罗地亚",
          "W",
          "w_playmaker",
          68,
          "R"
        ],
        [
          "拉米罗·阿吉雷",
          "Ramiro Aguirre",
          "阿根廷",
          "CM",
          "cm_destroyer",
          68,
          "R"
        ],
        [
          "小林翔太",
          "Shota Kobayashi",
          "日本",
          "ST",
          "st_false9",
          68,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-02",
      "club": "远帆城",
      "clubEn": "远帆城",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "slow",
        "line": "low",
        "press": "mid"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 793,
      "players": [
        [
          "利奥·哈特",
          "Leo Hart",
          "英格兰",
          "GK",
          "gk_sweeper",
          75,
          "R"
        ],
        [
          "安托万·吉拉尔",
          "Antoine Girard",
          "法国",
          "W",
          "w_crosser",
          75,
          "R"
        ],
        [
          "阿德·奥卡福",
          "Ade Okafor",
          "尼日利亚",
          "CB",
          "cb_cover",
          75,
          "R"
        ],
        [
          "赫里斯托·索科洛夫",
          "Hristo Sokolov",
          "保加利亚",
          "CB",
          "cb_cover",
          73,
          "R"
        ],
        [
          "欧文·休斯",
          "Owen Hughes",
          "英格兰",
          "W",
          "fb_playmaker",
          73,
          "L"
        ],
        [
          "乌切·恩沃苏",
          "Uche Nwosu",
          "尼日利亚",
          "CM",
          "cm_box2box",
          73,
          "R"
        ],
        [
          "哈坎·卡亚",
          "Hakan Kaya",
          "土耳其",
          "W",
          "w_engine",
          73,
          "L"
        ],
        [
          "唐星河",
          "Tang Xinghe",
          "中国",
          "CM",
          "cm_destroyer",
          72,
          "L"
        ],
        [
          "马丁·波波夫",
          "Martin Popov",
          "保加利亚",
          "CM",
          "cm_engine",
          72,
          "R"
        ],
        [
          "埃兹拉·弗莱彻",
          "Ezra Fletcher",
          "英格兰",
          "W",
          "fb_playmaker",
          72,
          "L"
        ],
        [
          "梅赫梅特·切利克",
          "Mehmet Celik",
          "土耳其",
          "ST",
          "st_false9",
          72,
          "R"
        ],
        [
          "埃米尔·莱曼",
          "Emil Lehmann",
          "德国",
          "GK",
          "gk_shotstopper",
          69,
          "R"
        ],
        [
          "普林斯·奥塞",
          "Prince Osei",
          "加纳",
          "CB",
          "cb_cover",
          69,
          "R"
        ],
        [
          "罗奕辰",
          "Luo Yichen",
          "中国",
          "W",
          "fb_playmaker",
          69,
          "L"
        ],
        [
          "阿德里安·卡诺",
          "Adrian Cano",
          "西班牙",
          "CM",
          "cm_box2box",
          69,
          "R"
        ],
        [
          "杨亦凡",
          "Yang Yifan",
          "中国",
          "ST",
          "st_target",
          69,
          "L"
        ]
      ]
    },
    {
      "id": "cup-league-03",
      "club": "霜原联",
      "clubEn": "霜原联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "low"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 805,
      "players": [
        [
          "斯特凡·武科维奇",
          "Stefan Vukovic",
          "克罗地亚",
          "GK",
          "gk_wall",
          75,
          "L"
        ],
        [
          "阿卜杜·迪亚洛",
          "Abdou Diallo",
          "塞内加尔",
          "W",
          "w_dribbler",
          75,
          "R"
        ],
        [
          "达里奥·帕斯夸尔",
          "Dario Pascual",
          "西班牙",
          "CB",
          "cb_cover",
          75,
          "L"
        ],
        [
          "伊藤飒太",
          "Sota Ito",
          "日本",
          "CB",
          "cb_stopper",
          73,
          "R"
        ],
        [
          "芬恩·特纳",
          "Finn Turner",
          "英格兰",
          "W",
          "w_dribbler",
          73,
          "L"
        ],
        [
          "拉尔斯·林德",
          "Lars Lind",
          "瑞典",
          "CM",
          "cm_engine",
          73,
          "R"
        ],
        [
          "拉维·辛格",
          "Ravi Singh",
          "印度",
          "CM",
          "cm_engine",
          73,
          "R"
        ],
        [
          "吉田健太",
          "Kenta Yoshida",
          "日本",
          "W",
          "w_dribbler",
          72,
          "R"
        ],
        [
          "唐雨辰",
          "Tang Yuchen",
          "中国",
          "CM",
          "cm_box2box",
          72,
          "L"
        ],
        [
          "奎西·阿多",
          "Kwesi Addo",
          "加纳",
          "W",
          "fb_playmaker",
          72,
          "R"
        ],
        [
          "克莱芒·富尼耶",
          "Clement Fournier",
          "法国",
          "ST",
          "st_finisher",
          72,
          "R"
        ],
        [
          "阿尤布·哈利勒",
          "Ayoub Khalil",
          "摩洛哥",
          "GK",
          "gk_sweeper",
          69,
          "R"
        ],
        [
          "埃梅卡·阿贾伊",
          "Emeka Ajayi",
          "尼日利亚",
          "CB",
          "cb_stopper",
          69,
          "R"
        ],
        [
          "布拉克·德米尔",
          "Burak Demir",
          "土耳其",
          "W",
          "w_dribbler",
          69,
          "R"
        ],
        [
          "米兰·霍尔瓦特",
          "Milan Horvat",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          69,
          "R"
        ],
        [
          "阿尔瓦罗·莫利纳",
          "Alvaro Molina",
          "西班牙",
          "ST",
          "st_runner",
          69,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-04",
      "club": "铁砧竞技会",
      "clubEn": "铁砧竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "low",
        "press": "low"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 818,
      "players": [
        [
          "姜贤宇",
          "Kang Hyunwoo",
          "韩国",
          "GK",
          "gk_shotstopper",
          76,
          "R"
        ],
        [
          "夸梅·奥乌苏",
          "Kwame Owusu",
          "加纳",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "冯星河",
          "Feng Xinghe",
          "中国",
          "CB",
          "cb_ballplaying",
          76,
          "R"
        ],
        [
          "若昂·席尔瓦",
          "Joao Silva",
          "巴西",
          "CB",
          "cb_stopper",
          74,
          "R"
        ],
        [
          "钟俊驰",
          "Zhong Junchi",
          "中国",
          "W",
          "fb_attacking",
          74,
          "R"
        ],
        [
          "陆思远",
          "Lu Siyuan",
          "中国",
          "CM",
          "cm_creator",
          74,
          "R"
        ],
        [
          "本·贝内特",
          "Ben Bennett",
          "英格兰",
          "CM",
          "cm_creator",
          74,
          "R"
        ],
        [
          "阿德·阿德耶米",
          "Ade Adeyemi",
          "尼日利亚",
          "CM",
          "cm_mezzala",
          73,
          "R"
        ],
        [
          "梅赫梅特·阿尔斯兰",
          "Mehmet Arslan",
          "土耳其",
          "W",
          "w_dribbler",
          73,
          "R"
        ],
        [
          "田承宇",
          "Tian Chengyu",
          "中国",
          "ST",
          "st_false9",
          73,
          "R"
        ],
        [
          "马克西姆·马尔尚",
          "Maxime Marchand",
          "法国",
          "ST",
          "st_poacher",
          73,
          "R"
        ],
        [
          "伊桑·科尔",
          "Ethan Cole",
          "英格兰",
          "GK",
          "gk_wall",
          70,
          "R"
        ],
        [
          "山田海斗",
          "Kaito Yamada",
          "日本",
          "CB",
          "cb_cover",
          70,
          "R"
        ],
        [
          "萨米尔·哈利勒",
          "Samir Khalil",
          "摩洛哥",
          "W",
          "w_finisher",
          70,
          "R"
        ],
        [
          "拉尔斯·桑德贝里",
          "Lars Sandberg",
          "瑞典",
          "CM",
          "cm_playmaker",
          70,
          "R"
        ],
        [
          "许云舟",
          "Xu Yunzhou",
          "中国",
          "ST",
          "st_target",
          70,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-05",
      "club": "沙丘流浪者",
      "clubEn": "沙丘流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "mid"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 831,
      "players": [
        [
          "沈明远",
          "Shen Mingyuan",
          "中国",
          "GK",
          "gk_sweeper",
          76,
          "R"
        ],
        [
          "安德斯·尼格伦",
          "Anders Nygren",
          "瑞典",
          "W",
          "w_dribbler",
          76,
          "R"
        ],
        [
          "拉斐尔·皮雷斯",
          "Rafael Pires",
          "巴西",
          "CB",
          "cb_cover",
          76,
          "L"
        ],
        [
          "魏牧野",
          "Wei Muye",
          "中国",
          "CB",
          "cb_stopper",
          74,
          "R"
        ],
        [
          "伊格纳西奥·梅迪纳",
          "Ignacio Medina",
          "阿根廷",
          "W",
          "w_finisher",
          74,
          "R"
        ],
        [
          "凯雷姆·卡亚",
          "Kerem Kaya",
          "土耳其",
          "CM",
          "cm_engine",
          74,
          "R"
        ],
        [
          "奥比纳·阿贾伊",
          "Obinna Ajayi",
          "尼日利亚",
          "CM",
          "cm_box2box",
          74,
          "R"
        ],
        [
          "凯奥·阿尔梅达",
          "Caio Almeida",
          "巴西",
          "CM",
          "cm_engine",
          73,
          "R"
        ],
        [
          "佐藤阳斗",
          "Haruto Sato",
          "日本",
          "CM",
          "cm_destroyer",
          73,
          "R"
        ],
        [
          "若昂·皮雷斯",
          "Joao Pires",
          "巴西",
          "ST",
          "st_finisher",
          73,
          "R"
        ],
        [
          "费利克斯·凯勒",
          "Felix Keller",
          "德国",
          "ST",
          "st_runner",
          73,
          "R"
        ],
        [
          "斯特凡·武科维奇",
          "Stefan Vukovic",
          "克罗地亚",
          "GK",
          "gk_sweeper",
          70,
          "R"
        ],
        [
          "格奥尔基·安格洛夫",
          "Georgi Angelov",
          "保加利亚",
          "CB",
          "cb_cover",
          70,
          "R"
        ],
        [
          "伊桑·贝内特",
          "Ethan Bennett",
          "英格兰",
          "W",
          "w_crosser",
          70,
          "R"
        ],
        [
          "耶斯佩尔·尼格伦",
          "Jesper Nygren",
          "瑞典",
          "CM",
          "cm_box2box",
          70,
          "R"
        ],
        [
          "阿尔瓦罗·雷耶斯",
          "Alvaro Reyes",
          "西班牙",
          "ST",
          "st_false9",
          70,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-06",
      "club": "银翼先锋",
      "clubEn": "银翼先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 844,
      "players": [
        [
          "沈子昂",
          "Shen Ziang",
          "中国",
          "GK",
          "gk_sweeper",
          77,
          "R"
        ],
        [
          "安德斯·斯特兰德",
          "Anders Strand",
          "瑞典",
          "W",
          "w_dribbler",
          77,
          "R"
        ],
        [
          "通德·奥涅卡",
          "Tunde Onyeka",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "陆景行",
          "Lu Jingxing",
          "中国",
          "CB",
          "cb_stopper",
          75,
          "R"
        ],
        [
          "亚尼斯·迪皮伊",
          "Yanis Dupuis",
          "法国",
          "W",
          "w_engine",
          75,
          "L"
        ],
        [
          "桑德·斯特兰德",
          "Sander Strand",
          "瑞典",
          "CM",
          "cm_engine",
          75,
          "R"
        ],
        [
          "布鲁诺·特谢拉",
          "Bruno Teixeira",
          "巴西",
          "CM",
          "cm_mezzala",
          75,
          "R"
        ],
        [
          "蒂姆·克劳泽",
          "Tim Krause",
          "德国",
          "CM",
          "cm_playmaker",
          74,
          "R"
        ],
        [
          "奎西·奥塞",
          "Kwesi Osei",
          "加纳",
          "CM",
          "cm_box2box",
          74,
          "R"
        ],
        [
          "贾科莫·莫雷蒂",
          "Giacomo Moretti",
          "意大利",
          "ST",
          "st_poacher",
          74,
          "L"
        ],
        [
          "夸梅·奥乌苏",
          "Kwame Owusu",
          "加纳",
          "ST",
          "st_target",
          74,
          "L"
        ],
        [
          "尼古拉·伊利奇",
          "Nikola Ilic",
          "克罗地亚",
          "GK",
          "gk_wall",
          71,
          "R"
        ],
        [
          "阿尔达·耶尔马兹",
          "Arda Yilmaz",
          "土耳其",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "夸梅·阿多",
          "Kwame Addo",
          "加纳",
          "W",
          "w_dribbler",
          71,
          "R"
        ],
        [
          "格奥尔基·安格洛夫",
          "Georgi Angelov",
          "保加利亚",
          "CM",
          "cm_playmaker",
          71,
          "R"
        ],
        [
          "拉斐尔·费雷拉",
          "Rafael Ferreira",
          "巴西",
          "ST",
          "st_false9",
          71,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-07",
      "club": "西湾体育",
      "clubEn": "西湾体育",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "slow",
        "line": "low",
        "press": "low"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 856,
      "players": [
        [
          "安特·巴比奇",
          "Ante Babic",
          "克罗地亚",
          "GK",
          "gk_wall",
          77,
          "L"
        ],
        [
          "杰克·贝内特",
          "Jack Bennett",
          "英格兰",
          "CB",
          "cb_stopper",
          77,
          "R"
        ],
        [
          "埃比尼泽·门萨",
          "Ebenezer Mensah",
          "加纳",
          "CB",
          "cb_cover",
          77,
          "R"
        ],
        [
          "阿德里安·普列托",
          "Adrian Prieto",
          "西班牙",
          "CB",
          "cb_cover",
          75,
          "L"
        ],
        [
          "伊格纳西奥·梅迪纳",
          "Ignacio Medina",
          "阿根廷",
          "W",
          "w_engine",
          75,
          "R"
        ],
        [
          "马科斯·雷耶斯",
          "Marcos Reyes",
          "西班牙",
          "CM",
          "cm_mezzala",
          75,
          "R"
        ],
        [
          "费德里科·马尔凯蒂",
          "Federico Marchetti",
          "意大利",
          "CM",
          "cm_engine",
          75,
          "R"
        ],
        [
          "许承宇",
          "Xu Chengyu",
          "中国",
          "W",
          "fb_playmaker",
          74,
          "R"
        ],
        [
          "迪米塔尔·安格洛夫",
          "Dimitar Angelov",
          "保加利亚",
          "W",
          "w_finisher",
          74,
          "L"
        ],
        [
          "林亦凡",
          "Lin Yifan",
          "中国",
          "ST",
          "st_finisher",
          74,
          "R"
        ],
        [
          "田中拓海",
          "Takumi Tanaka",
          "日本",
          "W",
          "fb_attacking",
          74,
          "R"
        ],
        [
          "托马斯·莱德斯马",
          "Tomas Ledesma",
          "阿根廷",
          "GK",
          "gk_sweeper",
          71,
          "R"
        ],
        [
          "赵云舟",
          "Zhao Yunzhou",
          "中国",
          "CB",
          "cb_ballplaying",
          71,
          "R"
        ],
        [
          "欧文·普赖斯",
          "Owen Price",
          "英格兰",
          "W",
          "w_finisher",
          71,
          "R"
        ],
        [
          "拉尔斯·隆德",
          "Lars Lund",
          "瑞典",
          "CM",
          "cm_engine",
          71,
          "L"
        ],
        [
          "陈启航",
          "Chen Qihang",
          "中国",
          "ST",
          "st_target",
          71,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-08",
      "club": "东岭先锋",
      "clubEn": "东岭先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "normal",
        "line": "mid",
        "press": "high"
      },
      "color": "#8e1f2f",
      "accent": "#f0bc42",
      "note": "PvE 生成球队",
      "targetCa": 869,
      "players": [
        [
          "阿卜杜·萨尔",
          "Abdou Sarr",
          "塞内加尔",
          "GK",
          "gk_wall",
          78,
          "R"
        ],
        [
          "铃木莲",
          "Ren Suzuki",
          "日本",
          "W",
          "w_dribbler",
          78,
          "R"
        ],
        [
          "拉斐尔·席尔瓦",
          "Rafael Silva",
          "巴西",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "山田悠希",
          "Yuki Yamada",
          "日本",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "尼科·帕斯夸尔",
          "Nico Pascual",
          "西班牙",
          "W",
          "fb_playmaker",
          76,
          "R"
        ],
        [
          "陈子昂",
          "Chen Ziang",
          "中国",
          "W",
          "fb_attacking",
          76,
          "R"
        ],
        [
          "森海斗",
          "Kaito Mori",
          "日本",
          "CM",
          "cm_playmaker",
          76,
          "R"
        ],
        [
          "费利佩·巴尔博扎",
          "Felipe Barbosa",
          "巴西",
          "CM",
          "cm_engine",
          75,
          "R"
        ],
        [
          "米洛·普赖斯",
          "Milo Price",
          "英格兰",
          "W",
          "w_dribbler",
          75,
          "R"
        ],
        [
          "阿德里安·吉拉尔",
          "Adrien Girard",
          "法国",
          "ST",
          "st_poacher",
          75,
          "R"
        ],
        [
          "蒂亚戈·巴尔博扎",
          "Thiago Barbosa",
          "巴西",
          "ST",
          "st_finisher",
          75,
          "R"
        ],
        [
          "铃木翔太",
          "Shota Suzuki",
          "日本",
          "GK",
          "gk_sweeper",
          72,
          "R"
        ],
        [
          "奇迪·阿贾伊",
          "Chidi Ajayi",
          "尼日利亚",
          "CB",
          "cb_cover",
          72,
          "R"
        ],
        [
          "苏启航",
          "Su Qihang",
          "中国",
          "W",
          "fb_playmaker",
          72,
          "R"
        ],
        [
          "里卡尔多·格雷科",
          "Riccardo Greco",
          "意大利",
          "CM",
          "cm_playmaker",
          72,
          "L"
        ],
        [
          "尼古拉·马尔科维奇",
          "Nikola Markovic",
          "克罗地亚",
          "ST",
          "st_runner",
          72,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-09",
      "club": "北岸联队",
      "clubEn": "北岸联队",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "low"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 882,
      "players": [
        [
          "塔里克·伊德里西",
          "Tarek Idrissi",
          "摩洛哥",
          "GK",
          "gk_sweeper",
          79,
          "R"
        ],
        [
          "彼得·西米奇",
          "Petar Simic",
          "克罗地亚",
          "W",
          "w_dribbler",
          79,
          "R"
        ],
        [
          "斯特凡·科瓦奇",
          "Stefan Kovac",
          "克罗地亚",
          "CB",
          "cb_ballplaying",
          79,
          "R"
        ],
        [
          "利奥·休斯",
          "Leo Hughes",
          "英格兰",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "约西普·马尔科维奇",
          "Josip Markovic",
          "克罗地亚",
          "W",
          "fb_playmaker",
          77,
          "R"
        ],
        [
          "克莱芒·迪皮伊",
          "Clement Dupuis",
          "法国",
          "W",
          "fb_playmaker",
          77,
          "R"
        ],
        [
          "乌斯曼·巴",
          "Ousmane Ba",
          "塞内加尔",
          "CM",
          "cm_box2box",
          77,
          "R"
        ],
        [
          "李志勋",
          "Lee Jihoon",
          "韩国",
          "CM",
          "cm_box2box",
          76,
          "R"
        ],
        [
          "塞尔吉奥·莫利纳",
          "Sergio Molina",
          "西班牙",
          "W",
          "w_finisher",
          76,
          "R"
        ],
        [
          "崔志勋",
          "Choi Jihoon",
          "韩国",
          "ST",
          "st_runner",
          76,
          "R"
        ],
        [
          "罗博文",
          "Luo Bowen",
          "中国",
          "ST",
          "st_target",
          76,
          "L"
        ],
        [
          "杨宇航",
          "Yang Yuhang",
          "中国",
          "GK",
          "gk_sweeper",
          73,
          "R"
        ],
        [
          "奥斯卡·林德奎斯特",
          "Oscar Lindqvist",
          "瑞典",
          "CB",
          "cb_stopper",
          73,
          "R"
        ],
        [
          "埃兹拉·梅森",
          "Ezra Mason",
          "英格兰",
          "W",
          "w_crosser",
          73,
          "R"
        ],
        [
          "赵博文",
          "Zhao Bowen",
          "中国",
          "CM",
          "cm_engine",
          73,
          "R"
        ],
        [
          "维克托·达尔",
          "Viktor Dahl",
          "瑞典",
          "ST",
          "st_target",
          73,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-10",
      "club": "西湾海港",
      "clubEn": "西湾海港",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "high"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 895,
      "players": [
        [
          "魏天佑",
          "Wei Tianyou",
          "中国",
          "GK",
          "gk_wall",
          79,
          "L"
        ],
        [
          "尼科·奥尔特加",
          "Nico Ortega",
          "西班牙",
          "W",
          "w_crosser",
          79,
          "R"
        ],
        [
          "赫里斯托·彼得罗夫",
          "Hristo Petrov",
          "保加利亚",
          "CB",
          "cb_cover",
          79,
          "L"
        ],
        [
          "中村翔太",
          "Shota Nakamura",
          "日本",
          "CB",
          "cb_stopper",
          77,
          "R"
        ],
        [
          "埃利亚斯·福格尔",
          "Elias Vogel",
          "德国",
          "W",
          "w_playmaker",
          77,
          "R"
        ],
        [
          "阿尤布·曼苏尔",
          "Ayoub Mansour",
          "摩洛哥",
          "CM",
          "cm_playmaker",
          77,
          "R"
        ],
        [
          "吉田海斗",
          "Kaito Yoshida",
          "日本",
          "CM",
          "cm_playmaker",
          77,
          "R"
        ],
        [
          "巴斯蒂安·勒费弗尔",
          "Bastien Lefevre",
          "法国",
          "CM",
          "cm_creator",
          76,
          "R"
        ],
        [
          "埃梅卡·阿贾伊",
          "Emeka Ajayi",
          "尼日利亚",
          "W",
          "w_finisher",
          76,
          "R"
        ],
        [
          "罗汉·夏尔马",
          "Rohan Sharma",
          "印度",
          "ST",
          "st_finisher",
          76,
          "R"
        ],
        [
          "若昂·巴尔博扎",
          "Joao Barbosa",
          "巴西",
          "W",
          "w_dribbler",
          76,
          "R"
        ],
        [
          "欧文·特纳",
          "Owen Turner",
          "英格兰",
          "GK",
          "gk_shotstopper",
          73,
          "R"
        ],
        [
          "马特乌斯·科斯塔",
          "Matheus Costa",
          "巴西",
          "CB",
          "cb_ballplaying",
          73,
          "R"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "W",
          "w_dribbler",
          73,
          "R"
        ],
        [
          "维托尔·巴尔博扎",
          "Vitor Barbosa",
          "巴西",
          "CM",
          "cm_playmaker",
          73,
          "R"
        ],
        [
          "布鲁诺·塞拉",
          "Bruno Serra",
          "巴西",
          "ST",
          "st_runner",
          73,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-11",
      "club": "黑潮海港",
      "clubEn": "黑潮海港",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "normal",
        "line": "mid",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 907,
      "players": [
        [
          "卢卡斯·特谢拉",
          "Lucas Teixeira",
          "巴西",
          "GK",
          "gk_sweeper",
          80,
          "R"
        ],
        [
          "拉米罗·卡夫雷拉",
          "Ramiro Cabrera",
          "阿根廷",
          "W",
          "fb_playmaker",
          80,
          "R"
        ],
        [
          "费利佩·科斯塔",
          "Felipe Costa",
          "巴西",
          "CB",
          "cb_ballplaying",
          80,
          "R"
        ],
        [
          "费利佩·卡多佐",
          "Felipe Cardoso",
          "巴西",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "塞杜·萨尔",
          "Seydou Sarr",
          "塞内加尔",
          "W",
          "w_finisher",
          78,
          "R"
        ],
        [
          "伊桑·贝内特",
          "Ethan Bennett",
          "英格兰",
          "CM",
          "cm_creator",
          78,
          "R"
        ],
        [
          "莫里茨·里希特",
          "Moritz Richter",
          "德国",
          "CM",
          "cm_destroyer",
          78,
          "R"
        ],
        [
          "马利克·法尔",
          "Malick Fall",
          "塞内加尔",
          "CM",
          "cm_box2box",
          77,
          "L"
        ],
        [
          "布鲁诺·塞拉",
          "Bruno Serra",
          "巴西",
          "W",
          "w_finisher",
          77,
          "R"
        ],
        [
          "菲利普·巴比奇",
          "Filip Babic",
          "克罗地亚",
          "ST",
          "st_target",
          77,
          "R"
        ],
        [
          "亨里克·尼格伦",
          "Henrik Nygren",
          "瑞典",
          "W",
          "w_engine",
          77,
          "L"
        ],
        [
          "埃梅卡·奥涅卡",
          "Emeka Onyeka",
          "尼日利亚",
          "GK",
          "gk_shotstopper",
          74,
          "R"
        ],
        [
          "阿德·恩沃苏",
          "Ade Nwosu",
          "尼日利亚",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "拉斐尔·卡多佐",
          "Rafael Cardoso",
          "巴西",
          "W",
          "w_finisher",
          74,
          "R"
        ],
        [
          "马尔科·伊利奇",
          "Marko Ilic",
          "克罗地亚",
          "CM",
          "cm_creator",
          74,
          "R"
        ],
        [
          "阿德·奥涅卡",
          "Ade Onyeka",
          "尼日利亚",
          "ST",
          "st_false9",
          74,
          "R"
        ]
      ]
    },
    {
      "id": "cup-league-12",
      "club": "长弓军团",
      "clubEn": "长弓军团",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 920,
      "players": [
        [
          "埃比尼泽·阿桑特",
          "Ebenezer Asante",
          "加纳",
          "GK",
          "gk_sweeper",
          80,
          "L"
        ],
        [
          "扬·哈特曼",
          "Jan Hartmann",
          "德国",
          "W",
          "w_playmaker",
          80,
          "L"
        ],
        [
          "莫里茨·哈特曼",
          "Moritz Hartmann",
          "德国",
          "CB",
          "cb_stopper",
          80,
          "R"
        ],
        [
          "马马杜·盖耶",
          "Mamadou Gueye",
          "塞内加尔",
          "CB",
          "cb_cover",
          78,
          "L"
        ],
        [
          "蒂姆·福格尔",
          "Tim Vogel",
          "德国",
          "W",
          "w_crosser",
          78,
          "R"
        ],
        [
          "克莱芒·朗贝尔",
          "Clement Lambert",
          "法国",
          "CM",
          "cm_destroyer",
          78,
          "R"
        ],
        [
          "安德斯·林德奎斯特",
          "Anders Lindqvist",
          "瑞典",
          "CM",
          "cm_engine",
          78,
          "R"
        ],
        [
          "塞杜·萨尔",
          "Seydou Sarr",
          "塞内加尔",
          "W",
          "fb_attacking",
          77,
          "R"
        ],
        [
          "斯特凡·西米奇",
          "Stefan Simic",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          77,
          "R"
        ],
        [
          "布鲁诺·巴尔博扎",
          "Bruno Barbosa",
          "巴西",
          "W",
          "w_engine",
          77,
          "R"
        ],
        [
          "利奥·里德",
          "Leo Reid",
          "英格兰",
          "ST",
          "st_target",
          77,
          "R"
        ],
        [
          "姜泰熙",
          "Kang Taehee",
          "韩国",
          "GK",
          "gk_sweeper",
          74,
          "R"
        ],
        [
          "朱利安·朗贝尔",
          "Julien Lambert",
          "法国",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "马尔科·里奇",
          "Marco Ricci",
          "意大利",
          "W",
          "w_playmaker",
          74,
          "R"
        ],
        [
          "马克西姆·迪皮伊",
          "Maxime Dupuis",
          "法国",
          "CM",
          "cm_playmaker",
          74,
          "R"
        ],
        [
          "泰奥·朗贝尔",
          "Theo Lambert",
          "法国",
          "ST",
          "st_finisher",
          74,
          "R"
        ]
      ]
    }
  ],
  "champions": [
    {
      "id": "cup-champions-01",
      "club": "北岸体育",
      "clubEn": "北岸体育",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 950,
      "players": [
        [
          "达里奥·普列托",
          "Dario Prieto",
          "西班牙",
          "GK",
          "gk_shotstopper",
          82,
          "L"
        ],
        [
          "冯子昂",
          "Feng Ziang",
          "中国",
          "W",
          "w_finisher",
          82,
          "R"
        ],
        [
          "伊费亚尼·奥卡福",
          "Ifeanyi Okafor",
          "尼日利亚",
          "CB",
          "cb_cover",
          82,
          "R"
        ],
        [
          "森飒太",
          "Sota Mori",
          "日本",
          "CB",
          "cb_stopper",
          80,
          "L"
        ],
        [
          "伊藤莲",
          "Ren Ito",
          "日本",
          "W",
          "w_finisher",
          80,
          "R"
        ],
        [
          "莱昂·哈特曼",
          "Leon Hartmann",
          "德国",
          "CM",
          "cm_engine",
          80,
          "L"
        ],
        [
          "卢卡斯·贝克尔",
          "Lukas Becker",
          "德国",
          "CM",
          "cm_creator",
          80,
          "R"
        ],
        [
          "哈坎·卡亚",
          "Hakan Kaya",
          "土耳其",
          "CM",
          "cm_box2box",
          79,
          "R"
        ],
        [
          "费利克斯·里希特",
          "Felix Richter",
          "德国",
          "CM",
          "cm_destroyer",
          79,
          "R"
        ],
        [
          "阿德·阿德耶米",
          "Ade Adeyemi",
          "尼日利亚",
          "ST",
          "st_runner",
          79,
          "R"
        ],
        [
          "陈浩然",
          "Chen Haoran",
          "中国",
          "ST",
          "st_target",
          79,
          "R"
        ],
        [
          "纳比勒·哈达德",
          "Nabil Haddad",
          "摩洛哥",
          "GK",
          "gk_sweeper",
          76,
          "L"
        ],
        [
          "阿尔瓦罗·加拉多",
          "Alvaro Gallardo",
          "西班牙",
          "CB",
          "cb_stopper",
          76,
          "R"
        ],
        [
          "秦明远",
          "Qin Mingyuan",
          "中国",
          "W",
          "w_crosser",
          76,
          "L"
        ],
        [
          "陆星河",
          "Lu Xinghe",
          "中国",
          "CM",
          "cm_playmaker",
          76,
          "R"
        ],
        [
          "伊桑·哈特",
          "Ethan Hart",
          "英格兰",
          "ST",
          "st_target",
          76,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-02",
      "club": "青锋竞技会",
      "clubEn": "青锋竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "mid"
      },
      "color": "#004170",
      "accent": "#da291c",
      "note": "PvE 生成球队",
      "targetCa": 957,
      "players": [
        [
          "佐藤优斗",
          "Yuto Sato",
          "日本",
          "GK",
          "gk_wall",
          82,
          "L"
        ],
        [
          "莫里茨·哈特曼",
          "Moritz Hartmann",
          "德国",
          "W",
          "w_playmaker",
          82,
          "R"
        ],
        [
          "亚辛·阿姆拉尼",
          "Yassine Amrani",
          "摩洛哥",
          "CB",
          "cb_cover",
          82,
          "R"
        ],
        [
          "拉维·夏尔马",
          "Ravi Sharma",
          "印度",
          "CB",
          "cb_stopper",
          80,
          "R"
        ],
        [
          "法昆多·阿吉雷",
          "Facundo Aguirre",
          "阿根廷",
          "W",
          "w_crosser",
          80,
          "L"
        ],
        [
          "路易·佩兰",
          "Louis Perrin",
          "法国",
          "W",
          "fb_playmaker",
          80,
          "L"
        ],
        [
          "程文博",
          "Cheng Wenbo",
          "中国",
          "CM",
          "cm_engine",
          80,
          "R"
        ],
        [
          "耶斯佩尔·达尔",
          "Jesper Dahl",
          "瑞典",
          "CM",
          "cm_mezzala",
          79,
          "R"
        ],
        [
          "阿尔琼·辛格",
          "Arjun Singh",
          "印度",
          "W",
          "fb_playmaker",
          79,
          "R"
        ],
        [
          "杰米·帕克",
          "Jamie Parker",
          "英格兰",
          "ST",
          "st_finisher",
          79,
          "R"
        ],
        [
          "巴勃罗·普列托",
          "Pablo Prieto",
          "西班牙",
          "ST",
          "st_poacher",
          79,
          "L"
        ],
        [
          "安德烈·莫拉",
          "Andre Moura",
          "巴西",
          "GK",
          "gk_shotstopper",
          76,
          "L"
        ],
        [
          "巴斯蒂安·佩兰",
          "Bastien Perrin",
          "法国",
          "CB",
          "cb_stopper",
          76,
          "L"
        ],
        [
          "瑞安·肖",
          "Ryan Shaw",
          "英格兰",
          "W",
          "fb_attacking",
          76,
          "R"
        ],
        [
          "小林悠希",
          "Yuki Kobayashi",
          "日本",
          "CM",
          "cm_destroyer",
          76,
          "R"
        ],
        [
          "诺亚·肖",
          "Noah Shaw",
          "英格兰",
          "ST",
          "st_poacher",
          76,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-03",
      "club": "远帆竞技会",
      "clubEn": "远帆竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "mid",
        "press": "mid"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 963,
      "players": [
        [
          "卡里姆·曼苏尔",
          "Karim Mansour",
          "摩洛哥",
          "GK",
          "gk_sweeper",
          82,
          "R"
        ],
        [
          "科菲·奥塞",
          "Kofi Osei",
          "加纳",
          "W",
          "w_finisher",
          82,
          "L"
        ],
        [
          "伊万·约万诺维奇",
          "Ivan Jovanovic",
          "克罗地亚",
          "CB",
          "cb_cover",
          82,
          "R"
        ],
        [
          "苏尼尔·奈尔",
          "Sunil Nair",
          "印度",
          "CB",
          "cb_stopper",
          80,
          "L"
        ],
        [
          "乌戈·雷耶斯",
          "Hugo Reyes",
          "西班牙",
          "W",
          "w_finisher",
          80,
          "L"
        ],
        [
          "达里奥·埃雷拉",
          "Dario Herrera",
          "西班牙",
          "W",
          "w_dribbler",
          80,
          "R"
        ],
        [
          "姜志勋",
          "Kang Jihoon",
          "韩国",
          "CM",
          "cm_box2box",
          80,
          "R"
        ],
        [
          "亨里克·尼格伦",
          "Henrik Nygren",
          "瑞典",
          "CM",
          "cm_box2box",
          79,
          "R"
        ],
        [
          "佐藤优斗",
          "Yuto Sato",
          "日本",
          "W",
          "w_finisher",
          79,
          "R"
        ],
        [
          "桑德·贝里",
          "Sander Berg",
          "瑞典",
          "ST",
          "st_poacher",
          79,
          "R"
        ],
        [
          "贡萨洛·基罗加",
          "Gonzalo Quiroga",
          "阿根廷",
          "ST",
          "st_finisher",
          79,
          "R"
        ],
        [
          "高子昂",
          "Gao Ziang",
          "中国",
          "GK",
          "gk_shotstopper",
          76,
          "R"
        ],
        [
          "佐藤悠希",
          "Yuki Sato",
          "日本",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "马特奥·罗梅罗",
          "Mateo Romero",
          "西班牙",
          "W",
          "w_finisher",
          76,
          "L"
        ],
        [
          "塞尔吉奥·莫利纳",
          "Sergio Molina",
          "西班牙",
          "CM",
          "cm_creator",
          76,
          "R"
        ],
        [
          "本·特纳",
          "Ben Turner",
          "英格兰",
          "ST",
          "st_target",
          76,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-04",
      "club": "金桥联",
      "clubEn": "金桥联",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "low"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 970,
      "players": [
        [
          "米洛·维尔",
          "Milo Vale",
          "英格兰",
          "GK",
          "gk_sweeper",
          82,
          "R"
        ],
        [
          "布拉克·沙欣",
          "Burak Sahin",
          "土耳其",
          "W",
          "w_playmaker",
          82,
          "R"
        ],
        [
          "罗汉·辛格",
          "Rohan Singh",
          "印度",
          "CB",
          "cb_ballplaying",
          82,
          "L"
        ],
        [
          "杜尚·科瓦奇",
          "Dusan Kovac",
          "克罗地亚",
          "CB",
          "cb_cover",
          80,
          "R"
        ],
        [
          "拉尔斯·埃克斯特伦",
          "Lars Ekstrom",
          "瑞典",
          "W",
          "w_crosser",
          80,
          "R"
        ],
        [
          "陈一鸣",
          "Chen Yiming",
          "中国",
          "CM",
          "cm_box2box",
          80,
          "R"
        ],
        [
          "诺亚·休斯",
          "Noah Hughes",
          "英格兰",
          "CM",
          "cm_creator",
          80,
          "L"
        ],
        [
          "安托万·吉拉尔",
          "Antoine Girard",
          "法国",
          "W",
          "w_playmaker",
          79,
          "R"
        ],
        [
          "若昂·席尔瓦",
          "Joao Silva",
          "巴西",
          "CM",
          "cm_engine",
          79,
          "R"
        ],
        [
          "佛朗哥·基罗加",
          "Franco Quiroga",
          "阿根廷",
          "W",
          "w_engine",
          79,
          "R"
        ],
        [
          "达维德·里纳尔迪",
          "Davide Rinaldi",
          "意大利",
          "ST",
          "st_poacher",
          79,
          "R"
        ],
        [
          "古斯塔沃·皮雷斯",
          "Gustavo Pires",
          "巴西",
          "GK",
          "gk_wall",
          76,
          "R"
        ],
        [
          "欧文·弗莱彻",
          "Owen Fletcher",
          "英格兰",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "本·哈特",
          "Ben Hart",
          "英格兰",
          "W",
          "fb_attacking",
          76,
          "L"
        ],
        [
          "谢赫·恩迪亚耶",
          "Cheikh Ndiaye",
          "塞内加尔",
          "CM",
          "cm_creator",
          76,
          "L"
        ],
        [
          "米克尔·斯特兰德",
          "Mikkel Strand",
          "瑞典",
          "ST",
          "st_finisher",
          76,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-05",
      "club": "银翼青年",
      "clubEn": "银翼青年",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 976,
      "players": [
        [
          "欧文·休斯",
          "Owen Hughes",
          "英格兰",
          "GK",
          "gk_sweeper",
          83,
          "R"
        ],
        [
          "优素福·厄兹蒂尔克",
          "Yusuf Ozturk",
          "土耳其",
          "W",
          "fb_playmaker",
          83,
          "R"
        ],
        [
          "伊费亚尼·埃泽",
          "Ifeanyi Eze",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          83,
          "R"
        ],
        [
          "沈亦凡",
          "Shen Yifan",
          "中国",
          "CB",
          "cb_cover",
          81,
          "L"
        ],
        [
          "瑞安·霍尔特",
          "Ryan Holt",
          "英格兰",
          "W",
          "w_engine",
          81,
          "R"
        ],
        [
          "雷南·塞拉",
          "Renan Serra",
          "巴西",
          "W",
          "fb_attacking",
          81,
          "R"
        ],
        [
          "伊万·武科维奇",
          "Ivan Vukovic",
          "克罗地亚",
          "CM",
          "cm_engine",
          81,
          "R"
        ],
        [
          "约纳斯·贝克尔",
          "Jonas Becker",
          "德国",
          "CM",
          "cm_destroyer",
          80,
          "L"
        ],
        [
          "卢卡·格雷科",
          "Luca Greco",
          "意大利",
          "W",
          "fb_attacking",
          80,
          "R"
        ],
        [
          "高桥海斗",
          "Kaito Takahashi",
          "日本",
          "ST",
          "st_poacher",
          80,
          "L"
        ],
        [
          "杰米·帕克",
          "Jamie Parker",
          "英格兰",
          "ST",
          "st_false9",
          80,
          "R"
        ],
        [
          "何子昂",
          "He Ziang",
          "中国",
          "GK",
          "gk_wall",
          77,
          "R"
        ],
        [
          "埃里克·霍尔姆",
          "Erik Holm",
          "瑞典",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "叶景行",
          "Ye Jingxing",
          "中国",
          "W",
          "w_crosser",
          77,
          "R"
        ],
        [
          "卢卡斯·福格尔",
          "Lukas Vogel",
          "德国",
          "CM",
          "cm_mezzala",
          77,
          "R"
        ],
        [
          "尼科·普列托",
          "Nico Prieto",
          "西班牙",
          "ST",
          "st_false9",
          77,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-06",
      "club": "白塔竞技",
      "clubEn": "白塔竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 983,
      "players": [
        [
          "巴勃罗·加拉多",
          "Pablo Gallardo",
          "西班牙",
          "GK",
          "gk_shotstopper",
          83,
          "R"
        ],
        [
          "埃兹拉·里德",
          "Ezra Reid",
          "英格兰",
          "W",
          "w_crosser",
          83,
          "R"
        ],
        [
          "韩明远",
          "Han Mingyuan",
          "中国",
          "CB",
          "cb_ballplaying",
          83,
          "R"
        ],
        [
          "佛朗哥·梅迪纳",
          "Franco Medina",
          "阿根廷",
          "CB",
          "cb_cover",
          81,
          "R"
        ],
        [
          "卡里姆·沙基尔",
          "Karim Chakir",
          "摩洛哥",
          "W",
          "w_crosser",
          81,
          "R"
        ],
        [
          "米洛·哈特",
          "Milo Hart",
          "英格兰",
          "W",
          "w_engine",
          81,
          "R"
        ],
        [
          "赵启航",
          "Zhao Qihang",
          "中国",
          "CM",
          "cm_destroyer",
          81,
          "R"
        ],
        [
          "维克托·林德奎斯特",
          "Viktor Lindqvist",
          "瑞典",
          "CM",
          "cm_engine",
          80,
          "R"
        ],
        [
          "利奥·巴克",
          "Leo Barker",
          "英格兰",
          "W",
          "w_crosser",
          80,
          "R"
        ],
        [
          "马尔科·科瓦奇",
          "Marko Kovac",
          "克罗地亚",
          "ST",
          "st_finisher",
          80,
          "R"
        ],
        [
          "伊藤拓海",
          "Takumi Ito",
          "日本",
          "ST",
          "st_runner",
          80,
          "R"
        ],
        [
          "奎西·阿莫阿",
          "Kwesi Amoah",
          "加纳",
          "GK",
          "gk_shotstopper",
          77,
          "L"
        ],
        [
          "马特乌斯·努内斯",
          "Matheus Nunes",
          "巴西",
          "CB",
          "cb_cover",
          77,
          "R"
        ],
        [
          "法比安·哈特曼",
          "Fabian Hartmann",
          "德国",
          "W",
          "w_playmaker",
          77,
          "L"
        ],
        [
          "尹泰熙",
          "Yoon Taehee",
          "韩国",
          "CM",
          "cm_engine",
          77,
          "L"
        ],
        [
          "马格努斯·林德奎斯特",
          "Magnus Lindqvist",
          "瑞典",
          "ST",
          "st_finisher",
          77,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-07",
      "club": "黑潮体育",
      "clubEn": "黑潮体育",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "low",
        "press": "mid"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 989,
      "players": [
        [
          "金敏俊",
          "Kim Minjun",
          "韩国",
          "GK",
          "gk_shotstopper",
          83,
          "R"
        ],
        [
          "米兰·巴比奇",
          "Milan Babic",
          "克罗地亚",
          "W",
          "w_engine",
          83,
          "L"
        ],
        [
          "马克西姆·迪皮伊",
          "Maxime Dupuis",
          "法国",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "若昂·里贝罗",
          "Joao Ribeiro",
          "巴西",
          "CB",
          "cb_stopper",
          81,
          "R"
        ],
        [
          "阿尔达·耶尔马兹",
          "Arda Yilmaz",
          "土耳其",
          "W",
          "fb_attacking",
          81,
          "R"
        ],
        [
          "拉维·夏尔马",
          "Ravi Sharma",
          "印度",
          "CM",
          "cm_mezzala",
          81,
          "R"
        ],
        [
          "约西普·诺瓦克",
          "Josip Novak",
          "克罗地亚",
          "W",
          "w_finisher",
          81,
          "R"
        ],
        [
          "钟子昂",
          "Zhong Ziang",
          "中国",
          "CM",
          "cm_creator",
          80,
          "R"
        ],
        [
          "阿古斯丁·索萨",
          "Agustin Sosa",
          "阿根廷",
          "CM",
          "cm_creator",
          80,
          "R"
        ],
        [
          "何浩然",
          "He Haoran",
          "中国",
          "W",
          "fb_attacking",
          80,
          "R"
        ],
        [
          "尼科洛·加利",
          "Nicolo Galli",
          "意大利",
          "ST",
          "st_finisher",
          80,
          "R"
        ],
        [
          "铃木莲",
          "Ren Suzuki",
          "日本",
          "GK",
          "gk_wall",
          77,
          "R"
        ],
        [
          "布鲁诺·卡多佐",
          "Bruno Cardoso",
          "巴西",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "塞杜·迪亚洛",
          "Seydou Diallo",
          "塞内加尔",
          "W",
          "w_finisher",
          77,
          "L"
        ],
        [
          "维托尔·塞拉",
          "Vitor Serra",
          "巴西",
          "CM",
          "cm_mezzala",
          77,
          "R"
        ],
        [
          "费利佩·卡多佐",
          "Felipe Cardoso",
          "巴西",
          "ST",
          "st_poacher",
          77,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-08",
      "club": "青锋雄狮",
      "clubEn": "青锋雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 996,
      "players": [
        [
          "安托万·朗贝尔",
          "Antoine Lambert",
          "法国",
          "GK",
          "gk_sweeper",
          84,
          "R"
        ],
        [
          "乌切·埃泽",
          "Uche Eze",
          "尼日利亚",
          "W",
          "fb_attacking",
          84,
          "L"
        ],
        [
          "塞尔吉奥·罗梅罗",
          "Sergio Romero",
          "西班牙",
          "CB",
          "cb_ballplaying",
          84,
          "R"
        ],
        [
          "恩佐·佩兰",
          "Enzo Perrin",
          "法国",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "安托万·勒纳尔",
          "Antoine Renard",
          "法国",
          "W",
          "w_crosser",
          82,
          "R"
        ],
        [
          "埃里克·桑德贝里",
          "Erik Sandberg",
          "瑞典",
          "CM",
          "cm_creator",
          82,
          "R"
        ],
        [
          "西莫内·里纳尔迪",
          "Simone Rinaldi",
          "意大利",
          "CM",
          "cm_destroyer",
          82,
          "L"
        ],
        [
          "伊格纳西奥·索萨",
          "Ignacio Sosa",
          "阿根廷",
          "W",
          "w_engine",
          81,
          "R"
        ],
        [
          "陈明远",
          "Chen Mingyuan",
          "中国",
          "CM",
          "cm_playmaker",
          81,
          "R"
        ],
        [
          "阿尔瓦罗·埃雷拉",
          "Alvaro Herrera",
          "西班牙",
          "W",
          "w_playmaker",
          81,
          "L"
        ],
        [
          "克莱芒·卢梭",
          "Clement Rousseau",
          "法国",
          "ST",
          "st_runner",
          81,
          "R"
        ],
        [
          "费德里科·里纳尔迪",
          "Federico Rinaldi",
          "意大利",
          "GK",
          "gk_shotstopper",
          78,
          "R"
        ],
        [
          "安德烈·塞拉",
          "Andre Serra",
          "巴西",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "克莱芒·莫罗",
          "Clement Moreau",
          "法国",
          "W",
          "w_crosser",
          78,
          "R"
        ],
        [
          "维克托·霍尔姆",
          "Viktor Holm",
          "瑞典",
          "CM",
          "cm_playmaker",
          78,
          "R"
        ],
        [
          "巴勃罗·维加",
          "Pablo Vega",
          "西班牙",
          "ST",
          "st_false9",
          78,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-09",
      "club": "晨星体育",
      "clubEn": "晨星体育",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "normal",
        "line": "mid",
        "press": "low"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1002,
      "players": [
        [
          "伊费亚尼·阿贾伊",
          "Ifeanyi Ajayi",
          "尼日利亚",
          "GK",
          "gk_wall",
          84,
          "R"
        ],
        [
          "尼克拉斯·里希特",
          "Niklas Richter",
          "德国",
          "CB",
          "cb_stopper",
          84,
          "R"
        ],
        [
          "伊克尔·奥尔特加",
          "Iker Ortega",
          "西班牙",
          "CB",
          "cb_ballplaying",
          84,
          "L"
        ],
        [
          "拉斐尔·皮雷斯",
          "Rafael Pires",
          "巴西",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "唐博文",
          "Tang Bowen",
          "中国",
          "W",
          "fb_playmaker",
          82,
          "R"
        ],
        [
          "马蒂斯·戈蒂埃",
          "Mathis Gauthier",
          "法国",
          "CM",
          "cm_engine",
          82,
          "R"
        ],
        [
          "巴斯蒂安·卢梭",
          "Bastien Rousseau",
          "法国",
          "CM",
          "cm_engine",
          82,
          "L"
        ],
        [
          "约纳斯·里希特",
          "Jonas Richter",
          "德国",
          "W",
          "w_finisher",
          81,
          "R"
        ],
        [
          "巴斯蒂安·戈蒂埃",
          "Bastien Gauthier",
          "法国",
          "W",
          "fb_playmaker",
          81,
          "R"
        ],
        [
          "马格努斯·尼尔松",
          "Magnus Nilsson",
          "瑞典",
          "ST",
          "st_poacher",
          81,
          "R"
        ],
        [
          "黄贤宇",
          "Hwang Hyunwoo",
          "韩国",
          "W",
          "fb_playmaker",
          81,
          "R"
        ],
        [
          "佛朗哥·基罗加",
          "Franco Quiroga",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          78,
          "R"
        ],
        [
          "伊桑·贝内特",
          "Ethan Bennett",
          "英格兰",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "杰米·贝内特",
          "Jamie Bennett",
          "英格兰",
          "W",
          "fb_attacking",
          78,
          "R"
        ],
        [
          "马尔科·比安基",
          "Marco Bianchi",
          "意大利",
          "CM",
          "cm_mezzala",
          78,
          "R"
        ],
        [
          "崔贤宇",
          "Choi Hyunwoo",
          "韩国",
          "ST",
          "st_poacher",
          78,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-10",
      "club": "铁砧之队",
      "clubEn": "铁砧之队",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1009,
      "players": [
        [
          "阿尔达·卡亚",
          "Arda Kaya",
          "土耳其",
          "GK",
          "gk_wall",
          84,
          "R"
        ],
        [
          "哈里·福斯特",
          "Harry Foster",
          "英格兰",
          "CB",
          "cb_stopper",
          84,
          "R"
        ],
        [
          "亚尼斯·富尼耶",
          "Yanis Fournier",
          "法国",
          "CB",
          "cb_cover",
          84,
          "R"
        ],
        [
          "伊克尔·奥尔特加",
          "Iker Ortega",
          "西班牙",
          "CB",
          "cb_cover",
          82,
          "L"
        ],
        [
          "李志勋",
          "Lee Jihoon",
          "韩国",
          "W",
          "w_playmaker",
          82,
          "L"
        ],
        [
          "蒂亚戈·塞拉",
          "Thiago Serra",
          "巴西",
          "CM",
          "cm_playmaker",
          82,
          "R"
        ],
        [
          "杜尚·伊利奇",
          "Dusan Ilic",
          "克罗地亚",
          "CM",
          "cm_box2box",
          82,
          "R"
        ],
        [
          "中村莲",
          "Ren Nakamura",
          "日本",
          "CM",
          "cm_creator",
          81,
          "R"
        ],
        [
          "米兰·武科维奇",
          "Milan Vukovic",
          "克罗地亚",
          "W",
          "fb_playmaker",
          81,
          "L"
        ],
        [
          "黄敏俊",
          "Hwang Minjun",
          "韩国",
          "ST",
          "st_finisher",
          81,
          "R"
        ],
        [
          "乌戈·普列托",
          "Hugo Prieto",
          "西班牙",
          "ST",
          "st_runner",
          81,
          "R"
        ],
        [
          "菲利普·约万诺维奇",
          "Filip Jovanovic",
          "克罗地亚",
          "GK",
          "gk_sweeper",
          78,
          "L"
        ],
        [
          "伊万·霍尔瓦特",
          "Ivan Horvat",
          "克罗地亚",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "阿德里安·纳瓦罗",
          "Adrian Navarro",
          "西班牙",
          "W",
          "w_dribbler",
          78,
          "R"
        ],
        [
          "尼科洛·格雷科",
          "Nicolo Greco",
          "意大利",
          "CM",
          "cm_mezzala",
          78,
          "R"
        ],
        [
          "罗牧野",
          "Luo Muye",
          "中国",
          "ST",
          "st_poacher",
          78,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-11",
      "club": "西湾体育 II",
      "clubEn": "西湾体育",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1015,
      "players": [
        [
          "田承宇",
          "Tian Chengyu",
          "中国",
          "GK",
          "gk_sweeper",
          84,
          "R"
        ],
        [
          "奥比纳·恩沃苏",
          "Obinna Nwosu",
          "尼日利亚",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "塞杜·盖耶",
          "Seydou Gueye",
          "塞内加尔",
          "CB",
          "cb_cover",
          84,
          "R"
        ],
        [
          "苏一鸣",
          "Su Yiming",
          "中国",
          "CB",
          "cb_cover",
          82,
          "R"
        ],
        [
          "哈姆扎·萨利赫",
          "Hamza Saleh",
          "摩洛哥",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "黄志勋",
          "Hwang Jihoon",
          "韩国",
          "CM",
          "cm_creator",
          82,
          "L"
        ],
        [
          "拉米罗·索萨",
          "Ramiro Sosa",
          "阿根廷",
          "W",
          "w_crosser",
          82,
          "R"
        ],
        [
          "沈泽宇",
          "Shen Zeyu",
          "中国",
          "CM",
          "cm_box2box",
          81,
          "R"
        ],
        [
          "凯莱奇·奥科耶",
          "Kelechi Okoye",
          "尼日利亚",
          "CM",
          "cm_engine",
          81,
          "R"
        ],
        [
          "迭戈·雷耶斯",
          "Diego Reyes",
          "西班牙",
          "W",
          "fb_playmaker",
          81,
          "R"
        ],
        [
          "埃里克·尼格伦",
          "Erik Nygren",
          "瑞典",
          "ST",
          "st_runner",
          81,
          "R"
        ],
        [
          "小林翔太",
          "Shota Kobayashi",
          "日本",
          "GK",
          "gk_shotstopper",
          78,
          "L"
        ],
        [
          "卡里姆·萨利赫",
          "Karim Saleh",
          "摩洛哥",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "奇迪·巴洛贡",
          "Chidi Balogun",
          "尼日利亚",
          "W",
          "w_crosser",
          78,
          "R"
        ],
        [
          "安德烈·席尔瓦",
          "Andre Silva",
          "巴西",
          "CM",
          "cm_mezzala",
          78,
          "R"
        ],
        [
          "雷南·费雷拉",
          "Renan Ferreira",
          "巴西",
          "ST",
          "st_runner",
          78,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-12",
      "club": "长弓海港",
      "clubEn": "长弓海港",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "normal",
        "line": "high",
        "press": "high"
      },
      "color": "#8e1f2f",
      "accent": "#f0bc42",
      "note": "PvE 生成球队",
      "targetCa": 1022,
      "players": [
        [
          "哈坎·切利克",
          "Hakan Celik",
          "土耳其",
          "GK",
          "gk_sweeper",
          85,
          "R"
        ],
        [
          "马利克·西塞",
          "Malick Cisse",
          "塞内加尔",
          "W",
          "w_crosser",
          85,
          "R"
        ],
        [
          "卡勒姆·哈特",
          "Callum Hart",
          "英格兰",
          "CB",
          "cb_ballplaying",
          85,
          "R"
        ],
        [
          "蒂姆·福斯",
          "Tim Voss",
          "德国",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "阿尔瓦罗·奥尔特加",
          "Alvaro Ortega",
          "西班牙",
          "W",
          "w_playmaker",
          83,
          "R"
        ],
        [
          "卢卡斯·费雷拉",
          "Lucas Ferreira",
          "巴西",
          "W",
          "w_crosser",
          83,
          "L"
        ],
        [
          "利亚姆·道森",
          "Liam Dawson",
          "英格兰",
          "CM",
          "cm_mezzala",
          83,
          "R"
        ],
        [
          "马利克·迪亚洛",
          "Malick Diallo",
          "塞内加尔",
          "CM",
          "cm_creator",
          82,
          "R"
        ],
        [
          "蒂姆·里希特",
          "Tim Richter",
          "德国",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "亚乌·阿莫阿",
          "Yaw Amoah",
          "加纳",
          "ST",
          "st_runner",
          82,
          "L"
        ],
        [
          "阿尔达·沙欣",
          "Arda Sahin",
          "土耳其",
          "ST",
          "st_false9",
          82,
          "R"
        ],
        [
          "哈维尔·帕斯夸尔",
          "Javier Pascual",
          "西班牙",
          "GK",
          "gk_shotstopper",
          79,
          "R"
        ],
        [
          "达里奥·纳瓦罗",
          "Dario Navarro",
          "西班牙",
          "CB",
          "cb_cover",
          79,
          "R"
        ],
        [
          "维克托·霍尔姆",
          "Viktor Holm",
          "瑞典",
          "W",
          "fb_playmaker",
          79,
          "R"
        ],
        [
          "埃米利亚诺·基罗加",
          "Emiliano Quiroga",
          "阿根廷",
          "CM",
          "cm_destroyer",
          79,
          "R"
        ],
        [
          "阿德·恩沃苏",
          "Ade Nwosu",
          "尼日利亚",
          "ST",
          "st_target",
          79,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-13",
      "club": "黑潮体育 II",
      "clubEn": "黑潮体育",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1028,
      "players": [
        [
          "恩佐·佩兰",
          "Enzo Perrin",
          "法国",
          "GK",
          "gk_wall",
          85,
          "R"
        ],
        [
          "林博文",
          "Lin Bowen",
          "中国",
          "W",
          "w_engine",
          85,
          "R"
        ],
        [
          "松田莲",
          "Ren Matsuda",
          "日本",
          "CB",
          "cb_stopper",
          85,
          "L"
        ],
        [
          "恩佐·戈蒂埃",
          "Enzo Gauthier",
          "法国",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "达里奥·普列托",
          "Dario Prieto",
          "西班牙",
          "W",
          "fb_attacking",
          83,
          "R"
        ],
        [
          "尼古拉斯·梅迪纳",
          "Nicolas Medina",
          "阿根廷",
          "CM",
          "cm_creator",
          83,
          "R"
        ],
        [
          "泰奥·佩兰",
          "Theo Perrin",
          "法国",
          "CM",
          "cm_playmaker",
          83,
          "L"
        ],
        [
          "江天佑",
          "Jiang Tianyou",
          "中国",
          "CM",
          "cm_mezzala",
          82,
          "R"
        ],
        [
          "梅赫梅特·阿尔斯兰",
          "Mehmet Arslan",
          "土耳其",
          "W",
          "w_playmaker",
          82,
          "R"
        ],
        [
          "姜成珉",
          "Kang Sungmin",
          "韩国",
          "ST",
          "st_runner",
          82,
          "R"
        ],
        [
          "科菲·门萨",
          "Kofi Mensah",
          "加纳",
          "W",
          "fb_playmaker",
          82,
          "R"
        ],
        [
          "马科斯·奥尔特加",
          "Marcos Ortega",
          "西班牙",
          "GK",
          "gk_sweeper",
          79,
          "R"
        ],
        [
          "马克西姆·吉拉尔",
          "Maxime Girard",
          "法国",
          "CB",
          "cb_cover",
          79,
          "R"
        ],
        [
          "罗汉·辛格",
          "Rohan Singh",
          "印度",
          "W",
          "w_playmaker",
          79,
          "R"
        ],
        [
          "苏尼尔·辛格",
          "Sunil Singh",
          "印度",
          "CM",
          "cm_playmaker",
          79,
          "R"
        ],
        [
          "哈维尔·普列托",
          "Javier Prieto",
          "西班牙",
          "ST",
          "st_false9",
          79,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-14",
      "club": "晨星联",
      "clubEn": "晨星联",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "normal",
        "line": "mid",
        "press": "low"
      },
      "color": "#8e1f2f",
      "accent": "#f0bc42",
      "note": "PvE 生成球队",
      "targetCa": 1035,
      "players": [
        [
          "奥比纳·埃泽",
          "Obinna Eze",
          "尼日利亚",
          "GK",
          "gk_shotstopper",
          85,
          "R"
        ],
        [
          "达维德·加利",
          "Davide Galli",
          "意大利",
          "W",
          "fb_playmaker",
          85,
          "R"
        ],
        [
          "黄贤宇",
          "Hwang Hyunwoo",
          "韩国",
          "CB",
          "cb_ballplaying",
          85,
          "R"
        ],
        [
          "崔宇镇",
          "Choi Woojin",
          "韩国",
          "CB",
          "cb_ballplaying",
          83,
          "R"
        ],
        [
          "尼古拉·西米奇",
          "Nikola Simic",
          "克罗地亚",
          "W",
          "w_playmaker",
          83,
          "L"
        ],
        [
          "拉尔斯·霍尔姆",
          "Lars Holm",
          "瑞典",
          "CM",
          "cm_playmaker",
          83,
          "R"
        ],
        [
          "奥马尔·哈利勒",
          "Omar Khalil",
          "摩洛哥",
          "CM",
          "cm_destroyer",
          83,
          "L"
        ],
        [
          "本·哈特",
          "Ben Hart",
          "英格兰",
          "CM",
          "cm_mezzala",
          82,
          "R"
        ],
        [
          "费利佩·莫拉",
          "Felipe Moura",
          "巴西",
          "CM",
          "cm_engine",
          82,
          "R"
        ],
        [
          "亚辛·哈达德",
          "Yassine Haddad",
          "摩洛哥",
          "ST",
          "st_finisher",
          82,
          "R"
        ],
        [
          "本·福斯特",
          "Ben Foster",
          "英格兰",
          "ST",
          "st_finisher",
          82,
          "R"
        ],
        [
          "华金·卡夫雷拉",
          "Joaquin Cabrera",
          "阿根廷",
          "GK",
          "gk_sweeper",
          79,
          "R"
        ],
        [
          "芬恩·里德",
          "Finn Reid",
          "英格兰",
          "CB",
          "cb_stopper",
          79,
          "R"
        ],
        [
          "彭俊驰",
          "Peng Junchi",
          "中国",
          "W",
          "w_playmaker",
          79,
          "R"
        ],
        [
          "安德斯·拉森",
          "Anders Larsen",
          "瑞典",
          "CM",
          "cm_box2box",
          79,
          "R"
        ],
        [
          "利亚姆·休斯",
          "Liam Hughes",
          "英格兰",
          "ST",
          "st_runner",
          79,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-15",
      "club": "晨星军团",
      "clubEn": "晨星军团",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1041,
      "players": [
        [
          "塞杜·迪亚洛",
          "Seydou Diallo",
          "塞内加尔",
          "GK",
          "gk_sweeper",
          85,
          "R"
        ],
        [
          "马克西姆·莫罗",
          "Maxime Moreau",
          "法国",
          "W",
          "w_crosser",
          85,
          "R"
        ],
        [
          "魏星河",
          "Wei Xinghe",
          "中国",
          "CB",
          "cb_ballplaying",
          85,
          "R"
        ],
        [
          "高桥翔太",
          "Shota Takahashi",
          "日本",
          "CB",
          "cb_cover",
          83,
          "L"
        ],
        [
          "伊克尔·帕斯夸尔",
          "Iker Pascual",
          "西班牙",
          "W",
          "w_playmaker",
          83,
          "L"
        ],
        [
          "保罗·福格尔",
          "Paul Vogel",
          "德国",
          "CM",
          "cm_destroyer",
          83,
          "R"
        ],
        [
          "莫里茨·法尔克",
          "Moritz Falk",
          "德国",
          "W",
          "w_playmaker",
          83,
          "R"
        ],
        [
          "扬·福斯",
          "Jan Voss",
          "德国",
          "CM",
          "cm_creator",
          82,
          "R"
        ],
        [
          "安德烈·特谢拉",
          "Andre Teixeira",
          "巴西",
          "CM",
          "cm_playmaker",
          82,
          "R"
        ],
        [
          "科菲·阿莫阿",
          "Kofi Amoah",
          "加纳",
          "W",
          "w_dribbler",
          82,
          "R"
        ],
        [
          "达里奥·埃雷拉",
          "Dario Herrera",
          "西班牙",
          "ST",
          "st_finisher",
          82,
          "R"
        ],
        [
          "苏尼尔·辛格",
          "Sunil Singh",
          "印度",
          "GK",
          "gk_wall",
          79,
          "R"
        ],
        [
          "法比安·魏斯",
          "Fabian Weiss",
          "德国",
          "CB",
          "cb_stopper",
          79,
          "L"
        ],
        [
          "法昆多·阿科斯塔",
          "Facundo Acosta",
          "阿根廷",
          "W",
          "w_engine",
          79,
          "R"
        ],
        [
          "普林斯·阿桑特",
          "Prince Asante",
          "加纳",
          "CM",
          "cm_playmaker",
          79,
          "R"
        ],
        [
          "安德斯·尼格伦",
          "Anders Nygren",
          "瑞典",
          "ST",
          "st_poacher",
          79,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-16",
      "club": "林海联",
      "clubEn": "林海联",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "normal",
        "line": "low",
        "press": "high"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1048,
      "players": [
        [
          "斯特凡·巴比奇",
          "Stefan Babic",
          "克罗地亚",
          "GK",
          "gk_wall",
          86,
          "R"
        ],
        [
          "保罗·莱曼",
          "Paul Lehmann",
          "德国",
          "W",
          "fb_attacking",
          86,
          "L"
        ],
        [
          "安德烈亚·格雷科",
          "Andrea Greco",
          "意大利",
          "CB",
          "cb_stopper",
          86,
          "L"
        ],
        [
          "塞杜·巴",
          "Seydou Ba",
          "塞内加尔",
          "CB",
          "cb_ballplaying",
          84,
          "R"
        ],
        [
          "阿尤布·哈利勒",
          "Ayoub Khalil",
          "摩洛哥",
          "W",
          "w_dribbler",
          84,
          "L"
        ],
        [
          "优素福·德米尔",
          "Yusuf Demir",
          "土耳其",
          "CM",
          "cm_box2box",
          84,
          "L"
        ],
        [
          "金泰熙",
          "Kim Taehee",
          "韩国",
          "W",
          "w_finisher",
          84,
          "R"
        ],
        [
          "费德里科·格雷科",
          "Federico Greco",
          "意大利",
          "CM",
          "cm_playmaker",
          83,
          "R"
        ],
        [
          "穆萨·迪亚洛",
          "Moussa Diallo",
          "塞内加尔",
          "CM",
          "cm_engine",
          83,
          "L"
        ],
        [
          "金贤宇",
          "Kim Hyunwoo",
          "韩国",
          "W",
          "w_finisher",
          83,
          "L"
        ],
        [
          "卡里姆·阿姆拉尼",
          "Karim Amrani",
          "摩洛哥",
          "ST",
          "st_finisher",
          83,
          "R"
        ],
        [
          "彼得·拉迪奇",
          "Petar Radic",
          "克罗地亚",
          "GK",
          "gk_sweeper",
          80,
          "L"
        ],
        [
          "伊藤悠希",
          "Yuki Ito",
          "日本",
          "CB",
          "cb_stopper",
          80,
          "L"
        ],
        [
          "里卡尔多·孔蒂",
          "Riccardo Conti",
          "意大利",
          "W",
          "w_playmaker",
          80,
          "R"
        ],
        [
          "蒂姆·布兰特",
          "Tim Brandt",
          "德国",
          "CM",
          "cm_mezzala",
          80,
          "L"
        ],
        [
          "耶斯佩尔·林德奎斯特",
          "Jesper Lindqvist",
          "瑞典",
          "ST",
          "st_target",
          80,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-17",
      "club": "北岸矿工",
      "clubEn": "北岸矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1054,
      "players": [
        [
          "杰克·维尔",
          "Jack Vale",
          "英格兰",
          "GK",
          "gk_shotstopper",
          86,
          "R"
        ],
        [
          "利奥·科尔",
          "Leo Cole",
          "英格兰",
          "W",
          "w_finisher",
          86,
          "L"
        ],
        [
          "贾科莫·加利",
          "Giacomo Galli",
          "意大利",
          "CB",
          "cb_ballplaying",
          86,
          "R"
        ],
        [
          "费利克斯·法尔克",
          "Felix Falk",
          "德国",
          "CB",
          "cb_ballplaying",
          84,
          "R"
        ],
        [
          "马尔科·霍尔瓦特",
          "Marko Horvat",
          "克罗地亚",
          "W",
          "w_playmaker",
          84,
          "R"
        ],
        [
          "松田陆",
          "Riku Matsuda",
          "日本",
          "CM",
          "cm_destroyer",
          84,
          "R"
        ],
        [
          "马丁·伊万诺夫",
          "Martin Ivanov",
          "保加利亚",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "洛伦佐·加利",
          "Lorenzo Galli",
          "意大利",
          "CM",
          "cm_box2box",
          83,
          "R"
        ],
        [
          "哈里·道森",
          "Harry Dawson",
          "英格兰",
          "CM",
          "cm_box2box",
          83,
          "L"
        ],
        [
          "萨米尔·贝纳利",
          "Samir Benali",
          "摩洛哥",
          "W",
          "fb_playmaker",
          83,
          "L"
        ],
        [
          "何嘉树",
          "He Jiashu",
          "中国",
          "ST",
          "st_poacher",
          83,
          "R"
        ],
        [
          "夸梅·阿桑特",
          "Kwame Asante",
          "加纳",
          "GK",
          "gk_wall",
          80,
          "R"
        ],
        [
          "若昂·阿尔梅达",
          "Joao Almeida",
          "巴西",
          "CB",
          "cb_stopper",
          80,
          "R"
        ],
        [
          "乌戈·卡诺",
          "Hugo Cano",
          "西班牙",
          "W",
          "w_dribbler",
          80,
          "R"
        ],
        [
          "朴道贤",
          "Park Dohyun",
          "韩国",
          "CM",
          "cm_destroyer",
          80,
          "L"
        ],
        [
          "马泰奥·费里",
          "Matteo Ferri",
          "意大利",
          "ST",
          "st_runner",
          80,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-18",
      "club": "铁砧足球会",
      "clubEn": "铁砧足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1061,
      "players": [
        [
          "马泰奥·丰塔纳",
          "Matteo Fontana",
          "意大利",
          "GK",
          "gk_sweeper",
          86,
          "L"
        ],
        [
          "奇迪·巴洛贡",
          "Chidi Balogun",
          "尼日利亚",
          "W",
          "fb_attacking",
          86,
          "R"
        ],
        [
          "布鲁诺·努内斯",
          "Bruno Nunes",
          "巴西",
          "CB",
          "cb_ballplaying",
          86,
          "R"
        ],
        [
          "陆博文",
          "Lu Bowen",
          "中国",
          "CB",
          "cb_stopper",
          84,
          "R"
        ],
        [
          "崔志勋",
          "Choi Jihoon",
          "韩国",
          "W",
          "w_playmaker",
          84,
          "R"
        ],
        [
          "许博文",
          "Xu Bowen",
          "中国",
          "CM",
          "cm_destroyer",
          84,
          "R"
        ],
        [
          "卢卡斯·克劳泽",
          "Lukas Krause",
          "德国",
          "CM",
          "cm_mezzala",
          84,
          "L"
        ],
        [
          "马克西姆·梅西耶",
          "Maxime Mercier",
          "法国",
          "CM",
          "cm_destroyer",
          83,
          "L"
        ],
        [
          "马特奥·维加",
          "Mateo Vega",
          "西班牙",
          "W",
          "w_finisher",
          83,
          "R"
        ],
        [
          "亚辛·贝纳利",
          "Yassine Benali",
          "摩洛哥",
          "ST",
          "st_runner",
          83,
          "R"
        ],
        [
          "吉田翔太",
          "Shota Yoshida",
          "日本",
          "W",
          "w_engine",
          83,
          "R"
        ],
        [
          "韩奕辰",
          "Han Yichen",
          "中国",
          "GK",
          "gk_shotstopper",
          80,
          "R"
        ],
        [
          "里卡尔多·莫雷蒂",
          "Riccardo Moretti",
          "意大利",
          "CB",
          "cb_stopper",
          80,
          "R"
        ],
        [
          "里卡尔多·里奇",
          "Riccardo Ricci",
          "意大利",
          "W",
          "w_finisher",
          80,
          "R"
        ],
        [
          "斯特凡·武科维奇",
          "Stefan Vukovic",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          80,
          "L"
        ],
        [
          "尹贤宇",
          "Yoon Hyunwoo",
          "韩国",
          "ST",
          "st_poacher",
          80,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-19",
      "club": "霜原海港",
      "clubEn": "霜原海港",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "fast",
        "line": "low",
        "press": "mid"
      },
      "color": "#004170",
      "accent": "#da291c",
      "note": "PvE 生成球队",
      "targetCa": 1067,
      "players": [
        [
          "马科斯·卡斯特罗",
          "Marcos Castro",
          "西班牙",
          "GK",
          "gk_shotstopper",
          87,
          "R"
        ],
        [
          "蒂姆·法尔克",
          "Tim Falk",
          "德国",
          "W",
          "w_engine",
          87,
          "R"
        ],
        [
          "塔里克·阿姆拉尼",
          "Tarek Amrani",
          "摩洛哥",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "安特·拉迪奇",
          "Ante Radic",
          "克罗地亚",
          "CB",
          "cb_stopper",
          85,
          "L"
        ],
        [
          "姜宇镇",
          "Kang Woojin",
          "韩国",
          "W",
          "w_crosser",
          85,
          "R"
        ],
        [
          "雷南·特谢拉",
          "Renan Teixeira",
          "巴西",
          "W",
          "w_finisher",
          85,
          "R"
        ],
        [
          "芬恩·肖",
          "Finn Shaw",
          "英格兰",
          "CM",
          "cm_engine",
          85,
          "L"
        ],
        [
          "恩佐·勒纳尔",
          "Enzo Renard",
          "法国",
          "CM",
          "cm_playmaker",
          84,
          "R"
        ],
        [
          "马科斯·奥尔特加",
          "Marcos Ortega",
          "西班牙",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "凯莱奇·巴洛贡",
          "Kelechi Balogun",
          "尼日利亚",
          "ST",
          "st_false9",
          84,
          "R"
        ],
        [
          "卡里姆·阿姆拉尼",
          "Karim Amrani",
          "摩洛哥",
          "ST",
          "st_target",
          84,
          "R"
        ],
        [
          "芬恩·福斯特",
          "Finn Foster",
          "英格兰",
          "GK",
          "gk_wall",
          81,
          "R"
        ],
        [
          "吉田悠希",
          "Yuki Yoshida",
          "日本",
          "CB",
          "cb_stopper",
          81,
          "R"
        ],
        [
          "罗汉·帕特尔",
          "Rohan Patel",
          "印度",
          "W",
          "w_playmaker",
          81,
          "R"
        ],
        [
          "阿尔琼·奈尔",
          "Arjun Nair",
          "印度",
          "CM",
          "cm_creator",
          81,
          "L"
        ],
        [
          "尼古拉斯·莱德斯马",
          "Nicolas Ledesma",
          "阿根廷",
          "ST",
          "st_finisher",
          81,
          "L"
        ]
      ]
    },
    {
      "id": "cup-champions-20",
      "club": "长弓雄狮",
      "clubEn": "长弓雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "normal",
        "line": "low",
        "press": "high"
      },
      "color": "#fde100",
      "accent": "#000000",
      "note": "PvE 生成球队",
      "targetCa": 1074,
      "players": [
        [
          "路易·迪皮伊",
          "Louis Dupuis",
          "法国",
          "GK",
          "gk_shotstopper",
          87,
          "R"
        ],
        [
          "费利克斯·凯勒",
          "Felix Keller",
          "德国",
          "CB",
          "cb_ballplaying",
          87,
          "R"
        ],
        [
          "尼古拉·马尔科维奇",
          "Nikola Markovic",
          "克罗地亚",
          "CB",
          "cb_cover",
          87,
          "R"
        ],
        [
          "利亚姆·休斯",
          "Liam Hughes",
          "英格兰",
          "CB",
          "cb_stopper",
          85,
          "L"
        ],
        [
          "凯奥·阿尔梅达",
          "Caio Almeida",
          "巴西",
          "W",
          "w_playmaker",
          85,
          "R"
        ],
        [
          "尼科洛·丰塔纳",
          "Nicolo Fontana",
          "意大利",
          "CM",
          "cm_playmaker",
          85,
          "R"
        ],
        [
          "维托尔·塞拉",
          "Vitor Serra",
          "巴西",
          "CM",
          "cm_box2box",
          85,
          "R"
        ],
        [
          "杨云舟",
          "Yang Yunzhou",
          "中国",
          "W",
          "w_dribbler",
          84,
          "R"
        ],
        [
          "尼古拉·伊利奇",
          "Nikola Ilic",
          "克罗地亚",
          "W",
          "w_engine",
          84,
          "R"
        ],
        [
          "田奕辰",
          "Tian Yichen",
          "中国",
          "ST",
          "st_finisher",
          84,
          "L"
        ],
        [
          "塞尔吉奥·卡斯特罗",
          "Sergio Castro",
          "西班牙",
          "W",
          "w_playmaker",
          84,
          "L"
        ],
        [
          "小林悠希",
          "Yuki Kobayashi",
          "日本",
          "GK",
          "gk_sweeper",
          81,
          "R"
        ],
        [
          "费德里科·马尔凯蒂",
          "Federico Marchetti",
          "意大利",
          "CB",
          "cb_cover",
          81,
          "R"
        ],
        [
          "拉斐尔·努内斯",
          "Rafael Nunes",
          "巴西",
          "W",
          "w_playmaker",
          81,
          "L"
        ],
        [
          "马克西姆·佩兰",
          "Maxime Perrin",
          "法国",
          "CM",
          "cm_playmaker",
          81,
          "R"
        ],
        [
          "里卡尔多·马尔凯蒂",
          "Riccardo Marchetti",
          "意大利",
          "ST",
          "st_target",
          81,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-21",
      "club": "长弓竞技会 II",
      "clubEn": "长弓竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "slow",
        "line": "low",
        "press": "mid"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1080,
      "players": [
        [
          "费德里科·马尔凯蒂",
          "Federico Marchetti",
          "意大利",
          "GK",
          "gk_shotstopper",
          87,
          "R"
        ],
        [
          "托马斯·索萨",
          "Tomas Sosa",
          "阿根廷",
          "W",
          "w_crosser",
          87,
          "L"
        ],
        [
          "鲍里斯·安格洛夫",
          "Boris Angelov",
          "保加利亚",
          "CB",
          "cb_cover",
          87,
          "R"
        ],
        [
          "亚乌·阿莫阿",
          "Yaw Amoah",
          "加纳",
          "CB",
          "cb_ballplaying",
          85,
          "R"
        ],
        [
          "华金·基罗加",
          "Joaquin Quiroga",
          "阿根廷",
          "W",
          "fb_attacking",
          85,
          "R"
        ],
        [
          "迭戈·帕斯夸尔",
          "Diego Pascual",
          "西班牙",
          "W",
          "w_finisher",
          85,
          "L"
        ],
        [
          "巴斯蒂安·富尼耶",
          "Bastien Fournier",
          "法国",
          "CM",
          "cm_destroyer",
          85,
          "L"
        ],
        [
          "马尔科·巴比奇",
          "Marko Babic",
          "克罗地亚",
          "CM",
          "cm_creator",
          84,
          "L"
        ],
        [
          "莱昂·贝克尔",
          "Leon Becker",
          "德国",
          "W",
          "w_finisher",
          84,
          "R"
        ],
        [
          "陈子昂",
          "Chen Ziang",
          "中国",
          "ST",
          "st_false9",
          84,
          "R"
        ],
        [
          "田博文",
          "Tian Bowen",
          "中国",
          "ST",
          "st_false9",
          84,
          "R"
        ],
        [
          "安托万·迪皮伊",
          "Antoine Dupuis",
          "法国",
          "GK",
          "gk_sweeper",
          81,
          "R"
        ],
        [
          "约西普·西米奇",
          "Josip Simic",
          "克罗地亚",
          "CB",
          "cb_cover",
          81,
          "R"
        ],
        [
          "阿尔琼·奈尔",
          "Arjun Nair",
          "印度",
          "W",
          "w_engine",
          81,
          "L"
        ],
        [
          "唐修远",
          "Tang Xiuyuan",
          "中国",
          "CM",
          "cm_engine",
          81,
          "L"
        ],
        [
          "朱利安·佩兰",
          "Julien Perrin",
          "法国",
          "ST",
          "st_false9",
          81,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-22",
      "club": "青锋军团",
      "clubEn": "青锋军团",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "fast",
        "line": "low",
        "press": "low"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1087,
      "players": [
        [
          "拉米罗·阿科斯塔",
          "Ramiro Acosta",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          87,
          "L"
        ],
        [
          "安德烈亚·莫雷蒂",
          "Andrea Moretti",
          "意大利",
          "W",
          "fb_attacking",
          87,
          "R"
        ],
        [
          "山田大辉",
          "Daiki Yamada",
          "日本",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "伊克尔·维加",
          "Iker Vega",
          "西班牙",
          "CB",
          "cb_cover",
          85,
          "R"
        ],
        [
          "巴勃罗·纳瓦罗",
          "Pablo Navarro",
          "西班牙",
          "CB",
          "cb_ballplaying",
          85,
          "R"
        ],
        [
          "琴克·切利克",
          "Cenk Celik",
          "土耳其",
          "W",
          "w_playmaker",
          85,
          "L"
        ],
        [
          "奥斯卡·隆德",
          "Oscar Lund",
          "瑞典",
          "CM",
          "cm_playmaker",
          85,
          "R"
        ],
        [
          "阿德里安·吉拉尔",
          "Adrien Girard",
          "法国",
          "CM",
          "cm_creator",
          84,
          "R"
        ],
        [
          "阿古斯丁·阿吉雷",
          "Agustin Aguirre",
          "阿根廷",
          "CM",
          "cm_engine",
          84,
          "L"
        ],
        [
          "马蒂斯·勒纳尔",
          "Mathis Renard",
          "法国",
          "ST",
          "st_poacher",
          84,
          "R"
        ],
        [
          "叶嘉树",
          "Ye Jiashu",
          "中国",
          "ST",
          "st_false9",
          84,
          "R"
        ],
        [
          "卢卡斯·皮雷斯",
          "Lucas Pires",
          "巴西",
          "GK",
          "gk_shotstopper",
          81,
          "R"
        ],
        [
          "阿古斯丁·基罗加",
          "Agustin Quiroga",
          "阿根廷",
          "CB",
          "cb_ballplaying",
          81,
          "R"
        ],
        [
          "通德·奥卡福",
          "Tunde Okafor",
          "尼日利亚",
          "W",
          "fb_attacking",
          81,
          "L"
        ],
        [
          "陈云舟",
          "Chen Yunzhou",
          "中国",
          "CM",
          "cm_box2box",
          81,
          "R"
        ],
        [
          "阿卜杜·迪亚洛",
          "Abdou Diallo",
          "塞内加尔",
          "ST",
          "st_false9",
          81,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-23",
      "club": "风暴之队",
      "clubEn": "风暴之队",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "mid"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1093,
      "players": [
        [
          "程泽宇",
          "Cheng Zeyu",
          "中国",
          "GK",
          "gk_wall",
          88,
          "R"
        ],
        [
          "格奥尔基·安格洛夫",
          "Georgi Angelov",
          "保加利亚",
          "W",
          "fb_playmaker",
          88,
          "R"
        ],
        [
          "佛朗哥·阿科斯塔",
          "Franco Acosta",
          "阿根廷",
          "CB",
          "cb_stopper",
          88,
          "R"
        ],
        [
          "亚乌·阿桑特",
          "Yaw Asante",
          "加纳",
          "CB",
          "cb_stopper",
          86,
          "R"
        ],
        [
          "杨启航",
          "Yang Qihang",
          "中国",
          "W",
          "w_engine",
          86,
          "R"
        ],
        [
          "田承宇",
          "Tian Chengyu",
          "中国",
          "W",
          "w_playmaker",
          86,
          "R"
        ],
        [
          "奥马尔·哈达德",
          "Omar Haddad",
          "摩洛哥",
          "CM",
          "cm_creator",
          86,
          "R"
        ],
        [
          "朴道贤",
          "Park Dohyun",
          "韩国",
          "CM",
          "cm_playmaker",
          85,
          "R"
        ],
        [
          "钟博文",
          "Zhong Bowen",
          "中国",
          "W",
          "w_playmaker",
          85,
          "R"
        ],
        [
          "乌斯曼·萨尔",
          "Ousmane Sarr",
          "塞内加尔",
          "ST",
          "st_poacher",
          85,
          "R"
        ],
        [
          "马格努斯·林德",
          "Magnus Lind",
          "瑞典",
          "ST",
          "st_false9",
          85,
          "R"
        ],
        [
          "米克尔·尼尔松",
          "Mikkel Nilsson",
          "瑞典",
          "GK",
          "gk_shotstopper",
          82,
          "R"
        ],
        [
          "芬恩·梅森",
          "Finn Mason",
          "英格兰",
          "CB",
          "cb_ballplaying",
          82,
          "R"
        ],
        [
          "金书俊",
          "Kim Seojun",
          "韩国",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "高桥海斗",
          "Kaito Takahashi",
          "日本",
          "CM",
          "cm_creator",
          82,
          "R"
        ],
        [
          "莱昂·凯勒",
          "Leon Keller",
          "德国",
          "ST",
          "st_target",
          82,
          "R"
        ]
      ]
    },
    {
      "id": "cup-champions-24",
      "club": "长弓青年",
      "clubEn": "长弓青年",
      "season": "",
      "coach": "生成教练",
      "tier": "S",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "normal",
        "line": "low",
        "press": "low"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1100,
      "players": [
        [
          "约西普·伊利奇",
          "Josip Ilic",
          "克罗地亚",
          "GK",
          "gk_sweeper",
          88,
          "R"
        ],
        [
          "埃米利亚诺·索萨",
          "Emiliano Sosa",
          "阿根廷",
          "CB",
          "cb_stopper",
          88,
          "R"
        ],
        [
          "谢赫·盖耶",
          "Cheikh Gueye",
          "塞内加尔",
          "CB",
          "cb_stopper",
          88,
          "R"
        ],
        [
          "奥比纳·巴洛贡",
          "Obinna Balogun",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          86,
          "R"
        ],
        [
          "米兰·巴比奇",
          "Milan Babic",
          "克罗地亚",
          "W",
          "w_crosser",
          86,
          "L"
        ],
        [
          "卡里姆·伊德里西",
          "Karim Idrissi",
          "摩洛哥",
          "CM",
          "cm_engine",
          86,
          "L"
        ],
        [
          "谢赫·法尔",
          "Cheikh Fall",
          "塞内加尔",
          "CM",
          "cm_destroyer",
          86,
          "R"
        ],
        [
          "瑞安·维尔",
          "Ryan Vale",
          "英格兰",
          "W",
          "fb_attacking",
          85,
          "L"
        ],
        [
          "雷南·科斯塔",
          "Renan Costa",
          "巴西",
          "W",
          "w_dribbler",
          85,
          "R"
        ],
        [
          "约纳斯·阿尔布雷希特",
          "Jonas Albrecht",
          "德国",
          "ST",
          "st_false9",
          85,
          "L"
        ],
        [
          "哈维尔·帕斯夸尔",
          "Javier Pascual",
          "西班牙",
          "W",
          "w_finisher",
          85,
          "R"
        ],
        [
          "贡萨洛·梅迪纳",
          "Gonzalo Medina",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          82,
          "R"
        ],
        [
          "伊费亚尼·埃泽",
          "Ifeanyi Eze",
          "尼日利亚",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "保罗·莱曼",
          "Paul Lehmann",
          "德国",
          "W",
          "fb_playmaker",
          82,
          "R"
        ],
        [
          "若昂·特谢拉",
          "Joao Teixeira",
          "巴西",
          "CM",
          "cm_destroyer",
          82,
          "R"
        ],
        [
          "达里奥·维加",
          "Dario Vega",
          "西班牙",
          "ST",
          "st_target",
          82,
          "R"
        ]
      ]
    }
  ]
}
