// 盤前新聞警示：抓取新聞標題（Google News RSS，免費），依 factors.json 的 newsAlert 關鍵字貼標籤。
// 只用來「提醒」使用者今天有重大新聞、建議請 AI 升級為完整版；不參與計分（CLAUDE.md §7）。
// 只保存標題、媒體名稱、時間與連結，不保存內文。
import config from '../../src/data/factors.json' with { type: 'json' };
import { sleep } from './http.mjs';

const { tags: TAGS } = config.newsAlert;
const TRUSTED = config.newsPolicy.trustedSources;

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pick = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1]).trim() : ''; };

/**
 * @param {string} query Google News 搜尋字串
 * @param {string} since ISO 時間，只保留這之後發布的新聞
 */
export async function fetchHeadlines(query, since, limit = 12) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  let xml = '';
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (premarket-radar)' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * attempt);
    }
  }
  const sinceMs = Date.parse(since);
  const seen = new Set();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? [])
    .map((it) => {
      const source = pick(it, 'source');
      const title = pick(it, 'title').replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      const time = new Date(pick(it, 'pubDate')).toISOString();
      const tags = Object.entries(TAGS).filter(([, words]) => words.some((w) => title.includes(w))).map(([t]) => t);
      return { title, source, url: pick(it, 'link'), time, tags, trusted: TRUSTED.some((s) => source.includes(s)) };
    })
    .filter((x) => Date.parse(x.time) >= sinceMs && !seen.has(x.title) && seen.add(x.title))
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, limit);
}

/** 大盤新聞的搜尋字串：政策、利率、兩岸、國安基金 */
export const MARKET_QUERY = '台股 (關稅 OR 出口管制 OR 聯準會 OR 解放軍 OR 國安基金)';
