import type { LegendTeamDef } from './legend-teams.ts'
import type { Position, StyleId } from '../types.ts'
import evidence from './world-cup-evidence.generated.json'

type Replacement = [name: string, enName: string, position?: Position, style?: StyleId]

/** 纠正跨年代、同名错配和未参加该届赛事的人选；不凭借纠错提高球队强度。 */
const CLUB_FIXES: Record<string, Record<string, Replacement>> = {
  'real-madrid-1959-60': { 'Agustín Rodríguez': ['胡安·阿隆索', 'Juan Alonso'], 'Isidro Sánchez': ['贝塞里尔', 'José María Becerril'] },
  'ajax-1971-72': { 'Sies Schrijvers': ['韦弗', 'Sies Wever'], 'Theo van Duivenbode': ['席尔歇', 'Heinz Schilcher'], 'Johan Dijkstra': ['阿诺德·米伦', 'Arnold Mühren', 'CM', 'cm_playmaker'] },
  'santos-1962-63': { 'Angelo Sormani': ['阿尔米尔', 'Almir Pernambuquinho', 'ST', 'st_runner'] },
  'bayern-1974-75': { 'Paul Breitner': ['比约恩·安德松', 'Björn Andersson'], 'Hans-Josef Weiss': ['约瑟夫·魏斯', 'Josef Weiss'], 'Rolf Aumann': ['奥尔克', 'Werner Olck'], 'Franz Obermeier': ['奥格斯堡', 'Klaus Augsburger'] },
  'liverpool-1983-84': { 'Bob Ogrizovic': ['博尔德', 'Bob Bolder'], 'Kenny Walsh': ['尼科尔', 'Steve Nicol', 'W', 'fb_attacking'] },
  'inter-1964-65': { 'Sergio Landini': ['布加蒂', 'Ottavio Bugatti'] },
  'napoli-1989-90': { 'Giovanni Galli': ['朱利亚尼', 'Giuliano Giuliani'], 'Carmelo Fusi': ['卢卡·富西', 'Luca Fusi'], 'Raffaele Taglialatela': ['迪富斯科', 'Raffaele Di Fusco'], 'Antonio Nista': ['雷尼卡', 'Alessandro Renica', 'CB', 'cb_cover'], 'Gianfranco Incocciati': ['马西莫·毛罗', 'Massimo Mauro', 'CM', 'cm_playmaker'] },
  'juventus-1995-96': { 'Paolo Montero': ['波里尼', 'Sergio Porrini', 'CB', 'cb_stopper'] },
  'juventus-1997-98': { 'Alen Bokšić': ['阿莫鲁索', 'Nicola Amoruso', 'W', 'w_finisher'] },
  'lazio-1999-00': { 'Hernán Crespo': ['西蒙尼·因扎吉', 'Simone Inzaghi', 'ST', 'st_poacher'] },
  'atletico-2013-14': { 'Guilherme Siqueira': ['因苏亚', 'Emiliano Insúa'] },
  'dortmund-1996-97': { 'Patrik Berger': ['里肯', 'Lars Ricken', 'CM', 'cm_creator'] },
  'psv-1987-88': { 'Patrick van Ede': ['费尔奎伦', 'Pierre Verkuylen'], 'Stan Valckx': ['库特', 'Adick Koot'], 'Wim de Jong': ['林斯肯斯', 'Edward Linskens', 'CM', 'cm_destroyer'] },
  'dynamo-kyiv-1985-86': { 'Yuriy Kutepov': ['米哈伊洛夫', 'Mikhail Mikhailov'], 'Serhiy Bal': ['安德烈·巴尔', 'Andriy Bal'], 'Serhiy Morozov': ['茹拉夫廖夫', 'Serhiy Zhuravlyov'], 'Viktor Ponomarev': ['叶夫谢耶夫', 'Vasyl Yevseyev', 'CB', 'cb_cover'] },
  'flamengo-1981-82': { 'Figueiredo': ['菲格雷多', 'Figueiredo', 'CB', 'cb_stopper'], 'Anselmo': ['安塞尔莫', 'Anselmo', 'ST', 'st_finisher'], 'Carpegiani': ['维托尔', 'Vitor', 'CM', 'cm_playmaker'] },
  'red-star-1990-91': { 'Miodrag Vasilijević': ['纳伊多斯基', 'Ilija Najdoski'], 'Slavoljub Jokanović': ['斯托希奇', 'Vlada Stošić'], 'Mitar Mrkela': ['托希奇', 'Rade Tošić', 'CB', 'cb_stopper'] },
  'river-1996-97': { 'Roberto Ayala': ['塞尔索·阿亚拉', 'Celso Ayala'], 'Norberto Rivarola': ['埃尔南·迪亚斯', 'Hernán Díaz'], 'Marcelo Salas': ['阿尔梅达', 'Matías Almeyda', 'CM', 'cm_destroyer'], 'Roberto Bonano': ['索德罗', 'Javier Sodero'], 'Diego Lombardi': ['贝尔蒂', 'Sergio Berti', 'CM', 'cm_box2box'], 'Sergio Escudero': ['马塞洛·埃斯库德罗', 'Marcelo Escudero'], 'Netto': ['特罗塔', 'Roberto Trotta'], 'Rambert': ['阿马托', 'Gabriel Amato', 'ST', 'st_target'] },
  'boca-2000-01': { 'José María Calvo': ['马特利安', 'Aníbal Matellán'], 'Nicolás Traverso': ['特拉韦索', 'Cristian Traverso'], 'Rolando Schiavi': ['克莱门特·罗德里格斯', 'Clemente Rodríguez', 'W', 'fb_attacking'], 'Nelson Vivas': ['埃尔南·梅迪纳', 'Hernán Medina', 'CB', 'cb_stopper'], 'José Gaitán': ['克里斯蒂安·希门尼斯', 'Christian Giménez', 'CM', 'cm_creator'] },
  'valencia-1999-00': { 'Roberto Ayala': ['佩莱格里诺', 'Mauricio Pellegrino'], 'Mauricio Pellegrino': ['法里诺斯', 'Javier Farinós', 'CM', 'cm_playmaker'], 'Zlatko Zahovič': ['路易斯·米利亚', 'Luis Milla', 'CM', 'cm_playmaker'] },
  'leverkusen-2001-02': { 'Michael Sebescen': ['塞贝岑', 'Zoltán Sebescen'] },
  'benfica-1961-62': { 'Ângelo Serra': ['费尔南多·克鲁兹', 'Fernando Cruz', 'W', 'fb_attacking'], 'José Simões': ['若泽·奥古斯托', 'José Augusto', 'CM', 'cm_creator'], 'Fernando Cruz': ['安东尼奥·西蒙斯', 'António Simões', 'CM', 'cm_playmaker'], 'José Mendes': ['若泽·巴斯托斯', 'José Bastos'], 'Fernando Pinto': ['马里奥·若昂', 'Mário João'], 'Neto': ['内托', 'Neto'], 'Calado': ['若泽·托雷斯', 'José Torres', 'ST', 'st_target'] },
  'parma-1998-99': { 'Orazio Torrisi': ['托里西', 'Stefano Torrisi'] },
  'sampdoria-1990-91': { 'Riccardo Ferri': ['佩莱格里尼', 'Luca Pellegrini'], 'Marco Dossena': ['多塞纳', 'Giuseppe Dossena'], 'Marco Branca': ['西拉斯', 'Silas', 'CM', 'cm_creator'] },
  'monaco-2003-04': { 'François Modesto': ['卡罗尔', 'Sébastien Carole', 'W', 'w_dribbler'] },
  'nottingham-forest-1979-80': { 'Frank Clark': ['弗兰克·格雷', 'Frank Gray'], 'Archie Gemmill': ['鲍耶', 'Ian Bowyer'], 'Ian Bowyer': ['加里·米尔斯', 'Gary Mills', 'W', 'w_engine'], 'Ian Wallace': ['鲍尔斯', 'Stan Bowles', 'ST', 'st_false9'], 'Peter Ward': ['甘恩', 'Brynn Gunn', 'CB', 'cb_cover'] },
  'celtic-1966-67': { 'Tommy Young': ['布罗根', 'Jim Brogan', 'CB', 'cb_stopper'], 'Willie Gallacher': ['卡塔纳赫', 'David Cattanach', 'CB', 'cb_cover'] },
  'everton-1984-85': { 'Martin Keown': ['哈珀', 'Alan Harper'] },
  'steaua-1985-86': { 'Nicolae Ungureanu': ['伯尔布列斯库', 'Ilie Bărbulescu'], 'Ion Radu': ['马林·拉杜', 'Marin Radu'], 'Petcu': ['图多雷尔·斯托伊卡', 'Tudorel Stoica', 'CM', 'cm_destroyer'], 'Stoica': ['卢奇安·伯兰', 'Lucian Bălan', 'CM', 'cm_playmaker'], 'Bălan': ['魏森巴赫', 'Anton Weissenbacher'], 'Vîrlan': ['米特里察', 'Dumitru Mitriță'] },
}

