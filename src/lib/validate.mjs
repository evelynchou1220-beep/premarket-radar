// 報告驗收規則（CLAUDE.md §6「怎麼算做完」的程式版）。
// 被 src/content.config.ts（建置時）與 scripts/check.mjs（npm run check）共用。
import config from '../data/factors.json' with { type: 'json' };
import { closeScore } from './scoring.mjs';

export const FACTOR_KEYS = config.factors.map((f) => f.key);
export const REQUIRED_KEYS = config.factors.filter((f) => f.required).map((f) => f.key);
export const AUTO_KEYS = config.factors.filter((f) => f.auto).map((f) => f.key);
export const REQUIRED_AUTO_KEYS = config.factors.filter((f) => f.required && f.auto).map((f) => f.key);
export const MODES = ['auto', 'ai'];
export const factorDef = Object.fromEntries(config.factors.map((f) => [f.key, f]));

const NEWS = config.newsPolicy;
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const VAGUE = ['市場氣氛', '投資人信心', '可望受惠', '值得關注', '樂觀看待', '情緒佳', '有望'];

/**
 * 驗證報告 frontmatter。回傳錯誤訊息陣列（空陣列代表通過）。
 * @param {any} fm  frontmatter
 * @param {any} [snapshot] 對應的 data/snapshots/<target>/<code>.json（check.mjs 會提供）
 */
