// 網站共用工具：路徑、格式化、資料讀取。頁面一律透過這裡取資料，不要在頁面內直接 glob。
import { getCollection } from 'astro:content';
import factorConfig from '../data/factors.json' with { type: 'json' };
import results from '../../data/results.json' with { type: 'json' };
import { computeScore } from './scoring.mjs';

export const SITE_NAME = '盤前雷達';
export const SITE_TAGLINE = '台股開盤前的 AI 個股多空分析';

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
export const factorDefs = Object.fromEntries(factorConfig.factors.map((f) => [f.key, f]));
export const categories = factorConfig.categories;
export const scoringConfig = factorConfig.scoring;

export async function getReports() {
  const list = await getCollection('reports');
  return list
    .map((r) => ({ ...r, snapshot: snapshots[r.id], result: results[r.id] ?? null, score: computeScore(r.data.factors) }))
    .sort((a, b) => b.data.target.localeCompare(a.data.target) || a.data.code.localeCompare(b.data.code));
}

export function stats(reports) {
  const verified = reports.filter((r) => r.result);
  const hits = verified.filter((r) => r.result.hit).length;
  return {
    total: reports.length,
    verified: verified.length,
    pending: reports.length - verified.length,
    hits,
    rate: verified.length ? Math.round((hits / verified.length) * 1000) / 10 : null,
  };
}

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
