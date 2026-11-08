import { describe, expect, it } from 'vitest'
import { convertRaw, keyNeeds, lightEdit, needsOf, normalizeEventKey, parseEventKey, slotsOf, stripUpper } from './clean.ts'
import { NEEDS, needNames } from './types.ts'

describe('占位符转换', () => {
  it('把 FM 原始占位符换成【】写法，显示方式后缀统一成同一个槽位', () => {
    expect(convertRaw('[%male#1-surname]把球传给[%male#2]')).toBe('【球员1】把球传给【球员2】')
    expect(convertRaw('[%female#3]在看台上')).toBe('【球员3】在看台上')
    expect(convertRaw('[%team#1-short]要换人了')).toBe('【球队1】要换人了')
    expect(convertRaw('[%team#1-uppercase]赢了')).toBe('【球队1】赢了')
    expect(convertRaw('第[%number#1-nth]个球，[%number#2-text]分钟')).toBe('第【数字1】个球，【数字2】分钟')
    expect(convertRaw('在[%stadium#1]，[%comp#1]的[%stage_name#1]，[%string#1]，[%injury#1]')).toBe('在【球场1】，【赛事1】的【阶段1】，【文本1】，【伤病1】')
    expect(convertRaw('[%person#referee]出示红牌')).toBe('【球员referee】出示红牌')
  })

  it('丢弃行尾多余的隐藏性别占位符', () => {
    expect(convertRaw('[%male#referee]吹响了哨子[%female#referee-hidden]')).toBe('【球员referee】吹响了哨子')
    expect(convertRaw('[%male#1]越位了[%male#1-hidden][%female#referee-hidden]')).toBe('【球员1】越位了')
  })

  it('去掉 {upper} 指令，也去掉原文里少写了左花括号的写法', () => {
    expect(convertRaw('{upper}[%male#referee]示意比赛继续')).toBe('【球员referee】示意比赛继续')
    expect(stripUpper('upper}【球员referee】吹响半场休息哨声')).toBe('【球员referee】吹响半场休息哨声')
  })

  it('认不出的占位符原样保留，方便构建时报出来', () => {
    expect(convertRaw('[%weird#1]')).toBe('[%weird#1]')
  })
})

describe('槽位', () => {
  it('按 球员 / 裁判 / 球队 / 数字 / 其他 排序并去重', () => {
    expect(slotsOf('【球员2】把球给【球员1】，【球员1】射门，【球队1】领先【数字1】米，【球员referee】')).toBe('P1,P2,REF,T1,N1')
    expect(slotsOf('在【球场1】，【赛事1】的【阶段1】，【文本1】，【伤病1】')).toBe('COMP,INJ,STAD,STAGE,TXT')
    expect(slotsOf('没有槽位')).toBe('')
  })

  it('认不出的槽位带 ? 前缀', () => {
    expect(slotsOf('【怪东西1】')).toBe('?怪东西1')
  })
})

describe('轻改', () => {
  it('她改成他', () => {
    expect(lightEdit('裁判看了眼她的手表')).toBe('裁判看了眼他的手表')
  })

  it('距离单位码改成米', () => {
    expect(lightEdit('【球员1】传了一个【数字1】码远的球')).toBe('【球员1】传了一个【数字1】米远的球')
    expect(lightEdit('裁判往十二码位置一指')).toBe('裁判往点球点位置一指')
    expect(lightEdit('把球向前移动了10码')).toBe('把球向前移动了9米')
    expect(lightEdit('让人墙离开球十码距离')).toBe('让人墙离开球九米距离')
    expect(lightEdit('他没有站在五码之外')).toBe('他没有站在五米之外')
  })

  it('号码牌里的“码”不能动', () => {
    expect(lightEdit('第四官员举起了号码牌...')).toBe('第四官员举起了号码牌...')
  })

  it('拆开的感叹号合并', () => {
    expect(lightEdit('太棒了! !')).toBe('太棒了!!')
    expect(lightEdit('进球了! ! !')).toBe('进球了!!!')
    expect(lightEdit('进球了!')).toBe('进球了!')
  })
})

describe('事件键', () => {
  it('去掉键后面夹带的注释', () => {
    expect(normalizeEventKey('TOUCHLINE_INSTRUCTION_PRAISE, refers to touchline instruction ID 436645 Praise')).toBe('TOUCHLINE_INSTRUCTION_PRAISE')
    expect(normalizeEventKey('VAR_PRE_DECISION_WAS_IT_OFFSIDE. Male 1 is offside')).toBe('VAR_PRE_DECISION_WAS_IT_OFFSIDE')
    expect(normalizeEventKey('VAR_PRE_DECISION_WAS_IT_AN_ELBOW.')).toBe('VAR_PRE_DECISION_WAS_IT_AN_ELBOW')
    expect(normalizeEventKey('  ')).toBeNull()
    expect(normalizeEventKey('lowercase')).toBeNull()
  })

  it('拆成家族和限定词', () => {
    expect(parseEventKey('PASS_SHORT_LEFT_WING_FIRST_TIME_INTO_PATH')).toEqual({ family: 'PASS_SHORT', tags: ['LEFT_WING', 'FIRST_TIME', 'INTO_PATH'] })
    expect(parseEventKey('CROSS_HIGH_NEAR_POST_FROM_LEFT')).toEqual({ family: 'CROSS_FROM', tags: ['HIGH', 'NEAR_POST', 'LEFT'] })
    expect(parseEventKey('GOAL_ONE')).toEqual({ family: 'GOAL_ONE', tags: [] })
    expect(parseEventKey('LEFT_FOOT')).toEqual({ family: 'LEFT_FOOT', tags: [] })
  })
})

