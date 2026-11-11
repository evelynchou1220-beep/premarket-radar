// 八大官股：把從玩股網「複製貼上」的表格文字轉成 data/govbanks/<date>.json 的格式（不需要 AI）。
// 「資料登錄」頁（瀏覽器）與 scripts/govbanks-import.mjs（AI／命令列）共用。格式見 CLAUDE.md §7.4。
import { GOV_BANKS } from './validate.mjs';

const numOf = (s) => Number(String(s).replace(/,/g, ''));
const isNum = (s) => /^-?[\d,]+(\.\d+)?$/.test(s);

/**
 * 「八大公股銀行買賣動向」表格：每列「日期 合庫 土銀 … 合計」，金額單位看標題（預設萬）。
 * @returns {{ days: any[], errors: string[] }}
 */
export function parseBankTable(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = [];
  let order = [...GOV_BANKS];
  let unit = '萬';
  const header = lines.find((l) => GOV_BANKS.filter((b) => l.includes(b)).length >= 4);
  if (header) {
    order = header.split(/\s+/).map((s) => s.trim()).filter((s) => GOV_BANKS.includes(s));
    if (/億/.test(header)) unit = '億';
    if (order.length !== GOV_BANKS.length) errors.push(`表頭只認得 ${order.length} 家行庫：${order.join('、')}`);
  }
  const days = [];
  for (const l of lines) {
    const m = l.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(.*)$/);
    if (!m) continue;
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const nums = m[4].split(/\s+/).filter(isNum).map(numOf);
    if (nums.length !== order.length + 1) { errors.push(`${date}：找到 ${nums.length} 個數字，預期 ${order.length + 1} 個（${order.length} 家行庫＋合計）`); continue; }
    days.push({ date, amountUnit: unit, banks: Object.fromEntries(order.map((b, i) => [b, nums[i]])), net: nums.at(-1) });
  }
  if (!days.length && !errors.length) errors.push('沒有找到「日期＋數字」的資料列');
  return { days, errors };
}

/**
 * 「八大公股銀行買賣超排行」表格：標題列「股票 買超／賣超」切換方向，資料列「股名 張數 金額 收盤價 漲跌% 成交量」。
 * @param {Record<string,string>} nameToCode 官方清單（名稱 → 代號）
 * @returns {{ unit: '元', buy: any[], sell: any[], unknown: string[] }}
 */
export function parseRanking(text, nameToCode) {
  let side = null;
  const buy = [], sell = [], unknown = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (/^股票/.test(l)) { side = l.includes('買超') ? 'buy' : l.includes('賣超') ? 'sell' : side; continue; }
    const tokens = l.split(/\s+/);
    const i = tokens.findIndex(isNum);
    if (i < 1 || tokens.length < i + 2 || !isNum(tokens[i + 1])) continue; // 不是資料列（例如「張數 金額」）
    const name = tokens.slice(0, i).join(' ');
    const lots = numOf(tokens[i]), amount = numOf(tokens[i + 1]);
    const s = side ?? (amount < 0 ? 'sell' : 'buy');
    const code = nameToCode[name];
    if (!code) { unknown.push(name); continue; }
    (s === 'buy' ? buy : sell).push({ code, name, value: Math.abs(amount), lots: Math.abs(lots) });
  }
  return { unit: '元', buy, sell, unknown };
}

/** 代號→名稱 轉成 名稱→代號 */
export const invertStockList = (stocks) => Object.fromEntries(Object.entries(stocks).map(([c, n]) => [n, c]));
