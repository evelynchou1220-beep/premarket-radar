// 程式版報告產生器（mode: auto）。只使用快照中的程式判定因子，不讀新聞。
// 由 scripts/daily.mjs 在每個開盤日早上自動呼叫；AI 之後可依 CLAUDE.md §4 升級成 AI 完整版（mode: ai）。
import { stringify } from 'yaml';
import { computeScore } from '../../src/lib/scoring.mjs';
import { factorDef } from '../../src/lib/validate.mjs';

// 每個因子在各種判定下的「影響機制」說明。內容需符合 CLAUDE.md §5.2（具體因果、不用空泛用語）。
const REASONS = {
  kline: {
    偏多: '收盤前買盤占上風（實體紅 K 或長下影線），隔日開盤通常延續前一天的力道。',
    偏空: '收盤前賣壓占上風（實體黑 K 或長上影線），隔日開盤容易延續弱勢。',
    中性: 'K 線實體小於 0.5% 且沒有長影線，多空在收盤前大致平衡。',
  },
  ma: {
    偏多: '收盤價位於月線之上，近一個月買進的人多數獲利，回檔時較有支撐。',
    偏空: '收盤價位於月線之下，近一個月買進的人多數套牢，反彈時容易遇到解套賣壓。',
  },
  volume: {
    偏多: '價漲且成交量明顯放大，代表有新資金願意追價，上漲較有持續性。',
    偏空: '價跌且成交量明顯放大，代表有人急著賣出，賣壓尚未消化完。',
    中性: '成交量沒有明顯放大，量能不足以確認方向。',
  },
  momentum: {
    偏多: 'RSI／KD 位於超賣區或剛出現黃金交叉，短線容易出現反彈。',
    偏空: 'RSI／KD 位於過熱區或剛出現死亡交叉，短線容易拉回。',
    中性: 'RSI 與 KD 都在中性區，沒有過熱或超賣訊號。',
  },
  foreign: {
    偏多: '外資買超占成交量比重高，代表國際資金加碼，籌碼面支撐隔日股價。',
    偏空: '外資賣超占成交量比重高，代表國際資金調節持股，會壓抑隔日股價表現。',
    中性: '外資買賣超占成交量不到 1%，對股價影響有限。',
  },
  trust: {
    偏多: '投信買超通常反映基金看好基本面或季底作帳，連續買進時股價較有支撐。',
    偏空: '投信賣超代表國內基金減碼，若連續賣出，股價上方會有持續賣壓。',
    中性: '投信買賣超占成交量比重低，對股價影響有限。',
  },
  dealer: {
    偏多: '自營商大幅買超，短線資金偏多，但自營商進出快，參考性較低。',
    偏空: '自營商大幅賣超，短線資金偏空，但自營商進出快，參考性較低。',
    中性: '自營商以短線與避險交易為主，買賣超比重低，對方向影響有限。',
  },
  margin: {
    偏多: '股價上漲而融資減少，代表散戶獲利了結、籌碼回到法人手上，籌碼較安定。',
    偏空: '股價下跌但融資增加，代表散戶逢低承接，若續跌容易引發追繳賣壓。',
    中性: '融資餘額變動小於 3%，籌碼結構沒有明顯變化。',
  },
  txf: {
    偏多: '台指期夜盤在美股交易時段上漲，已反映台股收盤後的國際消息，現貨開盤多半跟著夜盤方向。',
    偏空: '台指期夜盤在美股交易時段下跌，已反映台股收盤後的國際消息，現貨開盤多半跟著夜盤方向。',
    中性: '夜盤漲跌幅小於 0.2%，沒有提供明確的開盤方向。',
  },
  futures_oi: {
    偏多: '外資在台指期維持淨多單，代表外資看好大盤，權值股較不會遭遇期貨避險賣壓。',
    偏空: '外資在台指期維持大量淨空單，代表外資在避險或看空大盤，權值股反彈時容易受壓。',
    中性: '外資期貨淨部位在 ±1 萬口以內，沒有明顯方向。',
  },
  us_market: {
    偏多: '前一晚美股（電子股看費城半導體）上漲，台股權值股開盤通常跟著國際資金方向。',
    偏空: '前一晚美股（電子股看費城半導體）下跌，台股權值股開盤通常跟著國際資金方向走弱。',
    中性: '前一晚美股漲跌幅小，沒有提供明確方向。',
  },
  adr: {
    偏多: 'ADR 在台股收盤後的美股時段上漲，代表國際投資人加碼，隔日台股現貨通常跟漲。',
    偏空: 'ADR 在台股收盤後的美股時段下跌，代表國際投資人減碼，隔日台股現貨通常跟跌。',
    中性: 'ADR 漲跌幅小於 0.3%，沒有提供明確方向。',
  },
  asia: {
    偏多: '日韓股市同步上漲，亞洲科技股資金流向偏正面，有利台股權值股。',
    偏空: '日韓股市同步下跌，亞洲資金撤出科技股，台股權值股也容易受影響。',
    中性: '日韓股市漲跌幅小或方向不一致，沒有提供明確方向。',
  },
  revenue: {
    偏多: '月營收年增率高，代表訂單與出貨動能強，基本面支撐股價。',
    偏空: '月營收年減，代表終端需求轉弱，基本面會壓抑股價。',
    中性: '月營收年增率在 ±10% 之間，基本面沒有明顯變化。',
  },
  fx: {
    偏多: '新台幣升值代表外資資金匯入，通常伴隨外資買超台股。',
    偏空: '新台幣貶值代表外資資金匯出，通常伴隨外資賣超台股。',
    中性: '匯率變動小於 0.3%，影響有限。',
  },
};
const MISSING = '資料尚未公布或取得失敗，不列入計分。';

