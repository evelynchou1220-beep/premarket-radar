// 評分公式：網站與 scripts/check.mjs 共用，確保「信心度」是算出來的，不是憑感覺給的。
// 規則說明見 CLAUDE.md §5。修改公式時必須同步更新 CLAUDE.md 與「因子說明」頁。
import config from '../data/factors.json' with { type: 'json' };

const S = config.scoring;

/** 結論判定門檻：隔日收盤漲跌幅 */
export const HIT_THRESHOLD = 0.5; // %

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

/**
 * 程式版判定：只用快照 hints（程式依規則算出的因子）計分。
 * 每份報告（不論 auto 或 ai）都能由快照重算，用來比較「AI 讀新聞」是否讓預測更準。
 * @param {Record<string,{signal:string,strength?:string|null}>} hints snapshot.hints
 */
export function programScore(hints) {
  return computeScore(Object.values(hints ?? {}));
}

/**
 * 判斷預測是否命中
 * @param {'偏多'|'偏空'|'盤整'} verdict
 * @param {number} changePct 隔日收盤相對前一交易日收盤的漲跌幅（%）
 */
export function judge(verdict, changePct) {
  const actual = changePct >= HIT_THRESHOLD ? '偏多' : changePct <= -HIT_THRESHOLD ? '偏空' : '盤整';
  return { actual, hit: actual === verdict };
}
