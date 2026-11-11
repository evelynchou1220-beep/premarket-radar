// 依 src/data/factors.json 的 rule 欄位，替「auto: true」的因子算出建議判定。
// AI 撰寫報告時必須採用這些建議；若要改判，須在該因子的 reason 開頭寫「【改判】原因」（CLAUDE.md §5）。
import { round } from './http.mjs';

const tier = (abs, [strong, mid, weak]) =>
  abs >= strong ? '強' : abs >= mid ? '中' : abs >= weak ? '弱' : null;
const sign = (x) => (x > 0 ? '偏多' : x < 0 ? '偏空' : '中性');
const up = { 強: '強', 中: '強', 弱: '中' };
const fmt = (n, d = 2) => (n > 0 ? '+' : '') + round(n, d) + '%';
const lots = (n) => (n > 0 ? '買超 ' : '賣超 ') + Math.abs(Math.round(n)).toLocaleString('en-US') + ' 張';

function hint(signal, strength, data, source) {
  if (signal === '中性' || !strength) return { signal: '中性', strength: null, data, source };
  return { signal, strength, data, source };
}
const missing = (data, source) => ({ signal: '缺漏', strength: null, data, source });

export function buildHints(s) {
  const h = {};
  const ind = s.indicators;
  const day = s.meta.basedOn;

  // K 線
  {
    const { bodyPct, upperShadowPct, lowerShadowPct } = ind.candle;
    const absBody = Math.abs(bodyPct);
    let signal = sign(bodyPct), strength = tier(absBody, [3, 1.5, 0.5]);
    let note = `${bodyPct >= 0 ? '紅' : '黑'} K，實體 ${fmt(bodyPct)}，上影 ${upperShadowPct}%、下影 ${lowerShadowPct}%`;
    const ref = Math.max(absBody, 0.3);
    if (upperShadowPct > ref * 2 && upperShadowPct >= lowerShadowPct) { signal = '偏空'; strength = '中'; note += '（長上影線，上方賣壓重）'; }
    else if (lowerShadowPct > ref * 2) { signal = '偏多'; strength = '中'; note += '（長下影線，低檔有買盤）'; }
    h.kline = hint(strength ? signal : '中性', strength, `${day} ${note}`, '證交所 STOCK_DAY 日成交資訊');
  }

  // 均線
  {
    const { close, ma5, ma20, ma60 } = ind;
    let signal, strength;
    if (ma60 && close > ma5 && ma5 > ma20 && ma20 > ma60) { signal = '偏多'; strength = '強'; }
    else if (ma60 && close < ma5 && ma5 < ma20 && ma20 < ma60) { signal = '偏空'; strength = '強'; }
    else if (close > ma20 && ma5 > ma20) { signal = '偏多'; strength = '中'; }
    else if (close < ma20 && ma5 < ma20) { signal = '偏空'; strength = '中'; }
    else { signal = close >= ma20 ? '偏多' : '偏空'; strength = '弱'; }
    h.ma = hint(signal, strength, `收盤 ${close}｜MA5 ${ma5}｜MA20 ${ma20}｜MA60 ${ma60 ?? '資料不足'}`, '由日 K 計算');
  }

  // 量能
  {
    const vr = ind.volumeRatio;
    const strength = vr == null ? null : vr >= 1.5 ? '強' : vr >= 1.2 ? '中' : null;
    h.volume = hint(strength ? sign(ind.changePct) : '中性', strength,
      `成交量為前 5 日均量的 ${vr} 倍，當日漲跌 ${fmt(ind.changePct)}`, '由日 K 計算');
  }

  // RSI / KD
  {
    const { rsi14, k, d, prevK, prevD } = ind;
    let signal = '中性', strength = null, note = '';
    if (rsi14 >= 80 || k >= 85) { signal = '偏空'; strength = '中'; note = '（過熱）'; }
    else if (rsi14 <= 20 || k <= 15) { signal = '偏多'; strength = '中'; note = '（超賣）'; }
    else if (prevK != null && prevK <= prevD && k > d) { signal = '偏多'; strength = '弱'; note = '（KD 黃金交叉）'; }
    else if (prevK != null && prevK >= prevD && k < d) { signal = '偏空'; strength = '弱'; note = '（KD 死亡交叉）'; }
    h.momentum = hint(signal, strength, `RSI14 ${rsi14}｜K ${k}｜D ${d}${note}`, '由日 K 計算');
  }

  // 三大法人
  const inst = s.institutional;
  const lastInst = inst.at(-1);
  const volLots = s.daily.at(-1).volume / 1000;
  if (!lastInst || lastInst.date !== day) {
    const msg = `證交所尚未公布 ${day} 三大法人資料`;
    h.foreign = missing(msg, '證交所 T86');
    h.trust = missing(msg, '證交所 T86');
    h.dealer = missing(msg, '證交所 T86');
  } else {
    const chip = (key, label, thresholds, allowStrong = true) => {
      const v = lastInst[key];
      const pct = (Math.abs(v) / volLots) * 100;
      let strength = tier(pct, thresholds);
      const last3 = inst.slice(-3).map((x) => Math.sign(x[key]));
      const streak = last3.length === 3 && last3.every((x) => x === Math.sign(v) && x !== 0);
      if (strength && streak && allowStrong) strength = up[strength];
      if (!allowStrong && strength === '強') strength = '中';
      const sum5 = inst.slice(-5).reduce((a, x) => a + x[key], 0);
      return hint(strength ? sign(v) : '中性', strength,
        `${day} ${label}${lots(v)}（占成交量 ${round(pct, 1)}%）${streak ? '，連 3 日同向' : ''}；近 5 日合計${lots(sum5)}`,
        `證交所 T86，${day}`);
    };
    h.foreign = chip('foreign', '外資', [10, 5, 1]);
    h.trust = chip('trust', '投信', [5, 2.5, 0.5]);
    // 自營商只看自行買賣；避險部位是權證被動避險，不代表券商看法（CLAUDE.md §11）。舊快照沒有拆分時退回合計
    const dealerKey = inst.every((x) => x.dealerSelf != null) ? 'dealerSelf' : 'dealer';
    h.dealer = chip(dealerKey, dealerKey === 'dealerSelf' ? '自營商（自行買賣）' : '自營商', [Infinity, 5, 2], false);
  }

  // 融資融券
  {
    const m = s.margin;
    if (!m) h.margin = missing(`證交所尚未公布 ${day} 融資融券資料`, '證交所 MI_MARGN');
    else {
      const chg = m.marginPrev ? ((m.marginToday - m.marginPrev) / m.marginPrev) * 100 : 0;
      let signal = '中性', strength = null;
      if (chg >= 3 && ind.changePct < 0) { signal = '偏空'; strength = '中'; }
      else if (chg <= -3 && ind.changePct > 0) { signal = '偏多'; strength = '弱'; }
      h.margin = hint(signal, strength,
        `融資餘額 ${m.marginToday.toLocaleString('en-US')} 張（${fmt(chg)}），融券餘額 ${m.shortToday.toLocaleString('en-US')} 張`,
        `證交所 MI_MARGN，${m.date}`);
    }
  }

  // 台指期
  {
    const t = s.market.txf;
    // 日盤在台股收盤後只多交易 15 分鐘，資訊已大致反映在收盤價；盤前真正有用的是夜盤。
    if (!t) h.txf = missing('期交所資料取得失敗', '期交所即時行情');
    else if (!t.night) h.txf = missing(`尚無 ${day} 晚間夜盤資料（日盤 ${t.day.close}，${fmt(t.day.changePct)}）`, '期交所即時行情');
    else {
      const pct = t.night.changePct;
      const strength = tier(Math.abs(pct), [1, 0.5, 0.2]);
      h.txf = hint(strength ? sign(pct) : '中性', strength,
        `${t.contract}夜盤 ${t.night.close}（${fmt(pct)}，相對日盤收盤 ${t.night.ref}）`,
        `期交所即時行情，夜盤 ${t.night.session}`);
    }
  }

  // 外資期貨未平倉
  {
    const oi = s.market.foreignFuturesOI;
    if (oi == null) h.futures_oi = missing('期交所資料取得失敗', '期交所 OpenAPI');
    else {
      let signal = '中性', strength = null;
      if (oi.net >= 10000) { signal = '偏多'; strength = '中'; }
      else if (oi.net <= -30000) { signal = '偏空'; strength = '中'; }
      else if (oi.net <= -10000) { signal = '偏空'; strength = '弱'; }
      h.futures_oi = hint(signal, strength, `外資台指期淨${oi.net >= 0 ? '多' : '空'}單 ${Math.abs(oi.net).toLocaleString('en-US')} 口`, `期交所 OpenAPI，${oi.date}`);
    }
  }

  // 美股
  {
    const g = s.global;
    const tech = s.meta.isTech;
    const base = tech ? g.sox : g.sp500;
    const th = tech ? [2, 1, 0.3] : [1, 0.5, 0.15];
    const strength = tier(Math.abs(base.changePct), th);
    h.us_market = hint(strength ? sign(base.changePct) : '中性', strength,
      `費半 ${fmt(g.sox.changePct)}、那指 ${fmt(g.nasdaq.changePct)}、標普 ${fmt(g.sp500.changePct)}（${g.sox.date} 美股收盤；以${tech ? '費半' : '標普'}判斷）`,
      'Yahoo Finance');
  }

  // ADR
  if (s.adr) {
    const a = s.adr;
    const strength = tier(Math.abs(a.changePct), [2, 1, 0.3]);
    h.adr = hint(strength ? sign(a.changePct) : '中性', strength,
      `${a.name} ${a.close} 美元（${fmt(a.changePct)}，${a.date} 美股收盤）。ADR 長期有溢價，只看漲跌幅`,
      `Yahoo Finance ${a.symbol}，${a.date}`);
  }

  // 日韓
  {
    const avg = (s.global.nikkei.changePct + s.global.kospi.changePct) / 2;
    const strength = tier(Math.abs(avg), [Infinity, 1.5, 0.5]);
    h.asia = hint(strength ? sign(avg) : '中性', strength,
      `日經 ${fmt(s.global.nikkei.changePct)}、KOSPI ${fmt(s.global.kospi.changePct)}（平均 ${fmt(avg)}，${s.global.nikkei.date}）`, 'Yahoo Finance');
  }

  // 匯率（TWD=X 上漲代表新台幣貶值）
  {
    const twdPct = -s.global.usdtwd.changePct;
    const strength = Math.abs(twdPct) >= 0.8 ? '中' : Math.abs(twdPct) >= 0.3 ? '弱' : null;
    h.fx = hint(strength ? sign(twdPct) : '中性', strength,
      `美元兌新台幣 ${s.global.usdtwd.close}，新台幣${twdPct >= 0 ? '升值' : '貶值'} ${Math.abs(round(twdPct))}%`,
      `Yahoo Finance TWD=X，${s.global.usdtwd.date}`);
  }

  return h;
}
