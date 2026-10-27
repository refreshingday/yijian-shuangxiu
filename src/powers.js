// 锦囊 add-ons. Each pouch shows its glyph (gold = good, purple = bad) so players can see what's coming;
// 60% are bad, so the two players have to agree which to grab and which to dodge.
//
// time: seconds the effect lasts (0 = instant). who: the effect is tied to the grabber.

export const POWERS = {
  // ---- good ----
  shield:  { good: true, glyph: '罩',  time: 0, name: '金钟罩',   desc: '挡下一次撞击' },
  magnet:  { good: true, glyph: '吸',  time: 8, name: '吸灵葫芦', desc: '灵石自己飞过来' },
  slow:    { good: true, glyph: '定',  time: 5, name: '定时符',   desc: '天地放缓，天劫也慢了' },
  giant:   { good: true, glyph: '巨',  time: 5, name: '巨剑术',   desc: '横冲直撞，漩涡也吞不下' },
  cloud:   { good: true, glyph: '云',  time: 6, name: '腾云',     desc: '飘高一截，锁链漩涡都不怕' },
  heal:    { good: true, glyph: '丹',  time: 0, name: '回春丹',   desc: '护体 +1' },
  spring:  { good: true, glyph: '泉',  time: 0, name: '灵泉',     desc: '灵力灌满' },
  repel:   { good: true, glyph: '驱',  time: 0, name: '驱雷符',   desc: '天劫被逼退' },
  master:  { good: true, glyph: '令',  time: 6, name: '剑主令',   desc: '抢到的人独掌飞剑', who: true },
  // ---- bad ----
  curse:   { good: false, glyph: '魔', time: 6, name: '心魔',     desc: '左右颠倒', who: true },
  swap:    { good: false, glyph: '颠', time: 5, name: '阴阳颠倒', desc: '两人都左右颠倒' },
  drunk:   { good: false, glyph: '醉', time: 6, name: '醉仙酿',   desc: '飞剑东倒西歪' },
  fog:     { good: false, glyph: '雾', time: 7, name: '迷雾',     desc: '什么都看不清' },
  sticky:  { good: false, glyph: '黏', time: 6, name: '黏糊符',   desc: '转向迟缓' },
  gust:    { good: false, glyph: '风', time: 3.5, name: '疾风乱流', desc: '被吹得停不下来' },
  drain:   { good: false, glyph: '漏', time: 0, name: '漏灵',     desc: '灵力漏光' },
  thunder: { good: false, glyph: '雷', time: 0, name: '引雷',     desc: '天劫猛追上来' },
  seal:    { good: false, glyph: '封', time: 6, name: '封灵',     desc: '无法冲刺' },
  mirror:  { good: false, glyph: '镜', time: 6, name: '镜花水月', desc: '画面左右翻转' },
  delay:   { good: false, glyph: '迟', time: 6, name: '迟钝咒',   desc: '操作慢半拍' },
  bounce:  { good: false, glyph: '跳', time: 5, name: '弹跳符',   desc: '飞剑停不下来地乱跳' },
  usurp:   { good: false, glyph: '篡', time: 6, name: '篡位',     desc: '剑主令落到对方手里', who: true },
};

const GOOD = Object.keys(POWERS).filter(k => POWERS[k].good);
const BAD = Object.keys(POWERS).filter(k => !POWERS[k].good);

// Early on, pouches are a little kinder so new players learn that they're worth a gamble.
export function rollPower(r, lvl) {
  const badChance = lvl === 0 ? 0.45 : 0.6;
  const list = r() < badChance ? BAD : GOOD;
  return list[Math.floor(r() * list.length)];
}

export const TIMED = Object.keys(POWERS).filter(k => POWERS[k].time > 0);