// 第二轮依据赛季 Squad/Players statistics 校对的替补和姓名。
const CLUB_ADDITIONAL: Record<string, Record<string, Replacement>> = {
  'milan-1988-89': { 'Giulio Nuciari': ['安东尼奥利', 'Francesco Antonioli'] },
  'real-madrid-1959-60': { 'José María Becerril': ['潘塔莱昂', 'José Pantaleón'] },
  'ajax-1971-72': { 'Ton Pronk': ['苏伦东克', 'Ruud Suurendonk'] },
  'santos-1962-63': { 'Formiga': ['伊斯梅尔', 'Ismael'] },
  'bayern-1974-75': { 'Werner Olck': ['胡戈·罗布尔', 'Hugo Robl'], 'Klaus Augsburger': ['贝恩德·福斯特', 'Bernd Förster'] },
  'inter-1964-65': { 'Renato Vastola': ['斯帕尔塔科·兰迪尼', 'Spartaco Landini'] },
  'psv-1987-88': { 'René van der Gijp': ['安东·扬森', 'Anton Janssen'], 'Pierre Verkuylen': ['洛德韦克斯', 'Patrick Lodewijks'], 'Willy van der Kerkhof': ['威利·范德克尔霍夫', 'Willy van de Kerkhof'] },
  'red-star-1990-91': { 'Zvonko Milojević': ['米利奇·约万诺维奇', 'Milić Jovanović'], 'Goran Radinović': ['杜尚·拉迪诺维奇', 'Duško Radinović'] },
  'benfica-1961-62': { 'José Bastos': ['若泽·巴罗卡', 'José Barroca'], 'Raul Machado': ['温贝托·费尔南德斯', 'Humberto Fernandes'] },
  'parma-1998-99': { 'Stefano Torrisi': ['斯特凡诺·菲奥雷', 'Stefano Fiore', 'CM', 'cm_creator'] },
  'nottingham-forest-1979-80': { 'Brynn Gunn': ['甘恩', 'Bryn Gunn'] },
  'steaua-1985-86': { 'Dumitru Mitriță': ['皮斯托尔', 'Constantin Pistol', 'CB', 'cb_stopper'], 'Marin Majearu': ['马热亚鲁', 'Mihail Majearu'] },
}