const rank = { 強: 3, 中: 2, 弱: 1 };
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const price = (n) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 1 }));
const pct = (n) => `${n > 0 ? '+' : ''}${n}%`;

/** 台北時間 YYYY-MM-DDTHH:mm+08:00 */
const nowTpe = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16) + '+08:00';

/**
 * @param {any} s 快照
 * @returns {string} 完整的報告 Markdown（frontmatter＋內文）
 */
export function buildAutoReport(s) {
  const m = s.meta;
  const ind = s.indicators;
  const factors = Object.entries(s.hints).map(([key, h]) => {
    const f = { key, signal: h.signal };
    if (h.strength) f.strength = h.strength;
    f.data = h.data;
    f.source = h.source;
    f.reason = h.signal === '缺漏' ? MISSING : REASONS[key]?.[h.signal] ?? REASONS[key]?.中性 ?? '依規則判定。';
    return f;
  });
  const sc = computeScore(factors);
  const top = (signal) => factors.filter((f) => f.signal === signal).sort((a, b) => rank[b.strength] - rank[a.strength])[0];
  const bull = top('偏多'), bear = top('偏空');
  const label = (f) => factorDef[f.key].label;

  const lead = [bull, bear].filter(Boolean).sort((a, b) => rank[b.strength] - rank[a.strength]);
  const summary = lead.length
    ? `程式版｜多 ${sc.bull}・空 ${sc.bear}；最強：${lead.map((f) => `${label(f)}${f.signal}${f.strength}`).join('、')}`
    : `程式版｜${factors.length} 個程式因子皆無明確方向，判定盤整`;

  const fm = {
    code: m.code,
    name: m.name,
    target: m.target,
    basedOn: m.basedOn,
    createdAt: nowTpe(),
    mode: 'auto',
    verdict: sc.verdict,
    confidence: sc.confidence,
    summary,
    // 收盤後產生的初版：當晚美股、夜盤還沒出來，隔天 05:40 排程會用最新資料重做（CLAUDE.md §7.1）
    ...(m.timingOk ? {} : { timingNote: nowTpe().slice(0, 10) < m.target
      ? `初版（收盤後產生）：尚未納入今晚的美股、ADR 與台指期夜盤，開盤日 05:40 會用最新資料自動更新。`
      : `程式自動產生時資料不是最新：${m.stale.join('；')}。` }),
    factors,
    news: [],
  };

  const night = s.market.txf?.night;
  const body = [
    '## 綜合判斷',
    '',
    `這是**程式版**預測：只使用 ${factors.length} 個由程式依固定規則判定的技術、籌碼與國際因子，尚未納入關稅、聯準會、地緣政治、國安基金等新聞因子。` +
      (bull ? `多方最強的是${label(bull)}（${bull.data}）` : '沒有偏多因子') + '；' +
      (bear ? `空方最強的是${label(bear)}（${bear.data}）。` : '沒有偏空因子。') +
      `總分 ${sc.score > 0 ? '+' : ''}${sc.score}／${sc.max}（比例 ${sc.ratio}），依公式判定為**${sc.verdict}**，信心度 ${sc.confidence}%。` +
      (m.closedDays?.length ? `${md(m.basedOn)} 收盤後休市 ${m.closedDays.length} 天，期間的新聞需由 AI 完整版補上。` : ''),
    '',
    '## 開盤觀察重點',
    '',
    `- **${price(ind.close)} 元（${md(m.basedOn)} 收盤）**：開盤在此價之上代表延續${ind.changePct >= 0 ? '漲勢' : '反彈'}，之下代表買盤不足。`,
    `- **${price(ind.ma20)} 元（MA20 月線）**：${ind.close >= ind.ma20 ? '守住月線代表短期趨勢仍偏多，跌破則轉弱。' : '站回月線才代表短期趨勢轉強，否則仍偏弱。'}`,
    night
      ? `- **台指期夜盤 ${price(night.close)}（${pct(night.changePct)}）**：現貨開盤方向通常與夜盤一致；若開盤方向相反，代表現貨的買盤或賣壓比期貨更強。`
      : `- **${price(ind.ma60)} 元（MA60 季線）**：季線是中期趨勢的分界，${ind.close >= ind.ma60 ? '跌破代表中期轉弱。' : '突破代表中期轉強。'}`,
    '',
    '## 什麼情況下會看錯',
    '',
    '- 程式版沒有讀新聞：盤前若有關稅、出口管制、聯準會或兩岸的重大消息，影響會大於技術與籌碼因子。',
    '- 公司事件：法說會、月營收公布、除權息前後，股價常偏離技術面判斷。',
    '- 籌碼因子是前一日的資料，無法反映開盤後外資現貨或期貨方向急轉。',
    '',
  ].join('\n');

  return `---\n${stringify(fm, { lineWidth: 0 })}---\n\n${body}`;
}
