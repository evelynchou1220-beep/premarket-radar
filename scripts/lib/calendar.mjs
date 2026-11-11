// 台股交易日曆：判斷某天有沒有開盤、找上一個／下一個交易日。
// 休市日來源：證交所 OpenAPI「有價證券集中交易市場開（休）市日期」，只涵蓋當年度。
// 颱風假等臨時休市不在表內，由 verify 在對答案時偵測（CLAUDE.md §7）。
import { getJSON } from './http.mjs';

let closed = null;

/** 載入休市日（YYYY-MM-DD 集合）。取得失敗時只排除週末，並回傳警告。 */
export async function loadCalendar() {
  if (closed) return { closed, warning: null };
  try {
    const list = await getJSON('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule');
    closed = new Set(
      list
        // 「開始交易日」「最後交易日」是有開盤的日子，只是標註用
        .filter((x) => !/開始交易|最後交易/.test(x.Name))
        .map((x) => `${Number(x.Date.slice(0, 3)) + 1911}-${x.Date.slice(3, 5)}-${x.Date.slice(5, 7)}`),
    );
    return { closed, warning: null };
  } catch (e) {
    closed = new Set();
    return { closed, warning: `休市日曆取得失敗，只排除週末：${e.message}` };
  }
}

const shift = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** 是否為交易日（需先 await loadCalendar()） */
export function isTradingDay(d) {
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  if (wd === 0 || wd === 6) return false;
  if (d.endsWith('-01-01')) return false; // 跨年時新年度日曆可能尚未載入
  return !closed?.has(d);
}

export function nextTradingDay(d) {
  let x = shift(d, 1);
  while (!isTradingDay(x)) x = shift(x, 1);
  return x;
}

export function prevTradingDay(d) {
  let x = shift(d, -1);
  while (!isTradingDay(x)) x = shift(x, -1);
  return x;
}

/** 兩個日期之間（不含頭尾）的休市日，例如週一預測時回傳週六、週日 */
export function closedDaysBetween(from, to) {
  const out = [];
  for (let x = shift(from, 1); x < to; x = shift(x, 1)) out.push(x);
  return out;
}

/** 台北時間今天 YYYY-MM-DD */
export const todayTpe = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