describe('依赖未实现功能（needs）', () => {
  it('键按词边界匹配：BICYCLE 不是天气，ILLEGAL 不是两回合', () => {
    expect(keyNeeds('SHOT_BICYCLE_KICK')).toBe(0)
    expect(keyNeeds('BREAKS_THE_OFFSIDE_TRAP_ILLEGAL')).toBe(0)
    expect(keyNeeds('TURN_ICY')).toBe(NEEDS.weather)
    expect(keyNeeds('FULL_TIME_SECOND_LEG_HOME_TEAM_WINS_AND_ARE_THROUGH')).toBe(NEEDS.twoLeg)
  })

  it('VAR、场边训话、中止、补时、争议判罚、偏好动作：键就够了', () => {
    expect(needsOf(['VAR_DECISION_REF_IS_GOAL'], '【球员referee】判决进球有效!')).toBe(NEEDS.var)
    expect(needsOf(['AGGRESSIVE_TOUCHLINE_TEAM_TALK_ISSUED'], '【球员1】态度强硬地向球队训话')).toBe(NEEDS.talk)
    expect(needsOf(['MATCH_ABANDONED_FLOODLIGHT_FAILURE'], '裁判宣布比赛取消!')).toBe(NEEDS.abandon)
    expect(needsOf(['TIME_ADDED_ON'], '伤停补时【数字1】分钟')).toBe(NEEDS.stoppage)
    expect(needsOf(['CONTROVERSY_DODGY_GOAL'], '这个球似乎有点争议')).toBe(NEEDS.referee)
    expect(needsOf(['PPM_SHOOTS_LONG_CONTEXT_REFLECTIVE_GOAL'], '【球员1】又一记招牌式入球!')).toBe(NEEDS.ppm)
  })

  it('训话后的情绪下的普通动作，文字是普通描述，不挂起', () => {
    expect(needsOf(['HTT_CONFIDENT_RUN_PAST_OPPONENT'], '【球员1】带球从【球员2】身边闪了过去')).toBe(0)
  })

  it('天气、两回合、生涯的变体键：文字也提到了才挂起', () => {
    expect(needsOf(['PASS_SHORT_FORWARD_MUDDY'], '【球员1】把球向前传')).toBe(0)
    expect(needsOf(['PASS_SHORT_FORWARD_MUDDY'], '【球员1】在泥泞的场地上把球敲给【球员2】')).toBe(NEEDS.weather)
    expect(needsOf(['HALF_TIME_SECOND_LEG_LEVEL_ON_AGGREGATE'], '上半场比赛结束，双方真的是势均力敌')).toBe(0)
    expect(needsOf(['HALF_TIME_SECOND_LEG_LEVEL_ON_AGGREGATE'], '总比分、客场进球 双方都是一模一样')).toBe(NEEDS.twoLeg)
    expect(needsOf(['START_MATCH_ONE_OBSERVING_MANAGER_AT_MATCH'], '欢迎来到【球场1】，【球队1】首先开球')).toBe(0)
    expect(needsOf(['START_MATCH_ONE_OBSERVING_MANAGER_AT_MATCH'], '镜头转向看台，【球队3】主帅【球员3】今天也来到现场观战')).toBe(NEEDS.career)
  })

  it('只要有一个普通键，这句话就是普通描述', () => {
    expect(needsOf(['GOAL_ONE', 'GOAL_ONE_FANS_FAVE'], '【球员1】进球了!')).toBe(0)
    expect(needsOf(['PERFECT_SLIDE_TACKLE', 'HTT_DETERMINED_PERFECT_SLIDE_TACKLE'], '【球员1】的滑铲很漂亮')).toBe(0)
  })

  it('没有事件键的句子靠文字判断', () => {
    expect(needsOf([], 'VAR支持裁判的红牌决定!')).toBe(NEEDS.var)
    expect(needsOf([], '【球员1】控好球...')).toBe(0)
    expect(needsOf([], '第四官员示意补时一分钟')).toBe(NEEDS.stoppage)
    expect(needNames(NEEDS.var | NEEDS.stoppage)).toEqual(['var', 'stoppage'])
  })
})
