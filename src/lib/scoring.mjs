// 評分公式：網站與 scripts/check.mjs 共用，確保「信心度」是算出來的，不是憑感覺給的。
// 規則說明見 CLAUDE.md §5。修改公式時必須同步更新 CLAUDE.md 與「判斷規則」頁。
import config from '../data/factors.json' with { type: 'json' };

const S = config.scoring;
const AUTO = new Set(config.factors.filter((f) => f.auto).map((f) => f.key));

/**
 * 「盤整」範圍（%）：依個股近期波動計算，波動大的股票範圍較寬。
 * = 最後收盤日之前 N 日「每日漲跌幅絕對值」的中位數 × factor，最低 min。參數在 factors.json 的 scoring.flatBand。
 * 只用快照中 basedOn（含）以前的日 K，預測當下就已確定，不會看到答案。
 * @param {{close:number}[]} daily snapshot.daily
 * @returns {number} 例如 0.75 代表收盤漲跌在 ±0.75% 以內算盤整
 */
export function flatBand(daily, kind = 'close') {
  const { window, factor, min } = kind === 'open' ? S.openBand : S.flatBand;
  const rows = (daily ?? []).slice(-(window + 1));
  // close：收盤相對前一日收盤；open：開盤相對前一日收盤（跳空幅度）
  const moves = rows.slice(1).map((r, i) => Math.abs((((kind === 'open' ? r.open : r.close) - rows[i].close) / rows[i].close) * 100)).sort((a, b) => a - b);
  if (!moves.length) return min;
  const median = moves[Math.floor(moves.length / 2)];
  return Math.max(min, Math.round(median * factor * 100) / 100);
}

/**
 * @param {{signal:string,strength?:string}[]} factors
 * @returns {{score:number,max:number,ratio:number,verdict:'偏多'|'偏空'|'盤整',confidence:number,missing:number,bull:number,bear:number,neutral:number}}
 */
export function computeScore(factors) {
  let score = 0, valid = 0, missing = 0, bull = 0, bear = 0, neutral = 0;
  for (const f of factors) {
    if (f.signal === '缺漏') { missing++; continue; }
    valid++;
    const pts = S.strengthPoints[f.strength] ?? 0;
    if (f.signal === '偏多') { score += pts; bull++; }
    else if (f.signal === '偏空') { score -= pts; bear++; }
    else neutral++;
  }
  const max = valid * 3;
  const ratio = max ? score / max : 0;
  let verdict, confidence;
  if (ratio >= S.bullThreshold) {
    verdict = '偏多';
    confidence = 50 + 80 * Math.abs(ratio);
  } else if (ratio <= S.bearThreshold) {
    verdict = '偏空';
    confidence = 50 + 80 * Math.abs(ratio);
  } else {
    verdict = '盤整';
    confidence = 50 + 15 * (1 - Math.abs(ratio) / S.bullThreshold);
  }
  confidence = Math.round(Math.min(S.confidenceCap, confidence) - missing * S.missingPenalty);
  confidence = Math.max(50, confidence);
  return { score, max, ratio: Math.round(ratio * 1000) / 1000, verdict, confidence, missing, bull, bear, neutral };
}

/** 是否計入收盤預測：2026-11-13 起只計隔夜因子（scoring.closeFactors）與 AI 完整版有方向的新聞因子；之前的報告所有因子都計分 */
export function isScored(key, target, signal) {
  if (!target || target < S.closeFactorsFrom) return true;
  if (S.closeFactors.includes(key)) return true;
  return !AUTO.has(key) && (signal === '偏多' || signal === '偏空');
}

/**
 * 收盤預測（報告結論）。依報告的預測日套用當時的公式版本，舊報告不追溯（CLAUDE.md §8.6）。
 * @param {{key:string,signal:string,strength?:string|null}[]} factors
 * @param {string} target 預測日 YYYY-MM-DD
 */
export function closeScore(factors, target) {
  return computeScore((factors ?? []).filter((f) => isScored(f.key, target, f.signal)));
}

/** 開盤預測的文字：偏多→開高、偏空→開低、盤整→平盤 */
export const OPEN_LABEL = { 偏多: '開高', 偏空: '開低', 盤整: '平盤' };

/**
 * 開盤預測：用「台股收盤後才產生的隔夜資訊」（夜盤、ADR、美股、日韓、匯率，見 factors.json scoring.openFactors），
 * 加上 AI 完整版中有方向的新聞因子（強度用 openStrength），套用同一個評分公式。
 * 籌碼與技術面反映的是過去，對開盤跳空的解釋力較低，所以不納入。
 * @param {{key:string,signal:string,strength?:string|null}[]} factors 報告的因子（AI 改判也會反映）
 */
export function openScore(factors) {
  const list = (factors ?? []).flatMap((f) => {
    if (S.openFactors.includes(f.key)) return [f];
    // AI 完整版的新聞因子：只有偏多／偏空才納入（「沒有新消息」不該稀釋隔夜價格資訊），強度用 openStrength
    if (!AUTO.has(f.key) && (f.signal === '偏多' || f.signal === '偏空')) return [{ ...f, strength: f.openStrength ?? f.strength }];
    return [];
  });
  const s = computeScore(list);
  return { ...s, label: OPEN_LABEL[s.verdict] };
}

/**
 * 程式版判定：只用快照 hints（程式依規則算出的因子）計分。
 * 每份報告（不論 auto 或 ai）都能由快照重算，用來比較「AI 讀新聞」是否讓預測更準。
 * @param {Record<string,{signal:string,strength?:string|null}>} hints snapshot.hints
 * @param {string} target 預測日
 */
export function programScore(hints, target) {
  return closeScore(Object.entries(hints ?? {}).map(([key, h]) => ({ key, ...h })), target);
}

/**
 * 判斷預測是否命中
 * @param {'偏多'|'偏空'|'盤整'} verdict
 * @param {number} changePct 隔日收盤相對前一交易日收盤的漲跌幅（%）
 * @param {number} band 盤整範圍（%），由 flatBand(snapshot.daily) 計算
 */
export function judge(verdict, changePct, band) {
  const actual = changePct >= band ? '偏多' : changePct <= -band ? '偏空' : '盤整';
  return { actual, hit: actual === verdict };
}
