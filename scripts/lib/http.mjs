// 共用的 HTTP 工具：統一 User-Agent、逾時、重試與節流（證交所短時間大量請求會被暫時封鎖）。
const UA = 'Mozilla/5.0 (compatible; premarket-radar/1.0)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(url, { retries = 2, delay = 0 } = {}) {
  if (delay) await sleep(delay);
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`抓取失敗 ${url}：${lastErr?.message}`);
}

/** "1,234" → 1234 */
export const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, '').trim()));

/** Unix 秒 → 台北日期 YYYY-MM-DD */
export const tpeDate = (ts) => new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);

/** Unix 秒 → 台北時間 HH:MM */
export const tpeTime = (ts) => new Date((ts + 8 * 3600) * 1000).toISOString().slice(11, 16);

export const ymd = (d) => d.replaceAll('-', '');

export const round = (n, d = 2) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
