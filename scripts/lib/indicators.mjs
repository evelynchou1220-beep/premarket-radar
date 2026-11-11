// 技術指標計算。輸入為日 K 陣列 [{date,open,high,low,close,volume}]（時間由舊到新）。
import { round } from './http.mjs';

export function sma(values, n) {
  if (values.length < n) return null;
  const s = values.slice(-n).reduce((a, b) => a + b, 0);
  return s / n;
}

export function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

/** KD(9,3,3)，回傳最後兩天的 K、D 以判斷交叉 */
export function kd(daily, n = 9) {
  let k = 50, d = 50;
  const out = [];
  for (let i = 0; i < daily.length; i++) {
    if (i < n - 1) continue;
    const win = daily.slice(i - n + 1, i + 1);
    const hi = Math.max(...win.map((x) => x.high));
    const lo = Math.min(...win.map((x) => x.low));
    const rsv = hi === lo ? 50 : ((daily[i].close - lo) / (hi - lo)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    out.push({ k, d });
  }
  return out.slice(-2);
}

export function computeIndicators(daily) {
  const closes = daily.map((d) => d.close);
  const last = daily.at(-1);
  const prev = daily.at(-2);
  const vols = daily.map((d) => d.volume);
  const avgVol5 = sma(vols.slice(0, -1), 5);
  const kdv = kd(daily);
  const body = last.close - last.open;
  return {
    close: last.close,
    prevClose: prev?.close ?? null,
    changePct: prev ? round(((last.close - prev.close) / prev.close) * 100) : null,
    ma5: round(sma(closes, 5)),
    ma10: round(sma(closes, 10)),
    ma20: round(sma(closes, 20)),
    ma60: round(sma(closes, 60)),
    rsi14: round(rsi(closes, 14), 1),
    k: round(kdv.at(-1)?.k, 1),
    d: round(kdv.at(-1)?.d, 1),
    prevK: round(kdv.at(-2)?.k, 1),
    prevD: round(kdv.at(-2)?.d, 1),
    volumeRatio: avgVol5 ? round(last.volume / avgVol5) : null,
    candle: {
      bodyPct: round((body / (prev?.close ?? last.open)) * 100),
      upperShadowPct: round(((last.high - Math.max(last.open, last.close)) / (prev?.close ?? last.open)) * 100),
      lowerShadowPct: round(((Math.min(last.open, last.close) - last.low) / (prev?.close ?? last.open)) * 100),
    },
    high60: Math.max(...daily.slice(-60).map((d) => d.high)),
    low60: Math.min(...daily.slice(-60).map((d) => d.low)),
  };
}