const NATIONAL_FIXES: Record<string, Record<string, Replacement>> = {
  'cmr-1990': { 'Emmanuel Biyik': ['约姆比', 'Alphonse Yombi', 'CB', 'cb_stopper'], 'Emmanuel Ebwelle': ['贝尔坦·埃布韦莱', 'Bertin Ebwellé'], 'Emile Feutmba': ['罗杰·弗特姆巴', 'Roger Feutmba'] },
  'nga-1994': { 'Nwankwo Kanu': ['阿德波尤', 'Mutiu Adepoju', 'CM', 'cm_box2box'], 'Friday Ekpo': ['埃泽古', 'Emeka Ezeugo'] },
  'sen-2002': { 'Boubacar Sarr': ['索莱曼·卡马拉', 'Souleymane Camara'], 'Souleymane Camara': ['穆萨·恩迪亚耶', 'Moussa Ndiaye', 'W', 'w_dribbler'], 'Khalilou Ndiaye': ['奥马尔·迪亚洛', 'Omar Diallo'], 'Omar Traoré': ['帕普·马利克·迪奥普', 'Pape Malick Diop'] },
  'bul-1994': { 'Zdravko Zdravkov': ['普拉门·尼科洛夫', 'Plamen Nikolov'], 'Petar Petrov': ['扬科夫', 'Zlatko Yankov', 'CM', 'cm_destroyer'], 'Lyuboslav Penev': ['米赫塔尔斯基', 'Petar Mihtarski'] },
  'cro-1998': { 'Alen Bokšić': ['克尔潘', 'Petar Krpan'], 'Tomislav Butina': ['姆尔米奇', 'Marijan Mrmić'], 'Davor Vugrinec': ['科兹尼库', 'Ardian Kozniku'] },
  'den-1998': { 'Søren Colding': ['阿兰·尼尔森', 'Allan Nielsen'], 'Allan Nielsen': ['戈尔德贝克', 'Bjarne Goldbæk'], 'Jan Michaelsen': ['弗兰森', 'Per Frandsen'], 'Thomas Gravesen': ['维格霍斯特', 'Morten Wieghorst'] },
  'ita-1982': { 'Roberto Bettega': ['阿尔托贝利', 'Alessandro Altobelli'] },
  'arg-1986': { 'Claudio Caniggia': ['阿尔米隆', 'Sergio Almirón'], 'Óscar Cuciuffo': ['库丘福', 'José Luis Cuciuffo'] },
  'ned-1974': { 'Sies Schrijvers': ['皮特·斯赫赖弗斯', 'Piet Schrijvers'], 'Willy van der Kerkhof': ['威利·范德克尔霍夫', 'Willy van de Kerkhof'] },
  'bra-2002': { 'Juninho Paulista': ['罗纳尔迪尼奥', 'Ronaldinho', 'CM', 'cm_creator'] },
  'bra-1970': { 'Tostão': ['托斯唐', 'Tostão', 'W', 'w_playmaker'] },
}

