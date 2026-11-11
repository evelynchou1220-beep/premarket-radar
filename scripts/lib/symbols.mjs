// 代號對照表。新增 ADR 對應時只改這裡（CLAUDE.md §8 擴充指南）。

/** 台股代號 → 美國 ADR 代號 */
export const ADR = {
  '2330': { symbol: 'TSM', ratio: 5, name: '台積電 ADR' },
  '2303': { symbol: 'UMC', ratio: 5, name: '聯電 ADR' },
  '3711': { symbol: 'ASX', ratio: 2, name: '日月光投控 ADR' },
  '2412': { symbol: 'CHT', ratio: 10, name: '中華電 ADR' },
};

/** 每份快照都會抓的國際指標 */
export const GLOBAL = [
  { key: 'sox', symbol: '^SOX', label: '費城半導體' },
  { key: 'nasdaq', symbol: '^IXIC', label: '那斯達克' },
  { key: 'sp500', symbol: '^GSPC', label: '標普 500' },
  { key: 'dow', symbol: '^DJI', label: '道瓊' },
  { key: 'vix', symbol: '^VIX', label: 'VIX 恐慌指數' },
  { key: 'nikkei', symbol: '^N225', label: '日經 225' },
  { key: 'kospi', symbol: '^KS11', label: '韓國 KOSPI' },
  { key: 'usdtwd', symbol: 'TWD=X', label: '美元／新台幣' },
  { key: 'taiex', symbol: '^TWII', label: '台灣加權指數' },
];