export function validateReport(fm, snapshot) {
  const errors = [];
  const factors = fm.factors ?? [];
  const keys = factors.map((f) => f.key);
  const auto = fm.mode === 'auto';

  // 0. 報告模式：auto＝程式版（排程自動產生，只含程式判定因子）；ai＝AI 完整版（含新聞因子）
  if (fm.mode !== undefined && !MODES.includes(fm.mode)) errors.push(`mode 只能是 ${MODES.join('／')}`);

  // 1. 必查因子都要出現、不得重複（程式版只檢查程式判定的必查因子，且不可含新聞因子）
  for (const k of auto ? REQUIRED_AUTO_KEYS : REQUIRED_KEYS) if (!keys.includes(k)) errors.push(`缺少必查因子：${k}（${factorDef[k].label}）`);
  if (auto) for (const k of keys) if (factorDef[k] && !factorDef[k].auto) errors.push(`[${k}] 是新聞因子，程式版（mode: auto）不可包含；要加入新聞請改為 mode: ai`);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dup.length) errors.push(`因子重複：${[...new Set(dup)].join(', ')}`);

  // 2. 每個因子的格式
  for (const f of factors) {
    const tag = `[${f.key}]`;
    if (!factorDef[f.key]) { errors.push(`${tag} 不是 factors.json 定義的因子`); continue; }
    const directional = f.signal === '偏多' || f.signal === '偏空';
    if (directional && !f.strength) errors.push(`${tag} ${f.signal} 必須標註強度（強／中／弱）`);
    if (!directional && f.strength) errors.push(`${tag} ${f.signal} 不可標註強度`);
    if (directional) {
      if (!/\d/.test(f.data ?? '')) errors.push(`${tag} data 必須包含具體數字`);
      if ((f.reason ?? '').length < 15) errors.push(`${tag} reason 太短，必須說明影響機制（至少 15 字）`);
      const hit = VAGUE.find((w) => (f.reason ?? '').includes(w));
      if (hit) errors.push(`${tag} reason 使用了空泛用語「${hit}」，請改寫成具體的因果關係`);
    }
    if (!f.source) errors.push(`${tag} 缺少 source（資料來源與日期）`);
    // 開盤影響強度（只有新聞因子可填；方向與 signal 相同，只是強度可以不同）
    if (f.openStrength != null) {
      if (factorDef[f.key].auto) errors.push(`${tag} openStrength 只能用在新聞因子；程式因子的開盤影響由程式判定`);
      else if (!directional) errors.push(`${tag} ${f.signal} 不可填 openStrength`);
      else if (!['強', '中', '弱'].includes(f.openStrength)) errors.push(`${tag} openStrength 只能是 強／中／弱`);
    }
  }

  // 3. 結論與信心度必須等於公式計算結果
  const s = closeScore(factors, fm.target);
  if (fm.verdict !== s.verdict) errors.push(`verdict 應為「${s.verdict}」（公式計算），報告寫「${fm.verdict}」`);
  if (fm.confidence !== s.confidence) errors.push(`confidence 應為 ${s.confidence}（公式計算），報告寫 ${fm.confidence}`);

  // 4. 有力的理由：至少 2 個「強」或「中」的方向性因子（AI 完整版才要求；程式版如實呈現程式結果）
  const solid = factors.filter((f) => (f.signal === '偏多' || f.signal === '偏空') && (f.strength === '強' || f.strength === '中'));
  if (!auto && solid.length < 2) errors.push(`至少需要 2 個強度為「強」或「中」的方向性因子，目前 ${solid.length} 個`);

  // 5. 新聞：AI 完整版至少 3 則，且每則都有網址
  const news = fm.news ?? [];
  if (!auto && news.length < 3) errors.push(`news 至少 3 則，目前 ${news.length} 則`);
  news.forEach((n, i) => {
    if (!/^https?:\/\//.test(n.url ?? '')) errors.push(`news[${i}] 缺少有效網址`);
    const host = domainOf(n.url ?? '');
    if (NEWS.blockedDomains.some((d) => host === d || host.endsWith('.' + d))) errors.push(`news[${i}] 來自論壇或社群（${host}），不可作為判定依據`);
    const hype = NEWS.hypeWords.find((w) => (n.title ?? '').includes(w));
    if (hype) errors.push(`news[${i}] 標題含喊盤用語「${hype}」，不可採用`);
  });

  // 6. 新聞因子的方向判定必須有新聞佐證；「強」需要兩個不同來源，且至少一個是主流來源（CLAUDE.md §4 步驟 3）
  if (!auto) for (const f of factors) {
    if (factorDef[f.key]?.auto || (f.signal !== '偏多' && f.signal !== '偏空')) continue;
    const support = news.filter((n) => n.factor === f.key);
    const sources = new Set(support.map((n) => n.source));
    if (!support.length) errors.push(`[${f.key}] 判定為${f.signal}，但 news 中沒有任何一則標註 factor: ${f.key} 的新聞`);
    if ((f.strength === '強' || f.openStrength === '強') && sources.size < 2) errors.push(`[${f.key}] 判定為「強」需要兩個不同來源的新聞，目前 ${sources.size} 個`);
    if (support.length && !support.some((n) => NEWS.trustedSources.some((s) => (n.source ?? '').includes(s)))) errors.push(`[${f.key}] 佐證新聞沒有任何一則來自主流來源（見 factors.json newsPolicy.trustedSources）`);
  }

  // 7. 與快照比對（僅 check.mjs）
  if (snapshot) {
    if (snapshot.meta.code !== fm.code || snapshot.meta.target !== fm.target) errors.push('報告與快照的代號或日期不一致');
    if (snapshot.meta.basedOn !== fm.basedOn) errors.push(`basedOn 應為快照的 ${snapshot.meta.basedOn}`);
    for (const f of factors) {
      const h = snapshot.hints?.[f.key];
      if (!h || !AUTO_KEYS.includes(f.key)) continue;
      const same = h.signal === f.signal && (h.strength ?? null) === (f.strength ?? null);
      if (!same && !(f.reason ?? '').startsWith('【改判】')) {
        errors.push(`[${f.key}] 與程式建議不符（建議 ${h.signal}${h.strength ? '・' + h.strength : ''}）。若要改判，reason 開頭須寫「【改判】原因」`);
      }
      // 數據必須與快照完全相同，避免重新 fetch 後報告仍留著舊數字
      if (h.data !== f.data) errors.push(`[${f.key}] data 與快照不一致，請照抄 hints：${h.data}`);
      if (h.source !== f.source) errors.push(`[${f.key}] source 與快照不一致，請照抄 hints：${h.source}`);
    }
    if (!snapshot.meta.timingOk && !fm.timingNote) errors.push('快照未通過時序檢查，必須在 frontmatter 填寫 timingNote 說明（網頁會顯示警示）');
  }
  return errors;
}

