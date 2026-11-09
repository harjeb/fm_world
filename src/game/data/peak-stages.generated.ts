// 由 scripts/generate-peak-stages.ts 生成，请勿手改。
// 全局种子 0x5eed2026，所有玩家共享同一套 100 关对手。
import type { LegendTeamDef } from './legend-teams.ts'

export type PeakStageDef = {
  stage: number
  targetCa: number
  actualCa: number
  kind: 'generated' | 'national'
  team: LegendTeamDef
}

export const PEAK_STAGES: PeakStageDef[] = [
  {
    "stage": 1,
    "targetCa": 350,
    "actualCa": 347.3731835629018,
    "kind": "generated",
    "team": {
      "id": "peak-1",
      "club": "林海先锋",
      "clubEn": "林海先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "normal",
        "line": "low",
        "press": "low"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 350,
      "players": [
        [
          "凯莱奇·巴洛贡",
          "Kelechi Balogun",
          "尼日利亚",
          "GK",
          "gk_shotstopper",
          45,
          "R"
        ],
        [
          "阿尔达·卡亚",
          "Arda Kaya",
          "土耳其",
          "W",
          "fb_attacking",
          45,
          "R"
        ],
        [
          "萨米尔·萨利赫",
          "Samir Saleh",
          "摩洛哥",
          "CB",
          "cb_cover",
          45,
          "R"
        ],
        [
          "卢卡·马尔凯蒂",
          "Luca Marchetti",
          "意大利",
          "CB",
          "cb_cover",
          43,
          "R"
        ],
        [
          "布鲁诺·皮雷斯",
          "Bruno Pires",
          "巴西",
          "W",
          "fb_attacking",
          43,
          "R"
        ],
        [
          "通德·恩沃苏",
          "Tunde Nwosu",
          "尼日利亚",
          "CM",
          "cm_creator",
          43,
          "R"
        ],
        [
          "高文博",
          "Gao Wenbo",
          "中国",
          "CM",
          "cm_mezzala",
          43,
          "R"
        ],
        [
          "佛朗哥·基罗加",
          "Franco Quiroga",
          "阿根廷",
          "W",
          "w_crosser",
          42,
          "L"
        ],
        [
          "尹宇镇",
          "Yoon Woojin",
          "韩国",
          "CM",
          "cm_creator",
          42,
          "R"
        ],
        [
          "克莱芒·勒费弗尔",
          "Clement Lefevre",
          "法国",
          "W",
          "fb_attacking",
          42,
          "L"
        ],
        [
          "奥马尔·哈达德",
          "Omar Haddad",
          "摩洛哥",
          "ST",
          "st_false9",
          42,
          "L"
        ],
        [
          "拉维·夏尔马",
          "Ravi Sharma",
          "印度",
          "GK",
          "gk_wall",
          40,
          "L"
        ],
        [
          "奥斯卡·达尔",
          "Oscar Dahl",
          "瑞典",
          "CB",
          "cb_ballplaying",
          40,
          "R"
        ],
        [
          "蒂姆·魏斯",
          "Tim Weiss",
          "德国",
          "W",
          "w_playmaker",
          40,
          "R"
        ],
        [
          "许景行",
          "Xu Jingxing",
          "中国",
          "CM",
          "cm_mezzala",
          40,
          "R"
        ],
        [
          "穆萨·萨尔",
          "Moussa Sarr",
          "塞内加尔",
          "ST",
          "st_poacher",
          40,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 2,
    "targetCa": 360,
    "actualCa": 359.20187246403435,
    "kind": "generated",
    "team": {
      "id": "peak-2",
      "club": "霜原矿工",
      "clubEn": "霜原矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 360,
      "players": [
        [
          "乌戈·卡斯特罗",
          "Hugo Castro",
          "西班牙",
          "GK",
          "gk_wall",
          47,
          "R"
        ],
        [
          "杨子昂",
          "Yang Ziang",
          "中国",
          "W",
          "w_engine",
          47,
          "R"
        ],
        [
          "凯雷姆·沙欣",
          "Kerem Sahin",
          "土耳其",
          "CB",
          "cb_stopper",
          47,
          "R"
        ],
        [
          "保罗·哈特曼",
          "Paul Hartmann",
          "德国",
          "CB",
          "cb_stopper",
          45,
          "R"
        ],
        [
          "桑德·埃克斯特伦",
          "Sander Ekstrom",
          "瑞典",
          "W",
          "w_crosser",
          45,
          "R"
        ],
        [
          "罗汉·奈尔",
          "Rohan Nair",
          "印度",
          "CM",
          "cm_box2box",
          45,
          "L"
        ],
        [
          "阿德里安·戈蒂埃",
          "Adrien Gauthier",
          "法国",
          "CM",
          "cm_box2box",
          45,
          "R"
        ],
        [
          "维克托·埃克斯特伦",
          "Viktor Ekstrom",
          "瑞典",
          "W",
          "w_dribbler",
          44,
          "R"
        ],
        [
          "塞尔吉奥·纳瓦罗",
          "Sergio Navarro",
          "西班牙",
          "CM",
          "cm_creator",
          44,
          "R"
        ],
        [
          "奥马尔·曼苏尔",
          "Omar Mansour",
          "摩洛哥",
          "W",
          "w_playmaker",
          44,
          "R"
        ],
        [
          "克莱芒·迪皮伊",
          "Clement Dupuis",
          "法国",
          "ST",
          "st_finisher",
          44,
          "R"
        ],
        [
          "钟修远",
          "Zhong Xiuyuan",
          "中国",
          "GK",
          "gk_sweeper",
          41,
          "R"
        ],
        [
          "布拉克·厄兹蒂尔克",
          "Burak Ozturk",
          "土耳其",
          "CB",
          "cb_ballplaying",
          41,
          "R"
        ],
        [
          "崔道贤",
          "Choi Dohyun",
          "韩国",
          "W",
          "w_playmaker",
          41,
          "L"
        ],
        [
          "何修远",
          "He Xiuyuan",
          "中国",
          "CM",
          "cm_destroyer",
          41,
          "R"
        ],
        [
          "马蒂斯·富尼耶",
          "Mathis Fournier",
          "法国",
          "ST",
          "st_target",
          41,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 3,
    "targetCa": 370,
    "actualCa": 371.40397419651066,
    "kind": "generated",
    "team": {
      "id": "peak-3",
      "club": "金桥流浪者",
      "clubEn": "金桥流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "mid"
      },
      "color": "#fde100",
      "accent": "#000000",
      "note": "PvE 生成球队",
      "targetCa": 370,
      "players": [
        [
          "洛伦佐·莫雷蒂",
          "Lorenzo Moretti",
          "意大利",
          "GK",
          "gk_sweeper",
          49,
          "R"
        ],
        [
          "周宇航",
          "Zhou Yuhang",
          "中国",
          "W",
          "fb_attacking",
          49,
          "R"
        ],
        [
          "陆博文",
          "Lu Bowen",
          "中国",
          "CB",
          "cb_ballplaying",
          49,
          "R"
        ],
        [
          "金宇镇",
          "Kim Woojin",
          "韩国",
          "CB",
          "cb_stopper",
          47,
          "R"
        ],
        [
          "芬恩·维尔",
          "Finn Vale",
          "英格兰",
          "CB",
          "cb_ballplaying",
          47,
          "R"
        ],
        [
          "加藤拓海",
          "Takumi Kato",
          "日本",
          "W",
          "fb_playmaker",
          47,
          "R"
        ],
        [
          "阿克塞尔·桑德贝里",
          "Axel Sandberg",
          "瑞典",
          "CM",
          "cm_box2box",
          47,
          "R"
        ],
        [
          "杰米·哈特",
          "Jamie Hart",
          "英格兰",
          "CM",
          "cm_mezzala",
          46,
          "L"
        ],
        [
          "罗知行",
          "Luo Zhixing",
          "中国",
          "CM",
          "cm_creator",
          46,
          "L"
        ],
        [
          "马特乌斯·科斯塔",
          "Matheus Costa",
          "巴西",
          "ST",
          "st_runner",
          46,
          "R"
        ],
        [
          "阿尤布·伊德里西",
          "Ayoub Idrissi",
          "摩洛哥",
          "ST",
          "st_false9",
          46,
          "R"
        ],
        [
          "亨里克·尼格伦",
          "Henrik Nygren",
          "瑞典",
          "GK",
          "gk_wall",
          43,
          "R"
        ],
        [
          "中村翔太",
          "Shota Nakamura",
          "日本",
          "CB",
          "cb_stopper",
          43,
          "R"
        ],
        [
          "欧文·普赖斯",
          "Owen Price",
          "英格兰",
          "W",
          "w_crosser",
          43,
          "L"
        ],
        [
          "拉米罗·基罗加",
          "Ramiro Quiroga",
          "阿根廷",
          "CM",
          "cm_playmaker",
          43,
          "L"
        ],
        [
          "罗汉·帕特尔",
          "Rohan Patel",
          "印度",
          "ST",
          "st_target",
          43,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 4,
    "targetCa": 385,
    "actualCa": 383.15364915824915,
    "kind": "generated",
    "team": {
      "id": "peak-4",
      "club": "北岸城",
      "clubEn": "北岸城",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "mid"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 385,
      "players": [
        [
          "马蒂斯·朗贝尔",
          "Mathis Lambert",
          "法国",
          "GK",
          "gk_shotstopper",
          51,
          "L"
        ],
        [
          "埃梅卡·巴洛贡",
          "Emeka Balogun",
          "尼日利亚",
          "W",
          "w_dribbler",
          51,
          "L"
        ],
        [
          "马马杜·恩迪亚耶",
          "Mamadou Ndiaye",
          "塞内加尔",
          "CB",
          "cb_ballplaying",
          51,
          "L"
        ],
        [
          "安托万·吉拉尔",
          "Antoine Girard",
          "法国",
          "CB",
          "cb_stopper",
          49,
          "L"
        ],
        [
          "哈维尔·加拉多",
          "Javier Gallardo",
          "西班牙",
          "CB",
          "cb_ballplaying",
          49,
          "R"
        ],
        [
          "马丁·安格洛夫",
          "Martin Angelov",
          "保加利亚",
          "W",
          "w_engine",
          49,
          "L"
        ],
        [
          "布拉克·阿尔斯兰",
          "Burak Arslan",
          "土耳其",
          "CM",
          "cm_engine",
          49,
          "R"
        ],
        [
          "尼古拉斯·卡夫雷拉",
          "Nicolas Cabrera",
          "阿根廷",
          "CM",
          "cm_mezzala",
          48,
          "R"
        ],
        [
          "约纳斯·凯勒",
          "Jonas Keller",
          "德国",
          "CM",
          "cm_box2box",
          48,
          "L"
        ],
        [
          "泰奥·吉拉尔",
          "Theo Girard",
          "法国",
          "ST",
          "st_poacher",
          48,
          "R"
        ],
        [
          "费利佩·特谢拉",
          "Felipe Teixeira",
          "巴西",
          "ST",
          "st_runner",
          48,
          "L"
        ],
        [
          "伊藤健太",
          "Kenta Ito",
          "日本",
          "GK",
          "gk_wall",
          45,
          "L"
        ],
        [
          "尼克拉斯·贝克尔",
          "Niklas Becker",
          "德国",
          "CB",
          "cb_ballplaying",
          45,
          "R"
        ],
        [
          "夸梅·门萨",
          "Kwame Mensah",
          "加纳",
          "W",
          "w_crosser",
          45,
          "L"
        ],
        [
          "维克托·林德奎斯特",
          "Viktor Lindqvist",
          "瑞典",
          "CM",
          "cm_engine",
          45,
          "L"
        ],
        [
          "韩博文",
          "Han Bowen",
          "中国",
          "ST",
          "st_target",
          45,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 5,
    "targetCa": 395,
    "actualCa": 398.6552710162228,
    "kind": "generated",
    "team": {
      "id": "peak-5",
      "club": "赤焰竞技",
      "clubEn": "赤焰竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 395,
      "players": [
        [
          "伊费亚尼·奥卡福",
          "Ifeanyi Okafor",
          "尼日利亚",
          "GK",
          "gk_sweeper",
          53,
          "L"
        ],
        [
          "阿尤布·伊德里西",
          "Ayoub Idrissi",
          "摩洛哥",
          "W",
          "w_playmaker",
          53,
          "R"
        ],
        [
          "托马斯·贝尼特斯",
          "Tomas Benitez",
          "阿根廷",
          "CB",
          "cb_cover",
          53,
          "R"
        ],
        [
          "苏云舟",
          "Su Yunzhou",
          "中国",
          "CB",
          "cb_cover",
          51,
          "R"
        ],
        [
          "卢卡斯·皮雷斯",
          "Lucas Pires",
          "巴西",
          "W",
          "fb_playmaker",
          51,
          "R"
        ],
        [
          "周子昂",
          "Zhou Ziang",
          "中国",
          "CM",
          "cm_box2box",
          51,
          "R"
        ],
        [
          "陈牧野",
          "Chen Muye",
          "中国",
          "CM",
          "cm_creator",
          51,
          "L"
        ],
        [
          "朴泰熙",
          "Park Taehee",
          "韩国",
          "W",
          "fb_attacking",
          50,
          "R"
        ],
        [
          "蒂亚戈·莫拉",
          "Thiago Moura",
          "巴西",
          "CM",
          "cm_playmaker",
          50,
          "R"
        ],
        [
          "彭雨辰",
          "Peng Yuchen",
          "中国",
          "W",
          "w_finisher",
          50,
          "R"
        ],
        [
          "古斯塔沃·皮雷斯",
          "Gustavo Pires",
          "巴西",
          "ST",
          "st_false9",
          50,
          "L"
        ],
        [
          "马特奥·普列托",
          "Mateo Prieto",
          "西班牙",
          "GK",
          "gk_sweeper",
          47,
          "R"
        ],
        [
          "莫里茨·克劳泽",
          "Moritz Krause",
          "德国",
          "CB",
          "cb_ballplaying",
          47,
          "R"
        ],
        [
          "安特·巴比奇",
          "Ante Babic",
          "克罗地亚",
          "W",
          "w_crosser",
          47,
          "R"
        ],
        [
          "凯莱奇·奥涅卡",
          "Kelechi Onyeka",
          "尼日利亚",
          "CM",
          "cm_engine",
          47,
          "R"
        ],
        [
          "加藤翔太",
          "Shota Kato",
          "日本",
          "ST",
          "st_runner",
          47,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 6,
    "targetCa": 405,
    "actualCa": 408.60173894092435,
    "kind": "generated",
    "team": {
      "id": "peak-6",
      "club": "黑潮流浪者",
      "clubEn": "黑潮流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 405,
      "players": [
        [
          "奥斯卡·尼尔松",
          "Oscar Nilsson",
          "瑞典",
          "GK",
          "gk_sweeper",
          54,
          "L"
        ],
        [
          "瑞安·弗莱彻",
          "Ryan Fletcher",
          "英格兰",
          "W",
          "w_dribbler",
          54,
          "L"
        ],
        [
          "路易·吉拉尔",
          "Louis Girard",
          "法国",
          "CB",
          "cb_ballplaying",
          54,
          "R"
        ],
        [
          "凯莱奇·埃泽",
          "Kelechi Eze",
          "尼日利亚",
          "CB",
          "cb_stopper",
          52,
          "L"
        ],
        [
          "唐子昂",
          "Tang Ziang",
          "中国",
          "W",
          "w_engine",
          52,
          "L"
        ],
        [
          "华金·卡夫雷拉",
          "Joaquin Cabrera",
          "阿根廷",
          "W",
          "w_engine",
          52,
          "R"
        ],
        [
          "罗嘉树",
          "Luo Jiashu",
          "中国",
          "CM",
          "cm_box2box",
          52,
          "R"
        ],
        [
          "杰米·特纳",
          "Jamie Turner",
          "英格兰",
          "CM",
          "cm_box2box",
          51,
          "R"
        ],
        [
          "乌斯曼·迪奥普",
          "Ousmane Diop",
          "塞内加尔",
          "W",
          "w_finisher",
          51,
          "R"
        ],
        [
          "尼科·普列托",
          "Nico Prieto",
          "西班牙",
          "ST",
          "st_runner",
          51,
          "R"
        ],
        [
          "瑞安·帕克",
          "Ryan Parker",
          "英格兰",
          "ST",
          "st_poacher",
          51,
          "R"
        ],
        [
          "蒂亚戈·莫拉",
          "Thiago Moura",
          "巴西",
          "GK",
          "gk_shotstopper",
          48,
          "R"
        ],
        [
          "约纳斯·布兰特",
          "Jonas Brandt",
          "德国",
          "CB",
          "cb_ballplaying",
          48,
          "R"
        ],
        [
          "赵泽宇",
          "Zhao Zeyu",
          "中国",
          "W",
          "w_playmaker",
          48,
          "R"
        ],
        [
          "达里奥·加拉多",
          "Dario Gallardo",
          "西班牙",
          "CM",
          "cm_engine",
          48,
          "R"
        ],
        [
          "通德·奥涅卡",
          "Tunde Onyeka",
          "尼日利亚",
          "ST",
          "st_false9",
          48,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 7,
    "targetCa": 415,
    "actualCa": 421.39841860422405,
    "kind": "generated",
    "team": {
      "id": "peak-7",
      "club": "青锋竞技会",
      "clubEn": "青锋竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "slow",
        "line": "low",
        "press": "high"
      },
      "color": "#004170",
      "accent": "#da291c",
      "note": "PvE 生成球队",
      "targetCa": 415,
      "players": [
        [
          "贡萨洛·基罗加",
          "Gonzalo Quiroga",
          "阿根廷",
          "GK",
          "gk_wall",
          55,
          "R"
        ],
        [
          "韩思远",
          "Han Siyuan",
          "中国",
          "W",
          "w_crosser",
          55,
          "R"
        ],
        [
          "伊费亚尼·阿德耶米",
          "Ifeanyi Adeyemi",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          55,
          "R"
        ],
        [
          "郑宇镇",
          "Jung Woojin",
          "韩国",
          "CB",
          "cb_stopper",
          53,
          "L"
        ],
        [
          "苏承宇",
          "Su Chengyu",
          "中国",
          "W",
          "fb_attacking",
          53,
          "R"
        ],
        [
          "田宇航",
          "Tian Yuhang",
          "中国",
          "CM",
          "cm_creator",
          53,
          "R"
        ],
        [
          "诺亚·弗莱彻",
          "Noah Fletcher",
          "英格兰",
          "W",
          "fb_playmaker",
          53,
          "L"
        ],
        [
          "阿德里安·维加",
          "Adrian Vega",
          "西班牙",
          "CM",
          "cm_engine",
          52,
          "R"
        ],
        [
          "埃米尔·里希特",
          "Emil Richter",
          "德国",
          "CM",
          "cm_mezzala",
          52,
          "R"
        ],
        [
          "奇迪·奥科耶",
          "Chidi Okoye",
          "尼日利亚",
          "W",
          "w_dribbler",
          52,
          "R"
        ],
        [
          "亚尼斯·佩兰",
          "Yanis Perrin",
          "法国",
          "ST",
          "st_poacher",
          52,
          "R"
        ],
        [
          "路易·勒纳尔",
          "Louis Renard",
          "法国",
          "GK",
          "gk_sweeper",
          49,
          "R"
        ],
        [
          "马格努斯·达尔",
          "Magnus Dahl",
          "瑞典",
          "CB",
          "cb_cover",
          49,
          "R"
        ],
        [
          "芬恩·里德",
          "Finn Reid",
          "英格兰",
          "W",
          "fb_playmaker",
          49,
          "R"
        ],
        [
          "加藤海斗",
          "Kaito Kato",
          "日本",
          "CM",
          "cm_engine",
          49,
          "R"
        ],
        [
          "陆亦凡",
          "Lu Yifan",
          "中国",
          "ST",
          "st_poacher",
          49,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 8,
    "targetCa": 430,
    "actualCa": 437.82520809611265,
    "kind": "generated",
    "team": {
      "id": "peak-8",
      "club": "白塔体育",
      "clubEn": "白塔体育",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 430,
      "players": [
        [
          "阿尔瓦罗·罗梅罗",
          "Alvaro Romero",
          "西班牙",
          "GK",
          "gk_wall",
          56,
          "R"
        ],
        [
          "高泽宇",
          "Gao Zeyu",
          "中国",
          "W",
          "w_finisher",
          56,
          "R"
        ],
        [
          "莫里茨·福格尔",
          "Moritz Vogel",
          "德国",
          "CB",
          "cb_stopper",
          56,
          "R"
        ],
        [
          "阿尤布·贝纳利",
          "Ayoub Benali",
          "摩洛哥",
          "CB",
          "cb_cover",
          54,
          "R"
        ],
        [
          "乌戈·奥尔特加",
          "Hugo Ortega",
          "西班牙",
          "W",
          "w_finisher",
          54,
          "R"
        ],
        [
          "埃利亚斯·阿尔布雷希特",
          "Elias Albrecht",
          "德国",
          "CM",
          "cm_mezzala",
          54,
          "R"
        ],
        [
          "埃利亚斯·福斯",
          "Elias Voss",
          "德国",
          "W",
          "w_dribbler",
          54,
          "R"
        ],
        [
          "维托尔·费雷拉",
          "Vitor Ferreira",
          "巴西",
          "CM",
          "cm_playmaker",
          53,
          "R"
        ],
        [
          "达维德·马尔凯蒂",
          "Davide Marchetti",
          "意大利",
          "CM",
          "cm_creator",
          53,
          "R"
        ],
        [
          "华金·卡夫雷拉",
          "Joaquin Cabrera",
          "阿根廷",
          "W",
          "w_dribbler",
          53,
          "L"
        ],
        [
          "马丁·彼得罗夫",
          "Martin Petrov",
          "保加利亚",
          "ST",
          "st_finisher",
          53,
          "R"
        ],
        [
          "阿尔瓦罗·埃雷拉",
          "Alvaro Herrera",
          "西班牙",
          "GK",
          "gk_shotstopper",
          50,
          "R"
        ],
        [
          "尼科洛·里奇",
          "Nicolo Ricci",
          "意大利",
          "CB",
          "cb_cover",
          50,
          "R"
        ],
        [
          "叶子昂",
          "Ye Ziang",
          "中国",
          "W",
          "w_playmaker",
          50,
          "R"
        ],
        [
          "通德·奥科耶",
          "Tunde Okoye",
          "尼日利亚",
          "CM",
          "cm_creator",
          50,
          "R"
        ],
        [
          "乌切·阿德耶米",
          "Uche Adeyemi",
          "尼日利亚",
          "ST",
          "st_target",
          50,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 9,
    "targetCa": 440,
    "actualCa": 438.15582506580955,
    "kind": "generated",
    "team": {
      "id": "peak-9",
      "club": "东岭竞技",
      "clubEn": "东岭竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "slow",
        "line": "high",
        "press": "mid"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 440,
      "players": [
        [
          "韩启航",
          "Han Qihang",
          "中国",
          "GK",
          "gk_wall",
          56,
          "R"
        ],
        [
          "耶斯佩尔·林德",
          "Jesper Lind",
          "瑞典",
          "CB",
          "cb_stopper",
          56,
          "R"
        ],
        [
          "利奥·梅森",
          "Leo Mason",
          "英格兰",
          "CB",
          "cb_ballplaying",
          56,
          "L"
        ],
        [
          "约纳斯·凯勒",
          "Jonas Keller",
          "德国",
          "CB",
          "cb_cover",
          54,
          "R"
        ],
        [
          "伊万·伊利奇",
          "Ivan Ilic",
          "克罗地亚",
          "W",
          "w_playmaker",
          54,
          "R"
        ],
        [
          "乌切·奥科耶",
          "Uche Okoye",
          "尼日利亚",
          "CM",
          "cm_mezzala",
          54,
          "R"
        ],
        [
          "哈维尔·卡诺",
          "Javier Cano",
          "西班牙",
          "CM",
          "cm_box2box",
          54,
          "R"
        ],
        [
          "阿尤布·沙基尔",
          "Ayoub Chakir",
          "摩洛哥",
          "CM",
          "cm_destroyer",
          53,
          "R"
        ],
        [
          "杰克·哈特",
          "Jack Hart",
          "英格兰",
          "W",
          "fb_attacking",
          53,
          "L"
        ],
        [
          "乌斯曼·迪亚洛",
          "Ousmane Diallo",
          "塞内加尔",
          "ST",
          "st_false9",
          53,
          "L"
        ],
        [
          "中村莲",
          "Ren Nakamura",
          "日本",
          "ST",
          "st_finisher",
          53,
          "L"
        ],
        [
          "达里奥·纳瓦罗",
          "Dario Navarro",
          "西班牙",
          "GK",
          "gk_wall",
          50,
          "R"
        ],
        [
          "费利克斯·贝克尔",
          "Felix Becker",
          "德国",
          "CB",
          "cb_cover",
          50,
          "R"
        ],
        [
          "黄俊昊",
          "Hwang Junho",
          "韩国",
          "W",
          "w_finisher",
          50,
          "R"
        ],
        [
          "安德斯·达尔",
          "Anders Dahl",
          "瑞典",
          "CM",
          "cm_mezzala",
          50,
          "R"
        ],
        [
          "阿德里安·梅西耶",
          "Adrien Mercier",
          "法国",
          "ST",
          "st_runner",
          50,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 10,
    "targetCa": 450,
    "actualCa": 455.1712702907866,
    "kind": "generated",
    "team": {
      "id": "peak-10",
      "club": "赤焰海港",
      "clubEn": "赤焰海港",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 450,
      "players": [
        [
          "伊克尔·罗梅罗",
          "Iker Romero",
          "西班牙",
          "GK",
          "gk_sweeper",
          57,
          "R"
        ],
        [
          "苏尼尔·夏尔马",
          "Sunil Sharma",
          "印度",
          "W",
          "fb_playmaker",
          57,
          "R"
        ],
        [
          "崔书俊",
          "Choi Seojun",
          "韩国",
          "CB",
          "cb_ballplaying",
          57,
          "R"
        ],
        [
          "铃木翔太",
          "Shota Suzuki",
          "日本",
          "CB",
          "cb_cover",
          55,
          "R"
        ],
        [
          "卡勒姆·巴克",
          "Callum Barker",
          "英格兰",
          "W",
          "fb_attacking",
          55,
          "R"
        ],
        [
          "卢卡斯·特谢拉",
          "Lucas Teixeira",
          "巴西",
          "CM",
          "cm_box2box",
          55,
          "L"
        ],
        [
          "优素福·沙欣",
          "Yusuf Sahin",
          "土耳其",
          "CM",
          "cm_destroyer",
          55,
          "L"
        ],
        [
          "若昂·努内斯",
          "Joao Nunes",
          "巴西",
          "W",
          "w_engine",
          54,
          "R"
        ],
        [
          "尹成珉",
          "Yoon Sungmin",
          "韩国",
          "CM",
          "cm_destroyer",
          54,
          "R"
        ],
        [
          "马特奥·卡诺",
          "Mateo Cano",
          "西班牙",
          "W",
          "fb_attacking",
          54,
          "R"
        ],
        [
          "钟嘉树",
          "Zhong Jiashu",
          "中国",
          "ST",
          "st_runner",
          54,
          "L"
        ],
        [
          "彼得·霍尔瓦特",
          "Petar Horvat",
          "克罗地亚",
          "GK",
          "gk_shotstopper",
          51,
          "R"
        ],
        [
          "恩佐·吉拉尔",
          "Enzo Girard",
          "法国",
          "CB",
          "cb_stopper",
          51,
          "R"
        ],
        [
          "安德烈亚·莫雷蒂",
          "Andrea Moretti",
          "意大利",
          "W",
          "w_crosser",
          51,
          "L"
        ],
        [
          "中村阳斗",
          "Haruto Nakamura",
          "日本",
          "CM",
          "cm_mezzala",
          51,
          "R"
        ],
        [
          "魏云舟",
          "Wei Yunzhou",
          "中国",
          "ST",
          "st_poacher",
          51,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 11,
    "targetCa": 450,
    "actualCa": 455.6724084236302,
    "kind": "generated",
    "team": {
      "id": "peak-11",
      "club": "远帆竞技会",
      "clubEn": "远帆竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 450,
      "players": [
        [
          "巴斯蒂安·迪皮伊",
          "Bastien Dupuis",
          "法国",
          "GK",
          "gk_wall",
          57,
          "R"
        ],
        [
          "埃米尔·莱曼",
          "Emil Lehmann",
          "德国",
          "W",
          "w_playmaker",
          57,
          "R"
        ],
        [
          "奥马尔·伊德里西",
          "Omar Idrissi",
          "摩洛哥",
          "CB",
          "cb_stopper",
          57,
          "R"
        ],
        [
          "朱利安·马尔尚",
          "Julien Marchand",
          "法国",
          "CB",
          "cb_stopper",
          55,
          "R"
        ],
        [
          "奎西·奥塞",
          "Kwesi Osei",
          "加纳",
          "W",
          "w_dribbler",
          55,
          "L"
        ],
        [
          "黄俊昊",
          "Hwang Junho",
          "韩国",
          "CM",
          "cm_playmaker",
          55,
          "L"
        ],
        [
          "钟修远",
          "Zhong Xiuyuan",
          "中国",
          "W",
          "w_dribbler",
          55,
          "R"
        ],
        [
          "利奥·维尔",
          "Leo Vale",
          "英格兰",
          "CM",
          "cm_engine",
          54,
          "R"
        ],
        [
          "秦天佑",
          "Qin Tianyou",
          "中国",
          "CM",
          "cm_mezzala",
          54,
          "L"
        ],
        [
          "佐藤海斗",
          "Kaito Sato",
          "日本",
          "W",
          "w_crosser",
          54,
          "R"
        ],
        [
          "阿克塞尔·斯特兰德",
          "Axel Strand",
          "瑞典",
          "ST",
          "st_target",
          54,
          "R"
        ],
        [
          "若昂·科斯塔",
          "Joao Costa",
          "巴西",
          "GK",
          "gk_wall",
          51,
          "R"
        ],
        [
          "陆泽宇",
          "Lu Zeyu",
          "中国",
          "CB",
          "cb_ballplaying",
          51,
          "R"
        ],
        [
          "通德·奥涅卡",
          "Tunde Onyeka",
          "尼日利亚",
          "W",
          "w_crosser",
          51,
          "R"
        ],
        [
          "欧文·贝内特",
          "Owen Bennett",
          "英格兰",
          "CM",
          "cm_mezzala",
          51,
          "R"
        ],
        [
          "安特·武科维奇",
          "Ante Vukovic",
          "克罗地亚",
          "ST",
          "st_runner",
          51,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 12,
    "targetCa": 460,
    "actualCa": 453.0057441077441,
    "kind": "generated",
    "team": {
      "id": "peak-12",
      "club": "赤焰矿工",
      "clubEn": "赤焰矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 460,
      "players": [
        [
          "马格努斯·隆德",
          "Magnus Lund",
          "瑞典",
          "GK",
          "gk_shotstopper",
          57,
          "R"
        ],
        [
          "萨米尔·沙基尔",
          "Samir Chakir",
          "摩洛哥",
          "W",
          "w_dribbler",
          57,
          "R"
        ],
        [
          "李成珉",
          "Lee Sungmin",
          "韩国",
          "CB",
          "cb_cover",
          57,
          "R"
        ],
        [
          "刘易斯·科尔",
          "Lewis Cole",
          "英格兰",
          "CB",
          "cb_stopper",
          55,
          "L"
        ],
        [
          "冯天佑",
          "Feng Tianyou",
          "中国",
          "W",
          "w_engine",
          55,
          "R"
        ],
        [
          "朱利安·卢梭",
          "Julien Rousseau",
          "法国",
          "CM",
          "cm_box2box",
          55,
          "R"
        ],
        [
          "程修远",
          "Cheng Xiuyuan",
          "中国",
          "W",
          "fb_attacking",
          55,
          "R"
        ],
        [
          "亨里克·隆德",
          "Henrik Lund",
          "瑞典",
          "CM",
          "cm_engine",
          54,
          "R"
        ],
        [
          "伊克尔·奥尔特加",
          "Iker Ortega",
          "西班牙",
          "CM",
          "cm_mezzala",
          54,
          "R"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "W",
          "w_crosser",
          54,
          "R"
        ],
        [
          "费利佩·特谢拉",
          "Felipe Teixeira",
          "巴西",
          "ST",
          "st_false9",
          54,
          "L"
        ],
        [
          "圣地亚哥·索萨",
          "Santiago Sosa",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          51,
          "R"
        ],
        [
          "拉尔斯·尼格伦",
          "Lars Nygren",
          "瑞典",
          "CB",
          "cb_stopper",
          51,
          "L"
        ],
        [
          "李泰熙",
          "Lee Taehee",
          "韩国",
          "W",
          "w_crosser",
          51,
          "R"
        ],
        [
          "达里奥·卡诺",
          "Dario Cano",
          "西班牙",
          "CM",
          "cm_box2box",
          51,
          "R"
        ],
        [
          "沈牧野",
          "Shen Muye",
          "中国",
          "ST",
          "st_false9",
          51,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 13,
    "targetCa": 470,
    "actualCa": 470.6323836271809,
    "kind": "generated",
    "team": {
      "id": "peak-13",
      "club": "晨星足球会",
      "clubEn": "晨星足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "slow",
        "line": "high",
        "press": "mid"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 470,
      "players": [
        [
          "彭思远",
          "Peng Siyuan",
          "中国",
          "GK",
          "gk_wall",
          58,
          "R"
        ],
        [
          "刘易斯·道森",
          "Lewis Dawson",
          "英格兰",
          "W",
          "w_playmaker",
          58,
          "R"
        ],
        [
          "马特奥·奥尔特加",
          "Mateo Ortega",
          "西班牙",
          "CB",
          "cb_cover",
          58,
          "R"
        ],
        [
          "安德烈亚·巴罗内",
          "Andrea Barone",
          "意大利",
          "CB",
          "cb_cover",
          56,
          "R"
        ],
        [
          "欧文·特纳",
          "Owen Turner",
          "英格兰",
          "W",
          "w_dribbler",
          56,
          "R"
        ],
        [
          "卢卡斯·魏斯",
          "Lukas Weiss",
          "德国",
          "W",
          "w_playmaker",
          56,
          "R"
        ],
        [
          "卢卡·费里",
          "Luca Ferri",
          "意大利",
          "CM",
          "cm_playmaker",
          56,
          "R"
        ],
        [
          "保罗·阿尔布雷希特",
          "Paul Albrecht",
          "德国",
          "CM",
          "cm_box2box",
          55,
          "R"
        ],
        [
          "李宇镇",
          "Lee Woojin",
          "韩国",
          "W",
          "w_dribbler",
          55,
          "R"
        ],
        [
          "凯·弗莱彻",
          "Kai Fletcher",
          "英格兰",
          "ST",
          "st_target",
          55,
          "R"
        ],
        [
          "瑞安·科尔",
          "Ryan Cole",
          "英格兰",
          "ST",
          "st_false9",
          55,
          "R"
        ],
        [
          "卢卡·丰塔纳",
          "Luca Fontana",
          "意大利",
          "GK",
          "gk_wall",
          52,
          "L"
        ],
        [
          "本·哈特",
          "Ben Hart",
          "英格兰",
          "CB",
          "cb_cover",
          52,
          "L"
        ],
        [
          "维托尔·科斯塔",
          "Vitor Costa",
          "巴西",
          "W",
          "fb_attacking",
          52,
          "R"
        ],
        [
          "卢卡斯·科斯塔",
          "Lucas Costa",
          "巴西",
          "CM",
          "cm_creator",
          52,
          "R"
        ],
        [
          "诺亚·里德",
          "Noah Reid",
          "英格兰",
          "ST",
          "st_poacher",
          52,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 14,
    "targetCa": 485,
    "actualCa": 490.9657461738597,
    "kind": "generated",
    "team": {
      "id": "peak-14",
      "club": "火种军团",
      "clubEn": "火种军团",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "mid"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 485,
      "players": [
        [
          "凯·科尔",
          "Kai Cole",
          "英格兰",
          "GK",
          "gk_sweeper",
          59,
          "R"
        ],
        [
          "高星河",
          "Gao Xinghe",
          "中国",
          "CB",
          "cb_stopper",
          59,
          "R"
        ],
        [
          "阿德·埃泽",
          "Ade Eze",
          "尼日利亚",
          "CB",
          "cb_stopper",
          59,
          "L"
        ],
        [
          "崔成珉",
          "Choi Sungmin",
          "韩国",
          "CB",
          "cb_stopper",
          57,
          "R"
        ],
        [
          "伊格纳西奥·贝尼特斯",
          "Ignacio Benitez",
          "阿根廷",
          "W",
          "fb_playmaker",
          57,
          "L"
        ],
        [
          "法比安·阿尔布雷希特",
          "Fabian Albrecht",
          "德国",
          "CM",
          "cm_creator",
          57,
          "L"
        ],
        [
          "尼古拉·科瓦奇",
          "Nikola Kovac",
          "克罗地亚",
          "CM",
          "cm_box2box",
          57,
          "L"
        ],
        [
          "瑞安·帕克",
          "Ryan Parker",
          "英格兰",
          "W",
          "w_crosser",
          56,
          "R"
        ],
        [
          "马克西姆·吉拉尔",
          "Maxime Girard",
          "法国",
          "W",
          "w_crosser",
          56,
          "R"
        ],
        [
          "蒂姆·魏斯",
          "Tim Weiss",
          "德国",
          "ST",
          "st_target",
          56,
          "L"
        ],
        [
          "冯牧野",
          "Feng Muye",
          "中国",
          "W",
          "w_engine",
          56,
          "R"
        ],
        [
          "华金·莱德斯马",
          "Joaquin Ledesma",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          53,
          "R"
        ],
        [
          "尼克拉斯·魏斯",
          "Niklas Weiss",
          "德国",
          "CB",
          "cb_stopper",
          53,
          "R"
        ],
        [
          "马马杜·法尔",
          "Mamadou Fall",
          "塞内加尔",
          "W",
          "fb_attacking",
          53,
          "L"
        ],
        [
          "方思远",
          "Fang Siyuan",
          "中国",
          "CM",
          "cm_creator",
          53,
          "R"
        ],
        [
          "阿尔琼·辛格",
          "Arjun Singh",
          "印度",
          "ST",
          "st_false9",
          53,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 15,
    "targetCa": 495,
    "actualCa": 486.3884334037344,
    "kind": "generated",
    "team": {
      "id": "peak-15",
      "club": "西湾矿工",
      "clubEn": "西湾矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 495,
      "players": [
        [
          "凯雷姆·沙欣",
          "Kerem Sahin",
          "土耳其",
          "GK",
          "gk_wall",
          59,
          "R"
        ],
        [
          "埃梅卡·奥科耶",
          "Emeka Okoye",
          "尼日利亚",
          "W",
          "w_engine",
          59,
          "R"
        ],
        [
          "雷南·席尔瓦",
          "Renan Silva",
          "巴西",
          "CB",
          "cb_cover",
          59,
          "L"
        ],
        [
          "若昂·莫拉",
          "Joao Moura",
          "巴西",
          "CB",
          "cb_cover",
          57,
          "L"
        ],
        [
          "蒂亚戈·塞拉",
          "Thiago Serra",
          "巴西",
          "W",
          "fb_playmaker",
          57,
          "R"
        ],
        [
          "罗汉·帕特尔",
          "Rohan Patel",
          "印度",
          "CM",
          "cm_mezzala",
          57,
          "R"
        ],
        [
          "梅赫梅特·沙欣",
          "Mehmet Sahin",
          "土耳其",
          "W",
          "fb_playmaker",
          57,
          "R"
        ],
        [
          "埃利亚斯·阿尔布雷希特",
          "Elias Albrecht",
          "德国",
          "CM",
          "cm_box2box",
          56,
          "R"
        ],
        [
          "芬恩·道森",
          "Finn Dawson",
          "英格兰",
          "CM",
          "cm_creator",
          56,
          "R"
        ],
        [
          "阿尔达·切利克",
          "Arda Celik",
          "土耳其",
          "W",
          "w_dribbler",
          56,
          "L"
        ],
        [
          "巴斯蒂安·富尼耶",
          "Bastien Fournier",
          "法国",
          "ST",
          "st_false9",
          56,
          "R"
        ],
        [
          "奥斯卡·尼尔松",
          "Oscar Nilsson",
          "瑞典",
          "GK",
          "gk_wall",
          53,
          "R"
        ],
        [
          "马特奥·普列托",
          "Mateo Prieto",
          "西班牙",
          "CB",
          "cb_stopper",
          53,
          "R"
        ],
        [
          "卢卡·罗西",
          "Luca Rossi",
          "意大利",
          "W",
          "fb_attacking",
          53,
          "L"
        ],
        [
          "松田阳斗",
          "Haruto Matsuda",
          "日本",
          "CM",
          "cm_destroyer",
          53,
          "L"
        ],
        [
          "琴克·耶尔马兹",
          "Cenk Yilmaz",
          "土耳其",
          "ST",
          "st_false9",
          53,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 16,
    "targetCa": 505,
    "actualCa": 507.67282806550355,
    "kind": "generated",
    "team": {
      "id": "peak-16",
      "club": "黑潮军团",
      "clubEn": "黑潮军团",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "low"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 505,
      "players": [
        [
          "洛伦佐·罗西",
          "Lorenzo Rossi",
          "意大利",
          "GK",
          "gk_shotstopper",
          60,
          "R"
        ],
        [
          "许修远",
          "Xu Xiuyuan",
          "中国",
          "CB",
          "cb_stopper",
          60,
          "L"
        ],
        [
          "费利佩·努内斯",
          "Felipe Nunes",
          "巴西",
          "CB",
          "cb_cover",
          60,
          "L"
        ],
        [
          "崔泰熙",
          "Choi Taehee",
          "韩国",
          "CB",
          "cb_cover",
          58,
          "R"
        ],
        [
          "尼古拉·武科维奇",
          "Nikola Vukovic",
          "克罗地亚",
          "W",
          "w_crosser",
          58,
          "R"
        ],
        [
          "莫里茨·贝克尔",
          "Moritz Becker",
          "德国",
          "CM",
          "cm_playmaker",
          58,
          "R"
        ],
        [
          "迪米塔尔·伊万诺夫",
          "Dimitar Ivanov",
          "保加利亚",
          "CM",
          "cm_engine",
          58,
          "L"
        ],
        [
          "萨米尔·曼苏尔",
          "Samir Mansour",
          "摩洛哥",
          "CM",
          "cm_destroyer",
          57,
          "R"
        ],
        [
          "朱利安·佩兰",
          "Julien Perrin",
          "法国",
          "W",
          "fb_playmaker",
          57,
          "L"
        ],
        [
          "阿尤布·伊德里西",
          "Ayoub Idrissi",
          "摩洛哥",
          "ST",
          "st_target",
          57,
          "L"
        ],
        [
          "程子昂",
          "Cheng Ziang",
          "中国",
          "ST",
          "st_finisher",
          57,
          "L"
        ],
        [
          "埃兹拉·道森",
          "Ezra Dawson",
          "英格兰",
          "GK",
          "gk_shotstopper",
          54,
          "R"
        ],
        [
          "杰克·特纳",
          "Jack Turner",
          "英格兰",
          "CB",
          "cb_stopper",
          54,
          "R"
        ],
        [
          "路易·勒费弗尔",
          "Louis Lefevre",
          "法国",
          "W",
          "w_finisher",
          54,
          "R"
        ],
        [
          "埃兹拉·休斯",
          "Ezra Hughes",
          "英格兰",
          "CM",
          "cm_mezzala",
          54,
          "R"
        ],
        [
          "伊桑·普赖斯",
          "Ethan Price",
          "英格兰",
          "ST",
          "st_finisher",
          54,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 17,
    "targetCa": 515,
    "actualCa": 506.94778753290484,
    "kind": "generated",
    "team": {
      "id": "peak-17",
      "club": "晨星流浪者",
      "clubEn": "晨星流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
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
      "targetCa": 515,
      "players": [
        [
          "若昂·皮雷斯",
          "Joao Pires",
          "巴西",
          "GK",
          "gk_sweeper",
          60,
          "R"
        ],
        [
          "赫里斯托·索科洛夫",
          "Hristo Sokolov",
          "保加利亚",
          "W",
          "w_playmaker",
          60,
          "L"
        ],
        [
          "贡萨洛·基罗加",
          "Gonzalo Quiroga",
          "阿根廷",
          "CB",
          "cb_ballplaying",
          60,
          "R"
        ],
        [
          "维托尔·费雷拉",
          "Vitor Ferreira",
          "巴西",
          "CB",
          "cb_ballplaying",
          58,
          "R"
        ],
        [
          "保罗·布兰特",
          "Paul Brandt",
          "德国",
          "W",
          "w_crosser",
          58,
          "R"
        ],
        [
          "沈天佑",
          "Shen Tianyou",
          "中国",
          "CM",
          "cm_mezzala",
          58,
          "R"
        ],
        [
          "琴克·卡亚",
          "Cenk Kaya",
          "土耳其",
          "CM",
          "cm_playmaker",
          58,
          "R"
        ],
        [
          "奥比纳·阿贾伊",
          "Obinna Ajayi",
          "尼日利亚",
          "W",
          "w_dribbler",
          57,
          "R"
        ],
        [
          "周知行",
          "Zhou Zhixing",
          "中国",
          "CM",
          "cm_mezzala",
          57,
          "R"
        ],
        [
          "凯·哈特",
          "Kai Hart",
          "英格兰",
          "W",
          "fb_playmaker",
          57,
          "R"
        ],
        [
          "维托尔·里贝罗",
          "Vitor Ribeiro",
          "巴西",
          "ST",
          "st_target",
          57,
          "R"
        ],
        [
          "乌斯曼·迪亚洛",
          "Ousmane Diallo",
          "塞内加尔",
          "GK",
          "gk_sweeper",
          54,
          "L"
        ],
        [
          "奇迪·阿德耶米",
          "Chidi Adeyemi",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          54,
          "R"
        ],
        [
          "雷南·费雷拉",
          "Renan Ferreira",
          "巴西",
          "W",
          "w_finisher",
          54,
          "R"
        ],
        [
          "哈维尔·加拉多",
          "Javier Gallardo",
          "西班牙",
          "CM",
          "cm_box2box",
          54,
          "L"
        ],
        [
          "克莱芒·佩兰",
          "Clement Perrin",
          "法国",
          "ST",
          "st_runner",
          54,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 18,
    "targetCa": 530,
    "actualCa": 524.4228309458217,
    "kind": "generated",
    "team": {
      "id": "peak-18",
      "club": "南港联",
      "clubEn": "南港联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 530,
      "players": [
        [
          "卢卡斯·魏斯",
          "Lukas Weiss",
          "德国",
          "GK",
          "gk_sweeper",
          61,
          "R"
        ],
        [
          "韩宇航",
          "Han Yuhang",
          "中国",
          "W",
          "w_crosser",
          61,
          "L"
        ],
        [
          "欧文·帕克",
          "Owen Parker",
          "英格兰",
          "CB",
          "cb_cover",
          61,
          "R"
        ],
        [
          "安德斯·林德奎斯特",
          "Anders Lindqvist",
          "瑞典",
          "CB",
          "cb_ballplaying",
          59,
          "L"
        ],
        [
          "布拉克·卡亚",
          "Burak Kaya",
          "土耳其",
          "W",
          "w_playmaker",
          59,
          "L"
        ],
        [
          "克莱芒·勒费弗尔",
          "Clement Lefevre",
          "法国",
          "CM",
          "cm_destroyer",
          59,
          "R"
        ],
        [
          "凯奥·特谢拉",
          "Caio Teixeira",
          "巴西",
          "W",
          "fb_playmaker",
          59,
          "R"
        ],
        [
          "马泰奥·里奇",
          "Matteo Ricci",
          "意大利",
          "CM",
          "cm_playmaker",
          58,
          "L"
        ],
        [
          "韩文博",
          "Han Wenbo",
          "中国",
          "CM",
          "cm_box2box",
          58,
          "R"
        ],
        [
          "费利佩·努内斯",
          "Felipe Nunes",
          "巴西",
          "W",
          "w_finisher",
          58,
          "R"
        ],
        [
          "卢卡斯·卡多佐",
          "Lucas Cardoso",
          "巴西",
          "ST",
          "st_runner",
          58,
          "L"
        ],
        [
          "雷南·科斯塔",
          "Renan Costa",
          "巴西",
          "GK",
          "gk_shotstopper",
          55,
          "R"
        ],
        [
          "迪米塔尔·波波夫",
          "Dimitar Popov",
          "保加利亚",
          "CB",
          "cb_ballplaying",
          55,
          "L"
        ],
        [
          "克莱芒·佩兰",
          "Clement Perrin",
          "法国",
          "W",
          "fb_playmaker",
          55,
          "R"
        ],
        [
          "伊桑·弗莱彻",
          "Ethan Fletcher",
          "英格兰",
          "CM",
          "cm_engine",
          55,
          "R"
        ],
        [
          "米洛·梅森",
          "Milo Mason",
          "英格兰",
          "ST",
          "st_finisher",
          55,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 19,
    "targetCa": 540,
    "actualCa": 541.6789374104683,
    "kind": "generated",
    "team": {
      "id": "peak-19",
      "club": "金桥矿工",
      "clubEn": "金桥矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "low"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 540,
      "players": [
        [
          "马丁·彼得罗夫",
          "Martin Petrov",
          "保加利亚",
          "GK",
          "gk_wall",
          62,
          "R"
        ],
        [
          "科菲·门萨",
          "Kofi Mensah",
          "加纳",
          "W",
          "w_playmaker",
          62,
          "R"
        ],
        [
          "菲利普·伊利奇",
          "Filip Ilic",
          "克罗地亚",
          "CB",
          "cb_stopper",
          62,
          "R"
        ],
        [
          "江宇航",
          "Jiang Yuhang",
          "中国",
          "CB",
          "cb_cover",
          60,
          "R"
        ],
        [
          "黄俊昊",
          "Hwang Junho",
          "韩国",
          "W",
          "fb_attacking",
          60,
          "R"
        ],
        [
          "姜志勋",
          "Kang Jihoon",
          "韩国",
          "CM",
          "cm_engine",
          60,
          "L"
        ],
        [
          "维克托·林德奎斯特",
          "Viktor Lindqvist",
          "瑞典",
          "CM",
          "cm_creator",
          60,
          "R"
        ],
        [
          "维托尔·阿尔梅达",
          "Vitor Almeida",
          "巴西",
          "CM",
          "cm_engine",
          59,
          "R"
        ],
        [
          "程启航",
          "Cheng Qihang",
          "中国",
          "W",
          "fb_attacking",
          59,
          "L"
        ],
        [
          "乌戈·奥尔特加",
          "Hugo Ortega",
          "西班牙",
          "ST",
          "st_finisher",
          59,
          "R"
        ],
        [
          "阿尔达·阿尔斯兰",
          "Arda Arslan",
          "土耳其",
          "W",
          "fb_attacking",
          59,
          "R"
        ],
        [
          "米克尔·林德奎斯特",
          "Mikkel Lindqvist",
          "瑞典",
          "GK",
          "gk_wall",
          56,
          "L"
        ],
        [
          "松田陆",
          "Riku Matsuda",
          "日本",
          "CB",
          "cb_ballplaying",
          56,
          "L"
        ],
        [
          "方知行",
          "Fang Zhixing",
          "中国",
          "W",
          "fb_playmaker",
          56,
          "R"
        ],
        [
          "苏文博",
          "Su Wenbo",
          "中国",
          "CM",
          "cm_playmaker",
          56,
          "L"
        ],
        [
          "阿尤布·萨利赫",
          "Ayoub Saleh",
          "摩洛哥",
          "ST",
          "st_poacher",
          56,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 20,
    "targetCa": 550,
    "actualCa": 542.5597088215488,
    "kind": "generated",
    "team": {
      "id": "peak-20",
      "club": "风暴联队",
      "clubEn": "风暴联队",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "normal",
        "line": "high",
        "press": "low"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 550,
      "players": [
        [
          "路易·勒纳尔",
          "Louis Renard",
          "法国",
          "GK",
          "gk_shotstopper",
          62,
          "R"
        ],
        [
          "埃兹拉·霍尔特",
          "Ezra Holt",
          "英格兰",
          "W",
          "w_finisher",
          62,
          "R"
        ],
        [
          "乌斯曼·萨尔",
          "Ousmane Sarr",
          "塞内加尔",
          "CB",
          "cb_cover",
          62,
          "L"
        ],
        [
          "亚辛·贝纳利",
          "Yassine Benali",
          "摩洛哥",
          "CB",
          "cb_stopper",
          60,
          "R"
        ],
        [
          "伊格纳西奥·梅迪纳",
          "Ignacio Medina",
          "阿根廷",
          "W",
          "w_engine",
          60,
          "R"
        ],
        [
          "吉田直树",
          "Naoki Yoshida",
          "日本",
          "CM",
          "cm_mezzala",
          60,
          "L"
        ],
        [
          "里卡尔多·格雷科",
          "Riccardo Greco",
          "意大利",
          "CM",
          "cm_destroyer",
          60,
          "R"
        ],
        [
          "苏尼尔·夏尔马",
          "Sunil Sharma",
          "印度",
          "CM",
          "cm_box2box",
          59,
          "R"
        ],
        [
          "芬恩·霍尔特",
          "Finn Holt",
          "英格兰",
          "W",
          "fb_playmaker",
          59,
          "R"
        ],
        [
          "卢卡·巴罗内",
          "Luca Barone",
          "意大利",
          "ST",
          "st_runner",
          59,
          "R"
        ],
        [
          "马马杜·盖耶",
          "Mamadou Gueye",
          "塞内加尔",
          "W",
          "fb_attacking",
          59,
          "R"
        ],
        [
          "叶俊驰",
          "Ye Junchi",
          "中国",
          "GK",
          "gk_shotstopper",
          56,
          "R"
        ],
        [
          "江文博",
          "Jiang Wenbo",
          "中国",
          "CB",
          "cb_ballplaying",
          56,
          "R"
        ],
        [
          "法昆多·贝尼特斯",
          "Facundo Benitez",
          "阿根廷",
          "W",
          "w_finisher",
          56,
          "R"
        ],
        [
          "华金·梅迪纳",
          "Joaquin Medina",
          "阿根廷",
          "CM",
          "cm_creator",
          56,
          "R"
        ],
        [
          "凯雷姆·耶尔马兹",
          "Kerem Yilmaz",
          "土耳其",
          "ST",
          "st_poacher",
          56,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 21,
    "targetCa": 550,
    "actualCa": 543.2859761095806,
    "kind": "generated",
    "team": {
      "id": "peak-21",
      "club": "林海矿工",
      "clubEn": "林海矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "slow",
        "line": "low",
        "press": "mid"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 550,
      "players": [
        [
          "埃利亚斯·福格尔",
          "Elias Vogel",
          "德国",
          "GK",
          "gk_sweeper",
          62,
          "L"
        ],
        [
          "马泰奥·费里",
          "Matteo Ferri",
          "意大利",
          "W",
          "w_finisher",
          62,
          "L"
        ],
        [
          "阿尔琼·夏尔马",
          "Arjun Sharma",
          "印度",
          "CB",
          "cb_cover",
          62,
          "R"
        ],
        [
          "巴斯蒂安·吉拉尔",
          "Bastien Girard",
          "法国",
          "CB",
          "cb_stopper",
          60,
          "R"
        ],
        [
          "马尔科·拉迪奇",
          "Marko Radic",
          "克罗地亚",
          "W",
          "w_engine",
          60,
          "L"
        ],
        [
          "扬·阿尔布雷希特",
          "Jan Albrecht",
          "德国",
          "CM",
          "cm_creator",
          60,
          "R"
        ],
        [
          "贾科莫·比安基",
          "Giacomo Bianchi",
          "意大利",
          "W",
          "fb_playmaker",
          60,
          "L"
        ],
        [
          "达里奥·普列托",
          "Dario Prieto",
          "西班牙",
          "CM",
          "cm_creator",
          59,
          "R"
        ],
        [
          "乌切·奥涅卡",
          "Uche Onyeka",
          "尼日利亚",
          "CM",
          "cm_creator",
          59,
          "R"
        ],
        [
          "杰米·霍尔特",
          "Jamie Holt",
          "英格兰",
          "W",
          "fb_playmaker",
          59,
          "R"
        ],
        [
          "埃兹拉·弗莱彻",
          "Ezra Fletcher",
          "英格兰",
          "ST",
          "st_finisher",
          59,
          "R"
        ],
        [
          "科菲·奥塞",
          "Kofi Osei",
          "加纳",
          "GK",
          "gk_wall",
          56,
          "R"
        ],
        [
          "郑泰熙",
          "Jung Taehee",
          "韩国",
          "CB",
          "cb_cover",
          56,
          "R"
        ],
        [
          "亚辛·曼苏尔",
          "Yassine Mansour",
          "摩洛哥",
          "W",
          "w_finisher",
          56,
          "R"
        ],
        [
          "马泰奥·里纳尔迪",
          "Matteo Rinaldi",
          "意大利",
          "CM",
          "cm_box2box",
          56,
          "R"
        ],
        [
          "阿尔达·耶尔马兹",
          "Arda Yilmaz",
          "土耳其",
          "ST",
          "st_runner",
          56,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 22,
    "targetCa": 560,
    "actualCa": 560.243344738292,
    "kind": "generated",
    "team": {
      "id": "peak-22",
      "club": "南港联 II",
      "clubEn": "南港联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "low"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 560,
      "players": [
        [
          "马马杜·迪亚洛",
          "Mamadou Diallo",
          "塞内加尔",
          "GK",
          "gk_wall",
          63,
          "R"
        ],
        [
          "约纳斯·莱曼",
          "Jonas Lehmann",
          "德国",
          "W",
          "w_finisher",
          63,
          "R"
        ],
        [
          "马马杜·西塞",
          "Mamadou Cisse",
          "塞内加尔",
          "CB",
          "cb_ballplaying",
          63,
          "R"
        ],
        [
          "阿德里安·富尼耶",
          "Adrien Fournier",
          "法国",
          "CB",
          "cb_stopper",
          61,
          "R"
        ],
        [
          "古斯塔沃·皮雷斯",
          "Gustavo Pires",
          "巴西",
          "W",
          "w_dribbler",
          61,
          "R"
        ],
        [
          "亚乌·阿桑特",
          "Yaw Asante",
          "加纳",
          "CM",
          "cm_playmaker",
          61,
          "R"
        ],
        [
          "许思远",
          "Xu Siyuan",
          "中国",
          "CM",
          "cm_engine",
          61,
          "L"
        ],
        [
          "斯特凡·诺瓦克",
          "Stefan Novak",
          "克罗地亚",
          "CM",
          "cm_engine",
          60,
          "R"
        ],
        [
          "高景行",
          "Gao Jingxing",
          "中国",
          "W",
          "w_crosser",
          60,
          "R"
        ],
        [
          "哈维尔·纳瓦罗",
          "Javier Navarro",
          "西班牙",
          "ST",
          "st_false9",
          60,
          "R"
        ],
        [
          "魏一鸣",
          "Wei Yiming",
          "中国",
          "W",
          "w_crosser",
          60,
          "R"
        ],
        [
          "马利克·盖耶",
          "Malick Gueye",
          "塞内加尔",
          "GK",
          "gk_shotstopper",
          57,
          "R"
        ],
        [
          "伊藤大辉",
          "Daiki Ito",
          "日本",
          "CB",
          "cb_stopper",
          57,
          "L"
        ],
        [
          "马马杜·法尔",
          "Mamadou Fall",
          "塞内加尔",
          "W",
          "fb_playmaker",
          57,
          "R"
        ],
        [
          "米兰·约万诺维奇",
          "Milan Jovanovic",
          "克罗地亚",
          "CM",
          "cm_creator",
          57,
          "R"
        ],
        [
          "拉尔斯·桑德贝里",
          "Lars Sandberg",
          "瑞典",
          "ST",
          "st_poacher",
          57,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 23,
    "targetCa": 570,
    "actualCa": 561.0387769176614,
    "kind": "generated",
    "team": {
      "id": "peak-23",
      "club": "林海工人",
      "clubEn": "林海工人",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 570,
      "players": [
        [
          "巴斯蒂安·吉拉尔",
          "Bastien Girard",
          "法国",
          "GK",
          "gk_shotstopper",
          63,
          "R"
        ],
        [
          "维克托·桑德贝里",
          "Viktor Sandberg",
          "瑞典",
          "W",
          "w_crosser",
          63,
          "R"
        ],
        [
          "恩佐·富尼耶",
          "Enzo Fournier",
          "法国",
          "CB",
          "cb_cover",
          63,
          "R"
        ],
        [
          "贡萨洛·莱德斯马",
          "Gonzalo Ledesma",
          "阿根廷",
          "CB",
          "cb_cover",
          61,
          "R"
        ],
        [
          "阿德里安·勒费弗尔",
          "Adrien Lefevre",
          "法国",
          "W",
          "fb_attacking",
          61,
          "R"
        ],
        [
          "维托尔·莫拉",
          "Vitor Moura",
          "巴西",
          "CM",
          "cm_mezzala",
          61,
          "L"
        ],
        [
          "贡萨洛·贝尼特斯",
          "Gonzalo Benitez",
          "阿根廷",
          "CM",
          "cm_destroyer",
          61,
          "R"
        ],
        [
          "安托万·迪皮伊",
          "Antoine Dupuis",
          "法国",
          "CM",
          "cm_engine",
          60,
          "R"
        ],
        [
          "秦思远",
          "Qin Siyuan",
          "中国",
          "W",
          "w_crosser",
          60,
          "R"
        ],
        [
          "蒂姆·里希特",
          "Tim Richter",
          "德国",
          "ST",
          "st_poacher",
          60,
          "R"
        ],
        [
          "伊克尔·莫利纳",
          "Iker Molina",
          "西班牙",
          "W",
          "w_crosser",
          60,
          "R"
        ],
        [
          "郑在元",
          "Jung Jaewon",
          "韩国",
          "GK",
          "gk_shotstopper",
          57,
          "L"
        ],
        [
          "马蒂斯·梅西耶",
          "Mathis Mercier",
          "法国",
          "CB",
          "cb_ballplaying",
          57,
          "L"
        ],
        [
          "阿卜杜·恩迪亚耶",
          "Abdou Ndiaye",
          "塞内加尔",
          "W",
          "fb_playmaker",
          57,
          "R"
        ],
        [
          "陆雨辰",
          "Lu Yuchen",
          "中国",
          "CM",
          "cm_mezzala",
          57,
          "R"
        ],
        [
          "周天佑",
          "Zhou Tianyou",
          "中国",
          "ST",
          "st_false9",
          57,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 24,
    "targetCa": 575,
    "actualCa": 577.3964079185797,
    "kind": "generated",
    "team": {
      "id": "peak-24",
      "club": "远帆矿工",
      "clubEn": "远帆矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "low",
        "press": "high"
      },
      "color": "#fde100",
      "accent": "#000000",
      "note": "PvE 生成球队",
      "targetCa": 575,
      "players": [
        [
          "卡勒姆·梅森",
          "Callum Mason",
          "英格兰",
          "GK",
          "gk_sweeper",
          64,
          "R"
        ],
        [
          "凯雷姆·艾登",
          "Kerem Aydin",
          "土耳其",
          "W",
          "w_playmaker",
          64,
          "R"
        ],
        [
          "贾科莫·格雷科",
          "Giacomo Greco",
          "意大利",
          "CB",
          "cb_ballplaying",
          64,
          "R"
        ],
        [
          "芬恩·贝内特",
          "Finn Bennett",
          "英格兰",
          "CB",
          "cb_cover",
          62,
          "R"
        ],
        [
          "马特乌斯·巴尔博扎",
          "Matheus Barbosa",
          "巴西",
          "W",
          "w_dribbler",
          62,
          "R"
        ],
        [
          "华金·罗哈斯",
          "Joaquin Rojas",
          "阿根廷",
          "CM",
          "cm_engine",
          62,
          "L"
        ],
        [
          "卡里姆·萨利赫",
          "Karim Saleh",
          "摩洛哥",
          "CM",
          "cm_engine",
          62,
          "R"
        ],
        [
          "莱昂·布兰特",
          "Leon Brandt",
          "德国",
          "W",
          "w_engine",
          61,
          "L"
        ],
        [
          "林文博",
          "Lin Wenbo",
          "中国",
          "CM",
          "cm_box2box",
          61,
          "L"
        ],
        [
          "马泰奥·格雷科",
          "Matteo Greco",
          "意大利",
          "W",
          "w_playmaker",
          61,
          "R"
        ],
        [
          "阿尔瓦罗·卡斯特罗",
          "Alvaro Castro",
          "西班牙",
          "ST",
          "st_poacher",
          61,
          "R"
        ],
        [
          "江知行",
          "Jiang Zhixing",
          "中国",
          "GK",
          "gk_sweeper",
          58,
          "L"
        ],
        [
          "奥斯卡·隆德",
          "Oscar Lund",
          "瑞典",
          "CB",
          "cb_ballplaying",
          58,
          "L"
        ],
        [
          "埃梅卡·奥涅卡",
          "Emeka Onyeka",
          "尼日利亚",
          "W",
          "w_engine",
          58,
          "R"
        ],
        [
          "贾科莫·巴罗内",
          "Giacomo Barone",
          "意大利",
          "CM",
          "cm_mezzala",
          58,
          "R"
        ],
        [
          "米洛·维尔",
          "Milo Vale",
          "英格兰",
          "ST",
          "st_false9",
          58,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 25,
    "targetCa": 585,
    "actualCa": 581.6460514202632,
    "kind": "generated",
    "team": {
      "id": "peak-25",
      "club": "远帆流浪者",
      "clubEn": "远帆流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "slow",
        "line": "mid",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 585,
      "players": [
        [
          "田若谷",
          "Tian Ruogu",
          "中国",
          "GK",
          "gk_sweeper",
          64,
          "R"
        ],
        [
          "奥斯卡·埃克斯特伦",
          "Oscar Ekstrom",
          "瑞典",
          "W",
          "fb_attacking",
          64,
          "R"
        ],
        [
          "萨米尔·哈达德",
          "Samir Haddad",
          "摩洛哥",
          "CB",
          "cb_stopper",
          64,
          "R"
        ],
        [
          "魏一鸣",
          "Wei Yiming",
          "中国",
          "CB",
          "cb_stopper",
          62,
          "R"
        ],
        [
          "钟星河",
          "Zhong Xinghe",
          "中国",
          "W",
          "w_engine",
          62,
          "R"
        ],
        [
          "埃利亚斯·莱曼",
          "Elias Lehmann",
          "德国",
          "W",
          "w_crosser",
          62,
          "R"
        ],
        [
          "菲利普·科瓦奇",
          "Filip Kovac",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          62,
          "R"
        ],
        [
          "凯莱奇·阿贾伊",
          "Kelechi Ajayi",
          "尼日利亚",
          "CM",
          "cm_mezzala",
          61,
          "R"
        ],
        [
          "凯雷姆·卡亚",
          "Kerem Kaya",
          "土耳其",
          "W",
          "w_engine",
          61,
          "L"
        ],
        [
          "夸梅·门萨",
          "Kwame Mensah",
          "加纳",
          "ST",
          "st_target",
          61,
          "L"
        ],
        [
          "维托尔·皮雷斯",
          "Vitor Pires",
          "巴西",
          "ST",
          "st_poacher",
          61,
          "R"
        ],
        [
          "塔里克·伊德里西",
          "Tarek Idrissi",
          "摩洛哥",
          "GK",
          "gk_shotstopper",
          58,
          "R"
        ],
        [
          "贡萨洛·梅迪纳",
          "Gonzalo Medina",
          "阿根廷",
          "CB",
          "cb_stopper",
          58,
          "R"
        ],
        [
          "布鲁诺·巴尔博扎",
          "Bruno Barbosa",
          "巴西",
          "W",
          "fb_attacking",
          58,
          "R"
        ],
        [
          "托马斯·阿科斯塔",
          "Tomas Acosta",
          "阿根廷",
          "CM",
          "cm_destroyer",
          58,
          "R"
        ],
        [
          "伊万·科瓦奇",
          "Ivan Kovac",
          "克罗地亚",
          "ST",
          "st_runner",
          58,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 26,
    "targetCa": 595,
    "actualCa": 598.643460869299,
    "kind": "generated",
    "team": {
      "id": "peak-26",
      "club": "西湾海港",
      "clubEn": "西湾海港",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 595,
      "players": [
        [
          "彭泽宇",
          "Peng Zeyu",
          "中国",
          "GK",
          "gk_shotstopper",
          65,
          "R"
        ],
        [
          "贡萨洛·索萨",
          "Gonzalo Sosa",
          "阿根廷",
          "CB",
          "cb_ballplaying",
          65,
          "L"
        ],
        [
          "西莫内·莫雷蒂",
          "Simone Moretti",
          "意大利",
          "CB",
          "cb_ballplaying",
          65,
          "R"
        ],
        [
          "杰米·道森",
          "Jamie Dawson",
          "英格兰",
          "CB",
          "cb_stopper",
          63,
          "L"
        ],
        [
          "程云舟",
          "Cheng Yunzhou",
          "中国",
          "W",
          "w_playmaker",
          63,
          "R"
        ],
        [
          "安德烈亚·加利",
          "Andrea Galli",
          "意大利",
          "CM",
          "cm_playmaker",
          63,
          "R"
        ],
        [
          "费利克斯·里希特",
          "Felix Richter",
          "德国",
          "CM",
          "cm_engine",
          63,
          "L"
        ],
        [
          "拉斐尔·巴尔博扎",
          "Rafael Barbosa",
          "巴西",
          "W",
          "w_finisher",
          62,
          "L"
        ],
        [
          "约纳斯·魏斯",
          "Jonas Weiss",
          "德国",
          "W",
          "w_crosser",
          62,
          "R"
        ],
        [
          "阿古斯丁·阿科斯塔",
          "Agustin Acosta",
          "阿根廷",
          "ST",
          "st_finisher",
          62,
          "L"
        ],
        [
          "迭戈·卡斯特罗",
          "Diego Castro",
          "西班牙",
          "W",
          "w_engine",
          62,
          "R"
        ],
        [
          "唐奕辰",
          "Tang Yichen",
          "中国",
          "GK",
          "gk_wall",
          59,
          "L"
        ],
        [
          "高桥拓海",
          "Takumi Takahashi",
          "日本",
          "CB",
          "cb_ballplaying",
          59,
          "L"
        ],
        [
          "巴勃罗·卡诺",
          "Pablo Cano",
          "西班牙",
          "W",
          "w_finisher",
          59,
          "R"
        ],
        [
          "罗文博",
          "Luo Wenbo",
          "中国",
          "CM",
          "cm_box2box",
          59,
          "L"
        ],
        [
          "费利佩·巴尔博扎",
          "Felipe Barbosa",
          "巴西",
          "ST",
          "st_runner",
          59,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 27,
    "targetCa": 605,
    "actualCa": 602.4961518793999,
    "kind": "generated",
    "team": {
      "id": "peak-27",
      "club": "北岸联",
      "clubEn": "北岸联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 605,
      "players": [
        [
          "埃兹拉·帕克",
          "Ezra Parker",
          "英格兰",
          "GK",
          "gk_shotstopper",
          65,
          "R"
        ],
        [
          "马蒂斯·吉拉尔",
          "Mathis Girard",
          "法国",
          "W",
          "w_crosser",
          65,
          "R"
        ],
        [
          "高承宇",
          "Gao Chengyu",
          "中国",
          "CB",
          "cb_stopper",
          65,
          "R"
        ],
        [
          "田中健太",
          "Kenta Tanaka",
          "日本",
          "CB",
          "cb_cover",
          63,
          "R"
        ],
        [
          "尼克拉斯·克劳泽",
          "Niklas Krause",
          "德国",
          "W",
          "w_dribbler",
          63,
          "R"
        ],
        [
          "夸梅·阿多",
          "Kwame Addo",
          "加纳",
          "CM",
          "cm_destroyer",
          63,
          "R"
        ],
        [
          "达维德·莫雷蒂",
          "Davide Moretti",
          "意大利",
          "CM",
          "cm_creator",
          63,
          "L"
        ],
        [
          "哈维尔·卡诺",
          "Javier Cano",
          "西班牙",
          "CM",
          "cm_destroyer",
          62,
          "R"
        ],
        [
          "克莱芒·勒纳尔",
          "Clement Renard",
          "法国",
          "CM",
          "cm_destroyer",
          62,
          "R"
        ],
        [
          "陈子昂",
          "Chen Ziang",
          "中国",
          "ST",
          "st_runner",
          62,
          "L"
        ],
        [
          "欧文·梅森",
          "Owen Mason",
          "英格兰",
          "ST",
          "st_false9",
          62,
          "R"
        ],
        [
          "雷南·巴尔博扎",
          "Renan Barbosa",
          "巴西",
          "GK",
          "gk_sweeper",
          59,
          "L"
        ],
        [
          "拉斐尔·塞拉",
          "Rafael Serra",
          "巴西",
          "CB",
          "cb_cover",
          59,
          "R"
        ],
        [
          "莱昂·克劳泽",
          "Leon Krause",
          "德国",
          "W",
          "w_playmaker",
          59,
          "R"
        ],
        [
          "华金·索萨",
          "Joaquin Sosa",
          "阿根廷",
          "CM",
          "cm_destroyer",
          59,
          "L"
        ],
        [
          "杰克·帕克",
          "Jack Parker",
          "英格兰",
          "ST",
          "st_runner",
          59,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 28,
    "targetCa": 610,
    "actualCa": 618.1504816406489,
    "kind": "generated",
    "team": {
      "id": "peak-28",
      "club": "火种流浪者",
      "clubEn": "火种流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#004170",
      "accent": "#da291c",
      "note": "PvE 生成球队",
      "targetCa": 610,
      "players": [
        [
          "周天佑",
          "Zhou Tianyou",
          "中国",
          "GK",
          "gk_shotstopper",
          66,
          "R"
        ],
        [
          "伊万·科瓦奇",
          "Ivan Kovac",
          "克罗地亚",
          "W",
          "w_playmaker",
          66,
          "R"
        ],
        [
          "马格努斯·埃克斯特伦",
          "Magnus Ekstrom",
          "瑞典",
          "CB",
          "cb_ballplaying",
          66,
          "R"
        ],
        [
          "约西普·拉迪奇",
          "Josip Radic",
          "克罗地亚",
          "CB",
          "cb_cover",
          64,
          "R"
        ],
        [
          "江一鸣",
          "Jiang Yiming",
          "中国",
          "W",
          "fb_playmaker",
          64,
          "R"
        ],
        [
          "尼克拉斯·福斯",
          "Niklas Voss",
          "德国",
          "CM",
          "cm_destroyer",
          64,
          "R"
        ],
        [
          "伊格纳西奥·罗哈斯",
          "Ignacio Rojas",
          "阿根廷",
          "CM",
          "cm_playmaker",
          64,
          "R"
        ],
        [
          "埃比尼泽·奥乌苏",
          "Ebenezer Owusu",
          "加纳",
          "W",
          "w_finisher",
          63,
          "L"
        ],
        [
          "埃姆雷·耶尔马兹",
          "Emre Yilmaz",
          "土耳其",
          "CM",
          "cm_box2box",
          63,
          "L"
        ],
        [
          "卡勒姆·特纳",
          "Callum Turner",
          "英格兰",
          "W",
          "fb_playmaker",
          63,
          "R"
        ],
        [
          "中村大辉",
          "Daiki Nakamura",
          "日本",
          "ST",
          "st_target",
          63,
          "L"
        ],
        [
          "方奕辰",
          "Fang Yichen",
          "中国",
          "GK",
          "gk_sweeper",
          60,
          "R"
        ],
        [
          "布鲁诺·卡多佐",
          "Bruno Cardoso",
          "巴西",
          "CB",
          "cb_cover",
          60,
          "L"
        ],
        [
          "卢卡斯·莫拉",
          "Lucas Moura",
          "巴西",
          "W",
          "fb_playmaker",
          60,
          "R"
        ],
        [
          "安德烈·努内斯",
          "Andre Nunes",
          "巴西",
          "CM",
          "cm_box2box",
          60,
          "R"
        ],
        [
          "路易·梅西耶",
          "Louis Mercier",
          "法国",
          "ST",
          "st_target",
          60,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 29,
    "targetCa": 620,
    "actualCa": 617.8585636945209,
    "kind": "generated",
    "team": {
      "id": "peak-29",
      "club": "南港雄狮",
      "clubEn": "南港雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 620,
      "players": [
        [
          "马泰奥·格雷科",
          "Matteo Greco",
          "意大利",
          "GK",
          "gk_shotstopper",
          66,
          "R"
        ],
        [
          "伊万·马尔科维奇",
          "Ivan Markovic",
          "克罗地亚",
          "W",
          "w_playmaker",
          66,
          "R"
        ],
        [
          "赫里斯托·安格洛夫",
          "Hristo Angelov",
          "保加利亚",
          "CB",
          "cb_cover",
          66,
          "R"
        ],
        [
          "安德烈亚·费里",
          "Andrea Ferri",
          "意大利",
          "CB",
          "cb_stopper",
          64,
          "R"
        ],
        [
          "米洛·普赖斯",
          "Milo Price",
          "英格兰",
          "CB",
          "cb_stopper",
          64,
          "R"
        ],
        [
          "亚乌·奥乌苏",
          "Yaw Owusu",
          "加纳",
          "W",
          "fb_attacking",
          64,
          "L"
        ],
        [
          "叶修远",
          "Ye Xiuyuan",
          "中国",
          "CM",
          "cm_box2box",
          64,
          "R"
        ],
        [
          "乌戈·埃雷拉",
          "Hugo Herrera",
          "西班牙",
          "CM",
          "cm_engine",
          63,
          "R"
        ],
        [
          "泰奥·梅西耶",
          "Theo Mercier",
          "法国",
          "CM",
          "cm_engine",
          63,
          "L"
        ],
        [
          "雷南·费雷拉",
          "Renan Ferreira",
          "巴西",
          "ST",
          "st_target",
          63,
          "L"
        ],
        [
          "桑德·斯特兰德",
          "Sander Strand",
          "瑞典",
          "ST",
          "st_finisher",
          63,
          "R"
        ],
        [
          "马科斯·纳瓦罗",
          "Marcos Navarro",
          "西班牙",
          "GK",
          "gk_sweeper",
          60,
          "R"
        ],
        [
          "苏尼尔·帕特尔",
          "Sunil Patel",
          "印度",
          "CB",
          "cb_ballplaying",
          60,
          "R"
        ],
        [
          "托马斯·基罗加",
          "Tomas Quiroga",
          "阿根廷",
          "W",
          "fb_attacking",
          60,
          "L"
        ],
        [
          "埃利亚斯·福格尔",
          "Elias Vogel",
          "德国",
          "CM",
          "cm_playmaker",
          60,
          "R"
        ],
        [
          "埃姆雷·艾登",
          "Emre Aydin",
          "土耳其",
          "ST",
          "st_false9",
          60,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 30,
    "targetCa": 630,
    "actualCa": 622.240694670952,
    "kind": "generated",
    "team": {
      "id": "peak-30",
      "club": "北岸联 II",
      "clubEn": "北岸联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "fast",
        "line": "low",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 630,
      "players": [
        [
          "阿卜杜·迪奥普",
          "Abdou Diop",
          "塞内加尔",
          "GK",
          "gk_shotstopper",
          66,
          "R"
        ],
        [
          "彼得·诺瓦克",
          "Petar Novak",
          "克罗地亚",
          "W",
          "w_finisher",
          66,
          "R"
        ],
        [
          "小林悠希",
          "Yuki Kobayashi",
          "日本",
          "CB",
          "cb_stopper",
          66,
          "L"
        ],
        [
          "阿德·奥科耶",
          "Ade Okoye",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          64,
          "L"
        ],
        [
          "哈坎·艾登",
          "Hakan Aydin",
          "土耳其",
          "CB",
          "cb_cover",
          64,
          "R"
        ],
        [
          "琴克·耶尔马兹",
          "Cenk Yilmaz",
          "土耳其",
          "W",
          "w_dribbler",
          64,
          "R"
        ],
        [
          "扬·哈特曼",
          "Jan Hartmann",
          "德国",
          "CM",
          "cm_creator",
          64,
          "R"
        ],
        [
          "朱利安·佩兰",
          "Julien Perrin",
          "法国",
          "CM",
          "cm_destroyer",
          63,
          "R"
        ],
        [
          "托马斯·罗哈斯",
          "Tomas Rojas",
          "阿根廷",
          "CM",
          "cm_destroyer",
          63,
          "R"
        ],
        [
          "埃米尔·克劳泽",
          "Emil Krause",
          "德国",
          "ST",
          "st_target",
          63,
          "R"
        ],
        [
          "塞尔吉奥·罗梅罗",
          "Sergio Romero",
          "西班牙",
          "ST",
          "st_target",
          63,
          "R"
        ],
        [
          "埃比尼泽·阿桑特",
          "Ebenezer Asante",
          "加纳",
          "GK",
          "gk_wall",
          60,
          "R"
        ],
        [
          "沈嘉树",
          "Shen Jiashu",
          "中国",
          "CB",
          "cb_ballplaying",
          60,
          "R"
        ],
        [
          "魏景行",
          "Wei Jingxing",
          "中国",
          "W",
          "fb_attacking",
          60,
          "R"
        ],
        [
          "哈坎·耶尔马兹",
          "Hakan Yilmaz",
          "土耳其",
          "CM",
          "cm_creator",
          60,
          "R"
        ],
        [
          "乌斯曼·迪奥普",
          "Ousmane Diop",
          "塞内加尔",
          "ST",
          "st_false9",
          60,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 31,
    "targetCa": 630,
    "actualCa": 635.9158148974594,
    "kind": "generated",
    "team": {
      "id": "peak-31",
      "club": "北岸城 II",
      "clubEn": "北岸城",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 630,
      "players": [
        [
          "凯·维尔",
          "Kai Vale",
          "英格兰",
          "GK",
          "gk_shotstopper",
          67,
          "L"
        ],
        [
          "杨雨辰",
          "Yang Yuchen",
          "中国",
          "W",
          "w_dribbler",
          67,
          "R"
        ],
        [
          "阿德里安·梅西耶",
          "Adrien Mercier",
          "法国",
          "CB",
          "cb_cover",
          67,
          "R"
        ],
        [
          "拉维·奈尔",
          "Ravi Nair",
          "印度",
          "CB",
          "cb_ballplaying",
          65,
          "R"
        ],
        [
          "冯亦凡",
          "Feng Yifan",
          "中国",
          "W",
          "w_crosser",
          65,
          "R"
        ],
        [
          "哈里·特纳",
          "Harry Turner",
          "英格兰",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "雷南·阿尔梅达",
          "Renan Almeida",
          "巴西",
          "W",
          "w_playmaker",
          65,
          "R"
        ],
        [
          "费利克斯·阿尔布雷希特",
          "Felix Albrecht",
          "德国",
          "CM",
          "cm_mezzala",
          64,
          "R"
        ],
        [
          "马克西姆·朗贝尔",
          "Maxime Lambert",
          "法国",
          "CM",
          "cm_box2box",
          64,
          "R"
        ],
        [
          "埃里克·贝里",
          "Erik Berg",
          "瑞典",
          "W",
          "w_finisher",
          64,
          "L"
        ],
        [
          "亚乌·门萨",
          "Yaw Mensah",
          "加纳",
          "ST",
          "st_finisher",
          64,
          "R"
        ],
        [
          "江牧野",
          "Jiang Muye",
          "中国",
          "GK",
          "gk_sweeper",
          61,
          "R"
        ],
        [
          "奥比纳·奥卡福",
          "Obinna Okafor",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          61,
          "R"
        ],
        [
          "科菲·阿多",
          "Kofi Addo",
          "加纳",
          "W",
          "w_crosser",
          61,
          "R"
        ],
        [
          "伊藤飒太",
          "Sota Ito",
          "日本",
          "CM",
          "cm_engine",
          61,
          "L"
        ],
        [
          "安托万·戈蒂埃",
          "Antoine Gauthier",
          "法国",
          "ST",
          "st_runner",
          61,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 32,
    "targetCa": 640,
    "actualCa": 637.3592074227118,
    "kind": "generated",
    "team": {
      "id": "peak-32",
      "club": "霜原雄狮",
      "clubEn": "霜原雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#fde100",
      "accent": "#000000",
      "note": "PvE 生成球队",
      "targetCa": 640,
      "players": [
        [
          "圣地亚哥·阿吉雷",
          "Santiago Aguirre",
          "阿根廷",
          "GK",
          "gk_wall",
          67,
          "R"
        ],
        [
          "米兰·诺瓦克",
          "Milan Novak",
          "克罗地亚",
          "W",
          "w_dribbler",
          67,
          "L"
        ],
        [
          "江俊驰",
          "Jiang Junchi",
          "中国",
          "CB",
          "cb_cover",
          67,
          "R"
        ],
        [
          "阿德里安·富尼耶",
          "Adrien Fournier",
          "法国",
          "CB",
          "cb_cover",
          65,
          "R"
        ],
        [
          "克莱芒·迪皮伊",
          "Clement Dupuis",
          "法国",
          "W",
          "w_playmaker",
          65,
          "R"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "CM",
          "cm_destroyer",
          65,
          "L"
        ],
        [
          "伊藤陆",
          "Riku Ito",
          "日本",
          "W",
          "w_finisher",
          65,
          "R"
        ],
        [
          "泰奥·卢梭",
          "Theo Rousseau",
          "法国",
          "CM",
          "cm_box2box",
          64,
          "R"
        ],
        [
          "贡萨洛·罗哈斯",
          "Gonzalo Rojas",
          "阿根廷",
          "CM",
          "cm_engine",
          64,
          "R"
        ],
        [
          "蒂姆·克劳泽",
          "Tim Krause",
          "德国",
          "W",
          "fb_playmaker",
          64,
          "R"
        ],
        [
          "奥斯卡·桑德贝里",
          "Oscar Sandberg",
          "瑞典",
          "ST",
          "st_poacher",
          64,
          "R"
        ],
        [
          "伊万·拉迪奇",
          "Ivan Radic",
          "克罗地亚",
          "GK",
          "gk_wall",
          61,
          "R"
        ],
        [
          "迪米塔尔·彼得罗夫",
          "Dimitar Petrov",
          "保加利亚",
          "CB",
          "cb_stopper",
          61,
          "R"
        ],
        [
          "黄泰熙",
          "Hwang Taehee",
          "韩国",
          "W",
          "w_finisher",
          61,
          "R"
        ],
        [
          "周泽宇",
          "Zhou Zeyu",
          "中国",
          "CM",
          "cm_mezzala",
          61,
          "R"
        ],
        [
          "林修远",
          "Lin Xiuyuan",
          "中国",
          "ST",
          "st_false9",
          61,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 33,
    "targetCa": 650,
    "actualCa": 656.1986925987144,
    "kind": "generated",
    "team": {
      "id": "peak-33",
      "club": "灰岩流浪者",
      "clubEn": "灰岩流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 650,
      "players": [
        [
          "雷南·阿尔梅达",
          "Renan Almeida",
          "巴西",
          "GK",
          "gk_wall",
          68,
          "L"
        ],
        [
          "韩嘉树",
          "Han Jiashu",
          "中国",
          "W",
          "w_engine",
          68,
          "L"
        ],
        [
          "杜尚·约万诺维奇",
          "Dusan Jovanovic",
          "克罗地亚",
          "CB",
          "cb_ballplaying",
          68,
          "R"
        ],
        [
          "欧文·哈特",
          "Owen Hart",
          "英格兰",
          "CB",
          "cb_stopper",
          66,
          "R"
        ],
        [
          "米洛·肖",
          "Milo Shaw",
          "英格兰",
          "W",
          "w_finisher",
          66,
          "R"
        ],
        [
          "尼古拉·诺瓦克",
          "Nikola Novak",
          "克罗地亚",
          "CM",
          "cm_engine",
          66,
          "R"
        ],
        [
          "保罗·克劳泽",
          "Paul Krause",
          "德国",
          "CM",
          "cm_box2box",
          66,
          "R"
        ],
        [
          "佛朗哥·卡夫雷拉",
          "Franco Cabrera",
          "阿根廷",
          "W",
          "w_playmaker",
          65,
          "R"
        ],
        [
          "埃兹拉·维尔",
          "Ezra Vale",
          "英格兰",
          "CM",
          "cm_playmaker",
          65,
          "R"
        ],
        [
          "乌戈·埃雷拉",
          "Hugo Herrera",
          "西班牙",
          "W",
          "w_finisher",
          65,
          "R"
        ],
        [
          "马尔科·马尔凯蒂",
          "Marco Marchetti",
          "意大利",
          "ST",
          "st_runner",
          65,
          "R"
        ],
        [
          "吉田飒太",
          "Sota Yoshida",
          "日本",
          "GK",
          "gk_wall",
          62,
          "R"
        ],
        [
          "塔里克·沙基尔",
          "Tarek Chakir",
          "摩洛哥",
          "CB",
          "cb_stopper",
          62,
          "L"
        ],
        [
          "叶奕辰",
          "Ye Yichen",
          "中国",
          "W",
          "w_finisher",
          62,
          "R"
        ],
        [
          "阿尔达·耶尔马兹",
          "Arda Yilmaz",
          "土耳其",
          "CM",
          "cm_mezzala",
          62,
          "R"
        ],
        [
          "安特·西米奇",
          "Ante Simic",
          "克罗地亚",
          "ST",
          "st_runner",
          62,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 34,
    "targetCa": 655,
    "actualCa": 660.5515289623509,
    "kind": "generated",
    "team": {
      "id": "peak-34",
      "club": "晨星军团",
      "clubEn": "晨星军团",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "low",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 655,
      "players": [
        [
          "刘易斯·弗莱彻",
          "Lewis Fletcher",
          "英格兰",
          "GK",
          "gk_wall",
          68,
          "R"
        ],
        [
          "埃米尔·福格尔",
          "Emil Vogel",
          "德国",
          "CB",
          "cb_stopper",
          68,
          "R"
        ],
        [
          "约纳斯·克劳泽",
          "Jonas Krause",
          "德国",
          "CB",
          "cb_stopper",
          68,
          "R"
        ],
        [
          "扬·布兰特",
          "Jan Brandt",
          "德国",
          "CB",
          "cb_stopper",
          66,
          "R"
        ],
        [
          "塞尔吉奥·罗梅罗",
          "Sergio Romero",
          "西班牙",
          "W",
          "fb_attacking",
          66,
          "R"
        ],
        [
          "沈文博",
          "Shen Wenbo",
          "中国",
          "CM",
          "cm_creator",
          66,
          "R"
        ],
        [
          "乌斯曼·西塞",
          "Ousmane Cisse",
          "塞内加尔",
          "CM",
          "cm_mezzala",
          66,
          "R"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "W",
          "w_playmaker",
          65,
          "R"
        ],
        [
          "若昂·费雷拉",
          "Joao Ferreira",
          "巴西",
          "W",
          "w_dribbler",
          65,
          "L"
        ],
        [
          "罗汉·帕特尔",
          "Rohan Patel",
          "印度",
          "ST",
          "st_target",
          65,
          "R"
        ],
        [
          "埃梅卡·奥科耶",
          "Emeka Okoye",
          "尼日利亚",
          "W",
          "w_engine",
          65,
          "L"
        ],
        [
          "杰克·贝内特",
          "Jack Bennett",
          "英格兰",
          "GK",
          "gk_sweeper",
          62,
          "R"
        ],
        [
          "达维德·莫雷蒂",
          "Davide Moretti",
          "意大利",
          "CB",
          "cb_cover",
          62,
          "R"
        ],
        [
          "埃米尔·哈特曼",
          "Emil Hartmann",
          "德国",
          "W",
          "fb_attacking",
          62,
          "R"
        ],
        [
          "约纳斯·福格尔",
          "Jonas Vogel",
          "德国",
          "CM",
          "cm_destroyer",
          62,
          "R"
        ],
        [
          "佛朗哥·基罗加",
          "Franco Quiroga",
          "阿根廷",
          "ST",
          "st_target",
          62,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 35,
    "targetCa": 665,
    "actualCa": 658.140527104377,
    "kind": "generated",
    "team": {
      "id": "peak-35",
      "club": "银翼雄狮",
      "clubEn": "银翼雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "mid"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 665,
      "players": [
        [
          "约西普·拉迪奇",
          "Josip Radic",
          "克罗地亚",
          "GK",
          "gk_shotstopper",
          68,
          "L"
        ],
        [
          "高桥海斗",
          "Kaito Takahashi",
          "日本",
          "W",
          "fb_attacking",
          68,
          "L"
        ],
        [
          "布鲁诺·卡多佐",
          "Bruno Cardoso",
          "巴西",
          "CB",
          "cb_stopper",
          68,
          "R"
        ],
        [
          "克莱芒·莫罗",
          "Clement Moreau",
          "法国",
          "CB",
          "cb_ballplaying",
          66,
          "L"
        ],
        [
          "埃利亚斯·莱曼",
          "Elias Lehmann",
          "德国",
          "W",
          "w_engine",
          66,
          "L"
        ],
        [
          "奥比纳·阿德耶米",
          "Obinna Adeyemi",
          "尼日利亚",
          "CM",
          "cm_mezzala",
          66,
          "L"
        ],
        [
          "程奕辰",
          "Cheng Yichen",
          "中国",
          "CM",
          "cm_playmaker",
          66,
          "L"
        ],
        [
          "欧文·帕克",
          "Owen Parker",
          "英格兰",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "杨云舟",
          "Yang Yunzhou",
          "中国",
          "CM",
          "cm_creator",
          65,
          "R"
        ],
        [
          "菲利普·科瓦奇",
          "Filip Kovac",
          "克罗地亚",
          "ST",
          "st_runner",
          65,
          "R"
        ],
        [
          "谢赫·萨尔",
          "Cheikh Sarr",
          "塞内加尔",
          "ST",
          "st_runner",
          65,
          "R"
        ],
        [
          "姜在元",
          "Kang Jaewon",
          "韩国",
          "GK",
          "gk_sweeper",
          62,
          "R"
        ],
        [
          "菲利普·霍尔瓦特",
          "Filip Horvat",
          "克罗地亚",
          "CB",
          "cb_cover",
          62,
          "R"
        ],
        [
          "佛朗哥·梅迪纳",
          "Franco Medina",
          "阿根廷",
          "W",
          "fb_attacking",
          62,
          "R"
        ],
        [
          "马马杜·巴",
          "Mamadou Ba",
          "塞内加尔",
          "CM",
          "cm_destroyer",
          62,
          "L"
        ],
        [
          "郑志勋",
          "Jung Jihoon",
          "韩国",
          "ST",
          "st_runner",
          62,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 36,
    "targetCa": 675,
    "actualCa": 676.9515706121824,
    "kind": "generated",
    "team": {
      "id": "peak-36",
      "club": "白塔青年",
      "clubEn": "白塔青年",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 675,
      "players": [
        [
          "阿古斯丁·索萨",
          "Agustin Sosa",
          "阿根廷",
          "GK",
          "gk_sweeper",
          69,
          "R"
        ],
        [
          "许雨辰",
          "Xu Yuchen",
          "中国",
          "W",
          "w_dribbler",
          69,
          "L"
        ],
        [
          "罗泽宇",
          "Luo Zeyu",
          "中国",
          "CB",
          "cb_cover",
          69,
          "R"
        ],
        [
          "埃米利亚诺·阿科斯塔",
          "Emiliano Acosta",
          "阿根廷",
          "CB",
          "cb_cover",
          67,
          "L"
        ],
        [
          "哈里·维尔",
          "Harry Vale",
          "英格兰",
          "W",
          "w_crosser",
          67,
          "R"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "CM",
          "cm_mezzala",
          67,
          "R"
        ],
        [
          "西莫内·孔蒂",
          "Simone Conti",
          "意大利",
          "CM",
          "cm_box2box",
          67,
          "R"
        ],
        [
          "托马斯·阿科斯塔",
          "Tomas Acosta",
          "阿根廷",
          "CM",
          "cm_destroyer",
          66,
          "R"
        ],
        [
          "法昆多·贝尼特斯",
          "Facundo Benitez",
          "阿根廷",
          "W",
          "w_playmaker",
          66,
          "L"
        ],
        [
          "纳比勒·伊德里西",
          "Nabil Idrissi",
          "摩洛哥",
          "ST",
          "st_finisher",
          66,
          "L"
        ],
        [
          "卢卡斯·莱曼",
          "Lukas Lehmann",
          "德国",
          "W",
          "w_engine",
          66,
          "R"
        ],
        [
          "吉田莲",
          "Ren Yoshida",
          "日本",
          "GK",
          "gk_sweeper",
          63,
          "R"
        ],
        [
          "西莫内·格雷科",
          "Simone Greco",
          "意大利",
          "CB",
          "cb_cover",
          63,
          "R"
        ],
        [
          "埃里克·桑德贝里",
          "Erik Sandberg",
          "瑞典",
          "W",
          "w_crosser",
          63,
          "R"
        ],
        [
          "马克西姆·马尔尚",
          "Maxime Marchand",
          "法国",
          "CM",
          "cm_playmaker",
          63,
          "L"
        ],
        [
          "马泰奥·比安基",
          "Matteo Bianchi",
          "意大利",
          "ST",
          "st_target",
          63,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 37,
    "targetCa": 685,
    "actualCa": 678.4802111233547,
    "kind": "generated",
    "team": {
      "id": "peak-37",
      "club": "远帆雄狮",
      "clubEn": "远帆雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "slow",
        "line": "high",
        "press": "low"
      },
      "color": "#004170",
      "accent": "#da291c",
      "note": "PvE 生成球队",
      "targetCa": 685,
      "players": [
        [
          "乌戈·埃雷拉",
          "Hugo Herrera",
          "西班牙",
          "GK",
          "gk_shotstopper",
          69,
          "R"
        ],
        [
          "埃比尼泽·阿多",
          "Ebenezer Addo",
          "加纳",
          "W",
          "w_crosser",
          69,
          "R"
        ],
        [
          "方明远",
          "Fang Mingyuan",
          "中国",
          "CB",
          "cb_stopper",
          69,
          "R"
        ],
        [
          "泰奥·迪皮伊",
          "Theo Dupuis",
          "法国",
          "CB",
          "cb_cover",
          67,
          "R"
        ],
        [
          "达里奥·奥尔特加",
          "Dario Ortega",
          "西班牙",
          "W",
          "w_crosser",
          67,
          "L"
        ],
        [
          "马特奥·罗梅罗",
          "Mateo Romero",
          "西班牙",
          "CM",
          "cm_creator",
          67,
          "L"
        ],
        [
          "巴斯蒂安·梅西耶",
          "Bastien Mercier",
          "法国",
          "W",
          "w_crosser",
          67,
          "L"
        ],
        [
          "通德·恩沃苏",
          "Tunde Nwosu",
          "尼日利亚",
          "CM",
          "cm_playmaker",
          66,
          "R"
        ],
        [
          "何启航",
          "He Qihang",
          "中国",
          "CM",
          "cm_mezzala",
          66,
          "L"
        ],
        [
          "费利佩·皮雷斯",
          "Felipe Pires",
          "巴西",
          "W",
          "w_dribbler",
          66,
          "R"
        ],
        [
          "马尔科·诺瓦克",
          "Marko Novak",
          "克罗地亚",
          "ST",
          "st_target",
          66,
          "R"
        ],
        [
          "伊布拉希马·恩迪亚耶",
          "Ibrahima Ndiaye",
          "塞内加尔",
          "GK",
          "gk_wall",
          63,
          "L"
        ],
        [
          "杰米·弗莱彻",
          "Jamie Fletcher",
          "英格兰",
          "CB",
          "cb_cover",
          63,
          "L"
        ],
        [
          "奇迪·恩沃苏",
          "Chidi Nwosu",
          "尼日利亚",
          "W",
          "w_engine",
          63,
          "R"
        ],
        [
          "程泽宇",
          "Cheng Zeyu",
          "中国",
          "CM",
          "cm_playmaker",
          63,
          "R"
        ],
        [
          "约纳斯·里希特",
          "Jonas Richter",
          "德国",
          "ST",
          "st_poacher",
          63,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 38,
    "targetCa": 690,
    "actualCa": 699.5972402448729,
    "kind": "generated",
    "team": {
      "id": "peak-38",
      "club": "赤焰先锋",
      "clubEn": "赤焰先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "normal",
        "line": "mid",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 690,
      "players": [
        [
          "桑德·霍尔姆",
          "Sander Holm",
          "瑞典",
          "GK",
          "gk_sweeper",
          70,
          "R"
        ],
        [
          "亚辛·哈利勒",
          "Yassine Khalil",
          "摩洛哥",
          "W",
          "fb_playmaker",
          70,
          "L"
        ],
        [
          "若昂·特谢拉",
          "Joao Teixeira",
          "巴西",
          "CB",
          "cb_stopper",
          70,
          "R"
        ],
        [
          "托马斯·莱德斯马",
          "Tomas Ledesma",
          "阿根廷",
          "CB",
          "cb_ballplaying",
          68,
          "R"
        ],
        [
          "凯·帕克",
          "Kai Parker",
          "英格兰",
          "CB",
          "cb_ballplaying",
          68,
          "R"
        ],
        [
          "姜书俊",
          "Kang Seojun",
          "韩国",
          "W",
          "fb_attacking",
          68,
          "R"
        ],
        [
          "钟牧野",
          "Zhong Muye",
          "中国",
          "CM",
          "cm_engine",
          68,
          "R"
        ],
        [
          "方奕辰",
          "Fang Yichen",
          "中国",
          "CM",
          "cm_mezzala",
          67,
          "L"
        ],
        [
          "欧文·里德",
          "Owen Reid",
          "英格兰",
          "CM",
          "cm_destroyer",
          67,
          "R"
        ],
        [
          "克莱芒·吉拉尔",
          "Clement Girard",
          "法国",
          "ST",
          "st_poacher",
          67,
          "R"
        ],
        [
          "亨里克·林德",
          "Henrik Lind",
          "瑞典",
          "ST",
          "st_poacher",
          67,
          "R"
        ],
        [
          "约西普·约万诺维奇",
          "Josip Jovanovic",
          "克罗地亚",
          "GK",
          "gk_shotstopper",
          64,
          "R"
        ],
        [
          "罗汉·帕特尔",
          "Rohan Patel",
          "印度",
          "CB",
          "cb_stopper",
          64,
          "R"
        ],
        [
          "小林直树",
          "Naoki Kobayashi",
          "日本",
          "W",
          "fb_attacking",
          64,
          "L"
        ],
        [
          "赵天佑",
          "Zhao Tianyou",
          "中国",
          "CM",
          "cm_box2box",
          64,
          "R"
        ],
        [
          "佛朗哥·阿科斯塔",
          "Franco Acosta",
          "阿根廷",
          "ST",
          "st_target",
          64,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 39,
    "targetCa": 700,
    "actualCa": 697.6279496051424,
    "kind": "generated",
    "team": {
      "id": "peak-39",
      "club": "黑潮足球会",
      "clubEn": "黑潮足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "mid"
      },
      "color": "#87d8f7",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 700,
      "players": [
        [
          "鲍里斯·伊万诺夫",
          "Boris Ivanov",
          "保加利亚",
          "GK",
          "gk_sweeper",
          70,
          "R"
        ],
        [
          "姜宇镇",
          "Kang Woojin",
          "韩国",
          "W",
          "w_playmaker",
          70,
          "R"
        ],
        [
          "韩天佑",
          "Han Tianyou",
          "中国",
          "CB",
          "cb_ballplaying",
          70,
          "R"
        ],
        [
          "周若谷",
          "Zhou Ruogu",
          "中国",
          "CB",
          "cb_cover",
          68,
          "L"
        ],
        [
          "科菲·奥塞",
          "Kofi Osei",
          "加纳",
          "W",
          "w_crosser",
          68,
          "R"
        ],
        [
          "亚乌·阿桑特",
          "Yaw Asante",
          "加纳",
          "CM",
          "cm_mezzala",
          68,
          "R"
        ],
        [
          "西莫内·里纳尔迪",
          "Simone Rinaldi",
          "意大利",
          "CM",
          "cm_mezzala",
          68,
          "L"
        ],
        [
          "埃米尔·凯勒",
          "Emil Keller",
          "德国",
          "CM",
          "cm_box2box",
          67,
          "R"
        ],
        [
          "维克托·贝里",
          "Viktor Berg",
          "瑞典",
          "CM",
          "cm_creator",
          67,
          "R"
        ],
        [
          "田中海斗",
          "Kaito Tanaka",
          "日本",
          "ST",
          "st_false9",
          67,
          "L"
        ],
        [
          "蒂亚戈·里贝罗",
          "Thiago Ribeiro",
          "巴西",
          "ST",
          "st_target",
          67,
          "R"
        ],
        [
          "拉米罗·罗哈斯",
          "Ramiro Rojas",
          "阿根廷",
          "GK",
          "gk_wall",
          64,
          "R"
        ],
        [
          "哈姆扎·萨利赫",
          "Hamza Saleh",
          "摩洛哥",
          "CB",
          "cb_ballplaying",
          64,
          "R"
        ],
        [
          "埃比尼泽·奥塞",
          "Ebenezer Osei",
          "加纳",
          "W",
          "w_playmaker",
          64,
          "R"
        ],
        [
          "菲利普·拉迪奇",
          "Filip Radic",
          "克罗地亚",
          "CM",
          "cm_creator",
          64,
          "R"
        ],
        [
          "杰克·特纳",
          "Jack Turner",
          "英格兰",
          "ST",
          "st_poacher",
          64,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 40,
    "targetCa": 710,
    "actualCa": 719.2147146219772,
    "kind": "generated",
    "team": {
      "id": "peak-40",
      "club": "银翼青年",
      "clubEn": "银翼青年",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 710,
      "players": [
        [
          "卢卡斯·贝克尔",
          "Lukas Becker",
          "德国",
          "GK",
          "gk_wall",
          71,
          "R"
        ],
        [
          "扬·克劳泽",
          "Jan Krause",
          "德国",
          "CB",
          "cb_ballplaying",
          71,
          "R"
        ],
        [
          "马蒂斯·迪皮伊",
          "Mathis Dupuis",
          "法国",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "穆萨·盖耶",
          "Moussa Gueye",
          "塞内加尔",
          "CB",
          "cb_stopper",
          69,
          "R"
        ],
        [
          "里卡尔多·丰塔纳",
          "Riccardo Fontana",
          "意大利",
          "W",
          "w_crosser",
          69,
          "R"
        ],
        [
          "若昂·阿尔梅达",
          "Joao Almeida",
          "巴西",
          "CM",
          "cm_creator",
          69,
          "R"
        ],
        [
          "贾科莫·里奇",
          "Giacomo Ricci",
          "意大利",
          "CM",
          "cm_box2box",
          69,
          "L"
        ],
        [
          "阿古斯丁·贝尼特斯",
          "Agustin Benitez",
          "阿根廷",
          "CM",
          "cm_destroyer",
          68,
          "L"
        ],
        [
          "方俊驰",
          "Fang Junchi",
          "中国",
          "W",
          "fb_playmaker",
          68,
          "R"
        ],
        [
          "卢卡·丰塔纳",
          "Luca Fontana",
          "意大利",
          "ST",
          "st_false9",
          68,
          "R"
        ],
        [
          "李贤宇",
          "Lee Hyunwoo",
          "韩国",
          "ST",
          "st_false9",
          68,
          "R"
        ],
        [
          "吉田海斗",
          "Kaito Yoshida",
          "日本",
          "GK",
          "gk_sweeper",
          65,
          "L"
        ],
        [
          "马特乌斯·里贝罗",
          "Matheus Ribeiro",
          "巴西",
          "CB",
          "cb_ballplaying",
          65,
          "R"
        ],
        [
          "安特·武科维奇",
          "Ante Vukovic",
          "克罗地亚",
          "W",
          "w_finisher",
          65,
          "R"
        ],
        [
          "奥马尔·沙基尔",
          "Omar Chakir",
          "摩洛哥",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "程启航",
          "Cheng Qihang",
          "中国",
          "ST",
          "st_false9",
          65,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 41,
    "targetCa": 710,
    "actualCa": 718.3224870462199,
    "kind": "generated",
    "team": {
      "id": "peak-41",
      "club": "北岸竞技",
      "clubEn": "北岸竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#004170",
      "accent": "#da291c",
      "note": "PvE 生成球队",
      "targetCa": 710,
      "players": [
        [
          "埃比尼泽·阿桑特",
          "Ebenezer Asante",
          "加纳",
          "GK",
          "gk_wall",
          71,
          "R"
        ],
        [
          "萨米尔·曼苏尔",
          "Samir Mansour",
          "摩洛哥",
          "W",
          "w_playmaker",
          71,
          "R"
        ],
        [
          "松田阳斗",
          "Haruto Matsuda",
          "日本",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "利奥·道森",
          "Leo Dawson",
          "英格兰",
          "CB",
          "cb_stopper",
          69,
          "R"
        ],
        [
          "中村阳斗",
          "Haruto Nakamura",
          "日本",
          "W",
          "w_crosser",
          69,
          "R"
        ],
        [
          "杜尚·西米奇",
          "Dusan Simic",
          "克罗地亚",
          "CM",
          "cm_destroyer",
          69,
          "R"
        ],
        [
          "西莫内·罗西",
          "Simone Rossi",
          "意大利",
          "CM",
          "cm_box2box",
          69,
          "R"
        ],
        [
          "阿卜杜·迪奥普",
          "Abdou Diop",
          "塞内加尔",
          "CM",
          "cm_playmaker",
          68,
          "R"
        ],
        [
          "林云舟",
          "Lin Yunzhou",
          "中国",
          "CM",
          "cm_box2box",
          68,
          "L"
        ],
        [
          "马丁·彼得罗夫",
          "Martin Petrov",
          "保加利亚",
          "ST",
          "st_target",
          68,
          "R"
        ],
        [
          "乌戈·帕斯夸尔",
          "Hugo Pascual",
          "西班牙",
          "ST",
          "st_target",
          68,
          "R"
        ],
        [
          "巴勃罗·帕斯夸尔",
          "Pablo Pascual",
          "西班牙",
          "GK",
          "gk_wall",
          65,
          "R"
        ],
        [
          "凯奥·卡多佐",
          "Caio Cardoso",
          "巴西",
          "CB",
          "cb_stopper",
          65,
          "R"
        ],
        [
          "通德·阿德耶米",
          "Tunde Adeyemi",
          "尼日利亚",
          "W",
          "w_finisher",
          65,
          "R"
        ],
        [
          "黄成珉",
          "Hwang Sungmin",
          "韩国",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "尼科·奥尔特加",
          "Nico Ortega",
          "西班牙",
          "ST",
          "st_runner",
          65,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 42,
    "targetCa": 720,
    "actualCa": 717.7224030762168,
    "kind": "generated",
    "team": {
      "id": "peak-42",
      "club": "林海联",
      "clubEn": "林海联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
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
      "targetCa": 720,
      "players": [
        [
          "阿尔瓦罗·埃雷拉",
          "Alvaro Herrera",
          "西班牙",
          "GK",
          "gk_sweeper",
          71,
          "R"
        ],
        [
          "马尔科·武科维奇",
          "Marko Vukovic",
          "克罗地亚",
          "W",
          "fb_playmaker",
          71,
          "R"
        ],
        [
          "彼得·西米奇",
          "Petar Simic",
          "克罗地亚",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "巴勃罗·加拉多",
          "Pablo Gallardo",
          "西班牙",
          "CB",
          "cb_cover",
          69,
          "R"
        ],
        [
          "加藤直树",
          "Naoki Kato",
          "日本",
          "W",
          "w_crosser",
          69,
          "L"
        ],
        [
          "法比安·魏斯",
          "Fabian Weiss",
          "德国",
          "W",
          "fb_playmaker",
          69,
          "L"
        ],
        [
          "叶俊驰",
          "Ye Junchi",
          "中国",
          "CM",
          "cm_creator",
          69,
          "R"
        ],
        [
          "苏景行",
          "Su Jingxing",
          "中国",
          "CM",
          "cm_box2box",
          68,
          "R"
        ],
        [
          "凯莱奇·奥科耶",
          "Kelechi Okoye",
          "尼日利亚",
          "W",
          "w_crosser",
          68,
          "L"
        ],
        [
          "杨知行",
          "Yang Zhixing",
          "中国",
          "ST",
          "st_target",
          68,
          "R"
        ],
        [
          "赫里斯托·伊万诺夫",
          "Hristo Ivanov",
          "保加利亚",
          "ST",
          "st_poacher",
          68,
          "R"
        ],
        [
          "卡勒姆·福斯特",
          "Callum Foster",
          "英格兰",
          "GK",
          "gk_sweeper",
          65,
          "R"
        ],
        [
          "米克尔·贝里",
          "Mikkel Berg",
          "瑞典",
          "CB",
          "cb_ballplaying",
          65,
          "L"
        ],
        [
          "江云舟",
          "Jiang Yunzhou",
          "中国",
          "W",
          "fb_playmaker",
          65,
          "R"
        ],
        [
          "雷南·阿尔梅达",
          "Renan Almeida",
          "巴西",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "洛伦佐·罗西",
          "Lorenzo Rossi",
          "意大利",
          "ST",
          "st_runner",
          65,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 43,
    "targetCa": 725,
    "actualCa": 716.3696730731558,
    "kind": "generated",
    "team": {
      "id": "peak-43",
      "club": "白塔之队",
      "clubEn": "白塔之队",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "high"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 725,
      "players": [
        [
          "伊万·伊利奇",
          "Ivan Ilic",
          "克罗地亚",
          "GK",
          "gk_wall",
          71,
          "R"
        ],
        [
          "吉田直树",
          "Naoki Yoshida",
          "日本",
          "W",
          "w_crosser",
          71,
          "R"
        ],
        [
          "埃兹拉·贝内特",
          "Ezra Bennett",
          "英格兰",
          "CB",
          "cb_ballplaying",
          71,
          "L"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "CB",
          "cb_ballplaying",
          69,
          "R"
        ],
        [
          "金志勋",
          "Kim Jihoon",
          "韩国",
          "W",
          "w_engine",
          69,
          "R"
        ],
        [
          "约纳斯·贝克尔",
          "Jonas Becker",
          "德国",
          "CM",
          "cm_creator",
          69,
          "R"
        ],
        [
          "路易·莫罗",
          "Louis Moreau",
          "法国",
          "W",
          "w_finisher",
          69,
          "R"
        ],
        [
          "森大辉",
          "Daiki Mori",
          "日本",
          "CM",
          "cm_engine",
          68,
          "L"
        ],
        [
          "蒂姆·哈特曼",
          "Tim Hartmann",
          "德国",
          "CM",
          "cm_mezzala",
          68,
          "R"
        ],
        [
          "朴道贤",
          "Park Dohyun",
          "韩国",
          "W",
          "fb_playmaker",
          68,
          "R"
        ],
        [
          "拉米罗·莱德斯马",
          "Ramiro Ledesma",
          "阿根廷",
          "ST",
          "st_finisher",
          68,
          "R"
        ],
        [
          "本·帕克",
          "Ben Parker",
          "英格兰",
          "GK",
          "gk_shotstopper",
          65,
          "R"
        ],
        [
          "巴勃罗·维加",
          "Pablo Vega",
          "西班牙",
          "CB",
          "cb_stopper",
          65,
          "L"
        ],
        [
          "阿德里安·维加",
          "Adrian Vega",
          "西班牙",
          "W",
          "fb_attacking",
          65,
          "R"
        ],
        [
          "杜尚·拉迪奇",
          "Dusan Radic",
          "克罗地亚",
          "CM",
          "cm_engine",
          65,
          "R"
        ],
        [
          "杰克·福斯特",
          "Jack Foster",
          "英格兰",
          "ST",
          "st_runner",
          65,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 44,
    "targetCa": 735,
    "actualCa": 739.3597178604224,
    "kind": "generated",
    "team": {
      "id": "peak-44",
      "club": "晨星雄狮",
      "clubEn": "晨星雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "slow",
        "line": "high",
        "press": "low"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 735,
      "players": [
        [
          "埃兹拉·休斯",
          "Ezra Hughes",
          "英格兰",
          "GK",
          "gk_sweeper",
          72,
          "R"
        ],
        [
          "佐藤拓海",
          "Takumi Sato",
          "日本",
          "CB",
          "cb_cover",
          72,
          "R"
        ],
        [
          "韩知行",
          "Han Zhixing",
          "中国",
          "CB",
          "cb_ballplaying",
          72,
          "R"
        ],
        [
          "马丁·索科洛夫",
          "Martin Sokolov",
          "保加利亚",
          "CB",
          "cb_ballplaying",
          70,
          "R"
        ],
        [
          "埃利亚斯·贝克尔",
          "Elias Becker",
          "德国",
          "W",
          "w_crosser",
          70,
          "R"
        ],
        [
          "彭俊驰",
          "Peng Junchi",
          "中国",
          "CM",
          "cm_engine",
          70,
          "R"
        ],
        [
          "蒂亚戈·莫拉",
          "Thiago Moura",
          "巴西",
          "CM",
          "cm_creator",
          70,
          "L"
        ],
        [
          "哈维尔·纳瓦罗",
          "Javier Navarro",
          "西班牙",
          "W",
          "w_playmaker",
          69,
          "R"
        ],
        [
          "阿德·奥涅卡",
          "Ade Onyeka",
          "尼日利亚",
          "W",
          "w_crosser",
          69,
          "R"
        ],
        [
          "约纳斯·克劳泽",
          "Jonas Krause",
          "德国",
          "ST",
          "st_target",
          69,
          "L"
        ],
        [
          "埃比尼泽·阿多",
          "Ebenezer Addo",
          "加纳",
          "W",
          "fb_attacking",
          69,
          "L"
        ],
        [
          "杜尚·西米奇",
          "Dusan Simic",
          "克罗地亚",
          "GK",
          "gk_wall",
          66,
          "R"
        ],
        [
          "泰奥·勒费弗尔",
          "Theo Lefevre",
          "法国",
          "CB",
          "cb_stopper",
          66,
          "R"
        ],
        [
          "奎西·奥乌苏",
          "Kwesi Owusu",
          "加纳",
          "W",
          "w_finisher",
          66,
          "L"
        ],
        [
          "利奥·里德",
          "Leo Reid",
          "英格兰",
          "CM",
          "cm_engine",
          66,
          "R"
        ],
        [
          "恩佐·卢梭",
          "Enzo Rousseau",
          "法国",
          "ST",
          "st_target",
          66,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 45,
    "targetCa": 740,
    "actualCa": 738.7739512947658,
    "kind": "generated",
    "team": {
      "id": "peak-45",
      "club": "东岭矿工",
      "clubEn": "东岭矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "fast",
        "line": "high",
        "press": "mid"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 740,
      "players": [
        [
          "塞杜·巴",
          "Seydou Ba",
          "塞内加尔",
          "GK",
          "gk_sweeper",
          72,
          "R"
        ],
        [
          "杨启航",
          "Yang Qihang",
          "中国",
          "W",
          "fb_playmaker",
          72,
          "R"
        ],
        [
          "奥比纳·奥涅卡",
          "Obinna Onyeka",
          "尼日利亚",
          "CB",
          "cb_stopper",
          72,
          "R"
        ],
        [
          "马克西姆·勒费弗尔",
          "Maxime Lefevre",
          "法国",
          "CB",
          "cb_stopper",
          70,
          "R"
        ],
        [
          "哈维尔·卡诺",
          "Javier Cano",
          "西班牙",
          "W",
          "w_engine",
          70,
          "R"
        ],
        [
          "安德斯·尼尔松",
          "Anders Nilsson",
          "瑞典",
          "W",
          "fb_playmaker",
          70,
          "R"
        ],
        [
          "米洛·霍尔特",
          "Milo Holt",
          "英格兰",
          "CM",
          "cm_mezzala",
          70,
          "R"
        ],
        [
          "贡萨洛·卡夫雷拉",
          "Gonzalo Cabrera",
          "阿根廷",
          "CM",
          "cm_playmaker",
          69,
          "R"
        ],
        [
          "伊藤拓海",
          "Takumi Ito",
          "日本",
          "W",
          "fb_attacking",
          69,
          "L"
        ],
        [
          "马克西姆·迪皮伊",
          "Maxime Dupuis",
          "法国",
          "ST",
          "st_finisher",
          69,
          "R"
        ],
        [
          "穆萨·西塞",
          "Moussa Cisse",
          "塞内加尔",
          "ST",
          "st_target",
          69,
          "R"
        ],
        [
          "赫里斯托·彼得罗夫",
          "Hristo Petrov",
          "保加利亚",
          "GK",
          "gk_wall",
          66,
          "R"
        ],
        [
          "吉田大辉",
          "Daiki Yoshida",
          "日本",
          "CB",
          "cb_ballplaying",
          66,
          "R"
        ],
        [
          "秦云舟",
          "Qin Yunzhou",
          "中国",
          "W",
          "w_engine",
          66,
          "R"
        ],
        [
          "塞杜·萨尔",
          "Seydou Sarr",
          "塞内加尔",
          "CM",
          "cm_box2box",
          66,
          "R"
        ],
        [
          "埃里克·林德奎斯特",
          "Erik Lindqvist",
          "瑞典",
          "ST",
          "st_poacher",
          66,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 46,
    "targetCa": 750,
    "actualCa": 759.2799987909395,
    "kind": "generated",
    "team": {
      "id": "peak-46",
      "club": "灰岩联队",
      "clubEn": "灰岩联队",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 750,
      "players": [
        [
          "拉尔斯·桑德贝里",
          "Lars Sandberg",
          "瑞典",
          "GK",
          "gk_wall",
          73,
          "R"
        ],
        [
          "马格努斯·贝里",
          "Magnus Berg",
          "瑞典",
          "W",
          "w_crosser",
          73,
          "R"
        ],
        [
          "唐启航",
          "Tang Qihang",
          "中国",
          "CB",
          "cb_ballplaying",
          73,
          "R"
        ],
        [
          "普林斯·阿桑特",
          "Prince Asante",
          "加纳",
          "CB",
          "cb_cover",
          71,
          "L"
        ],
        [
          "卡勒姆·里德",
          "Callum Reid",
          "英格兰",
          "W",
          "fb_playmaker",
          71,
          "L"
        ],
        [
          "方星河",
          "Fang Xinghe",
          "中国",
          "CM",
          "cm_mezzala",
          71,
          "R"
        ],
        [
          "卢卡斯·法尔克",
          "Lukas Falk",
          "德国",
          "CM",
          "cm_playmaker",
          71,
          "R"
        ],
        [
          "卢卡斯·哈特曼",
          "Lukas Hartmann",
          "德国",
          "W",
          "w_crosser",
          70,
          "R"
        ],
        [
          "奥斯卡·贝里",
          "Oscar Berg",
          "瑞典",
          "CM",
          "cm_playmaker",
          70,
          "L"
        ],
        [
          "埃姆雷·德米尔",
          "Emre Demir",
          "土耳其",
          "W",
          "w_playmaker",
          70,
          "L"
        ],
        [
          "阿德里安·卡诺",
          "Adrian Cano",
          "西班牙",
          "ST",
          "st_finisher",
          70,
          "R"
        ],
        [
          "罗汉·夏尔马",
          "Rohan Sharma",
          "印度",
          "GK",
          "gk_sweeper",
          67,
          "R"
        ],
        [
          "金书俊",
          "Kim Seojun",
          "韩国",
          "CB",
          "cb_stopper",
          67,
          "R"
        ],
        [
          "米洛·哈特",
          "Milo Hart",
          "英格兰",
          "W",
          "w_engine",
          67,
          "R"
        ],
        [
          "马尔科·马尔科维奇",
          "Marko Markovic",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          67,
          "R"
        ],
        [
          "费德里科·里奇",
          "Federico Ricci",
          "意大利",
          "ST",
          "st_false9",
          67,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 47,
    "targetCa": 755,
    "actualCa": 760.6408282614019,
    "kind": "generated",
    "team": {
      "id": "peak-47",
      "club": "北岸工人",
      "clubEn": "北岸工人",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#fde100",
      "accent": "#000000",
      "note": "PvE 生成球队",
      "targetCa": 755,
      "players": [
        [
          "巴勃罗·卡斯特罗",
          "Pablo Castro",
          "西班牙",
          "GK",
          "gk_shotstopper",
          73,
          "R"
        ],
        [
          "郑宇镇",
          "Jung Woojin",
          "韩国",
          "W",
          "fb_playmaker",
          73,
          "R"
        ],
        [
          "贾科莫·加利",
          "Giacomo Galli",
          "意大利",
          "CB",
          "cb_cover",
          73,
          "R"
        ],
        [
          "法昆多·索萨",
          "Facundo Sosa",
          "阿根廷",
          "CB",
          "cb_cover",
          71,
          "R"
        ],
        [
          "佐藤优斗",
          "Yuto Sato",
          "日本",
          "W",
          "w_finisher",
          71,
          "L"
        ],
        [
          "韩一鸣",
          "Han Yiming",
          "中国",
          "CM",
          "cm_creator",
          71,
          "R"
        ],
        [
          "凯莱奇·奥涅卡",
          "Kelechi Onyeka",
          "尼日利亚",
          "W",
          "fb_attacking",
          71,
          "R"
        ],
        [
          "铃木翔太",
          "Shota Suzuki",
          "日本",
          "CM",
          "cm_box2box",
          70,
          "R"
        ],
        [
          "鲍里斯·波波夫",
          "Boris Popov",
          "保加利亚",
          "CM",
          "cm_destroyer",
          70,
          "R"
        ],
        [
          "森优斗",
          "Yuto Mori",
          "日本",
          "W",
          "fb_attacking",
          70,
          "R"
        ],
        [
          "阿尤布·阿姆拉尼",
          "Ayoub Amrani",
          "摩洛哥",
          "ST",
          "st_false9",
          70,
          "R"
        ],
        [
          "谢赫·巴",
          "Cheikh Ba",
          "塞内加尔",
          "GK",
          "gk_shotstopper",
          67,
          "R"
        ],
        [
          "里卡尔多·罗西",
          "Riccardo Rossi",
          "意大利",
          "CB",
          "cb_stopper",
          67,
          "R"
        ],
        [
          "奥马尔·曼苏尔",
          "Omar Mansour",
          "摩洛哥",
          "W",
          "w_crosser",
          67,
          "L"
        ],
        [
          "安特·巴比奇",
          "Ante Babic",
          "克罗地亚",
          "CM",
          "cm_destroyer",
          67,
          "L"
        ],
        [
          "杰米·弗莱彻",
          "Jamie Fletcher",
          "英格兰",
          "ST",
          "st_finisher",
          67,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 48,
    "targetCa": 765,
    "actualCa": 758.593476516682,
    "kind": "generated",
    "team": {
      "id": "peak-48",
      "club": "西湾流浪者",
      "clubEn": "西湾流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "mid"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 765,
      "players": [
        [
          "奇迪·阿贾伊",
          "Chidi Ajayi",
          "尼日利亚",
          "GK",
          "gk_sweeper",
          73,
          "R"
        ],
        [
          "铃木大辉",
          "Daiki Suzuki",
          "日本",
          "W",
          "fb_attacking",
          73,
          "L"
        ],
        [
          "阿尔瓦罗·普列托",
          "Alvaro Prieto",
          "西班牙",
          "CB",
          "cb_ballplaying",
          73,
          "R"
        ],
        [
          "钟宇航",
          "Zhong Yuhang",
          "中国",
          "CB",
          "cb_stopper",
          71,
          "L"
        ],
        [
          "穆萨·恩迪亚耶",
          "Moussa Ndiaye",
          "塞内加尔",
          "W",
          "w_crosser",
          71,
          "L"
        ],
        [
          "莱昂·魏斯",
          "Leon Weiss",
          "德国",
          "CM",
          "cm_playmaker",
          71,
          "R"
        ],
        [
          "伊布拉希马·盖耶",
          "Ibrahima Gueye",
          "塞内加尔",
          "CM",
          "cm_playmaker",
          71,
          "R"
        ],
        [
          "约西普·西米奇",
          "Josip Simic",
          "克罗地亚",
          "CM",
          "cm_engine",
          70,
          "R"
        ],
        [
          "田思远",
          "Tian Siyuan",
          "中国",
          "W",
          "w_engine",
          70,
          "L"
        ],
        [
          "阿德·巴洛贡",
          "Ade Balogun",
          "尼日利亚",
          "ST",
          "st_false9",
          70,
          "R"
        ],
        [
          "尼科·卡斯特罗",
          "Nico Castro",
          "西班牙",
          "W",
          "fb_attacking",
          70,
          "R"
        ],
        [
          "许一鸣",
          "Xu Yiming",
          "中国",
          "GK",
          "gk_shotstopper",
          67,
          "R"
        ],
        [
          "许景行",
          "Xu Jingxing",
          "中国",
          "CB",
          "cb_ballplaying",
          67,
          "R"
        ],
        [
          "黄志勋",
          "Hwang Jihoon",
          "韩国",
          "W",
          "fb_attacking",
          67,
          "R"
        ],
        [
          "夸梅·奥塞",
          "Kwame Osei",
          "加纳",
          "CM",
          "cm_engine",
          67,
          "L"
        ],
        [
          "马泰奥·里奇",
          "Matteo Ricci",
          "意大利",
          "ST",
          "st_target",
          67,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 49,
    "targetCa": 770,
    "actualCa": 761.1564508937862,
    "kind": "generated",
    "team": {
      "id": "peak-49",
      "club": "金桥军团",
      "clubEn": "金桥军团",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "slow",
        "line": "mid",
        "press": "mid"
      },
      "color": "#f2a900",
      "accent": "#1a1a1a",
      "note": "PvE 生成球队",
      "targetCa": 770,
      "players": [
        [
          "里卡尔多·加利",
          "Riccardo Galli",
          "意大利",
          "GK",
          "gk_sweeper",
          73,
          "R"
        ],
        [
          "陈奕辰",
          "Chen Yichen",
          "中国",
          "W",
          "w_dribbler",
          73,
          "R"
        ],
        [
          "穆萨·巴",
          "Moussa Ba",
          "塞内加尔",
          "CB",
          "cb_stopper",
          73,
          "R"
        ],
        [
          "何承宇",
          "He Chengyu",
          "中国",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "伊布拉希马·萨尔",
          "Ibrahima Sarr",
          "塞内加尔",
          "W",
          "fb_attacking",
          71,
          "R"
        ],
        [
          "马丁·索科洛夫",
          "Martin Sokolov",
          "保加利亚",
          "CM",
          "cm_destroyer",
          71,
          "R"
        ],
        [
          "奥马尔·哈利勒",
          "Omar Khalil",
          "摩洛哥",
          "CM",
          "cm_destroyer",
          71,
          "L"
        ],
        [
          "阿尔琼·辛格",
          "Arjun Singh",
          "印度",
          "W",
          "fb_attacking",
          70,
          "R"
        ],
        [
          "加藤陆",
          "Riku Kato",
          "日本",
          "CM",
          "cm_box2box",
          70,
          "L"
        ],
        [
          "凯奥·卡多佐",
          "Caio Cardoso",
          "巴西",
          "W",
          "w_engine",
          70,
          "R"
        ],
        [
          "奎西·阿莫阿",
          "Kwesi Amoah",
          "加纳",
          "ST",
          "st_false9",
          70,
          "R"
        ],
        [
          "优素福·沙欣",
          "Yusuf Sahin",
          "土耳其",
          "GK",
          "gk_shotstopper",
          67,
          "R"
        ],
        [
          "费利佩·里贝罗",
          "Felipe Ribeiro",
          "巴西",
          "CB",
          "cb_stopper",
          67,
          "R"
        ],
        [
          "夸梅·阿桑特",
          "Kwame Asante",
          "加纳",
          "W",
          "w_playmaker",
          67,
          "R"
        ],
        [
          "铃木大辉",
          "Daiki Suzuki",
          "日本",
          "CM",
          "cm_destroyer",
          67,
          "R"
        ],
        [
          "马特乌斯·席尔瓦",
          "Matheus Silva",
          "巴西",
          "ST",
          "st_target",
          67,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 50,
    "targetCa": 780,
    "actualCa": 782.3185839608202,
    "kind": "generated",
    "team": {
      "id": "peak-50",
      "club": "黑潮联",
      "clubEn": "黑潮联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "fast",
        "line": "low",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 780,
      "players": [
        [
          "松田悠希",
          "Yuki Matsuda",
          "日本",
          "GK",
          "gk_sweeper",
          74,
          "R"
        ],
        [
          "尼科洛·丰塔纳",
          "Nicolo Fontana",
          "意大利",
          "CB",
          "cb_stopper",
          74,
          "R"
        ],
        [
          "奎西·门萨",
          "Kwesi Mensah",
          "加纳",
          "CB",
          "cb_cover",
          74,
          "L"
        ],
        [
          "亚乌·门萨",
          "Yaw Mensah",
          "加纳",
          "CB",
          "cb_ballplaying",
          72,
          "R"
        ],
        [
          "法昆多·帕雷德斯",
          "Facundo Paredes",
          "阿根廷",
          "W",
          "w_playmaker",
          72,
          "L"
        ],
        [
          "田若谷",
          "Tian Ruogu",
          "中国",
          "CM",
          "cm_playmaker",
          72,
          "R"
        ],
        [
          "许泽宇",
          "Xu Zeyu",
          "中国",
          "CM",
          "cm_engine",
          72,
          "R"
        ],
        [
          "琴克·厄兹蒂尔克",
          "Cenk Ozturk",
          "土耳其",
          "W",
          "w_engine",
          71,
          "R"
        ],
        [
          "芬恩·肖",
          "Finn Shaw",
          "英格兰",
          "W",
          "w_dribbler",
          71,
          "L"
        ],
        [
          "阿克塞尔·尼格伦",
          "Axel Nygren",
          "瑞典",
          "ST",
          "st_target",
          71,
          "R"
        ],
        [
          "何思远",
          "He Siyuan",
          "中国",
          "W",
          "w_finisher",
          71,
          "R"
        ],
        [
          "阿古斯丁·莱德斯马",
          "Agustin Ledesma",
          "阿根廷",
          "GK",
          "gk_sweeper",
          68,
          "R"
        ],
        [
          "马科斯·奥尔特加",
          "Marcos Ortega",
          "西班牙",
          "CB",
          "cb_cover",
          68,
          "R"
        ],
        [
          "塞杜·巴",
          "Seydou Ba",
          "塞内加尔",
          "W",
          "fb_playmaker",
          68,
          "R"
        ],
        [
          "黄志勋",
          "Hwang Jihoon",
          "韩国",
          "CM",
          "cm_engine",
          68,
          "R"
        ],
        [
          "马尔科·比安基",
          "Marco Bianchi",
          "意大利",
          "ST",
          "st_runner",
          68,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 51,
    "targetCa": 780,
    "actualCa": 784.4316693816959,
    "kind": "generated",
    "team": {
      "id": "peak-51",
      "club": "金桥军团 II",
      "clubEn": "金桥军团",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "slow",
        "line": "high",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 780,
      "players": [
        [
          "瑞安·休斯",
          "Ryan Hughes",
          "英格兰",
          "GK",
          "gk_sweeper",
          74,
          "R"
        ],
        [
          "奥比纳·奥卡福",
          "Obinna Okafor",
          "尼日利亚",
          "W",
          "fb_attacking",
          74,
          "R"
        ],
        [
          "阿德里安·迪皮伊",
          "Adrien Dupuis",
          "法国",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "杰克·福斯特",
          "Jack Foster",
          "英格兰",
          "CB",
          "cb_ballplaying",
          72,
          "L"
        ],
        [
          "罗汉·辛格",
          "Rohan Singh",
          "印度",
          "CB",
          "cb_stopper",
          72,
          "L"
        ],
        [
          "阿德里安·佩兰",
          "Adrien Perrin",
          "法国",
          "W",
          "w_playmaker",
          72,
          "R"
        ],
        [
          "尼古拉斯·阿吉雷",
          "Nicolas Aguirre",
          "阿根廷",
          "CM",
          "cm_creator",
          72,
          "R"
        ],
        [
          "凯·哈特",
          "Kai Hart",
          "英格兰",
          "CM",
          "cm_playmaker",
          71,
          "R"
        ],
        [
          "法比安·哈特曼",
          "Fabian Hartmann",
          "德国",
          "CM",
          "cm_creator",
          71,
          "R"
        ],
        [
          "谢赫·迪亚洛",
          "Cheikh Diallo",
          "塞内加尔",
          "ST",
          "st_runner",
          71,
          "R"
        ],
        [
          "埃里克·林德奎斯特",
          "Erik Lindqvist",
          "瑞典",
          "ST",
          "st_runner",
          71,
          "R"
        ],
        [
          "拉斐尔·席尔瓦",
          "Rafael Silva",
          "巴西",
          "GK",
          "gk_shotstopper",
          68,
          "R"
        ],
        [
          "秦一鸣",
          "Qin Yiming",
          "中国",
          "CB",
          "cb_stopper",
          68,
          "L"
        ],
        [
          "普林斯·奥塞",
          "Prince Osei",
          "加纳",
          "W",
          "w_playmaker",
          68,
          "R"
        ],
        [
          "卢卡斯·福格尔",
          "Lukas Vogel",
          "德国",
          "CM",
          "cm_mezzala",
          68,
          "R"
        ],
        [
          "里卡尔多·费里",
          "Riccardo Ferri",
          "意大利",
          "ST",
          "st_finisher",
          68,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 52,
    "targetCa": 790,
    "actualCa": 784.0507735292318,
    "kind": "generated",
    "team": {
      "id": "peak-52",
      "club": "远帆城",
      "clubEn": "远帆城",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "fast",
        "line": "high",
        "press": "low"
      },
      "color": "#8e1f2f",
      "accent": "#f0bc42",
      "note": "PvE 生成球队",
      "targetCa": 790,
      "players": [
        [
          "江牧野",
          "Jiang Muye",
          "中国",
          "GK",
          "gk_wall",
          74,
          "R"
        ],
        [
          "马马杜·迪亚洛",
          "Mamadou Diallo",
          "塞内加尔",
          "W",
          "fb_attacking",
          74,
          "R"
        ],
        [
          "金成珉",
          "Kim Sungmin",
          "韩国",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "菲利普·诺瓦克",
          "Filip Novak",
          "克罗地亚",
          "CB",
          "cb_cover",
          72,
          "L"
        ],
        [
          "桑德·尼尔松",
          "Sander Nilsson",
          "瑞典",
          "W",
          "fb_attacking",
          72,
          "R"
        ],
        [
          "巴斯蒂安·勒费弗尔",
          "Bastien Lefevre",
          "法国",
          "W",
          "w_playmaker",
          72,
          "L"
        ],
        [
          "赵奕辰",
          "Zhao Yichen",
          "中国",
          "CM",
          "cm_mezzala",
          72,
          "R"
        ],
        [
          "佛朗哥·梅迪纳",
          "Franco Medina",
          "阿根廷",
          "CM",
          "cm_mezzala",
          71,
          "R"
        ],
        [
          "里卡尔多·比安基",
          "Riccardo Bianchi",
          "意大利",
          "W",
          "fb_attacking",
          71,
          "R"
        ],
        [
          "约西普·巴比奇",
          "Josip Babic",
          "克罗地亚",
          "ST",
          "st_poacher",
          71,
          "L"
        ],
        [
          "古斯塔沃·巴尔博扎",
          "Gustavo Barbosa",
          "巴西",
          "ST",
          "st_false9",
          71,
          "R"
        ],
        [
          "阿德里安·迪皮伊",
          "Adrien Dupuis",
          "法国",
          "GK",
          "gk_shotstopper",
          68,
          "R"
        ],
        [
          "罗景行",
          "Luo Jingxing",
          "中国",
          "CB",
          "cb_cover",
          68,
          "R"
        ],
        [
          "苏俊驰",
          "Su Junchi",
          "中国",
          "W",
          "fb_playmaker",
          68,
          "L"
        ],
        [
          "哈里·科尔",
          "Harry Cole",
          "英格兰",
          "CM",
          "cm_mezzala",
          68,
          "L"
        ],
        [
          "埃米尔·贝克尔",
          "Emil Becker",
          "德国",
          "ST",
          "st_target",
          68,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 53,
    "targetCa": 795,
    "actualCa": 802.8750174288336,
    "kind": "generated",
    "team": {
      "id": "peak-53",
      "club": "风暴足球会",
      "clubEn": "风暴足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 795,
      "players": [
        [
          "马特乌斯·皮雷斯",
          "Matheus Pires",
          "巴西",
          "GK",
          "gk_shotstopper",
          75,
          "R"
        ],
        [
          "本·肖",
          "Ben Shaw",
          "英格兰",
          "W",
          "w_engine",
          75,
          "R"
        ],
        [
          "阿尔达·沙欣",
          "Arda Sahin",
          "土耳其",
          "CB",
          "cb_cover",
          75,
          "R"
        ],
        [
          "马格努斯·霍尔姆",
          "Magnus Holm",
          "瑞典",
          "CB",
          "cb_ballplaying",
          73,
          "R"
        ],
        [
          "达维德·罗西",
          "Davide Rossi",
          "意大利",
          "CB",
          "cb_ballplaying",
          73,
          "R"
        ],
        [
          "中村拓海",
          "Takumi Nakamura",
          "日本",
          "W",
          "w_engine",
          73,
          "R"
        ],
        [
          "凯莱奇·埃泽",
          "Kelechi Eze",
          "尼日利亚",
          "CM",
          "cm_box2box",
          73,
          "R"
        ],
        [
          "周修远",
          "Zhou Xiuyuan",
          "中国",
          "CM",
          "cm_destroyer",
          72,
          "R"
        ],
        [
          "伊藤直树",
          "Naoki Ito",
          "日本",
          "CM",
          "cm_destroyer",
          72,
          "R"
        ],
        [
          "尼古拉·巴比奇",
          "Nikola Babic",
          "克罗地亚",
          "ST",
          "st_runner",
          72,
          "L"
        ],
        [
          "刘易斯·福斯特",
          "Lewis Foster",
          "英格兰",
          "ST",
          "st_false9",
          72,
          "L"
        ],
        [
          "埃米尔·魏斯",
          "Emil Weiss",
          "德国",
          "GK",
          "gk_wall",
          69,
          "R"
        ],
        [
          "凯奥·塞拉",
          "Caio Serra",
          "巴西",
          "CB",
          "cb_ballplaying",
          69,
          "R"
        ],
        [
          "利奥·休斯",
          "Leo Hughes",
          "英格兰",
          "W",
          "fb_playmaker",
          69,
          "R"
        ],
        [
          "泰奥·迪皮伊",
          "Theo Dupuis",
          "法国",
          "CM",
          "cm_destroyer",
          69,
          "R"
        ],
        [
          "马克西姆·莫罗",
          "Maxime Moreau",
          "法国",
          "ST",
          "st_runner",
          69,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 54,
    "targetCa": 805,
    "actualCa": 802.7040757147231,
    "kind": "generated",
    "team": {
      "id": "peak-54",
      "club": "北岸联 IIII",
      "clubEn": "北岸联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "slow",
        "line": "high",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 805,
      "players": [
        [
          "伊布拉希马·西塞",
          "Ibrahima Cisse",
          "塞内加尔",
          "GK",
          "gk_sweeper",
          75,
          "R"
        ],
        [
          "尹书俊",
          "Yoon Seojun",
          "韩国",
          "W",
          "w_crosser",
          75,
          "L"
        ],
        [
          "约纳斯·福斯",
          "Jonas Voss",
          "德国",
          "CB",
          "cb_stopper",
          75,
          "R"
        ],
        [
          "卢卡斯·阿尔布雷希特",
          "Lukas Albrecht",
          "德国",
          "CB",
          "cb_stopper",
          73,
          "L"
        ],
        [
          "安德斯·尼格伦",
          "Anders Nygren",
          "瑞典",
          "CB",
          "cb_cover",
          73,
          "R"
        ],
        [
          "埃里克·林德奎斯特",
          "Erik Lindqvist",
          "瑞典",
          "W",
          "fb_playmaker",
          73,
          "R"
        ],
        [
          "姜泰熙",
          "Kang Taehee",
          "韩国",
          "CM",
          "cm_mezzala",
          73,
          "L"
        ],
        [
          "本·休斯",
          "Ben Hughes",
          "英格兰",
          "CM",
          "cm_playmaker",
          72,
          "R"
        ],
        [
          "巴斯蒂安·富尼耶",
          "Bastien Fournier",
          "法国",
          "CM",
          "cm_playmaker",
          72,
          "R"
        ],
        [
          "桑德·贝里",
          "Sander Berg",
          "瑞典",
          "ST",
          "st_finisher",
          72,
          "R"
        ],
        [
          "卡勒姆·梅森",
          "Callum Mason",
          "英格兰",
          "ST",
          "st_finisher",
          72,
          "R"
        ],
        [
          "崔宇镇",
          "Choi Woojin",
          "韩国",
          "GK",
          "gk_sweeper",
          69,
          "R"
        ],
        [
          "通德·巴洛贡",
          "Tunde Balogun",
          "尼日利亚",
          "CB",
          "cb_cover",
          69,
          "R"
        ],
        [
          "哈维尔·帕斯夸尔",
          "Javier Pascual",
          "西班牙",
          "W",
          "w_dribbler",
          69,
          "R"
        ],
        [
          "加藤优斗",
          "Yuto Kato",
          "日本",
          "CM",
          "cm_creator",
          69,
          "R"
        ],
        [
          "扬·里希特",
          "Jan Richter",
          "德国",
          "ST",
          "st_runner",
          69,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 55,
    "targetCa": 810,
    "actualCa": 803.0380561493726,
    "kind": "generated",
    "team": {
      "id": "peak-55",
      "club": "远帆青年",
      "clubEn": "远帆青年",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 810,
      "players": [
        [
          "古斯塔沃·巴尔博扎",
          "Gustavo Barbosa",
          "巴西",
          "GK",
          "gk_shotstopper",
          75,
          "L"
        ],
        [
          "埃利亚斯·阿尔布雷希特",
          "Elias Albrecht",
          "德国",
          "CB",
          "cb_stopper",
          75,
          "R"
        ],
        [
          "若昂·努内斯",
          "Joao Nunes",
          "巴西",
          "CB",
          "cb_ballplaying",
          75,
          "L"
        ],
        [
          "佐藤陆",
          "Riku Sato",
          "日本",
          "CB",
          "cb_cover",
          73,
          "R"
        ],
        [
          "亚尼斯·马尔尚",
          "Yanis Marchand",
          "法国",
          "W",
          "w_crosser",
          73,
          "R"
        ],
        [
          "安托万·迪皮伊",
          "Antoine Dupuis",
          "法国",
          "CM",
          "cm_box2box",
          73,
          "R"
        ],
        [
          "马格努斯·贝里",
          "Magnus Berg",
          "瑞典",
          "CM",
          "cm_destroyer",
          73,
          "R"
        ],
        [
          "尼古拉·霍尔瓦特",
          "Nikola Horvat",
          "克罗地亚",
          "W",
          "w_crosser",
          72,
          "R"
        ],
        [
          "奥比纳·奥涅卡",
          "Obinna Onyeka",
          "尼日利亚",
          "W",
          "fb_attacking",
          72,
          "L"
        ],
        [
          "马尔科·孔蒂",
          "Marco Conti",
          "意大利",
          "ST",
          "st_false9",
          72,
          "R"
        ],
        [
          "费利克斯·哈特曼",
          "Felix Hartmann",
          "德国",
          "W",
          "w_dribbler",
          72,
          "L"
        ],
        [
          "秦承宇",
          "Qin Chengyu",
          "中国",
          "GK",
          "gk_sweeper",
          69,
          "R"
        ],
        [
          "山田陆",
          "Riku Yamada",
          "日本",
          "CB",
          "cb_cover",
          69,
          "L"
        ],
        [
          "乌切·奥科耶",
          "Uche Okoye",
          "尼日利亚",
          "W",
          "w_finisher",
          69,
          "R"
        ],
        [
          "田知行",
          "Tian Zhixing",
          "中国",
          "CM",
          "cm_destroyer",
          69,
          "L"
        ],
        [
          "程浩然",
          "Cheng Haoran",
          "中国",
          "ST",
          "st_poacher",
          69,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 56,
    "targetCa": 820,
    "actualCa": 827.5506792868074,
    "kind": "generated",
    "team": {
      "id": "peak-56",
      "club": "灰岩雄狮",
      "clubEn": "灰岩雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "slow",
        "line": "low",
        "press": "low"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 820,
      "players": [
        [
          "尼克拉斯·法尔克",
          "Niklas Falk",
          "德国",
          "GK",
          "gk_sweeper",
          76,
          "L"
        ],
        [
          "芬恩·霍尔特",
          "Finn Holt",
          "英格兰",
          "W",
          "w_engine",
          76,
          "R"
        ],
        [
          "奥比纳·奥卡福",
          "Obinna Okafor",
          "尼日利亚",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "诺亚·肖",
          "Noah Shaw",
          "英格兰",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "佐藤海斗",
          "Kaito Sato",
          "日本",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "凯雷姆·切利克",
          "Kerem Celik",
          "土耳其",
          "W",
          "w_finisher",
          74,
          "L"
        ],
        [
          "哈坎·沙欣",
          "Hakan Sahin",
          "土耳其",
          "CM",
          "cm_destroyer",
          74,
          "R"
        ],
        [
          "安德斯·桑德贝里",
          "Anders Sandberg",
          "瑞典",
          "CM",
          "cm_playmaker",
          73,
          "L"
        ],
        [
          "乌斯曼·法尔",
          "Ousmane Fall",
          "塞内加尔",
          "CM",
          "cm_destroyer",
          73,
          "R"
        ],
        [
          "耶斯佩尔·埃克斯特伦",
          "Jesper Ekstrom",
          "瑞典",
          "ST",
          "st_runner",
          73,
          "R"
        ],
        [
          "桑德·拉森",
          "Sander Larsen",
          "瑞典",
          "ST",
          "st_finisher",
          73,
          "R"
        ],
        [
          "马马杜·恩迪亚耶",
          "Mamadou Ndiaye",
          "塞内加尔",
          "GK",
          "gk_wall",
          70,
          "R"
        ],
        [
          "萨米尔·哈利勒",
          "Samir Khalil",
          "摩洛哥",
          "CB",
          "cb_cover",
          70,
          "L"
        ],
        [
          "哈姆扎·哈达德",
          "Hamza Haddad",
          "摩洛哥",
          "W",
          "w_dribbler",
          70,
          "R"
        ],
        [
          "安德烈亚·加利",
          "Andrea Galli",
          "意大利",
          "CM",
          "cm_playmaker",
          70,
          "R"
        ],
        [
          "达里奥·奥尔特加",
          "Dario Ortega",
          "西班牙",
          "ST",
          "st_false9",
          70,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 57,
    "targetCa": 825,
    "actualCa": 825.7289650933577,
    "kind": "generated",
    "team": {
      "id": "peak-57",
      "club": "北岸竞技 II",
      "clubEn": "北岸竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 825,
      "players": [
        [
          "伊克尔·雷耶斯",
          "Iker Reyes",
          "西班牙",
          "GK",
          "gk_wall",
          76,
          "L"
        ],
        [
          "冯一鸣",
          "Feng Yiming",
          "中国",
          "W",
          "w_dribbler",
          76,
          "L"
        ],
        [
          "程景行",
          "Cheng Jingxing",
          "中国",
          "CB",
          "cb_stopper",
          76,
          "R"
        ],
        [
          "达维德·丰塔纳",
          "Davide Fontana",
          "意大利",
          "CB",
          "cb_stopper",
          74,
          "L"
        ],
        [
          "莫里茨·克劳泽",
          "Moritz Krause",
          "德国",
          "W",
          "w_playmaker",
          74,
          "R"
        ],
        [
          "卢卡·费里",
          "Luca Ferri",
          "意大利",
          "CM",
          "cm_engine",
          74,
          "L"
        ],
        [
          "高俊驰",
          "Gao Junchi",
          "中国",
          "CM",
          "cm_box2box",
          74,
          "R"
        ],
        [
          "铃木阳斗",
          "Haruto Suzuki",
          "日本",
          "CM",
          "cm_creator",
          73,
          "R"
        ],
        [
          "费利克斯·哈特曼",
          "Felix Hartmann",
          "德国",
          "W",
          "w_playmaker",
          73,
          "L"
        ],
        [
          "芬恩·科尔",
          "Finn Cole",
          "英格兰",
          "ST",
          "st_target",
          73,
          "R"
        ],
        [
          "埃里克·尼格伦",
          "Erik Nygren",
          "瑞典",
          "W",
          "w_playmaker",
          73,
          "R"
        ],
        [
          "苏承宇",
          "Su Chengyu",
          "中国",
          "GK",
          "gk_shotstopper",
          70,
          "R"
        ],
        [
          "埃比尼泽·门萨",
          "Ebenezer Mensah",
          "加纳",
          "CB",
          "cb_stopper",
          70,
          "L"
        ],
        [
          "达维德·比安基",
          "Davide Bianchi",
          "意大利",
          "W",
          "w_crosser",
          70,
          "R"
        ],
        [
          "马克西姆·迪皮伊",
          "Maxime Dupuis",
          "法国",
          "CM",
          "cm_destroyer",
          70,
          "R"
        ],
        [
          "卢卡·孔蒂",
          "Luca Conti",
          "意大利",
          "ST",
          "st_false9",
          70,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 58,
    "targetCa": 835,
    "actualCa": 845.7170745454546,
    "kind": "generated",
    "team": {
      "id": "peak-58",
      "club": "西湾矿工 II",
      "clubEn": "西湾矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "slow",
        "line": "mid",
        "press": "low"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 835,
      "players": [
        [
          "本·巴克",
          "Ben Barker",
          "英格兰",
          "GK",
          "gk_wall",
          77,
          "R"
        ],
        [
          "奥马尔·哈达德",
          "Omar Haddad",
          "摩洛哥",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "埃梅卡·阿贾伊",
          "Emeka Ajayi",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "西莫内·里纳尔迪",
          "Simone Rinaldi",
          "意大利",
          "CB",
          "cb_ballplaying",
          75,
          "R"
        ],
        [
          "约纳斯·福格尔",
          "Jonas Vogel",
          "德国",
          "W",
          "w_finisher",
          75,
          "R"
        ],
        [
          "蒂姆·布兰特",
          "Tim Brandt",
          "德国",
          "CM",
          "cm_mezzala",
          75,
          "R"
        ],
        [
          "拉斐尔·阿尔梅达",
          "Rafael Almeida",
          "巴西",
          "CM",
          "cm_playmaker",
          75,
          "R"
        ],
        [
          "赫里斯托·安格洛夫",
          "Hristo Angelov",
          "保加利亚",
          "W",
          "w_finisher",
          74,
          "R"
        ],
        [
          "陈浩然",
          "Chen Haoran",
          "中国",
          "W",
          "fb_attacking",
          74,
          "R"
        ],
        [
          "埃里克·斯特兰德",
          "Erik Strand",
          "瑞典",
          "ST",
          "st_target",
          74,
          "R"
        ],
        [
          "瑞安·贝内特",
          "Ryan Bennett",
          "英格兰",
          "W",
          "w_engine",
          74,
          "R"
        ],
        [
          "塞尔吉奥·莫利纳",
          "Sergio Molina",
          "西班牙",
          "GK",
          "gk_sweeper",
          71,
          "L"
        ],
        [
          "马丁·彼得罗夫",
          "Martin Petrov",
          "保加利亚",
          "CB",
          "cb_cover",
          71,
          "R"
        ],
        [
          "米克尔·埃克斯特伦",
          "Mikkel Ekstrom",
          "瑞典",
          "W",
          "w_playmaker",
          71,
          "R"
        ],
        [
          "马蒂斯·马尔尚",
          "Mathis Marchand",
          "法国",
          "CM",
          "cm_creator",
          71,
          "R"
        ],
        [
          "彼得·约万诺维奇",
          "Petar Jovanovic",
          "克罗地亚",
          "ST",
          "st_false9",
          71,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 59,
    "targetCa": 840,
    "actualCa": 846.6465995592287,
    "kind": "generated",
    "team": {
      "id": "peak-59",
      "club": "风暴流浪者",
      "clubEn": "风暴流浪者",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "low",
        "press": "mid"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 840,
      "players": [
        [
          "米兰·拉迪奇",
          "Milan Radic",
          "克罗地亚",
          "GK",
          "gk_shotstopper",
          77,
          "R"
        ],
        [
          "若昂·科斯塔",
          "Joao Costa",
          "巴西",
          "W",
          "w_crosser",
          77,
          "R"
        ],
        [
          "阿古斯丁·索萨",
          "Agustin Sosa",
          "阿根廷",
          "CB",
          "cb_cover",
          77,
          "R"
        ],
        [
          "伊格纳西奥·莱德斯马",
          "Ignacio Ledesma",
          "阿根廷",
          "CB",
          "cb_stopper",
          75,
          "R"
        ],
        [
          "达维德·巴罗内",
          "Davide Barone",
          "意大利",
          "W",
          "w_finisher",
          75,
          "L"
        ],
        [
          "朴在元",
          "Park Jaewon",
          "韩国",
          "CM",
          "cm_box2box",
          75,
          "R"
        ],
        [
          "米克尔·拉森",
          "Mikkel Larsen",
          "瑞典",
          "CM",
          "cm_destroyer",
          75,
          "R"
        ],
        [
          "高牧野",
          "Gao Muye",
          "中国",
          "W",
          "fb_attacking",
          74,
          "L"
        ],
        [
          "阿克塞尔·拉森",
          "Axel Larsen",
          "瑞典",
          "CM",
          "cm_destroyer",
          74,
          "R"
        ],
        [
          "安特·拉迪奇",
          "Ante Radic",
          "克罗地亚",
          "W",
          "fb_playmaker",
          74,
          "R"
        ],
        [
          "卢卡·格雷科",
          "Luca Greco",
          "意大利",
          "ST",
          "st_poacher",
          74,
          "R"
        ],
        [
          "卢卡斯·塞拉",
          "Lucas Serra",
          "巴西",
          "GK",
          "gk_shotstopper",
          71,
          "L"
        ],
        [
          "费德里科·费里",
          "Federico Ferri",
          "意大利",
          "CB",
          "cb_stopper",
          71,
          "R"
        ],
        [
          "乌切·阿贾伊",
          "Uche Ajayi",
          "尼日利亚",
          "W",
          "w_engine",
          71,
          "R"
        ],
        [
          "布鲁诺·卡多佐",
          "Bruno Cardoso",
          "巴西",
          "CM",
          "cm_creator",
          71,
          "R"
        ],
        [
          "朱利安·勒费弗尔",
          "Julien Lefevre",
          "法国",
          "ST",
          "st_finisher",
          71,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 60,
    "targetCa": 850,
    "actualCa": 844.9303828619529,
    "kind": "generated",
    "team": {
      "id": "peak-60",
      "club": "灰岩青年",
      "clubEn": "灰岩青年",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 850,
      "players": [
        [
          "扬·福斯",
          "Jan Voss",
          "德国",
          "GK",
          "gk_wall",
          77,
          "L"
        ],
        [
          "乌切·奥涅卡",
          "Uche Onyeka",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "莫里茨·哈特曼",
          "Moritz Hartmann",
          "德国",
          "CB",
          "cb_stopper",
          77,
          "R"
        ],
        [
          "莫里茨·里希特",
          "Moritz Richter",
          "德国",
          "CB",
          "cb_ballplaying",
          75,
          "L"
        ],
        [
          "钟文博",
          "Zhong Wenbo",
          "中国",
          "W",
          "fb_attacking",
          75,
          "L"
        ],
        [
          "格奥尔基·彼得罗夫",
          "Georgi Petrov",
          "保加利亚",
          "CM",
          "cm_playmaker",
          75,
          "R"
        ],
        [
          "郑成珉",
          "Jung Sungmin",
          "韩国",
          "CM",
          "cm_box2box",
          75,
          "R"
        ],
        [
          "法昆多·罗哈斯",
          "Facundo Rojas",
          "阿根廷",
          "W",
          "w_engine",
          74,
          "L"
        ],
        [
          "奥斯卡·隆德",
          "Oscar Lund",
          "瑞典",
          "W",
          "w_dribbler",
          74,
          "R"
        ],
        [
          "费德里科·格雷科",
          "Federico Greco",
          "意大利",
          "ST",
          "st_false9",
          74,
          "R"
        ],
        [
          "佛朗哥·罗哈斯",
          "Franco Rojas",
          "阿根廷",
          "W",
          "w_crosser",
          74,
          "L"
        ],
        [
          "奥斯卡·桑德贝里",
          "Oscar Sandberg",
          "瑞典",
          "GK",
          "gk_sweeper",
          71,
          "L"
        ],
        [
          "程景行",
          "Cheng Jingxing",
          "中国",
          "CB",
          "cb_ballplaying",
          71,
          "R"
        ],
        [
          "布鲁诺·卡多佐",
          "Bruno Cardoso",
          "巴西",
          "W",
          "w_dribbler",
          71,
          "R"
        ],
        [
          "阿尔达·切利克",
          "Arda Celik",
          "土耳其",
          "CM",
          "cm_playmaker",
          71,
          "R"
        ],
        [
          "科菲·门萨",
          "Kofi Mensah",
          "加纳",
          "ST",
          "st_finisher",
          71,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 61,
    "targetCa": 850,
    "actualCa": 843.1505480777472,
    "kind": "generated",
    "team": {
      "id": "peak-61",
      "club": "金桥之队",
      "clubEn": "金桥之队",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-4-2",
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
      "targetCa": 850,
      "players": [
        [
          "米兰·马尔科维奇",
          "Milan Markovic",
          "克罗地亚",
          "GK",
          "gk_shotstopper",
          77,
          "R"
        ],
        [
          "秦子昂",
          "Qin Ziang",
          "中国",
          "W",
          "w_crosser",
          77,
          "R"
        ],
        [
          "埃利亚斯·阿尔布雷希特",
          "Elias Albrecht",
          "德国",
          "CB",
          "cb_stopper",
          77,
          "R"
        ],
        [
          "山田莲",
          "Ren Yamada",
          "日本",
          "CB",
          "cb_ballplaying",
          75,
          "R"
        ],
        [
          "林知行",
          "Lin Zhixing",
          "中国",
          "W",
          "fb_playmaker",
          75,
          "R"
        ],
        [
          "罗汉·夏尔马",
          "Rohan Sharma",
          "印度",
          "W",
          "fb_attacking",
          75,
          "R"
        ],
        [
          "亚辛·沙基尔",
          "Yassine Chakir",
          "摩洛哥",
          "CM",
          "cm_playmaker",
          75,
          "L"
        ],
        [
          "伊布拉希马·萨尔",
          "Ibrahima Sarr",
          "塞内加尔",
          "CM",
          "cm_box2box",
          74,
          "R"
        ],
        [
          "田奕辰",
          "Tian Yichen",
          "中国",
          "W",
          "fb_playmaker",
          74,
          "L"
        ],
        [
          "赵宇航",
          "Zhao Yuhang",
          "中国",
          "ST",
          "st_target",
          74,
          "R"
        ],
        [
          "阿尤布·贝纳利",
          "Ayoub Benali",
          "摩洛哥",
          "ST",
          "st_finisher",
          74,
          "R"
        ],
        [
          "凯莱奇·阿贾伊",
          "Kelechi Ajayi",
          "尼日利亚",
          "GK",
          "gk_wall",
          71,
          "R"
        ],
        [
          "唐知行",
          "Tang Zhixing",
          "中国",
          "CB",
          "cb_ballplaying",
          71,
          "R"
        ],
        [
          "马格努斯·埃克斯特伦",
          "Magnus Ekstrom",
          "瑞典",
          "W",
          "w_finisher",
          71,
          "L"
        ],
        [
          "方一鸣",
          "Fang Yiming",
          "中国",
          "CM",
          "cm_destroyer",
          71,
          "L"
        ],
        [
          "程泽宇",
          "Cheng Zeyu",
          "中国",
          "ST",
          "st_false9",
          71,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 62,
    "targetCa": 860,
    "actualCa": 870.0566452372208,
    "kind": "generated",
    "team": {
      "id": "peak-62",
      "club": "林海联 II",
      "clubEn": "林海联",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "slow",
        "line": "low",
        "press": "high"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 860,
      "players": [
        [
          "秦俊驰",
          "Qin Junchi",
          "中国",
          "GK",
          "gk_shotstopper",
          78,
          "L"
        ],
        [
          "塞尔吉奥·维加",
          "Sergio Vega",
          "西班牙",
          "CB",
          "cb_ballplaying",
          78,
          "R"
        ],
        [
          "迭戈·埃雷拉",
          "Diego Herrera",
          "西班牙",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "斯特凡·霍尔瓦特",
          "Stefan Horvat",
          "克罗地亚",
          "CB",
          "cb_stopper",
          76,
          "L"
        ],
        [
          "安德斯·林德奎斯特",
          "Anders Lindqvist",
          "瑞典",
          "W",
          "w_playmaker",
          76,
          "R"
        ],
        [
          "达里奥·奥尔特加",
          "Dario Ortega",
          "西班牙",
          "CM",
          "cm_creator",
          76,
          "L"
        ],
        [
          "阿尔琼·帕特尔",
          "Arjun Patel",
          "印度",
          "CM",
          "cm_mezzala",
          76,
          "R"
        ],
        [
          "卢卡斯·阿尔布雷希特",
          "Lukas Albrecht",
          "德国",
          "CM",
          "cm_playmaker",
          75,
          "R"
        ],
        [
          "陈修远",
          "Chen Xiuyuan",
          "中国",
          "W",
          "w_playmaker",
          75,
          "R"
        ],
        [
          "雷南·里贝罗",
          "Renan Ribeiro",
          "巴西",
          "ST",
          "st_runner",
          75,
          "R"
        ],
        [
          "埃兹拉·维尔",
          "Ezra Vale",
          "英格兰",
          "ST",
          "st_finisher",
          75,
          "R"
        ],
        [
          "莱昂·福斯",
          "Leon Voss",
          "德国",
          "GK",
          "gk_shotstopper",
          72,
          "R"
        ],
        [
          "卡里姆·沙基尔",
          "Karim Chakir",
          "摩洛哥",
          "CB",
          "cb_cover",
          72,
          "R"
        ],
        [
          "达维德·孔蒂",
          "Davide Conti",
          "意大利",
          "W",
          "w_playmaker",
          72,
          "R"
        ],
        [
          "达里奥·埃雷拉",
          "Dario Herrera",
          "西班牙",
          "CM",
          "cm_creator",
          72,
          "R"
        ],
        [
          "马蒂斯·戈蒂埃",
          "Mathis Gauthier",
          "法国",
          "ST",
          "st_target",
          72,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 63,
    "targetCa": 865,
    "actualCa": 865.126798469544,
    "kind": "generated",
    "team": {
      "id": "peak-63",
      "club": "西湾矿工 IIII",
      "clubEn": "西湾矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "fast",
        "line": "low",
        "press": "mid"
      },
      "color": "#8e1f2f",
      "accent": "#f0bc42",
      "note": "PvE 生成球队",
      "targetCa": 865,
      "players": [
        [
          "塔里克·阿姆拉尼",
          "Tarek Amrani",
          "摩洛哥",
          "GK",
          "gk_shotstopper",
          78,
          "R"
        ],
        [
          "卢卡斯·凯勒",
          "Lukas Keller",
          "德国",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "埃米尔·里希特",
          "Emil Richter",
          "德国",
          "CB",
          "cb_ballplaying",
          78,
          "R"
        ],
        [
          "魏思远",
          "Wei Siyuan",
          "中国",
          "CB",
          "cb_stopper",
          76,
          "R"
        ],
        [
          "李敏俊",
          "Lee Minjun",
          "韩国",
          "W",
          "w_playmaker",
          76,
          "R"
        ],
        [
          "钟景行",
          "Zhong Jingxing",
          "中国",
          "CM",
          "cm_box2box",
          76,
          "L"
        ],
        [
          "乌切·奥卡福",
          "Uche Okafor",
          "尼日利亚",
          "CM",
          "cm_box2box",
          76,
          "R"
        ],
        [
          "亚辛·沙基尔",
          "Yassine Chakir",
          "摩洛哥",
          "W",
          "fb_playmaker",
          75,
          "L"
        ],
        [
          "李成珉",
          "Lee Sungmin",
          "韩国",
          "W",
          "fb_playmaker",
          75,
          "R"
        ],
        [
          "崔志勋",
          "Choi Jihoon",
          "韩国",
          "ST",
          "st_finisher",
          75,
          "R"
        ],
        [
          "古斯塔沃·卡多佐",
          "Gustavo Cardoso",
          "巴西",
          "W",
          "w_crosser",
          75,
          "R"
        ],
        [
          "尼古拉斯·贝尼特斯",
          "Nicolas Benitez",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          72,
          "L"
        ],
        [
          "华金·卡夫雷拉",
          "Joaquin Cabrera",
          "阿根廷",
          "CB",
          "cb_ballplaying",
          72,
          "R"
        ],
        [
          "扬·法尔克",
          "Jan Falk",
          "德国",
          "W",
          "w_crosser",
          72,
          "R"
        ],
        [
          "尼克拉斯·里希特",
          "Niklas Richter",
          "德国",
          "CM",
          "cm_creator",
          72,
          "R"
        ],
        [
          "陆浩然",
          "Lu Haoran",
          "中国",
          "ST",
          "st_false9",
          72,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 64,
    "targetCa": 875,
    "actualCa": 867.8249701530455,
    "kind": "generated",
    "team": {
      "id": "peak-64",
      "club": "青锋足球会",
      "clubEn": "青锋足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "mid",
        "press": "low"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 875,
      "players": [
        [
          "安德烈·莫拉",
          "Andre Moura",
          "巴西",
          "GK",
          "gk_shotstopper",
          78,
          "R"
        ],
        [
          "阿古斯丁·贝尼特斯",
          "Agustin Benitez",
          "阿根廷",
          "W",
          "w_crosser",
          78,
          "R"
        ],
        [
          "尼古拉·马尔科维奇",
          "Nikola Markovic",
          "克罗地亚",
          "CB",
          "cb_ballplaying",
          78,
          "R"
        ],
        [
          "小林优斗",
          "Yuto Kobayashi",
          "日本",
          "CB",
          "cb_stopper",
          76,
          "R"
        ],
        [
          "高桥直树",
          "Naoki Takahashi",
          "日本",
          "W",
          "fb_attacking",
          76,
          "L"
        ],
        [
          "马蒂斯·佩兰",
          "Mathis Perrin",
          "法国",
          "CM",
          "cm_creator",
          76,
          "R"
        ],
        [
          "田云舟",
          "Tian Yunzhou",
          "中国",
          "CM",
          "cm_creator",
          76,
          "L"
        ],
        [
          "恩佐·马尔尚",
          "Enzo Marchand",
          "法国",
          "CM",
          "cm_playmaker",
          75,
          "R"
        ],
        [
          "伊藤优斗",
          "Yuto Ito",
          "日本",
          "W",
          "w_engine",
          75,
          "R"
        ],
        [
          "马科斯·纳瓦罗",
          "Marcos Navarro",
          "西班牙",
          "ST",
          "st_poacher",
          75,
          "R"
        ],
        [
          "韩博文",
          "Han Bowen",
          "中国",
          "W",
          "w_playmaker",
          75,
          "R"
        ],
        [
          "阿尔瓦罗·维加",
          "Alvaro Vega",
          "西班牙",
          "GK",
          "gk_shotstopper",
          72,
          "L"
        ],
        [
          "卢卡·孔蒂",
          "Luca Conti",
          "意大利",
          "CB",
          "cb_ballplaying",
          72,
          "R"
        ],
        [
          "马尔科·比安基",
          "Marco Bianchi",
          "意大利",
          "W",
          "fb_attacking",
          72,
          "R"
        ],
        [
          "谢赫·西塞",
          "Cheikh Cisse",
          "塞内加尔",
          "CM",
          "cm_creator",
          72,
          "R"
        ],
        [
          "林牧野",
          "Lin Muye",
          "中国",
          "ST",
          "st_false9",
          72,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 65,
    "targetCa": 880,
    "actualCa": 873.5899735935109,
    "kind": "generated",
    "team": {
      "id": "peak-65",
      "club": "晨星雄狮 II",
      "clubEn": "晨星雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "mid"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 880,
      "players": [
        [
          "卢卡斯·费雷拉",
          "Lucas Ferreira",
          "巴西",
          "GK",
          "gk_wall",
          78,
          "R"
        ],
        [
          "奥比纳·恩沃苏",
          "Obinna Nwosu",
          "尼日利亚",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "马特乌斯·巴尔博扎",
          "Matheus Barbosa",
          "巴西",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "黄宇镇",
          "Hwang Woojin",
          "韩国",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "马科斯·莫利纳",
          "Marcos Molina",
          "西班牙",
          "W",
          "w_finisher",
          76,
          "R"
        ],
        [
          "恩佐·吉拉尔",
          "Enzo Girard",
          "法国",
          "CM",
          "cm_destroyer",
          76,
          "R"
        ],
        [
          "优素福·卡亚",
          "Yusuf Kaya",
          "土耳其",
          "CM",
          "cm_destroyer",
          76,
          "L"
        ],
        [
          "塔里克·贝纳利",
          "Tarek Benali",
          "摩洛哥",
          "W",
          "w_crosser",
          75,
          "L"
        ],
        [
          "加藤优斗",
          "Yuto Kato",
          "日本",
          "W",
          "w_finisher",
          75,
          "R"
        ],
        [
          "马尔科·马尔科维奇",
          "Marko Markovic",
          "克罗地亚",
          "ST",
          "st_runner",
          75,
          "L"
        ],
        [
          "佐藤莲",
          "Ren Sato",
          "日本",
          "W",
          "w_dribbler",
          75,
          "R"
        ],
        [
          "耶斯佩尔·贝里",
          "Jesper Berg",
          "瑞典",
          "GK",
          "gk_shotstopper",
          72,
          "L"
        ],
        [
          "埃米利亚诺·梅迪纳",
          "Emiliano Medina",
          "阿根廷",
          "CB",
          "cb_stopper",
          72,
          "R"
        ],
        [
          "铃木健太",
          "Kenta Suzuki",
          "日本",
          "W",
          "w_finisher",
          72,
          "R"
        ],
        [
          "里卡尔多·里纳尔迪",
          "Riccardo Rinaldi",
          "意大利",
          "CM",
          "cm_mezzala",
          72,
          "R"
        ],
        [
          "琴克·切利克",
          "Cenk Celik",
          "土耳其",
          "ST",
          "st_runner",
          72,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 66,
    "targetCa": 890,
    "actualCa": 891.9073698132844,
    "kind": "generated",
    "team": {
      "id": "peak-66",
      "club": "白塔竞技会",
      "clubEn": "白塔竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 890,
      "players": [
        [
          "罗牧野",
          "Luo Muye",
          "中国",
          "GK",
          "gk_wall",
          79,
          "L"
        ],
        [
          "凯莱奇·阿贾伊",
          "Kelechi Ajayi",
          "尼日利亚",
          "CB",
          "cb_stopper",
          79,
          "R"
        ],
        [
          "唐启航",
          "Tang Qihang",
          "中国",
          "CB",
          "cb_stopper",
          79,
          "L"
        ],
        [
          "托马斯·卡夫雷拉",
          "Tomas Cabrera",
          "阿根廷",
          "CB",
          "cb_stopper",
          77,
          "R"
        ],
        [
          "达维德·罗西",
          "Davide Rossi",
          "意大利",
          "W",
          "w_finisher",
          77,
          "R"
        ],
        [
          "乌切·阿贾伊",
          "Uche Ajayi",
          "尼日利亚",
          "CM",
          "cm_engine",
          77,
          "R"
        ],
        [
          "尼古拉·霍尔瓦特",
          "Nikola Horvat",
          "克罗地亚",
          "CM",
          "cm_creator",
          77,
          "R"
        ],
        [
          "林星河",
          "Lin Xinghe",
          "中国",
          "W",
          "fb_playmaker",
          76,
          "R"
        ],
        [
          "芬恩·霍尔特",
          "Finn Holt",
          "英格兰",
          "W",
          "w_engine",
          76,
          "L"
        ],
        [
          "圣地亚哥·贝尼特斯",
          "Santiago Benitez",
          "阿根廷",
          "ST",
          "st_runner",
          76,
          "R"
        ],
        [
          "古斯塔沃·卡多佐",
          "Gustavo Cardoso",
          "巴西",
          "W",
          "w_dribbler",
          76,
          "R"
        ],
        [
          "蒂姆·福斯",
          "Tim Voss",
          "德国",
          "GK",
          "gk_shotstopper",
          73,
          "R"
        ],
        [
          "马克西姆·富尼耶",
          "Maxime Fournier",
          "法国",
          "CB",
          "cb_cover",
          73,
          "L"
        ],
        [
          "哈维尔·埃雷拉",
          "Javier Herrera",
          "西班牙",
          "W",
          "fb_attacking",
          73,
          "L"
        ],
        [
          "塞杜·恩迪亚耶",
          "Seydou Ndiaye",
          "塞内加尔",
          "CM",
          "cm_playmaker",
          73,
          "R"
        ],
        [
          "黄在元",
          "Hwang Jaewon",
          "韩国",
          "ST",
          "st_finisher",
          73,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 67,
    "targetCa": 895,
    "actualCa": 889.9039175573921,
    "kind": "generated",
    "team": {
      "id": "peak-67",
      "club": "长弓矿工",
      "clubEn": "长弓矿工",
      "season": "",
      "coach": "生成教练",
      "tier": "B",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "low",
        "press": "high"
      },
      "color": "#8e1f2f",
      "accent": "#f0bc42",
      "note": "PvE 生成球队",
      "targetCa": 895,
      "players": [
        [
          "高桥阳斗",
          "Haruto Takahashi",
          "日本",
          "GK",
          "gk_wall",
          79,
          "L"
        ],
        [
          "哈里·道森",
          "Harry Dawson",
          "英格兰",
          "W",
          "fb_attacking",
          79,
          "L"
        ],
        [
          "马蒂斯·佩兰",
          "Mathis Perrin",
          "法国",
          "CB",
          "cb_stopper",
          79,
          "R"
        ],
        [
          "冯子昂",
          "Feng Ziang",
          "中国",
          "CB",
          "cb_stopper",
          77,
          "L"
        ],
        [
          "芬恩·弗莱彻",
          "Finn Fletcher",
          "英格兰",
          "W",
          "fb_attacking",
          77,
          "R"
        ],
        [
          "马尔科·约万诺维奇",
          "Marko Jovanovic",
          "克罗地亚",
          "CM",
          "cm_playmaker",
          77,
          "R"
        ],
        [
          "魏启航",
          "Wei Qihang",
          "中国",
          "W",
          "fb_attacking",
          77,
          "R"
        ],
        [
          "哈里·福斯特",
          "Harry Foster",
          "英格兰",
          "CM",
          "cm_creator",
          76,
          "R"
        ],
        [
          "加藤大辉",
          "Daiki Kato",
          "日本",
          "CM",
          "cm_destroyer",
          76,
          "R"
        ],
        [
          "马蒂斯·莫罗",
          "Mathis Moreau",
          "法国",
          "W",
          "fb_attacking",
          76,
          "L"
        ],
        [
          "马利克·萨尔",
          "Malick Sarr",
          "塞内加尔",
          "ST",
          "st_target",
          76,
          "R"
        ],
        [
          "若昂·里贝罗",
          "Joao Ribeiro",
          "巴西",
          "GK",
          "gk_wall",
          73,
          "R"
        ],
        [
          "何宇航",
          "He Yuhang",
          "中国",
          "CB",
          "cb_ballplaying",
          73,
          "R"
        ],
        [
          "李志勋",
          "Lee Jihoon",
          "韩国",
          "W",
          "w_playmaker",
          73,
          "R"
        ],
        [
          "杰米·维尔",
          "Jamie Vale",
          "英格兰",
          "CM",
          "cm_creator",
          73,
          "R"
        ],
        [
          "里卡尔多·加利",
          "Riccardo Galli",
          "意大利",
          "ST",
          "st_poacher",
          73,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 68,
    "targetCa": 905,
    "actualCa": 914.3710785583103,
    "kind": "generated",
    "team": {
      "id": "peak-68",
      "club": "白塔足球会",
      "clubEn": "白塔足球会",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 905,
      "players": [
        [
          "钟若谷",
          "Zhong Ruogu",
          "中国",
          "GK",
          "gk_sweeper",
          80,
          "R"
        ],
        [
          "米兰·马尔科维奇",
          "Milan Markovic",
          "克罗地亚",
          "W",
          "w_crosser",
          80,
          "R"
        ],
        [
          "安特·拉迪奇",
          "Ante Radic",
          "克罗地亚",
          "CB",
          "cb_cover",
          80,
          "R"
        ],
        [
          "韩星河",
          "Han Xinghe",
          "中国",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "通德·奥涅卡",
          "Tunde Onyeka",
          "尼日利亚",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "安德烈亚·加利",
          "Andrea Galli",
          "意大利",
          "W",
          "fb_playmaker",
          78,
          "L"
        ],
        [
          "圣地亚哥·罗哈斯",
          "Santiago Rojas",
          "阿根廷",
          "CM",
          "cm_creator",
          78,
          "L"
        ],
        [
          "桑德·霍尔姆",
          "Sander Holm",
          "瑞典",
          "CM",
          "cm_destroyer",
          77,
          "L"
        ],
        [
          "加藤莲",
          "Ren Kato",
          "日本",
          "CM",
          "cm_box2box",
          77,
          "R"
        ],
        [
          "阿德·阿德耶米",
          "Ade Adeyemi",
          "尼日利亚",
          "ST",
          "st_poacher",
          77,
          "R"
        ],
        [
          "贡萨洛·罗哈斯",
          "Gonzalo Rojas",
          "阿根廷",
          "ST",
          "st_false9",
          77,
          "L"
        ],
        [
          "伊克尔·埃雷拉",
          "Iker Herrera",
          "西班牙",
          "GK",
          "gk_wall",
          74,
          "R"
        ],
        [
          "马科斯·维加",
          "Marcos Vega",
          "西班牙",
          "CB",
          "cb_cover",
          74,
          "L"
        ],
        [
          "马特奥·纳瓦罗",
          "Mateo Navarro",
          "西班牙",
          "W",
          "w_crosser",
          74,
          "L"
        ],
        [
          "托马斯·阿科斯塔",
          "Tomas Acosta",
          "阿根廷",
          "CM",
          "cm_box2box",
          74,
          "R"
        ],
        [
          "陈宇航",
          "Chen Yuhang",
          "中国",
          "ST",
          "st_false9",
          74,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 69,
    "targetCa": 910,
    "actualCa": 915.5853568074687,
    "kind": "generated",
    "team": {
      "id": "peak-69",
      "club": "黑潮竞技会",
      "clubEn": "黑潮竞技会",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 910,
      "players": [
        [
          "贾科莫·里纳尔迪",
          "Giacomo Rinaldi",
          "意大利",
          "GK",
          "gk_wall",
          80,
          "L"
        ],
        [
          "马马杜·恩迪亚耶",
          "Mamadou Ndiaye",
          "塞内加尔",
          "W",
          "w_playmaker",
          80,
          "R"
        ],
        [
          "阿德里安·加拉多",
          "Adrian Gallardo",
          "西班牙",
          "CB",
          "cb_stopper",
          80,
          "L"
        ],
        [
          "卢卡斯·皮雷斯",
          "Lucas Pires",
          "巴西",
          "CB",
          "cb_cover",
          78,
          "L"
        ],
        [
          "罗亦凡",
          "Luo Yifan",
          "中国",
          "W",
          "w_dribbler",
          78,
          "R"
        ],
        [
          "凯·休斯",
          "Kai Hughes",
          "英格兰",
          "CM",
          "cm_mezzala",
          78,
          "L"
        ],
        [
          "伊格纳西奥·帕雷德斯",
          "Ignacio Paredes",
          "阿根廷",
          "CM",
          "cm_creator",
          78,
          "R"
        ],
        [
          "陆泽宇",
          "Lu Zeyu",
          "中国",
          "W",
          "fb_attacking",
          77,
          "L"
        ],
        [
          "夸梅·阿多",
          "Kwame Addo",
          "加纳",
          "CM",
          "cm_creator",
          77,
          "R"
        ],
        [
          "马利克·巴",
          "Malick Ba",
          "塞内加尔",
          "W",
          "w_crosser",
          77,
          "R"
        ],
        [
          "达维德·加利",
          "Davide Galli",
          "意大利",
          "ST",
          "st_runner",
          77,
          "R"
        ],
        [
          "达里奥·罗梅罗",
          "Dario Romero",
          "西班牙",
          "GK",
          "gk_wall",
          74,
          "R"
        ],
        [
          "江天佑",
          "Jiang Tianyou",
          "中国",
          "CB",
          "cb_cover",
          74,
          "L"
        ],
        [
          "哈里·贝内特",
          "Harry Bennett",
          "英格兰",
          "W",
          "w_engine",
          74,
          "R"
        ],
        [
          "欧文·帕克",
          "Owen Parker",
          "英格兰",
          "CM",
          "cm_creator",
          74,
          "R"
        ],
        [
          "泰奥·戈蒂埃",
          "Theo Gauthier",
          "法国",
          "ST",
          "st_poacher",
          74,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 70,
    "targetCa": 920,
    "actualCa": 912.535308962351,
    "kind": "generated",
    "team": {
      "id": "peak-70",
      "club": "东岭竞技 II",
      "clubEn": "东岭竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "high",
        "press": "low"
      },
      "color": "#37474f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 920,
      "players": [
        [
          "赵若谷",
          "Zhao Ruogu",
          "中国",
          "GK",
          "gk_wall",
          80,
          "R"
        ],
        [
          "尼科洛·巴罗内",
          "Nicolo Barone",
          "意大利",
          "CB",
          "cb_ballplaying",
          80,
          "R"
        ],
        [
          "魏雨辰",
          "Wei Yuchen",
          "中国",
          "CB",
          "cb_stopper",
          80,
          "R"
        ],
        [
          "通德·阿贾伊",
          "Tunde Ajayi",
          "尼日利亚",
          "CB",
          "cb_stopper",
          78,
          "L"
        ],
        [
          "亚尼斯·戈蒂埃",
          "Yanis Gauthier",
          "法国",
          "W",
          "w_engine",
          78,
          "R"
        ],
        [
          "安托万·勒纳尔",
          "Antoine Renard",
          "法国",
          "CM",
          "cm_destroyer",
          78,
          "R"
        ],
        [
          "埃米尔·里希特",
          "Emil Richter",
          "德国",
          "CM",
          "cm_mezzala",
          78,
          "R"
        ],
        [
          "苏尼尔·帕特尔",
          "Sunil Patel",
          "印度",
          "W",
          "w_engine",
          77,
          "R"
        ],
        [
          "本·帕克",
          "Ben Parker",
          "英格兰",
          "W",
          "w_crosser",
          77,
          "R"
        ],
        [
          "路易·莫罗",
          "Louis Moreau",
          "法国",
          "ST",
          "st_false9",
          77,
          "R"
        ],
        [
          "奎西·门萨",
          "Kwesi Mensah",
          "加纳",
          "W",
          "fb_attacking",
          77,
          "R"
        ],
        [
          "阿德·巴洛贡",
          "Ade Balogun",
          "尼日利亚",
          "GK",
          "gk_sweeper",
          74,
          "L"
        ],
        [
          "卢卡斯·莱曼",
          "Lukas Lehmann",
          "德国",
          "CB",
          "cb_cover",
          74,
          "R"
        ],
        [
          "森直树",
          "Naoki Mori",
          "日本",
          "W",
          "w_finisher",
          74,
          "R"
        ],
        [
          "法比安·哈特曼",
          "Fabian Hartmann",
          "德国",
          "CM",
          "cm_creator",
          74,
          "R"
        ],
        [
          "陈明远",
          "Chen Mingyuan",
          "中国",
          "ST",
          "st_finisher",
          74,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 71,
    "targetCa": 920,
    "actualCa": 914.1894825650444,
    "kind": "generated",
    "team": {
      "id": "peak-71",
      "club": "远帆海港",
      "clubEn": "远帆海港",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "slow",
        "line": "mid",
        "press": "mid"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 920,
      "players": [
        [
          "巴勃罗·奥尔特加",
          "Pablo Ortega",
          "西班牙",
          "GK",
          "gk_sweeper",
          80,
          "R"
        ],
        [
          "阿克塞尔·达尔",
          "Axel Dahl",
          "瑞典",
          "W",
          "w_engine",
          80,
          "R"
        ],
        [
          "贾科莫·罗西",
          "Giacomo Rossi",
          "意大利",
          "CB",
          "cb_ballplaying",
          80,
          "R"
        ],
        [
          "利亚姆·巴克",
          "Liam Barker",
          "英格兰",
          "CB",
          "cb_stopper",
          78,
          "L"
        ],
        [
          "伊费亚尼·奥涅卡",
          "Ifeanyi Onyeka",
          "尼日利亚",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "何云舟",
          "He Yunzhou",
          "中国",
          "W",
          "w_finisher",
          78,
          "L"
        ],
        [
          "乌戈·奥尔特加",
          "Hugo Ortega",
          "西班牙",
          "CM",
          "cm_box2box",
          78,
          "R"
        ],
        [
          "陆文博",
          "Lu Wenbo",
          "中国",
          "CM",
          "cm_destroyer",
          77,
          "R"
        ],
        [
          "埃兹拉·弗莱彻",
          "Ezra Fletcher",
          "英格兰",
          "CM",
          "cm_playmaker",
          77,
          "L"
        ],
        [
          "卢卡·费里",
          "Luca Ferri",
          "意大利",
          "ST",
          "st_poacher",
          77,
          "R"
        ],
        [
          "洛伦佐·孔蒂",
          "Lorenzo Conti",
          "意大利",
          "ST",
          "st_false9",
          77,
          "R"
        ],
        [
          "伊布拉希马·迪奥普",
          "Ibrahima Diop",
          "塞内加尔",
          "GK",
          "gk_wall",
          74,
          "R"
        ],
        [
          "森悠希",
          "Yuki Mori",
          "日本",
          "CB",
          "cb_ballplaying",
          74,
          "R"
        ],
        [
          "凯雷姆·耶尔马兹",
          "Kerem Yilmaz",
          "土耳其",
          "W",
          "w_engine",
          74,
          "R"
        ],
        [
          "法昆多·梅迪纳",
          "Facundo Medina",
          "阿根廷",
          "CM",
          "cm_creator",
          74,
          "L"
        ],
        [
          "阿德里安·莫利纳",
          "Adrian Molina",
          "西班牙",
          "ST",
          "st_target",
          74,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 72,
    "targetCa": 930,
    "actualCa": 938.3305533425159,
    "kind": "generated",
    "team": {
      "id": "peak-72",
      "club": "黑潮先锋",
      "clubEn": "黑潮先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "fast",
        "line": "low",
        "press": "low"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 930,
      "players": [
        [
          "陆子昂",
          "Lu Ziang",
          "中国",
          "GK",
          "gk_sweeper",
          81,
          "R"
        ],
        [
          "哈里·霍尔特",
          "Harry Holt",
          "英格兰",
          "W",
          "w_dribbler",
          81,
          "R"
        ],
        [
          "佐藤悠希",
          "Yuki Sato",
          "日本",
          "CB",
          "cb_ballplaying",
          81,
          "R"
        ],
        [
          "加藤阳斗",
          "Haruto Kato",
          "日本",
          "CB",
          "cb_stopper",
          79,
          "L"
        ],
        [
          "伊费亚尼·奥卡福",
          "Ifeanyi Okafor",
          "尼日利亚",
          "W",
          "w_crosser",
          79,
          "L"
        ],
        [
          "埃梅卡·奥科耶",
          "Emeka Okoye",
          "尼日利亚",
          "W",
          "w_dribbler",
          79,
          "R"
        ],
        [
          "埃里克·尼格伦",
          "Erik Nygren",
          "瑞典",
          "CM",
          "cm_box2box",
          79,
          "L"
        ],
        [
          "卡里姆·哈利勒",
          "Karim Khalil",
          "摩洛哥",
          "CM",
          "cm_mezzala",
          78,
          "R"
        ],
        [
          "冯雨辰",
          "Feng Yuchen",
          "中国",
          "W",
          "w_playmaker",
          78,
          "R"
        ],
        [
          "卡里姆·贝纳利",
          "Karim Benali",
          "摩洛哥",
          "ST",
          "st_finisher",
          78,
          "R"
        ],
        [
          "冯知行",
          "Feng Zhixing",
          "中国",
          "ST",
          "st_poacher",
          78,
          "R"
        ],
        [
          "迪米塔尔·彼得罗夫",
          "Dimitar Petrov",
          "保加利亚",
          "GK",
          "gk_wall",
          75,
          "L"
        ],
        [
          "贾科莫·里奇",
          "Giacomo Ricci",
          "意大利",
          "CB",
          "cb_ballplaying",
          75,
          "L"
        ],
        [
          "高奕辰",
          "Gao Yichen",
          "中国",
          "W",
          "fb_attacking",
          75,
          "R"
        ],
        [
          "赵启航",
          "Zhao Qihang",
          "中国",
          "CM",
          "cm_playmaker",
          75,
          "R"
        ],
        [
          "迪米塔尔·索科洛夫",
          "Dimitar Sokolov",
          "保加利亚",
          "ST",
          "st_poacher",
          75,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 73,
    "targetCa": 940,
    "actualCa": 937.7849557667586,
    "kind": "generated",
    "team": {
      "id": "peak-73",
      "club": "赤焰工人",
      "clubEn": "赤焰工人",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-4-1",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "fast",
        "line": "mid",
        "press": "mid"
      },
      "color": "#1b7f4b",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 940,
      "players": [
        [
          "伊费亚尼·埃泽",
          "Ifeanyi Eze",
          "尼日利亚",
          "GK",
          "gk_sweeper",
          81,
          "R"
        ],
        [
          "费利佩·特谢拉",
          "Felipe Teixeira",
          "巴西",
          "W",
          "fb_playmaker",
          81,
          "R"
        ],
        [
          "耶斯佩尔·达尔",
          "Jesper Dahl",
          "瑞典",
          "CB",
          "cb_ballplaying",
          81,
          "R"
        ],
        [
          "托马斯·卡夫雷拉",
          "Tomas Cabrera",
          "阿根廷",
          "CB",
          "cb_ballplaying",
          79,
          "L"
        ],
        [
          "圣地亚哥·索萨",
          "Santiago Sosa",
          "阿根廷",
          "W",
          "w_finisher",
          79,
          "R"
        ],
        [
          "维托尔·莫拉",
          "Vitor Moura",
          "巴西",
          "CM",
          "cm_mezzala",
          79,
          "R"
        ],
        [
          "杰米·梅森",
          "Jamie Mason",
          "英格兰",
          "W",
          "w_dribbler",
          79,
          "R"
        ],
        [
          "米克尔·隆德",
          "Mikkel Lund",
          "瑞典",
          "CM",
          "cm_box2box",
          78,
          "R"
        ],
        [
          "伊布拉希马·恩迪亚耶",
          "Ibrahima Ndiaye",
          "塞内加尔",
          "CM",
          "cm_creator",
          78,
          "R"
        ],
        [
          "法比安·莱曼",
          "Fabian Lehmann",
          "德国",
          "W",
          "w_finisher",
          78,
          "R"
        ],
        [
          "陈宇航",
          "Chen Yuhang",
          "中国",
          "ST",
          "st_false9",
          78,
          "R"
        ],
        [
          "蒂亚戈·里贝罗",
          "Thiago Ribeiro",
          "巴西",
          "GK",
          "gk_wall",
          75,
          "R"
        ],
        [
          "雷南·莫拉",
          "Renan Moura",
          "巴西",
          "CB",
          "cb_cover",
          75,
          "R"
        ],
        [
          "耶斯佩尔·拉森",
          "Jesper Larsen",
          "瑞典",
          "W",
          "w_engine",
          75,
          "L"
        ],
        [
          "耶斯佩尔·斯特兰德",
          "Jesper Strand",
          "瑞典",
          "CM",
          "cm_playmaker",
          75,
          "R"
        ],
        [
          "塔里克·哈利勒",
          "Tarek Khalil",
          "摩洛哥",
          "ST",
          "st_false9",
          75,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 74,
    "targetCa": 945,
    "actualCa": 936.0025701867157,
    "kind": "generated",
    "team": {
      "id": "peak-74",
      "club": "长弓竞技",
      "clubEn": "长弓竞技",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "low",
        "press": "low"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 945,
      "players": [
        [
          "亚辛·哈利勒",
          "Yassine Khalil",
          "摩洛哥",
          "GK",
          "gk_shotstopper",
          81,
          "L"
        ],
        [
          "巴斯蒂安·富尼耶",
          "Bastien Fournier",
          "法国",
          "W",
          "fb_playmaker",
          81,
          "R"
        ],
        [
          "唐天佑",
          "Tang Tianyou",
          "中国",
          "CB",
          "cb_stopper",
          81,
          "R"
        ],
        [
          "许云舟",
          "Xu Yunzhou",
          "中国",
          "CB",
          "cb_cover",
          79,
          "R"
        ],
        [
          "埃兹拉·休斯",
          "Ezra Hughes",
          "英格兰",
          "W",
          "fb_playmaker",
          79,
          "R"
        ],
        [
          "安德烈亚·孔蒂",
          "Andrea Conti",
          "意大利",
          "W",
          "w_playmaker",
          79,
          "R"
        ],
        [
          "凯·普赖斯",
          "Kai Price",
          "英格兰",
          "CM",
          "cm_creator",
          79,
          "R"
        ],
        [
          "杨知行",
          "Yang Zhixing",
          "中国",
          "CM",
          "cm_mezzala",
          78,
          "R"
        ],
        [
          "凯莱奇·阿德耶米",
          "Kelechi Adeyemi",
          "尼日利亚",
          "W",
          "w_crosser",
          78,
          "R"
        ],
        [
          "朴志勋",
          "Park Jihoon",
          "韩国",
          "ST",
          "st_target",
          78,
          "R"
        ],
        [
          "奥比纳·奥卡福",
          "Obinna Okafor",
          "尼日利亚",
          "ST",
          "st_finisher",
          78,
          "L"
        ],
        [
          "恩佐·莫罗",
          "Enzo Moreau",
          "法国",
          "GK",
          "gk_shotstopper",
          75,
          "R"
        ],
        [
          "高桥健太",
          "Kenta Takahashi",
          "日本",
          "CB",
          "cb_ballplaying",
          75,
          "R"
        ],
        [
          "伊克尔·维加",
          "Iker Vega",
          "西班牙",
          "W",
          "w_crosser",
          75,
          "L"
        ],
        [
          "伊桑·霍尔特",
          "Ethan Holt",
          "英格兰",
          "CM",
          "cm_creator",
          75,
          "L"
        ],
        [
          "方天佑",
          "Fang Tianyou",
          "中国",
          "ST",
          "st_finisher",
          75,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 75,
    "targetCa": 955,
    "actualCa": 963.8256884205693,
    "kind": "generated",
    "team": {
      "id": "peak-75",
      "club": "北岸体育",
      "clubEn": "北岸体育",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "3-4-3",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "slow",
        "line": "low",
        "press": "low"
      },
      "color": "#d84315",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 955,
      "players": [
        [
          "田中海斗",
          "Kaito Tanaka",
          "日本",
          "GK",
          "gk_sweeper",
          82,
          "L"
        ],
        [
          "桑德·尼格伦",
          "Sander Nygren",
          "瑞典",
          "CB",
          "cb_ballplaying",
          82,
          "L"
        ],
        [
          "路易·戈蒂埃",
          "Louis Gauthier",
          "法国",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "奎西·奥乌苏",
          "Kwesi Owusu",
          "加纳",
          "CB",
          "cb_cover",
          80,
          "L"
        ],
        [
          "加藤健太",
          "Kenta Kato",
          "日本",
          "W",
          "w_dribbler",
          80,
          "R"
        ],
        [
          "普林斯·阿桑特",
          "Prince Asante",
          "加纳",
          "CM",
          "cm_engine",
          80,
          "R"
        ],
        [
          "亚乌·奥乌苏",
          "Yaw Owusu",
          "加纳",
          "CM",
          "cm_creator",
          80,
          "R"
        ],
        [
          "伊费亚尼·巴洛贡",
          "Ifeanyi Balogun",
          "尼日利亚",
          "W",
          "w_dribbler",
          79,
          "R"
        ],
        [
          "马尔科·孔蒂",
          "Marco Conti",
          "意大利",
          "W",
          "fb_attacking",
          79,
          "R"
        ],
        [
          "凯·特纳",
          "Kai Turner",
          "英格兰",
          "ST",
          "st_false9",
          79,
          "L"
        ],
        [
          "尼科·普列托",
          "Nico Prieto",
          "西班牙",
          "W",
          "w_finisher",
          79,
          "R"
        ],
        [
          "迭戈·帕斯夸尔",
          "Diego Pascual",
          "西班牙",
          "GK",
          "gk_sweeper",
          76,
          "R"
        ],
        [
          "伊藤飒太",
          "Sota Ito",
          "日本",
          "CB",
          "cb_cover",
          76,
          "L"
        ],
        [
          "尹敏俊",
          "Yoon Minjun",
          "韩国",
          "W",
          "w_dribbler",
          76,
          "R"
        ],
        [
          "方景行",
          "Fang Jingxing",
          "中国",
          "CM",
          "cm_destroyer",
          76,
          "L"
        ],
        [
          "杰米·特纳",
          "Jamie Turner",
          "英格兰",
          "ST",
          "st_false9",
          76,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 76,
    "targetCa": 965,
    "actualCa": 958.7964306887053,
    "kind": "generated",
    "team": {
      "id": "peak-76",
      "club": "远帆之队",
      "clubEn": "远帆之队",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 965,
      "players": [
        [
          "凯雷姆·德米尔",
          "Kerem Demir",
          "土耳其",
          "GK",
          "gk_shotstopper",
          82,
          "L"
        ],
        [
          "桑德·隆德",
          "Sander Lund",
          "瑞典",
          "W",
          "w_finisher",
          82,
          "R"
        ],
        [
          "西莫内·加利",
          "Simone Galli",
          "意大利",
          "CB",
          "cb_ballplaying",
          82,
          "R"
        ],
        [
          "若昂·阿尔梅达",
          "Joao Almeida",
          "巴西",
          "CB",
          "cb_ballplaying",
          80,
          "R"
        ],
        [
          "托马斯·基罗加",
          "Tomas Quiroga",
          "阿根廷",
          "W",
          "fb_attacking",
          80,
          "L"
        ],
        [
          "陈承宇",
          "Chen Chengyu",
          "中国",
          "CM",
          "cm_box2box",
          80,
          "R"
        ],
        [
          "吉田阳斗",
          "Haruto Yoshida",
          "日本",
          "CM",
          "cm_playmaker",
          80,
          "R"
        ],
        [
          "江星河",
          "Jiang Xinghe",
          "中国",
          "CM",
          "cm_destroyer",
          79,
          "L"
        ],
        [
          "尼古拉斯·阿科斯塔",
          "Nicolas Acosta",
          "阿根廷",
          "W",
          "w_crosser",
          79,
          "R"
        ],
        [
          "约纳斯·贝克尔",
          "Jonas Becker",
          "德国",
          "ST",
          "st_false9",
          79,
          "R"
        ],
        [
          "冯知行",
          "Feng Zhixing",
          "中国",
          "W",
          "w_playmaker",
          79,
          "R"
        ],
        [
          "路易·吉拉尔",
          "Louis Girard",
          "法国",
          "GK",
          "gk_sweeper",
          76,
          "L"
        ],
        [
          "叶牧野",
          "Ye Muye",
          "中国",
          "CB",
          "cb_cover",
          76,
          "R"
        ],
        [
          "赫里斯托·彼得罗夫",
          "Hristo Petrov",
          "保加利亚",
          "W",
          "w_dribbler",
          76,
          "R"
        ],
        [
          "卢卡斯·努内斯",
          "Lucas Nunes",
          "巴西",
          "CM",
          "cm_playmaker",
          76,
          "R"
        ],
        [
          "托马斯·罗哈斯",
          "Tomas Rojas",
          "阿根廷",
          "ST",
          "st_runner",
          76,
          "L"
        ]
      ]
    }
  },
  {
    "stage": 77,
    "targetCa": 975,
    "actualCa": 982.0786018885827,
    "kind": "generated",
    "team": {
      "id": "peak-77",
      "club": "林海海港",
      "clubEn": "林海海港",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "normal",
        "line": "low",
        "press": "high"
      },
      "color": "#00838f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 975,
      "players": [
        [
          "尼古拉斯·帕雷德斯",
          "Nicolas Paredes",
          "阿根廷",
          "GK",
          "gk_wall",
          83,
          "R"
        ],
        [
          "恩佐·卢梭",
          "Enzo Rousseau",
          "法国",
          "W",
          "w_crosser",
          83,
          "R"
        ],
        [
          "吉田飒太",
          "Sota Yoshida",
          "日本",
          "CB",
          "cb_stopper",
          83,
          "L"
        ],
        [
          "卡里姆·萨利赫",
          "Karim Saleh",
          "摩洛哥",
          "CB",
          "cb_ballplaying",
          81,
          "R"
        ],
        [
          "恩佐·马尔尚",
          "Enzo Marchand",
          "法国",
          "W",
          "fb_attacking",
          81,
          "L"
        ],
        [
          "高若谷",
          "Gao Ruogu",
          "中国",
          "CM",
          "cm_destroyer",
          81,
          "R"
        ],
        [
          "埃米利亚诺·贝尼特斯",
          "Emiliano Benitez",
          "阿根廷",
          "CM",
          "cm_creator",
          81,
          "L"
        ],
        [
          "本·普赖斯",
          "Ben Price",
          "英格兰",
          "W",
          "fb_attacking",
          80,
          "R"
        ],
        [
          "贾科莫·孔蒂",
          "Giacomo Conti",
          "意大利",
          "CM",
          "cm_creator",
          80,
          "R"
        ],
        [
          "菲利普·巴比奇",
          "Filip Babic",
          "克罗地亚",
          "W",
          "w_playmaker",
          80,
          "L"
        ],
        [
          "苏尼尔·奈尔",
          "Sunil Nair",
          "印度",
          "ST",
          "st_poacher",
          80,
          "R"
        ],
        [
          "田修远",
          "Tian Xiuyuan",
          "中国",
          "GK",
          "gk_wall",
          77,
          "R"
        ],
        [
          "钟一鸣",
          "Zhong Yiming",
          "中国",
          "CB",
          "cb_cover",
          77,
          "R"
        ],
        [
          "安德烈亚·费里",
          "Andrea Ferri",
          "意大利",
          "W",
          "w_playmaker",
          77,
          "L"
        ],
        [
          "蒂亚戈·里贝罗",
          "Thiago Ribeiro",
          "巴西",
          "CM",
          "cm_playmaker",
          77,
          "R"
        ],
        [
          "高桥海斗",
          "Kaito Takahashi",
          "日本",
          "ST",
          "st_poacher",
          77,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 78,
    "targetCa": 980,
    "actualCa": 985.62572832262,
    "kind": "generated",
    "team": {
      "id": "peak-78",
      "club": "林海雄狮",
      "clubEn": "林海雄狮",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-1-2-1-2",
      "tactics": {
        "attack": "balanced",
        "passing": "short",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#c8102e",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 980,
      "players": [
        [
          "凯雷姆·厄兹蒂尔克",
          "Kerem Ozturk",
          "土耳其",
          "GK",
          "gk_shotstopper",
          83,
          "R"
        ],
        [
          "通德·巴洛贡",
          "Tunde Balogun",
          "尼日利亚",
          "W",
          "w_playmaker",
          83,
          "R"
        ],
        [
          "林亦凡",
          "Lin Yifan",
          "中国",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "陈宇航",
          "Chen Yuhang",
          "中国",
          "CB",
          "cb_cover",
          81,
          "R"
        ],
        [
          "马特乌斯·莫拉",
          "Matheus Moura",
          "巴西",
          "W",
          "w_engine",
          81,
          "L"
        ],
        [
          "安特·马尔科维奇",
          "Ante Markovic",
          "克罗地亚",
          "CM",
          "cm_destroyer",
          81,
          "R"
        ],
        [
          "马尔科·巴比奇",
          "Marko Babic",
          "克罗地亚",
          "CM",
          "cm_mezzala",
          81,
          "L"
        ],
        [
          "马格努斯·尼尔松",
          "Magnus Nilsson",
          "瑞典",
          "CM",
          "cm_engine",
          80,
          "L"
        ],
        [
          "本·弗莱彻",
          "Ben Fletcher",
          "英格兰",
          "CM",
          "cm_playmaker",
          80,
          "R"
        ],
        [
          "方泽宇",
          "Fang Zeyu",
          "中国",
          "ST",
          "st_runner",
          80,
          "R"
        ],
        [
          "扬·布兰特",
          "Jan Brandt",
          "德国",
          "ST",
          "st_false9",
          80,
          "R"
        ],
        [
          "罗天佑",
          "Luo Tianyou",
          "中国",
          "GK",
          "gk_shotstopper",
          77,
          "L"
        ],
        [
          "森莲",
          "Ren Mori",
          "日本",
          "CB",
          "cb_ballplaying",
          77,
          "R"
        ],
        [
          "埃兹拉·哈特",
          "Ezra Hart",
          "英格兰",
          "W",
          "w_engine",
          77,
          "R"
        ],
        [
          "马格努斯·尼格伦",
          "Magnus Nygren",
          "瑞典",
          "CM",
          "cm_box2box",
          77,
          "R"
        ],
        [
          "欧文·巴克",
          "Owen Barker",
          "英格兰",
          "ST",
          "st_runner",
          77,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 79,
    "targetCa": 990,
    "actualCa": 986.1075192623201,
    "kind": "generated",
    "team": {
      "id": "peak-79",
      "club": "远帆先锋",
      "clubEn": "远帆先锋",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "5-3-2",
      "tactics": {
        "attack": "wing",
        "passing": "direct",
        "tempo": "normal",
        "line": "high",
        "press": "mid"
      },
      "color": "#00529f",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 990,
      "players": [
        [
          "田泽宇",
          "Tian Zeyu",
          "中国",
          "GK",
          "gk_wall",
          83,
          "R"
        ],
        [
          "拉维·夏尔马",
          "Ravi Sharma",
          "印度",
          "W",
          "w_dribbler",
          83,
          "R"
        ],
        [
          "尹志勋",
          "Yoon Jihoon",
          "韩国",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "埃兹拉·哈特",
          "Ezra Hart",
          "英格兰",
          "CB",
          "cb_stopper",
          81,
          "R"
        ],
        [
          "达维德·格雷科",
          "Davide Greco",
          "意大利",
          "CB",
          "cb_cover",
          81,
          "R"
        ],
        [
          "费利佩·塞拉",
          "Felipe Serra",
          "巴西",
          "W",
          "fb_playmaker",
          81,
          "L"
        ],
        [
          "何亦凡",
          "He Yifan",
          "中国",
          "CM",
          "cm_creator",
          81,
          "R"
        ],
        [
          "埃米尔·哈特曼",
          "Emil Hartmann",
          "德国",
          "CM",
          "cm_mezzala",
          80,
          "R"
        ],
        [
          "莱昂·法尔克",
          "Leon Falk",
          "德国",
          "CM",
          "cm_creator",
          80,
          "R"
        ],
        [
          "华金·梅迪纳",
          "Joaquin Medina",
          "阿根廷",
          "ST",
          "st_target",
          80,
          "R"
        ],
        [
          "周奕辰",
          "Zhou Yichen",
          "中国",
          "ST",
          "st_poacher",
          80,
          "L"
        ],
        [
          "亚乌·奥塞",
          "Yaw Osei",
          "加纳",
          "GK",
          "gk_wall",
          77,
          "R"
        ],
        [
          "奇迪·奥科耶",
          "Chidi Okoye",
          "尼日利亚",
          "CB",
          "cb_ballplaying",
          77,
          "L"
        ],
        [
          "托马斯·梅迪纳",
          "Tomas Medina",
          "阿根廷",
          "W",
          "fb_attacking",
          77,
          "L"
        ],
        [
          "苏嘉树",
          "Su Jiashu",
          "中国",
          "CM",
          "cm_engine",
          77,
          "R"
        ],
        [
          "马格努斯·尼格伦",
          "Magnus Nygren",
          "瑞典",
          "ST",
          "st_poacher",
          77,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 80,
    "targetCa": 1000,
    "actualCa": 1003.8010147903274,
    "kind": "generated",
    "team": {
      "id": "peak-80",
      "club": "铁砧城",
      "clubEn": "铁砧城",
      "season": "",
      "coach": "生成教练",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "slow",
        "line": "mid",
        "press": "high"
      },
      "color": "#6a1b9a",
      "accent": "#ffffff",
      "note": "PvE 生成球队",
      "targetCa": 1000,
      "players": [
        [
          "约西普·约万诺维奇",
          "Josip Jovanovic",
          "克罗地亚",
          "GK",
          "gk_wall",
          84,
          "R"
        ],
        [
          "乌戈·罗梅罗",
          "Hugo Romero",
          "西班牙",
          "W",
          "fb_playmaker",
          84,
          "L"
        ],
        [
          "阿德里安·维加",
          "Adrian Vega",
          "西班牙",
          "CB",
          "cb_ballplaying",
          84,
          "R"
        ],
        [
          "蒂亚戈·塞拉",
          "Thiago Serra",
          "巴西",
          "CB",
          "cb_ballplaying",
          82,
          "R"
        ],
        [
          "奥比纳·巴洛贡",
          "Obinna Balogun",
          "尼日利亚",
          "W",
          "w_engine",
          82,
          "R"
        ],
        [
          "魏俊驰",
          "Wei Junchi",
          "中国",
          "W",
          "w_engine",
          82,
          "R"
        ],
        [
          "奥马尔·伊德里西",
          "Omar Idrissi",
          "摩洛哥",
          "CM",
          "cm_box2box",
          82,
          "R"
        ],
        [
          "托马斯·卡夫雷拉",
          "Tomas Cabrera",
          "阿根廷",
          "CM",
          "cm_mezzala",
          81,
          "L"
        ],
        [
          "崔宇镇",
          "Choi Woojin",
          "韩国",
          "W",
          "fb_playmaker",
          81,
          "R"
        ],
        [
          "蒂姆·魏斯",
          "Tim Weiss",
          "德国",
          "ST",
          "st_target",
          81,
          "R"
        ],
        [
          "维托尔·卡多佐",
          "Vitor Cardoso",
          "巴西",
          "ST",
          "st_finisher",
          81,
          "R"
        ],
        [
          "埃比尼泽·阿多",
          "Ebenezer Addo",
          "加纳",
          "GK",
          "gk_wall",
          78,
          "L"
        ],
        [
          "安德烈亚·丰塔纳",
          "Andrea Fontana",
          "意大利",
          "CB",
          "cb_cover",
          78,
          "R"
        ],
        [
          "利奥·普赖斯",
          "Leo Price",
          "英格兰",
          "W",
          "fb_playmaker",
          78,
          "R"
        ],
        [
          "卢卡斯·哈特曼",
          "Lukas Hartmann",
          "德国",
          "CM",
          "cm_destroyer",
          78,
          "L"
        ],
        [
          "马克西姆·勒费弗尔",
          "Maxime Lefevre",
          "法国",
          "ST",
          "st_runner",
          78,
          "R"
        ]
      ]
    }
  },
  {
    "stage": 81,
    "targetCa": 1000,
    "actualCa": 1005.2732668717475,
    "kind": "national",
    "team": {
      "id": "cmr-1990",
      "club": "喀麦隆",
      "clubEn": "Cameroon",
      "season": "1990",
      "coach": "瓦列里·涅波姆尼亚奇",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "normal",
        "line": "low",
        "press": "mid"
      },
      "color": "#007a5e",
      "accent": "#ce1126",
      "note": "1990 世界杯八强；米拉大叔与恩科诺的非洲黑马。",
      "players": [
        [
          "恩科诺",
          "Thomas N'Kono",
          "喀麦隆",
          "GK",
          "gk_wall",
          83,
          "R"
        ],
        [
          "埃布韦莱",
          "Emmanuel Ebwelle",
          "喀麦隆",
          "W",
          "fb_attacking",
          81,
          "R"
        ],
        [
          "孔德",
          "Emmanuel Kundé",
          "喀麦隆",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "马辛",
          "Benjamin Massing",
          "喀麦隆",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "塔塔乌",
          "Stephen Tataw",
          "喀麦隆",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "姆费德",
          "Louis-Paul Mfede",
          "喀麦隆",
          "W",
          "w_engine",
          81,
          "R"
        ],
        [
          "马博昂",
          "Cyrille Makanaky",
          "喀麦隆",
          "CM",
          "cm_box2box",
          82,
          "R"
        ],
        [
          "马卡纳基",
          "Emile Mbouh",
          "喀麦隆",
          "CM",
          "cm_destroyer",
          82,
          "R"
        ],
        [
          "利比赫",
          "Thomas Libiih",
          "喀麦隆",
          "W",
          "w_dribbler",
          81,
          "R"
        ],
        [
          "米拉",
          "Roger Milla",
          "喀麦隆",
          "ST",
          "st_poacher",
          84,
          "R"
        ],
        [
          "奥马姆-比伊克",
          "François Omam-Biyik",
          "喀麦隆",
          "ST",
          "st_target",
          83,
          "R"
        ],
        [
          "贝尔",
          "Joseph-Antoine Bell",
          "喀麦隆",
          "GK",
          "gk_wall",
          78,
          "R"
        ],
        [
          "弗特姆巴",
          "Emile Feutmba",
          "喀麦隆",
          "CM",
          "cm_playmaker",
          78,
          "R"
        ],
        [
          "帕加尔",
          "Jean-Claude Pagal",
          "喀麦隆",
          "W",
          "fb_attacking",
          78,
          "R"
        ],
        [
          "卡纳-比伊克",
          "André Kana-Biyik",
          "喀麦隆",
          "CB",
          "cb_stopper",
          78,
          "R"
        ],
        [
          "比伊克",
          "Emmanuel Biyik",
          "喀麦隆",
          "ST",
          "st_finisher",
          78,
          "R"
        ]
      ],
      "targetCa": 1000
    }
  },
  {
    "stage": 82,
    "targetCa": 1015,
    "actualCa": 1023.1072129170494,
    "kind": "national",
    "team": {
      "id": "nga-1994",
      "club": "尼日利亚",
      "clubEn": "Nigeria",
      "season": "1994",
      "coach": "克莱门斯·韦斯特霍夫",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#008751",
      "accent": "#ffffff",
      "note": "1994 世界杯十六强；奥科查、耶基尼、阿莫卡奇的黄金一代。",
      "players": [
        [
          "鲁法伊",
          "Peter Rufai",
          "尼日利亚",
          "GK",
          "gk_wall",
          82,
          "R"
        ],
        [
          "埃瓜沃恩",
          "Augustine Eguavoen",
          "尼日利亚",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "奥克丘库",
          "Uche Okechukwu",
          "尼日利亚",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "凯西",
          "Stephen Keshi",
          "尼日利亚",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "恩瓦努",
          "Benedict Iroha",
          "尼日利亚",
          "W",
          "fb_attacking",
          81,
          "R"
        ],
        [
          "阿穆尼克",
          "Emmanuel Amunike",
          "尼日利亚",
          "W",
          "w_finisher",
          83,
          "R"
        ],
        [
          "奥利塞赫",
          "Sunday Oliseh",
          "尼日利亚",
          "CM",
          "cm_playmaker",
          83,
          "R"
        ],
        [
          "奥科查",
          "Jay-Jay Okocha",
          "尼日利亚",
          "CM",
          "cm_creator",
          84,
          "R"
        ],
        [
          "菲尼迪",
          "Finidi George",
          "尼日利亚",
          "W",
          "w_dribbler",
          84,
          "R"
        ],
        [
          "耶基尼",
          "Rashidi Yekini",
          "尼日利亚",
          "ST",
          "st_target",
          84,
          "R"
        ],
        [
          "阿莫卡奇",
          "Daniel Amokachi",
          "尼日利亚",
          "ST",
          "st_runner",
          83,
          "R"
        ],
        [
          "阿格博纳夫巴雷",
          "Wilfred Agbonavbare",
          "尼日利亚",
          "GK",
          "gk_wall",
          78,
          "R"
        ],
        [
          "奥利哈",
          "Thompson Oliha",
          "尼日利亚",
          "CM",
          "cm_engine",
          78,
          "R"
        ],
        [
          "埃克波",
          "Friday Ekpo",
          "尼日利亚",
          "CM",
          "cm_box2box",
          78,
          "R"
        ],
        [
          "西亚西亚",
          "Samson Siasia",
          "尼日利亚",
          "ST",
          "st_false9",
          78,
          "R"
        ],
        [
          "卡努",
          "Nwankwo Kanu",
          "尼日利亚",
          "ST",
          "st_target",
          78,
          "R"
        ]
      ],
      "targetCa": 1015
    }
  },
  {
    "stage": 83,
    "targetCa": 1030,
    "actualCa": 1030.4883897000307,
    "kind": "national",
    "team": {
      "id": "sen-2002",
      "club": "塞内加尔",
      "clubEn": "Senegal",
      "season": "2002",
      "coach": "布鲁诺·梅楚",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "direct",
        "tempo": "normal",
        "line": "mid",
        "press": "high"
      },
      "color": "#00853f",
      "accent": "#fdef42",
      "note": "2002 世界杯八强；揭幕战击败法国，迪乌夫与法迪加的球队。",
      "players": [
        [
          "西尔瓦",
          "Tony Sylva",
          "塞内加尔",
          "GK",
          "gk_wall",
          83,
          "R"
        ],
        [
          "达夫",
          "Omar Daf",
          "塞内加尔",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "迪亚塔",
          "Lamine Diatta",
          "塞内加尔",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "科利",
          "Ferdinand Coly",
          "塞内加尔",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "西塞",
          "Aliou Cissé",
          "塞内加尔",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "法迪加",
          "Khalilou Fadiga",
          "塞内加尔",
          "W",
          "w_playmaker",
          83,
          "R"
        ],
        [
          "迪奥",
          "Salif Diao",
          "塞内加尔",
          "CM",
          "cm_destroyer",
          83,
          "R"
        ],
        [
          "布巴·迪奥普",
          "Papa Bouba Diop",
          "塞内加尔",
          "CM",
          "cm_box2box",
          84,
          "R"
        ],
        [
          "哈吉·卡马拉",
          "Henri Camara",
          "塞内加尔",
          "W",
          "w_finisher",
          84,
          "R"
        ],
        [
          "迪乌夫",
          "El Hadji Diouf",
          "塞内加尔",
          "ST",
          "st_runner",
          85,
          "R"
        ],
        [
          "萨尔",
          "Boubacar Sarr",
          "塞内加尔",
          "ST",
          "st_target",
          83,
          "R"
        ],
        [
          "恩迪亚耶",
          "Khalilou Ndiaye",
          "塞内加尔",
          "GK",
          "gk_wall",
          79,
          "R"
        ],
        [
          "贝耶",
          "Habib Beye",
          "塞内加尔",
          "CB",
          "cb_stopper",
          79,
          "R"
        ],
        [
          "特拉奥雷",
          "Omar Traoré",
          "塞内加尔",
          "CB",
          "cb_cover",
          79,
          "R"
        ],
        [
          "法耶",
          "Amdy Faye",
          "塞内加尔",
          "CM",
          "cm_destroyer",
          79,
          "R"
        ],
        [
          "索莱曼·卡马拉",
          "Souleymane Camara",
          "塞内加尔",
          "ST",
          "st_poacher",
          79,
          "R"
        ]
      ],
      "targetCa": 1030
    }
  },
  {
    "stage": 84,
    "targetCa": 1045,
    "actualCa": 1033.2197426354453,
    "kind": "national",
    "team": {
      "id": "den-1992",
      "club": "丹麦",
      "clubEn": "Denmark",
      "season": "1992",
      "coach": "理查德·穆勒-尼尔森",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#c60c30",
      "accent": "#ffffff",
      "note": "1992 欧洲杯冠军；临时顶替南斯拉夫参赛的童话。",
      "players": [
        [
          "舒梅切尔",
          "Peter Schmeichel",
          "丹麦",
          "GK",
          "gk_wall",
          85,
          "R"
        ],
        [
          "海因策",
          "Jan Heintze",
          "丹麦",
          "W",
          "fb_attacking",
          82,
          "L"
        ],
        [
          "肯特·尼尔森",
          "Kent Nielsen",
          "丹麦",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "奥尔森",
          "Lars Olsen",
          "丹麦",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "西维贝克",
          "John Sivebæk",
          "丹麦",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "克里斯托夫特",
          "Kim Christofte",
          "丹麦",
          "W",
          "w_engine",
          82,
          "R"
        ],
        [
          "维尔福特",
          "Kim Vilfort",
          "丹麦",
          "CM",
          "cm_box2box",
          83,
          "R"
        ],
        [
          "拉尔森",
          "Henrik Larsen",
          "丹麦",
          "CM",
          "cm_playmaker",
          83,
          "R"
        ],
        [
          "布莱恩·劳德鲁普",
          "Brian Laudrup",
          "丹麦",
          "W",
          "w_playmaker",
          85,
          "R"
        ],
        [
          "米歇尔·劳德鲁普",
          "Michael Laudrup",
          "丹麦",
          "ST",
          "st_false9",
          85,
          "R"
        ],
        [
          "波尔森",
          "Flemming Povlsen",
          "丹麦",
          "ST",
          "st_finisher",
          83,
          "R"
        ],
        [
          "霍格",
          "Lars Høgh",
          "丹麦",
          "GK",
          "gk_wall",
          79,
          "R"
        ],
        [
          "延森",
          "John Jensen",
          "丹麦",
          "CM",
          "cm_engine",
          79,
          "R"
        ],
        [
          "埃斯特鲁普",
          "Lars Elstrup",
          "丹麦",
          "ST",
          "st_target",
          79,
          "R"
        ],
        [
          "默尔比",
          "Jan Mølby",
          "丹麦",
          "CM",
          "cm_playmaker",
          79,
          "R"
        ],
        [
          "克里斯滕森",
          "Bent Christensen",
          "丹麦",
          "W",
          "w_dribbler",
          79,
          "R"
        ]
      ],
      "targetCa": 1045
    }
  },
  {
    "stage": 85,
    "targetCa": 1060,
    "actualCa": 1057.7215566085092,
    "kind": "national",
    "team": {
      "id": "bul-1994",
      "club": "保加利亚",
      "clubEn": "Bulgaria",
      "season": "1994",
      "coach": "迪米塔尔·佩内夫",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#ffffff",
      "accent": "#00966e",
      "note": "1994 世界杯四强；斯托伊奇科夫与巴拉科夫的黄金一代。",
      "players": [
        [
          "米哈伊洛夫",
          "Borislav Mihaylov",
          "保加利亚",
          "GK",
          "gk_wall",
          84,
          "R"
        ],
        [
          "茨韦塔诺夫",
          "Tsanko Tsvetanov",
          "保加利亚",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "伊万诺夫",
          "Trifon Ivanov",
          "保加利亚",
          "CB",
          "cb_stopper",
          84,
          "R"
        ],
        [
          "胡布切夫",
          "Petar Hubchev",
          "保加利亚",
          "CB",
          "cb_cover",
          83,
          "R"
        ],
        [
          "克雷门利耶夫",
          "Iliyan Kiriakov",
          "保加利亚",
          "W",
          "fb_attacking",
          83,
          "R"
        ],
        [
          "西拉科夫",
          "Nasko Sirakov",
          "保加利亚",
          "W",
          "w_finisher",
          84,
          "R"
        ],
        [
          "巴拉科夫",
          "Krasimir Balakov",
          "保加利亚",
          "CM",
          "cm_creator",
          85,
          "R"
        ],
        [
          "莱切科夫",
          "Yordan Lechkov",
          "保加利亚",
          "CM",
          "cm_box2box",
          85,
          "R"
        ],
        [
          "扬科夫",
          "Ivaylo Yordanov",
          "保加利亚",
          "W",
          "w_engine",
          84,
          "R"
        ],
        [
          "斯托伊奇科夫",
          "Hristo Stoichkov",
          "保加利亚",
          "ST",
          "st_finisher",
          86,
          "L"
        ],
        [
          "科斯塔迪诺夫",
          "Emil Kostadinov",
          "保加利亚",
          "ST",
          "st_runner",
          85,
          "R"
        ],
        [
          "兹德拉夫科夫",
          "Zdravko Zdravkov",
          "保加利亚",
          "GK",
          "gk_wall",
          80,
          "R"
        ],
        [
          "佩特罗夫",
          "Petar Petrov",
          "保加利亚",
          "CB",
          "cb_stopper",
          80,
          "R"
        ],
        [
          "根切夫",
          "Boncho Genchev",
          "保加利亚",
          "CM",
          "cm_playmaker",
          80,
          "R"
        ],
        [
          "博里米罗夫",
          "Daniel Borimirov",
          "保加利亚",
          "CM",
          "cm_box2box",
          80,
          "R"
        ],
        [
          "佩内夫",
          "Lyuboslav Penev",
          "保加利亚",
          "ST",
          "st_target",
          80,
          "R"
        ]
      ],
      "targetCa": 1060
    }
  },
  {
    "stage": 86,
    "targetCa": 1075,
    "actualCa": 1065.7438887297214,
    "kind": "national",
    "team": {
      "id": "tur-2002",
      "club": "土耳其",
      "clubEn": "Turkey",
      "season": "2002",
      "coach": "谢诺尔·居内什",
      "tier": "A",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#e30a17",
      "accent": "#ffffff",
      "note": "2002 世界杯季军；哈坎·苏克、鲁斯图与黄金一代。",
      "players": [
        [
          "鲁斯图",
          "Rüştü Reçber",
          "土耳其",
          "GK",
          "gk_shotstopper",
          86,
          "R"
        ],
        [
          "埃尔金",
          "Ergün Penbe",
          "土耳其",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "阿尔帕伊",
          "Alpay Özalan",
          "土耳其",
          "CB",
          "cb_stopper",
          84,
          "R"
        ],
        [
          "比伦特",
          "Bülent Korkmaz",
          "土耳其",
          "CB",
          "cb_cover",
          84,
          "R"
        ],
        [
          "法提赫",
          "Fatih Akyel",
          "土耳其",
          "W",
          "fb_attacking",
          83,
          "R"
        ],
        [
          "图盖",
          "Tugay Kerimoğlu",
          "土耳其",
          "CM",
          "cm_playmaker",
          84,
          "R"
        ],
        [
          "埃姆雷",
          "Emre Belözoğlu",
          "土耳其",
          "CM",
          "cm_creator",
          85,
          "R"
        ],
        [
          "巴斯图尔克",
          "Yıldıray Baştürk",
          "土耳其",
          "CM",
          "cm_mezzala",
          85,
          "R"
        ],
        [
          "哈桑·萨斯",
          "Hasan Şaş",
          "土耳其",
          "W",
          "w_finisher",
          85,
          "L"
        ],
        [
          "哈坎·苏克",
          "Hakan Şükür",
          "土耳其",
          "ST",
          "st_target",
          86,
          "R"
        ],
        [
          "伊尔汗",
          "İlhan Mansız",
          "土耳其",
          "W",
          "w_finisher",
          85,
          "R"
        ],
        [
          "厄梅尔",
          "Ömer Çatkıç",
          "土耳其",
          "GK",
          "gk_wall",
          80,
          "R"
        ],
        [
          "于米特·达瓦拉",
          "Ümit Davala",
          "土耳其",
          "W",
          "fb_attacking",
          80,
          "R"
        ],
        [
          "奥坎",
          "Okan Buruk",
          "土耳其",
          "CM",
          "cm_box2box",
          80,
          "R"
        ],
        [
          "阿里夫",
          "Arif Erdem",
          "土耳其",
          "ST",
          "st_poacher",
          80,
          "R"
        ],
        [
          "穆斯塔法",
          "Mustafa İzzet",
          "土耳其",
          "CM",
          "cm_playmaker",
          80,
          "R"
        ]
      ],
      "targetCa": 1075
    }
  },
  {
    "stage": 87,
    "targetCa": 1090,
    "actualCa": 1091.773424778084,
    "kind": "national",
    "team": {
      "id": "cro-1998",
      "club": "克罗地亚",
      "clubEn": "Croatia",
      "season": "1998",
      "coach": "米罗斯拉夫·布拉泽维奇",
      "tier": "A",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#ff0000",
      "accent": "#ffffff",
      "note": "1998 世界杯季军；苏克、博班、普罗辛内茨基的格子军团。",
      "players": [
        [
          "拉迪奇",
          "Dražen Ladić",
          "克罗地亚",
          "GK",
          "gk_wall",
          85,
          "R"
        ],
        [
          "亚尔尼",
          "Robert Jarni",
          "克罗地亚",
          "W",
          "fb_attacking",
          86,
          "L"
        ],
        [
          "比利奇",
          "Slaven Bilić",
          "克罗地亚",
          "CB",
          "cb_stopper",
          85,
          "R"
        ],
        [
          "什蒂马茨",
          "Igor Štimac",
          "克罗地亚",
          "CB",
          "cb_cover",
          86,
          "R"
        ],
        [
          "谢里奇",
          "Dario Šimić",
          "克罗地亚",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "阿萨诺维奇",
          "Aljoša Asanović",
          "克罗地亚",
          "W",
          "w_playmaker",
          85,
          "L"
        ],
        [
          "普罗辛内茨基",
          "Robert Prosinečki",
          "克罗地亚",
          "CM",
          "cm_creator",
          87,
          "R"
        ],
        [
          "博班",
          "Zvonimir Boban",
          "克罗地亚",
          "CM",
          "cm_playmaker",
          87,
          "R"
        ],
        [
          "斯塔尼奇",
          "Mario Stanić",
          "克罗地亚",
          "W",
          "w_engine",
          85,
          "R"
        ],
        [
          "苏克",
          "Davor Šuker",
          "克罗地亚",
          "ST",
          "st_finisher",
          87,
          "L"
        ],
        [
          "弗拉奥维奇",
          "Goran Vlaović",
          "克罗地亚",
          "ST",
          "st_poacher",
          85,
          "R"
        ],
        [
          "布蒂纳",
          "Tomislav Butina",
          "克罗地亚",
          "GK",
          "gk_wall",
          81,
          "R"
        ],
        [
          "图多尔",
          "Igor Tudor",
          "克罗地亚",
          "CB",
          "cb_stopper",
          81,
          "R"
        ],
        [
          "尤尔契奇",
          "Krunoslav Jurčić",
          "克罗地亚",
          "CM",
          "cm_destroyer",
          81,
          "R"
        ],
        [
          "博克西奇",
          "Alen Bokšić",
          "克罗地亚",
          "ST",
          "st_finisher",
          81,
          "R"
        ],
        [
          "武格里内奇",
          "Davor Vugrinec",
          "克罗地亚",
          "ST",
          "st_runner",
          81,
          "R"
        ]
      ],
      "targetCa": 1090
    }
  },
  {
    "stage": 88,
    "targetCa": 1105,
    "actualCa": 1104.2629156228957,
    "kind": "national",
    "team": {
      "id": "arg-1990",
      "club": "阿根廷",
      "clubEn": "Argentina",
      "season": "1990",
      "coach": "卡洛斯·比拉尔多",
      "tier": "S",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "middle",
        "passing": "direct",
        "tempo": "slow",
        "line": "low",
        "press": "mid"
      },
      "color": "#75aadb",
      "accent": "#ffffff",
      "note": "1990 世界杯亚军；马拉多纳与戈耶切亚的防守足球。",
      "players": [
        [
          "戈耶切亚",
          "Sergio Goycochea",
          "阿根廷",
          "GK",
          "gk_shotstopper",
          87,
          "R"
        ],
        [
          "鲁杰里",
          "Oscar Ruggeri",
          "阿根廷",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "西蒙",
          "Juan Simón",
          "阿根廷",
          "CB",
          "cb_cover",
          86,
          "R"
        ],
        [
          "蒙松",
          "Pedro Monzón",
          "阿根廷",
          "CB",
          "cb_stopper",
          85,
          "R"
        ],
        [
          "奥尔蒂科埃切亚",
          "Julio Olarticoechea",
          "阿根廷",
          "W",
          "fb_attacking",
          85,
          "L"
        ],
        [
          "巴苏阿尔多",
          "José Basualdo",
          "阿根廷",
          "CM",
          "cm_destroyer",
          86,
          "R"
        ],
        [
          "布鲁查加",
          "Jorge Burruchaga",
          "阿根廷",
          "CM",
          "cm_box2box",
          87,
          "R"
        ],
        [
          "马拉多纳",
          "Diego Maradona",
          "阿根廷",
          "CM",
          "cm_creator",
          88,
          "L"
        ],
        [
          "特罗格利奥",
          "Pedro Troglio",
          "阿根廷",
          "W",
          "w_engine",
          86,
          "R"
        ],
        [
          "卡尼吉亚",
          "Claudio Caniggia",
          "阿根廷",
          "ST",
          "st_runner",
          87,
          "R"
        ],
        [
          "德索蒂",
          "Gustavo Dezotti",
          "阿根廷",
          "ST",
          "st_target",
          85,
          "R"
        ],
        [
          "蓬皮多",
          "Nery Pumpido",
          "阿根廷",
          "GK",
          "gk_wall",
          82,
          "R"
        ],
        [
          "塞里苏埃拉",
          "José Serrizuela",
          "阿根廷",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "森西尼",
          "Néstor Sensini",
          "阿根廷",
          "CB",
          "cb_cover",
          82,
          "R"
        ],
        [
          "朱斯蒂",
          "Ricardo Giusti",
          "阿根廷",
          "W",
          "fb_attacking",
          82,
          "R"
        ],
        [
          "卡尔德隆",
          "Gabriel Calderón",
          "阿根廷",
          "CM",
          "cm_playmaker",
          82,
          "R"
        ]
      ],
      "targetCa": 1105
    }
  },
  {
    "stage": 89,
    "targetCa": 1120,
    "actualCa": 1126.9407061340678,
    "kind": "national",
    "team": {
      "id": "ned-1998",
      "club": "荷兰",
      "clubEn": "Netherlands",
      "season": "1998",
      "coach": "弗兰克·里杰卡尔德",
      "tier": "S",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#f36c21",
      "accent": "#ffffff",
      "note": "1998 世界杯四强；博格坎普、克鲁伊维特与戴维斯的橙衣军团。",
      "players": [
        [
          "范德萨",
          "Edwin van der Sar",
          "荷兰",
          "GK",
          "gk_sweeper",
          88,
          "R"
        ],
        [
          "纽曼",
          "Arthur Numan",
          "荷兰",
          "W",
          "fb_attacking",
          86,
          "L"
        ],
        [
          "斯塔姆",
          "Jaap Stam",
          "荷兰",
          "CB",
          "cb_stopper",
          88,
          "R"
        ],
        [
          "弗兰克·德波尔",
          "Frank de Boer",
          "荷兰",
          "CB",
          "cb_ballplaying",
          87,
          "L"
        ],
        [
          "雷齐格",
          "Michael Reiziger",
          "荷兰",
          "W",
          "fb_attacking",
          86,
          "R"
        ],
        [
          "戴维斯",
          "Edgar Davids",
          "荷兰",
          "CM",
          "cm_destroyer",
          88,
          "L"
        ],
        [
          "科库",
          "Phillip Cocu",
          "荷兰",
          "CM",
          "cm_box2box",
          87,
          "L"
        ],
        [
          "罗纳德·德波尔",
          "Ronald de Boer",
          "荷兰",
          "CM",
          "cm_playmaker",
          86,
          "R"
        ],
        [
          "奥维马斯",
          "Marc Overmars",
          "荷兰",
          "W",
          "w_dribbler",
          88,
          "L"
        ],
        [
          "博格坎普",
          "Dennis Bergkamp",
          "荷兰",
          "ST",
          "st_false9",
          88,
          "R"
        ],
        [
          "克鲁伊维特",
          "Patrick Kluivert",
          "荷兰",
          "W",
          "w_finisher",
          87,
          "R"
        ],
        [
          "赫斯普",
          "Ruud Hesp",
          "荷兰",
          "GK",
          "gk_wall",
          82,
          "R"
        ],
        [
          "博加德",
          "Winston Bogarde",
          "荷兰",
          "CB",
          "cb_stopper",
          82,
          "R"
        ],
        [
          "西多夫",
          "Clarence Seedorf",
          "荷兰",
          "CM",
          "cm_box2box",
          82,
          "R"
        ],
        [
          "岑登",
          "Boudewijn Zenden",
          "荷兰",
          "W",
          "w_dribbler",
          82,
          "L"
        ],
        [
          "霍伊东克",
          "Pierre van Hooijdonk",
          "荷兰",
          "ST",
          "st_target",
          82,
          "R"
        ]
      ],
      "targetCa": 1120
    }
  },
  {
    "stage": 90,
    "targetCa": 1135,
    "actualCa": 1146.5226793265995,
    "kind": "national",
    "team": {
      "id": "ita-2006",
      "club": "意大利",
      "clubEn": "Italy",
      "season": "2006",
      "coach": "马塞洛·里皮",
      "tier": "S",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#0066b2",
      "accent": "#ffffff",
      "note": "2006 世界杯冠军；卡纳瓦罗、布冯、皮尔洛与托蒂。",
      "players": [
        [
          "布冯",
          "Gianluigi Buffon",
          "意大利",
          "GK",
          "gk_sweeper",
          89,
          "R"
        ],
        [
          "格罗索",
          "Fabio Grosso",
          "意大利",
          "W",
          "fb_attacking",
          87,
          "L"
        ],
        [
          "卡纳瓦罗",
          "Fabio Cannavaro",
          "意大利",
          "CB",
          "cb_stopper",
          89,
          "R"
        ],
        [
          "马特拉齐",
          "Marco Materazzi",
          "意大利",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "赞布罗塔",
          "Gianluca Zambrotta",
          "意大利",
          "W",
          "fb_attacking",
          88,
          "R"
        ],
        [
          "皮尔洛",
          "Andrea Pirlo",
          "意大利",
          "CM",
          "cm_playmaker",
          89,
          "R"
        ],
        [
          "加图索",
          "Gennaro Gattuso",
          "意大利",
          "CM",
          "cm_destroyer",
          88,
          "R"
        ],
        [
          "佩罗塔",
          "Simone Perrotta",
          "意大利",
          "W",
          "w_engine",
          87,
          "R"
        ],
        [
          "托蒂",
          "Francesco Totti",
          "意大利",
          "CM",
          "cm_creator",
          89,
          "R"
        ],
        [
          "卡莫拉内西",
          "Mauro Camoranesi",
          "意大利",
          "W",
          "w_playmaker",
          87,
          "R"
        ],
        [
          "托尼",
          "Luca Toni",
          "意大利",
          "ST",
          "st_target",
          88,
          "R"
        ],
        [
          "阿梅利亚",
          "Marco Amelia",
          "意大利",
          "GK",
          "gk_wall",
          83,
          "R"
        ],
        [
          "巴尔扎利",
          "Andrea Barzagli",
          "意大利",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "德尔·皮耶罗",
          "Alessandro Del Piero",
          "意大利",
          "ST",
          "st_false9",
          83,
          "L"
        ],
        [
          "因扎吉",
          "Filippo Inzaghi",
          "意大利",
          "ST",
          "st_poacher",
          83,
          "R"
        ],
        [
          "吉拉迪诺",
          "Alberto Gilardino",
          "意大利",
          "ST",
          "st_finisher",
          83,
          "R"
        ]
      ],
      "targetCa": 1135
    }
  },
  {
    "stage": 91,
    "targetCa": 1150,
    "actualCa": 1144.5406713835323,
    "kind": "national",
    "team": {
      "id": "ita-1982",
      "club": "意大利",
      "clubEn": "Italy",
      "season": "1982",
      "coach": "恩佐·贝阿尔佐特",
      "tier": "S",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#0066b2",
      "accent": "#ffffff",
      "note": "1982 世界杯冠军；佐夫、罗西与塔尔代利的蓝衣军团。",
      "players": [
        [
          "佐夫",
          "Dino Zoff",
          "意大利",
          "GK",
          "gk_wall",
          89,
          "R"
        ],
        [
          "卡布里尼",
          "Antonio Cabrini",
          "意大利",
          "W",
          "fb_attacking",
          87,
          "L"
        ],
        [
          "科洛瓦蒂",
          "Fulvio Collovati",
          "意大利",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "希雷阿",
          "Gaetano Scirea",
          "意大利",
          "CB",
          "cb_cover",
          89,
          "R"
        ],
        [
          "真蒂莱",
          "Claudio Gentile",
          "意大利",
          "W",
          "fb_attacking",
          88,
          "R"
        ],
        [
          "孔蒂",
          "Bruno Conti",
          "意大利",
          "W",
          "w_dribbler",
          88,
          "R"
        ],
        [
          "奥里亚利",
          "Gabriele Oriali",
          "意大利",
          "CM",
          "cm_destroyer",
          87,
          "R"
        ],
        [
          "塔尔代利",
          "Marco Tardelli",
          "意大利",
          "CM",
          "cm_box2box",
          88,
          "R"
        ],
        [
          "安托诺尼",
          "Giancarlo Antognoni",
          "意大利",
          "W",
          "w_playmaker",
          88,
          "R"
        ],
        [
          "罗西",
          "Paolo Rossi",
          "意大利",
          "ST",
          "st_poacher",
          89,
          "R"
        ],
        [
          "格拉齐亚尼",
          "Francesco Graziani",
          "意大利",
          "ST",
          "st_target",
          87,
          "R"
        ],
        [
          "加利",
          "Giovanni Galli",
          "意大利",
          "GK",
          "gk_wall",
          83,
          "R"
        ],
        [
          "贝尔戈米",
          "Giuseppe Bergomi",
          "意大利",
          "CB",
          "cb_stopper",
          83,
          "R"
        ],
        [
          "考西奥",
          "Franco Causio",
          "意大利",
          "W",
          "w_dribbler",
          83,
          "R"
        ],
        [
          "贝特加",
          "Roberto Bettega",
          "意大利",
          "ST",
          "st_finisher",
          83,
          "R"
        ],
        [
          "多塞纳",
          "Giuseppe Dossena",
          "意大利",
          "CM",
          "cm_playmaker",
          83,
          "R"
        ]
      ],
      "targetCa": 1150
    }
  },
  {
    "stage": 92,
    "targetCa": 1165,
    "actualCa": 1175.5897652892563,
    "kind": "national",
    "team": {
      "id": "arg-1986",
      "club": "阿根廷",
      "clubEn": "Argentina",
      "season": "1986",
      "coach": "卡洛斯·比拉尔多",
      "tier": "S",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "middle",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#75aadb",
      "accent": "#ffffff",
      "note": "1986 世界杯冠军；马拉多纳的“上帝之手”与连过五人。",
      "players": [
        [
          "蓬皮多",
          "Nery Pumpido",
          "阿根廷",
          "GK",
          "gk_wall",
          89,
          "R"
        ],
        [
          "布朗",
          "José Luis Brown",
          "阿根廷",
          "CB",
          "cb_stopper",
          89,
          "R"
        ],
        [
          "库丘福",
          "Óscar Cuciuffo",
          "阿根廷",
          "CB",
          "cb_cover",
          88,
          "R"
        ],
        [
          "鲁杰里",
          "Oscar Ruggeri",
          "阿根廷",
          "CB",
          "cb_stopper",
          90,
          "R"
        ],
        [
          "奥尔蒂科埃切亚",
          "Julio Olarticoechea",
          "阿根廷",
          "W",
          "fb_attacking",
          88,
          "L"
        ],
        [
          "巴蒂斯塔",
          "Sergio Batista",
          "阿根廷",
          "CM",
          "cm_destroyer",
          89,
          "R"
        ],
        [
          "恩里克",
          "Héctor Enrique",
          "阿根廷",
          "CM",
          "cm_box2box",
          89,
          "R"
        ],
        [
          "布鲁查加",
          "Jorge Burruchaga",
          "阿根廷",
          "CM",
          "cm_box2box",
          90,
          "R"
        ],
        [
          "朱斯蒂",
          "Ricardo Giusti",
          "阿根廷",
          "W",
          "fb_attacking",
          88,
          "R"
        ],
        [
          "马拉多纳",
          "Diego Maradona",
          "阿根廷",
          "ST",
          "st_false9",
          91,
          "L"
        ],
        [
          "巴尔达诺",
          "Jorge Valdano",
          "阿根廷",
          "ST",
          "st_target",
          90,
          "R"
        ],
        [
          "伊斯拉斯",
          "Luis Islas",
          "阿根廷",
          "GK",
          "gk_wall",
          85,
          "R"
        ],
        [
          "塔皮亚",
          "Carlos Tapia",
          "阿根廷",
          "CM",
          "cm_playmaker",
          85,
          "R"
        ],
        [
          "特罗比亚尼",
          "Marcelo Trobbiani",
          "阿根廷",
          "CM",
          "cm_creator",
          85,
          "R"
        ],
        [
          "卡尼吉亚",
          "Claudio Caniggia",
          "阿根廷",
          "ST",
          "st_runner",
          85,
          "R"
        ],
        [
          "帕斯库利",
          "Pedro Pasculli",
          "阿根廷",
          "ST",
          "st_poacher",
          85,
          "R"
        ]
      ],
      "targetCa": 1165
    }
  },
  {
    "stage": 93,
    "targetCa": 1180,
    "actualCa": 1169.1079193970004,
    "kind": "national",
    "team": {
      "id": "bra-1994",
      "club": "巴西",
      "clubEn": "Brazil",
      "season": "1994",
      "coach": "卡洛斯·阿尔贝托·佩雷拉",
      "tier": "S",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#ffdf00",
      "accent": "#009c3b",
      "note": "1994 世界杯冠军；罗马里奥、贝贝托与邓加的实用巴西。",
      "players": [
        [
          "塔法雷尔",
          "Cláudio Taffarel",
          "巴西",
          "GK",
          "gk_wall",
          89,
          "R"
        ],
        [
          "布兰科",
          "Branco",
          "巴西",
          "W",
          "fb_attacking",
          89,
          "L"
        ],
        [
          "阿尔代尔",
          "Aldair",
          "巴西",
          "CB",
          "cb_cover",
          89,
          "R"
        ],
        [
          "马尔西奥·桑托斯",
          "Márcio Santos",
          "巴西",
          "CB",
          "cb_stopper",
          88,
          "R"
        ],
        [
          "若日尼奥",
          "Jorginho",
          "巴西",
          "W",
          "fb_attacking",
          88,
          "R"
        ],
        [
          "津霍",
          "Zinho",
          "巴西",
          "W",
          "w_playmaker",
          88,
          "R"
        ],
        [
          "邓加",
          "Dunga",
          "巴西",
          "CM",
          "cm_destroyer",
          90,
          "R"
        ],
        [
          "毛罗·席尔瓦",
          "Mauro Silva",
          "巴西",
          "CM",
          "cm_playmaker",
          89,
          "R"
        ],
        [
          "马齐尼奥",
          "Mazinho",
          "巴西",
          "W",
          "w_engine",
          88,
          "R"
        ],
        [
          "罗马里奥",
          "Romário",
          "巴西",
          "ST",
          "st_poacher",
          90,
          "R"
        ],
        [
          "贝贝托",
          "Bebeto",
          "巴西",
          "ST",
          "st_false9",
          89,
          "L"
        ],
        [
          "泽蒂",
          "Zetti",
          "巴西",
          "GK",
          "gk_wall",
          84,
          "R"
        ],
        [
          "卡福",
          "Cafu",
          "巴西",
          "W",
          "fb_attacking",
          84,
          "R"
        ],
        [
          "罗纳尔当",
          "Ronaldão",
          "巴西",
          "CB",
          "cb_stopper",
          84,
          "R"
        ],
        [
          "拉伊",
          "Raí",
          "巴西",
          "CM",
          "cm_creator",
          84,
          "R"
        ],
        [
          "穆勒",
          "Müller",
          "巴西",
          "ST",
          "st_finisher",
          84,
          "R"
        ]
      ],
      "targetCa": 1180
    }
  },
  {
    "stage": 94,
    "targetCa": 1195,
    "actualCa": 1199.570593587389,
    "kind": "national",
    "team": {
      "id": "ger-2014",
      "club": "德国",
      "clubEn": "Germany",
      "season": "2014",
      "coach": "约阿希姆·勒夫",
      "tier": "S",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "normal",
        "line": "high",
        "press": "high"
      },
      "color": "#ffffff",
      "accent": "#000000",
      "note": "2014 世界杯冠军；7-1 巴西，诺伊尔、克罗斯与穆勒。",
      "players": [
        [
          "诺伊尔",
          "Manuel Neuer",
          "德国",
          "GK",
          "gk_sweeper",
          91,
          "R"
        ],
        [
          "赫韦德斯",
          "Benedikt Höwedes",
          "德国",
          "W",
          "fb_attacking",
          89,
          "L"
        ],
        [
          "胡梅尔斯",
          "Mats Hummels",
          "德国",
          "CB",
          "cb_ballplaying",
          90,
          "R"
        ],
        [
          "博阿滕",
          "Jérôme Boateng",
          "德国",
          "CB",
          "cb_stopper",
          90,
          "R"
        ],
        [
          "拉姆",
          "Philipp Lahm",
          "德国",
          "W",
          "fb_playmaker",
          91,
          "R"
        ],
        [
          "施魏因施泰格",
          "Bastian Schweinsteiger",
          "德国",
          "CM",
          "cm_playmaker",
          90,
          "R"
        ],
        [
          "赫迪拉",
          "Sami Khedira",
          "德国",
          "CM",
          "cm_box2box",
          89,
          "R"
        ],
        [
          "克罗斯",
          "Toni Kroos",
          "德国",
          "CM",
          "cm_playmaker",
          91,
          "L"
        ],
        [
          "厄齐尔",
          "Mesut Özil",
          "德国",
          "W",
          "w_playmaker",
          90,
          "L"
        ],
        [
          "克洛泽",
          "Miroslav Klose",
          "德国",
          "ST",
          "st_poacher",
          90,
          "R"
        ],
        [
          "穆勒",
          "Thomas Müller",
          "德国",
          "W",
          "w_finisher",
          91,
          "R"
        ],
        [
          "齐勒",
          "Ron-Robert Zieler",
          "德国",
          "GK",
          "gk_wall",
          85,
          "R"
        ],
        [
          "默特萨克",
          "Per Mertesacker",
          "德国",
          "CB",
          "cb_stopper",
          85,
          "R"
        ],
        [
          "德拉克斯勒",
          "Julian Draxler",
          "德国",
          "W",
          "w_dribbler",
          85,
          "R"
        ],
        [
          "格策",
          "Mario Götze",
          "德国",
          "CM",
          "cm_mezzala",
          85,
          "R"
        ],
        [
          "许尔勒",
          "André Schürrle",
          "德国",
          "W",
          "w_finisher",
          85,
          "R"
        ]
      ],
      "targetCa": 1195
    }
  },
  {
    "stage": 95,
    "targetCa": 1210,
    "actualCa": 1220.880108472605,
    "kind": "national",
    "team": {
      "id": "fra-1998",
      "club": "法国",
      "clubEn": "France",
      "season": "1998",
      "coach": "艾梅·雅凯",
      "tier": "S+",
      "formationId": "4-2-3-1",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#002395",
      "accent": "#ed2939",
      "note": "1998 世界杯冠军；齐达内决赛两球，德尚与德塞利的法国。",
      "players": [
        [
          "巴特兹",
          "Fabien Barthez",
          "法国",
          "GK",
          "gk_sweeper",
          91,
          "R"
        ],
        [
          "利扎拉祖",
          "Bixente Lizarazu",
          "法国",
          "W",
          "fb_attacking",
          91,
          "L"
        ],
        [
          "布兰克",
          "Laurent Blanc",
          "法国",
          "CB",
          "cb_ballplaying",
          92,
          "R"
        ],
        [
          "德塞利",
          "Marcel Desailly",
          "法国",
          "CB",
          "cb_stopper",
          92,
          "R"
        ],
        [
          "图拉姆",
          "Lilian Thuram",
          "法国",
          "W",
          "fb_attacking",
          92,
          "R"
        ],
        [
          "德尚",
          "Didier Deschamps",
          "法国",
          "CM",
          "cm_destroyer",
          91,
          "R"
        ],
        [
          "佩蒂特",
          "Emmanuel Petit",
          "法国",
          "CM",
          "cm_box2box",
          90,
          "L"
        ],
        [
          "齐达内",
          "Zinedine Zidane",
          "法国",
          "W",
          "w_playmaker",
          92,
          "R"
        ],
        [
          "德约卡夫",
          "Youri Djorkaeff",
          "法国",
          "CM",
          "cm_creator",
          91,
          "R"
        ],
        [
          "卡伦布",
          "Christian Karembeu",
          "法国",
          "W",
          "w_engine",
          90,
          "R"
        ],
        [
          "吉瓦什",
          "Stéphane Guivarc’h",
          "法国",
          "ST",
          "st_target",
          89,
          "R"
        ],
        [
          "拉马",
          "Bernard Lama",
          "法国",
          "GK",
          "gk_wall",
          86,
          "R"
        ],
        [
          "坎德拉",
          "Vincent Candela",
          "法国",
          "W",
          "fb_attacking",
          86,
          "R"
        ],
        [
          "维埃拉",
          "Patrick Vieira",
          "法国",
          "CM",
          "cm_box2box",
          86,
          "R"
        ],
        [
          "杜加里",
          "Christophe Dugarry",
          "法国",
          "ST",
          "st_target",
          86,
          "R"
        ],
        [
          "亨利",
          "Thierry Henry",
          "法国",
          "ST",
          "st_runner",
          86,
          "L"
        ]
      ],
      "targetCa": 1210
    }
  },
  {
    "stage": 96,
    "targetCa": 1225,
    "actualCa": 1218.2381713651669,
    "kind": "national",
    "team": {
      "id": "bra-2002",
      "club": "巴西",
      "clubEn": "Brazil",
      "season": "2002",
      "coach": "路易斯·菲利佩·斯科拉里",
      "tier": "S+",
      "formationId": "3-5-2",
      "tactics": {
        "attack": "wing",
        "passing": "mixed",
        "tempo": "fast",
        "line": "mid",
        "press": "high"
      },
      "color": "#ffdf00",
      "accent": "#009c3b",
      "note": "2002 世界杯冠军；3R 组合，七战全胜。",
      "players": [
        [
          "马科斯",
          "Marcos",
          "巴西",
          "GK",
          "gk_wall",
          90,
          "R"
        ],
        [
          "卢西奥",
          "Lúcio",
          "巴西",
          "CB",
          "cb_stopper",
          92,
          "R"
        ],
        [
          "罗克·儒尼奥尔",
          "Roque Júnior",
          "巴西",
          "CB",
          "cb_cover",
          89,
          "R"
        ],
        [
          "埃德米尔森",
          "Edmílson",
          "巴西",
          "CB",
          "cb_ballplaying",
          90,
          "R"
        ],
        [
          "罗伯特·卡洛斯",
          "Roberto Carlos",
          "巴西",
          "W",
          "fb_attacking",
          92,
          "L"
        ],
        [
          "吉尔伯托·席尔瓦",
          "Gilberto Silva",
          "巴西",
          "CM",
          "cm_destroyer",
          91,
          "R"
        ],
        [
          "克莱伯森",
          "Kléberson",
          "巴西",
          "CM",
          "cm_box2box",
          89,
          "R"
        ],
        [
          "儒尼尼奥",
          "Juninho Paulista",
          "巴西",
          "CM",
          "cm_playmaker",
          90,
          "R"
        ],
        [
          "卡福",
          "Cafu",
          "巴西",
          "W",
          "fb_attacking",
          92,
          "R"
        ],
        [
          "罗纳尔多",
          "Ronaldo Nazário",
          "巴西",
          "ST",
          "st_runner",
          92,
          "R"
        ],
        [
          "里瓦尔多",
          "Rivaldo",
          "巴西",
          "ST",
          "st_false9",
          92,
          "L"
        ],
        [
          "迪达",
          "Dida",
          "巴西",
          "GK",
          "gk_wall",
          86,
          "R"
        ],
        [
          "贝莱蒂",
          "Belletti",
          "巴西",
          "W",
          "fb_attacking",
          86,
          "R"
        ],
        [
          "安德森·波尔加",
          "Anderson Polga",
          "巴西",
          "CB",
          "cb_stopper",
          86,
          "R"
        ],
        [
          "德尼尔森",
          "Denílson",
          "巴西",
          "CM",
          "cm_mezzala",
          86,
          "L"
        ],
        [
          "路易松",
          "Luizão",
          "巴西",
          "ST",
          "st_target",
          86,
          "R"
        ]
      ],
      "targetCa": 1225
    }
  },
  {
    "stage": 97,
    "targetCa": 1240,
    "actualCa": 1252.43498922865,
    "kind": "national",
    "team": {
      "id": "esp-2010",
      "club": "西班牙",
      "clubEn": "Spain",
      "season": "2010",
      "coach": "维森特·德尔·博斯克",
      "tier": "S+",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "middle",
        "passing": "short",
        "tempo": "slow",
        "line": "high",
        "press": "high"
      },
      "color": "#c60b1e",
      "accent": "#ffc400",
      "note": "2010 世界杯冠军；tiki-taka 的国家队巅峰。",
      "players": [
        [
          "卡西利亚斯",
          "Iker Casillas",
          "西班牙",
          "GK",
          "gk_shotstopper",
          93,
          "R"
        ],
        [
          "卡普德维拉",
          "Joan Capdevila",
          "西班牙",
          "W",
          "fb_attacking",
          91,
          "L"
        ],
        [
          "皮克",
          "Gerard Piqué",
          "西班牙",
          "CB",
          "cb_ballplaying",
          92,
          "R"
        ],
        [
          "普约尔",
          "Carles Puyol",
          "西班牙",
          "CB",
          "cb_stopper",
          92,
          "R"
        ],
        [
          "拉莫斯",
          "Sergio Ramos",
          "西班牙",
          "W",
          "fb_attacking",
          92,
          "R"
        ],
        [
          "布斯克茨",
          "Sergio Busquets",
          "西班牙",
          "CM",
          "cm_destroyer",
          92,
          "R"
        ],
        [
          "哈维",
          "Xavi Hernández",
          "西班牙",
          "CM",
          "cm_playmaker",
          93,
          "R"
        ],
        [
          "阿隆索",
          "Xabi Alonso",
          "西班牙",
          "CM",
          "cm_playmaker",
          92,
          "R"
        ],
        [
          "伊涅斯塔",
          "Andrés Iniesta",
          "西班牙",
          "W",
          "w_playmaker",
          93,
          "R"
        ],
        [
          "比利亚",
          "David Villa",
          "西班牙",
          "ST",
          "st_finisher",
          93,
          "R"
        ],
        [
          "佩德罗",
          "Pedro Rodríguez",
          "西班牙",
          "W",
          "w_finisher",
          91,
          "R"
        ],
        [
          "巴尔德斯",
          "Víctor Valdés",
          "西班牙",
          "GK",
          "gk_sweeper",
          87,
          "R"
        ],
        [
          "马切纳",
          "Carlos Marchena",
          "西班牙",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "法布雷加斯",
          "Cesc Fàbregas",
          "西班牙",
          "CM",
          "cm_creator",
          87,
          "R"
        ],
        [
          "席尔瓦",
          "David Silva",
          "西班牙",
          "W",
          "w_playmaker",
          87,
          "L"
        ],
        [
          "托雷斯",
          "Fernando Torres",
          "西班牙",
          "ST",
          "st_runner",
          87,
          "R"
        ]
      ],
      "targetCa": 1240
    }
  },
  {
    "stage": 98,
    "targetCa": 1255,
    "actualCa": 1245.196614937251,
    "kind": "national",
    "team": {
      "id": "ger-1974",
      "club": "联邦德国",
      "clubEn": "West Germany",
      "season": "1974",
      "coach": "赫尔穆特·舍恩",
      "tier": "S+",
      "formationId": "4-4-2",
      "tactics": {
        "attack": "balanced",
        "passing": "mixed",
        "tempo": "normal",
        "line": "mid",
        "press": "mid"
      },
      "color": "#ffffff",
      "accent": "#000000",
      "note": "1974 世界杯冠军；贝肯鲍尔、盖德·穆勒与“伯尔尼奇迹”后的第二冠。",
      "players": [
        [
          "迈尔",
          "Sepp Maier",
          "联邦德国",
          "GK",
          "gk_wall",
          92,
          "R"
        ],
        [
          "布莱特纳",
          "Paul Breitner",
          "联邦德国",
          "W",
          "fb_attacking",
          93,
          "L"
        ],
        [
          "施瓦岑贝克",
          "Georg Schwarzenbeck",
          "联邦德国",
          "CB",
          "cb_stopper",
          91,
          "R"
        ],
        [
          "贝肯鲍尔",
          "Franz Beckenbauer",
          "联邦德国",
          "CB",
          "cb_ballplaying",
          93,
          "R"
        ],
        [
          "福格茨",
          "Berti Vogts",
          "联邦德国",
          "W",
          "fb_attacking",
          91,
          "R"
        ],
        [
          "奥韦拉特",
          "Wolfgang Overath",
          "联邦德国",
          "W",
          "w_playmaker",
          92,
          "R"
        ],
        [
          "邦霍夫",
          "Rainer Bonhof",
          "联邦德国",
          "CM",
          "cm_box2box",
          91,
          "R"
        ],
        [
          "格拉博夫斯基",
          "Jürgen Grabowski",
          "联邦德国",
          "CM",
          "cm_mezzala",
          91,
          "R"
        ],
        [
          "赫内斯",
          "Uli Hoeneß",
          "联邦德国",
          "W",
          "w_finisher",
          92,
          "R"
        ],
        [
          "盖德·穆勒",
          "Gerd Müller",
          "联邦德国",
          "ST",
          "st_poacher",
          93,
          "R"
        ],
        [
          "赫尔岑拜因",
          "Bernd Hölzenbein",
          "联邦德国",
          "ST",
          "st_false9",
          91,
          "R"
        ],
        [
          "克莱夫",
          "Wolfgang Kleff",
          "联邦德国",
          "GK",
          "gk_wall",
          87,
          "R"
        ],
        [
          "赫特格斯",
          "Horst-Dieter Höttges",
          "联邦德国",
          "CB",
          "cb_stopper",
          87,
          "R"
        ],
        [
          "库尔曼",
          "Bernhard Cullmann",
          "联邦德国",
          "CM",
          "cm_playmaker",
          87,
          "R"
        ],
        [
          "弗洛赫",
          "Heinz Flohe",
          "联邦德国",
          "W",
          "w_engine",
          87,
          "R"
        ],
        [
          "克雷默斯",
          "Helmut Kremers",
          "联邦德国",
          "CM",
          "cm_box2box",
          87,
          "R"
        ]
      ],
      "targetCa": 1255
    }
  },
  {
    "stage": 99,
    "targetCa": 1270,
    "actualCa": 1271.6095477808385,
    "kind": "national",
    "team": {
      "id": "ned-1974",
      "club": "荷兰",
      "clubEn": "Netherlands",
      "season": "1974",
      "coach": "里努斯·米歇尔斯",
      "tier": "S+",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#f36c21",
      "accent": "#ffffff",
      "note": "1974 世界杯亚军；克鲁伊夫与全攻全守的橙衣军团。",
      "players": [
        [
          "容布洛德",
          "Jan Jongbloed",
          "荷兰",
          "GK",
          "gk_wall",
          91,
          "R"
        ],
        [
          "克罗尔",
          "Ruud Krol",
          "荷兰",
          "W",
          "fb_attacking",
          94,
          "L"
        ],
        [
          "赖斯贝根",
          "Wim Rijsbergen",
          "荷兰",
          "CB",
          "cb_stopper",
          92,
          "R"
        ],
        [
          "哈恩",
          "Arie Haan",
          "荷兰",
          "CB",
          "cb_ballplaying",
          93,
          "R"
        ],
        [
          "苏尔比尔",
          "Wim Suurbier",
          "荷兰",
          "W",
          "fb_attacking",
          93,
          "R"
        ],
        [
          "扬森",
          "Wim Jansen",
          "荷兰",
          "CM",
          "cm_destroyer",
          92,
          "R"
        ],
        [
          "内斯肯斯",
          "Johan Neeskens",
          "荷兰",
          "CM",
          "cm_box2box",
          94,
          "R"
        ],
        [
          "范哈内亨",
          "Willem van Hanegem",
          "荷兰",
          "CM",
          "cm_playmaker",
          93,
          "L"
        ],
        [
          "雷普",
          "Johnny Rep",
          "荷兰",
          "W",
          "w_finisher",
          93,
          "R"
        ],
        [
          "克鲁伊夫",
          "Johan Cruyff",
          "荷兰",
          "ST",
          "st_false9",
          94,
          "R"
        ],
        [
          "伦森布林克",
          "Rob Rensenbrink",
          "荷兰",
          "W",
          "w_finisher",
          93,
          "L"
        ],
        [
          "斯赫赖弗斯",
          "Sies Schrijvers",
          "荷兰",
          "GK",
          "gk_wall",
          88,
          "R"
        ],
        [
          "伊斯拉埃尔",
          "Rinus Israël",
          "荷兰",
          "CB",
          "cb_stopper",
          88,
          "R"
        ],
        [
          "德容",
          "Theo de Jong",
          "荷兰",
          "CM",
          "cm_engine",
          88,
          "R"
        ],
        [
          "范德克尔霍夫",
          "Willy van der Kerkhof",
          "荷兰",
          "CM",
          "cm_box2box",
          88,
          "R"
        ],
        [
          "赫尔斯",
          "Ruud Geels",
          "荷兰",
          "ST",
          "st_finisher",
          88,
          "R"
        ]
      ],
      "targetCa": 1270
    }
  },
  {
    "stage": 100,
    "targetCa": 1300,
    "actualCa": 1304.2935982460972,
    "kind": "national",
    "team": {
      "id": "bra-1970",
      "club": "巴西",
      "clubEn": "Brazil",
      "season": "1970",
      "coach": "马里奥·扎加洛",
      "tier": "S+",
      "formationId": "4-3-3",
      "tactics": {
        "attack": "wing",
        "passing": "short",
        "tempo": "fast",
        "line": "high",
        "press": "high"
      },
      "color": "#ffdf00",
      "accent": "#009c3b",
      "note": "1970 世界杯冠军；贝利、雅伊尔津霍、托斯唐、里维利诺，被公认为最强国家队。",
      "players": [
        [
          "费利克斯",
          "Félix",
          "巴西",
          "GK",
          "gk_wall",
          93,
          "R"
        ],
        [
          "埃韦拉尔多",
          "Everaldo",
          "巴西",
          "W",
          "fb_attacking",
          92,
          "L"
        ],
        [
          "布里托",
          "Brito",
          "巴西",
          "CB",
          "cb_stopper",
          93,
          "R"
        ],
        [
          "皮亚扎",
          "Piazza",
          "巴西",
          "CB",
          "cb_ballplaying",
          94,
          "R"
        ],
        [
          "卡洛斯·阿尔贝托",
          "Carlos Alberto",
          "巴西",
          "W",
          "fb_attacking",
          95,
          "R"
        ],
        [
          "克洛多阿尔多",
          "Clodoaldo",
          "巴西",
          "CM",
          "cm_destroyer",
          94,
          "R"
        ],
        [
          "热尔松",
          "Gérson",
          "巴西",
          "CM",
          "cm_playmaker",
          95,
          "L"
        ],
        [
          "里维利诺",
          "Rivelino",
          "巴西",
          "CM",
          "cm_creator",
          95,
          "L"
        ],
        [
          "雅伊尔津霍",
          "Jairzinho",
          "巴西",
          "W",
          "w_finisher",
          95,
          "R"
        ],
        [
          "托斯唐",
          "Tostão",
          "巴西",
          "ST",
          "st_false9",
          95,
          "R"
        ],
        [
          "贝利",
          "Pelé",
          "巴西",
          "ST",
          "st_false9",
          95,
          "R"
        ],
        [
          "阿多",
          "Ado",
          "巴西",
          "GK",
          "gk_wall",
          89,
          "R"
        ],
        [
          "泽·马里亚",
          "Zé Maria",
          "巴西",
          "W",
          "fb_attacking",
          89,
          "R"
        ],
        [
          "若埃尔·卡马戈",
          "Joel Camargo",
          "巴西",
          "CB",
          "cb_stopper",
          89,
          "R"
        ],
        [
          "保罗·塞萨尔",
          "Paulo Cézar Caju",
          "巴西",
          "W",
          "w_dribbler",
          89,
          "L"
        ],
        [
          "罗伯托·米兰达",
          "Roberto Miranda",
          "巴西",
          "ST",
          "st_target",
          89,
          "R"
        ]
      ],
      "targetCa": 1300
    }
  }
]