function replace(def: LegendTeamDef, fixes: Record<string, Replacement> = {}): LegendTeamDef {
  return { ...def, players: def.players.map((tuple) => {
    const fix = fixes[tuple[1]]
    return fix ? [fix[0], fix[1], tuple[2], fix[2] ?? tuple[3], fix[3] ?? tuple[4], tuple[5], tuple[6] ?? 'R'] : tuple
  }) }
}

export function correctLegendTeam(base: LegendTeamDef): LegendTeamDef {
  const def = replace(replace(base, CLUB_FIXES[base.id]), CLUB_ADDITIONAL[base.id])
  const countries: Record<string, string> = {
    barcelona: '西班牙', 'real-madrid': '西班牙', atletico: '西班牙', valencia: '西班牙',
    milan: '意大利', inter: '意大利', napoli: '意大利', juventus: '意大利', lazio: '意大利', roma: '意大利', parma: '意大利', sampdoria: '意大利',
    ajax: '荷兰', psv: '荷兰', bayern: '德国', dortmund: '德国', leverkusen: '德国',
    'man-utd': '英格兰', arsenal: '英格兰', chelsea: '英格兰', liverpool: '英格兰', 'nottingham-forest': '英格兰', 'aston-villa': '英格兰', everton: '英格兰',
    celtic: '苏格兰', psg: '法国', marseille: '法国', monaco: '摩纳哥', porto: '葡萄牙', benfica: '葡萄牙',
    santos: '巴西', flamengo: '巴西', river: '阿根廷', boca: '阿根廷', 'dynamo-kyiv': '乌克兰', 'red-star': '塞尔维亚', steaua: '罗马尼亚',
  }
  def.country = countries[base.id.split(/-(?=\d{4})/)[0]]
  if (base.id === 'river-1996-97') {
    def.season = '1996'
    def.formationId = '4-1-2-1-2'
    // 原名单用 W 表示前腰，转为菱形中场；保留当年锋线弗朗切斯科利/克雷斯波。
    def.players = def.players.map((p, i) => i === 5 ? [p[0], p[1], p[2], 'CM', 'cm_creator', p[5], p[6]] : i === 8 ? [p[0], p[1], p[2], 'ST', 'st_false9', p[5], p[6]] : p)
    def.note = '1996 年解放者杯冠军；采用夺冠时点阵容，不混入其后加盟的萨拉斯。'
  }
  if (base.id === 'boca-2000-01') { def.season = '2000'; def.note = '2000 年解放者杯、洲际杯冠军；采用当年末阵容。' }
  if (base.id === 'napoli-1989-90') def.note = '1989–90 意甲冠军；联盟杯冠军属于前一赛季，不合并统计。'
  if (base.id === 'lazio-1999-00') def.note = '1999–00 意甲、意大利杯双冠；锋线萨拉斯与西蒙尼·因扎吉，克雷斯波尚未加盟。'
  if (base.id === 'liverpool-1983-84') def.note = '1983–84 联赛、联赛杯、欧洲冠军杯三冠，主教练乔·费根。'
  return def
}

export function correctNationalTeam(base: LegendTeamDef): LegendTeamDef {
  const def = replace(base, NATIONAL_FIXES[base.id])
  if (base.id === 'ned-1998') def.coach = '古斯·希丁克'
  const source = (evidence as Record<string, { source: string; players: NonNullable<LegendTeamDef['playerInfo']> }>)[def.id]
  if (!source) throw new Error(`缺少世界杯名单证据：${def.id}`)
  def.source = source.source
  def.playerInfo = source.players
  return def
}