/**
 * 驗證八大官股資料（data/govbanks/<date>.json，使用者每天提供，CLAUDE.md §7.4）。
 * 兩種內容可以只有其中一種，也可以都有：
 * 1. 各行庫合計：{ amountUnit: '萬'|'億', banks: { 合庫: -103721, ... }, net: -464920 }
 * 2. 個股排行：{ unit: '張'|'萬'|'億', buy: [{code,name,value}], sell: [...] }
 */
export const GOV_BANKS = ['合庫', '土銀', '台銀', '台企銀', '彰銀', '第一金', '兆豐銀', '華南永昌'];
export function validateGovBank(g, file = '') {
  const errors = [];
  const tag = file ? `[${file}] ` : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date ?? '')) errors.push(`${tag}date 必須是 YYYY-MM-DD`);
  if (file && g.date && file !== `${g.date}.json`) errors.push(`${tag}檔名應為 ${g.date}.json`);
  if (!g.source) errors.push(`${tag}缺少 source（資料出處，例如「使用者提供（某網站截圖）」）`);
  const hasBanks = g.banks != null || g.net != null;
  const hasLists = g.buy != null || g.sell != null;
  if (!hasBanks && !hasLists) errors.push(`${tag}至少要有「各行庫合計」（banks／net）或「個股排行」（buy／sell）其中一種`);

  if (hasBanks) {
    if (!['萬', '億'].includes(g.amountUnit)) errors.push(`${tag}amountUnit（金額單位）只能是「萬」或「億」，照資料原樣填寫`);
    if (typeof g.net !== 'number') errors.push(`${tag}net（合計買賣超金額）必須是數字`);
    if (g.banks != null) {
      const names = Object.keys(g.banks);
      const unknown = names.filter((n) => !GOV_BANKS.includes(n));
      if (unknown.length) errors.push(`${tag}不認得的行庫名稱：${unknown.join('、')}（應為 ${GOV_BANKS.join('、')}）`);
      if (Object.values(g.banks).some((v) => typeof v !== 'number')) errors.push(`${tag}banks 的金額必須都是數字`);
      // 抄寫檢查：八家加總必須等於合計（各家四捨五入，容許些微誤差）
      if (names.length === GOV_BANKS.length && typeof g.net === 'number') {
        const sum = Object.values(g.banks).reduce((a, v) => a + v, 0);
        const tol = g.amountUnit === '億' ? 0.05 : 10;
        if (Math.abs(sum - g.net) > tol) errors.push(`${tag}八家加總 ${sum} 與合計 ${g.net} 不符，請檢查是否抄錯`);
      }
    }
  }
  if (hasLists) {
    if (!['張', '元', '萬', '億'].includes(g.unit)) errors.push(`${tag}unit（個股排行 value 的單位）只能是「張」「元」「萬」或「億」`);
    for (const side of ['buy', 'sell']) {
      if (g[side] == null) continue;
      if (!Array.isArray(g[side])) { errors.push(`${tag}${side} 必須是陣列`); continue; }
      g[side].forEach((x, i) => {
        if (!/^\d{4,6}[A-Z]?$/.test(x.code ?? '')) errors.push(`${tag}${side}[${i}] 股票代號格式錯誤`);
        if (x.lots != null && (typeof x.lots !== 'number' || x.lots <= 0)) errors.push(`${tag}${side}[${i}] lots（張數）必須是正數`);
        if (!x.name) errors.push(`${tag}${side}[${i}] 缺少股票名稱`);
        if (typeof x.value !== 'number' || x.value <= 0) errors.push(`${tag}${side}[${i}] value 必須是正數（買超、賣超都填正數，方向由 buy／sell 區分）`);
      });
    }
  }
  return errors;
}

/** 檢查 Markdown 內文是否有規定的章節 */
export const REQUIRED_SECTIONS = ['## 綜合判斷', '## 開盤觀察重點', '## 什麼情況下會看錯'];
export function validateBody(body) {
  return REQUIRED_SECTIONS.filter((h) => !body.includes(h)).map((h) => `內文缺少章節「${h}」`);
}

