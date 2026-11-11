// 報告驗收規則（CLAUDE.md §6「怎麼算做完」的程式版）。
// 被 src/content.config.ts（建置時）與 scripts/check.mjs（npm run check）共用。
import config from '../data/factors.json' with { type: 'json' };
import { computeScore } from './scoring.mjs';

export const FACTOR_KEYS = config.factors.map((f) => f.key);
export const REQUIRED_KEYS = config.factors.filter((f) => f.required).map((f) => f.key);
export const AUTO_KEYS = config.factors.filter((f) => f.auto).map((f) => f.key);
export const REQUIRED_AUTO_KEYS = config.factors.filter((f) => f.required && f.auto).map((f) => f.key);
export const MODES = ['auto', 'ai'];
export const factorDef = Object.fromEntries(config.factors.map((f) => [f.key, f]));

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
  }

  // 3. 結論與信心度必須等於公式計算結果
  const s = computeScore(factors);
  if (fm.verdict !== s.verdict) errors.push(`verdict 應為「${s.verdict}」（公式計算），報告寫「${fm.verdict}」`);
  if (fm.confidence !== s.confidence) errors.push(`confidence 應為 ${s.confidence}（公式計算），報告寫 ${fm.confidence}`);

  // 4. 有力的理由：至少 2 個「強」或「中」的方向性因子（AI 完整版才要求；程式版如實呈現程式結果）
  const solid = factors.filter((f) => (f.signal === '偏多' || f.signal === '偏空') && (f.strength === '強' || f.strength === '中'));
  if (!auto && solid.length < 2) errors.push(`至少需要 2 個強度為「強」或「中」的方向性因子，目前 ${solid.length} 個`);

  // 5. 新聞：AI 完整版至少 3 則，且每則都有網址
  const news = fm.news ?? [];
  if (!auto && news.length < 3) errors.push(`news 至少 3 則，目前 ${news.length} 則`);
  news.forEach((n, i) => { if (!/^https?:\/\//.test(n.url ?? '')) errors.push(`news[${i}] 缺少有效網址`); });

  // 6. 與快照比對（僅 check.mjs）
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

/** 檢查 Markdown 內文是否有規定的章節 */
export const REQUIRED_SECTIONS = ['## 綜合判斷', '## 開盤觀察重點', '## 什麼情況下會看錯'];
export function validateBody(body) {
  return REQUIRED_SECTIONS.filter((h) => !body.includes(h)).map((h) => `內文缺少章節「${h}」`);
}
