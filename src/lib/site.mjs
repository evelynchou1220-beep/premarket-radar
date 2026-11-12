// 網站共用工具：路徑、格式化、資料讀取。頁面一律透過這裡取資料，不要在頁面內直接 glob。
import { getCollection } from 'astro:content';
import factorConfig from '../data/factors.json' with { type: 'json' };
import results from '../../data/results.json' with { type: 'json' };
import drafts from '../../data/drafts.json' with { type: 'json' };
import { closeScore, programScore, flatBand, openScore, judge } from './scoring.mjs';
export { isScored } from './scoring.mjs';
import { validateGovBank } from './validate.mjs';

export const SITE_NAME = '盤前雷達';
export const SITE_TAGLINE = '台股開盤前的 AI 個股多空分析';
/** GitHub repo（資料登錄頁用來開啟新增檔案頁） */
export const REPO = import.meta.env.PUBLIC_REPO || 'evelynchou1220-beep/premarket-radar';

/** 產生站內連結（自動加上 GitHub Pages 的 base 路徑） */
export function url(path = '') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = path.replace(/^\//, '');
  return `${base}/${p}${p && !p.endsWith('/') && !p.includes('#') ? '/' : ''}`;
}

const snapshotModules = import.meta.glob('/data/snapshots/*/*.json', { eager: true, import: 'default' });
/** @returns {Record<string, any>} key = `${target}-${code}` */
export const snapshots = Object.fromEntries(
  Object.values(snapshotModules).map((s) => [`${s.meta.target}-${s.meta.code}`, s]),
);

export { results };

const govModules = import.meta.glob('/data/govbanks/*.json', { eager: true, import: 'default' });
/** 八大官股資料（使用者提供），新到舊。格式錯誤時 build 直接失敗 */
export const govBanks = Object.entries(govModules)
  .map(([path, g]) => {
    const errors = validateGovBank(g, path.split('/').pop());
    if (errors.length) throw new Error(`官股資料格式錯誤：${errors.join('；')}`);
    return g;
  })
  .sort((a, b) => b.date.localeCompare(a.date));
/** 金額換算成億元（只用於顯示） */
export const toYi = (v, unit) => (unit === '元' ? v / 1e8 : unit === '萬' ? v / 10000 : v);
/** 某檔股票在某日官股名單中的買賣超；不在名單回傳 null */
export function govBankOf(date, code) {
  const g = govBanks.find((x) => x.date === date);
  if (!g || (!g.buy && !g.sell)) return undefined; // 當天沒有個股排行資料
  g.buy ??= []; g.sell ??= [];
  const b = g.buy.find((x) => x.code === code);
  if (b) return { side: 'buy', value: b.value, unit: g.unit, lots: b.lots, rank: g.buy.indexOf(b) + 1 };
  const s = g.sell.find((x) => x.code === code);
  if (s) return { side: 'sell', value: s.value, unit: g.unit, lots: s.lots, rank: g.sell.indexOf(s) + 1 };
  return null; // 有資料但未上榜
}
export const factorDefs = Object.fromEntries(factorConfig.factors.map((f) => [f.key, f]));
export const categories = factorConfig.categories;
export const scoringConfig = factorConfig.scoring;

export { default as watchlist } from '../data/watchlist.json' with { type: 'json' };

/** 報告版本：auto＝程式版（排程自動產生），ai＝AI 完整版（含新聞因子） */
export const MODE_LABEL = { auto: '程式版', ai: 'AI 完整版' };

export async function getReports() {
  const list = await getCollection('reports');
  return list
    .map((r) => {
      const snapshot = snapshots[r.id];
      const result = results[r.id] ?? null;
      const band = result?.band ?? flatBand(snapshot?.daily);
      const draft = drafts[r.id] ?? null; // 盤後初版的結論（daily.mjs 產生初版時記錄）
      return {
        ...r,
        snapshot,
        result,
        score: closeScore(r.data.factors, r.data.target),
        program: programScore(snapshot?.hints, r.data.target), // 只用程式因子重算的判定，AI 完整版用來對照
        band, // 盤整範圍（%）
        draft,
        draftHit: draft && result && !result.void ? judge(draft.verdict, result.changePct, band).hit : null,
        open: openScore(r.data.factors), // 開盤預測（開高／開低／平盤）
        openBand: result?.openBand ?? flatBand(snapshot?.daily, 'open'),
        void: Boolean(result?.void), // 預測日臨時休市，作廢
      };
    })
    .sort((a, b) => b.data.target.localeCompare(a.data.target) || a.data.code.localeCompare(b.data.code));
}

/**
 * 命中率統計（排除作廢）。
 * @param {any[]} reports
 * @param {'report'|'program'|'open'|'draft'} [by] report＝報告本身的結論；program＝程式版判定（所有報告都有）；open＝開盤預測；draft＝盤後初版
 */
export function stats(reports, by = 'report') {
  if (by === 'draft') {
    const xs = reports.filter((r) => !r.void && r.draft);
    const done = xs.filter((r) => r.draftHit != null);
    const hits = done.filter((r) => r.draftHit).length;
    return { total: xs.length, verified: done.length, pending: xs.length - done.length, hits, rate: done.length ? Math.round((hits / done.length) * 1000) / 10 : null };
  }
  const valid = reports.filter((r) => !r.void);
  const verified = valid.filter((r) => r.result);
  const key = by === 'program' ? 'programHit' : by === 'open' ? 'openHit' : 'hit';
  const hits = verified.filter((r) => r.result[key]).length;
  return {
    total: valid.length,
    verified: verified.length,
    pending: valid.length - verified.length,
    hits,
    rate: verified.length ? Math.round((hits / verified.length) * 1000) / 10 : null,
  };
}

export const rateText = (st) => (st.rate == null ? '—' : `${st.rate}%`);

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const weekday = (d) => WEEK[new Date(d + 'T00:00:00Z').getUTCDay()];
export const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const pct = (n, digits = 2) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`);
export const tone = (n) => (n == null || n === 0 ? 'flat' : n > 0 ? 'up' : 'down');
export const verdictTone = (v) => (v === '偏多' ? 'up' : v === '偏空' ? 'down' : 'flat');
export const signalTone = (s) => (s === '偏多' ? 'up' : s === '偏空' ? 'down' : 'flat');
export const signalIcon = (s) => ({ 偏多: '▲', 偏空: '▼', 中性: '■', 缺漏: '?' })[s];
export const fmtNum = (n, d = 0) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const lots = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${fmtNum(n)}`);