/** 新聞連結的共同檢查：網址、禁用來源、喊盤用語 */
function checkLink(n, where, errors) {
  if (!n?.title) errors.push(`${where} 缺少標題`);
  if (!n?.source) errors.push(`${where} 缺少媒體名稱（source）`);
  if (!/^https?:\/\//.test(n?.url ?? '')) errors.push(`${where} 缺少有效網址`);
  const host = domainOf(n?.url ?? '');
  if (NEWS.blockedDomains.some((d) => host === d || host.endsWith('.' + d))) errors.push(`${where} 來自論壇或社群（${host}），不可採用`);
  const hype = NEWS.hypeWords.find((w) => (n?.title ?? '').includes(w));
  if (hype) errors.push(`${where} 標題含喊盤用語「${hype}」，不可採用`);
}
const vagueIn = (texts) => VAGUE.find((w) => texts.some((t) => (t ?? '').includes(w)));
const dateCheck = (x, file, tag, errors) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date ?? '')) errors.push(`${tag}date 必須是 YYYY-MM-DD`);
  if (file && x.date && file !== `${x.date}.json`) errors.push(`${tag}檔名應為 ${x.date}.json`);
};
const lenOk = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;

/**
 * AI 盤後分析（data/recaps/<交易日>.json，CLAUDE.md §7.6）
 * { date, createdAt, headline, points: [3～5], watch: [1～3], news: [{title, source, url}] ≥ 2 }
 */
export function validateRecap(x, file = '') {
  const errors = [];
  const tag = file ? `[${file}] ` : '';
  dateCheck(x, file, tag, errors);
  if (!lenOk(x.headline, 40)) errors.push(`${tag}headline 必須是 1～40 字的一句話結論`);
  if (!Array.isArray(x.points) || x.points.length < 3 || x.points.length > 5) errors.push(`${tag}points 必須 3～5 點`);
  else x.points.forEach((p, i) => { if (!lenOk(p, 80)) errors.push(`${tag}points[${i}] 必須是 1～80 字`); });
  if (!Array.isArray(x.watch) || x.watch.length < 1 || x.watch.length > 3) errors.push(`${tag}watch（明天要注意）必須 1～3 點`);
  else x.watch.forEach((p, i) => { if (!lenOk(p, 60)) errors.push(`${tag}watch[${i}] 必須是 1～60 字`); });
  if (!Array.isArray(x.news) || x.news.length < 2) errors.push(`${tag}news 至少 2 則（附真實網址）`);
  else x.news.forEach((n, i) => checkLink(n, `${tag}news[${i}]`, errors));
  const v = vagueIn([x.headline, ...(x.points ?? []), ...(x.watch ?? [])]);
  if (v) errors.push(`${tag}含空泛用語「${v}」`);
  return errors;
}

/**
 * 今早新聞重點（data/briefs/<交易日>.json，雲端晨報產生，CLAUDE.md §7.5）
 * { date, createdAt, items: [{ title, point, impact: 偏多|偏空|中性, source, url }] 3～5 則 }
 */
export function validateBrief(x, file = '') {
  const errors = [];
  const tag = file ? `[${file}] ` : '';
  dateCheck(x, file, tag, errors);
  if (!Array.isArray(x.items) || x.items.length < 3 || x.items.length > 5) errors.push(`${tag}items 必須 3～5 則`);
  else x.items.forEach((n, i) => {
    checkLink(n, `${tag}items[${i}]`, errors);
    if (!lenOk(n.point, 60)) errors.push(`${tag}items[${i}].point（對台股的影響）必須是 1～60 字`);
    if (!['偏多', '偏空', '中性'].includes(n.impact)) errors.push(`${tag}items[${i}].impact 只能是偏多、偏空、中性`);
  });
  const v = vagueIn((x.items ?? []).map((n) => n.point));
  if (v) errors.push(`${tag}含空泛用語「${v}」`);
  return errors;
}
