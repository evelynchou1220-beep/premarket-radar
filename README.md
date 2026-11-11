# 盤前雷達 Pre-Market Radar

台股開盤前的 AI 個股多空分析網站。對 AI 說一句「分析今天的 2330」，AI 會抓取官方數據、搜尋新聞，依照固定的因子清單與評分公式，產生一份「偏多／偏空／盤整＋信心度＋有力理由」的盤前報告，收盤後再自動對答案、累積預測戰績。

> 本站內容由 AI 依公開資料自動產生，僅供學習與研究，不構成任何投資建議。

## 特色

- **深色看盤風**：分時走勢、日 K（MA5／20／60）、三大法人 10 日籌碼、隔夜國際行情看板，台股慣例紅漲綠跌。
- **22 個影響因子**：K 線、均線、量能、外資、投信、自營商、融資融券、台指期夜盤、外資期貨未平倉、美股、ADR、日韓股、匯率、關稅、聯準會、地緣政治、國安基金、月營收、法說會、除息等。
- **結論不靠感覺**：每個因子都要有「數據、來源、影響機制、強度」；結論與信心度由固定公式計算，`npm run check` 不通過就無法建置。
- **誠實的戰績**：收盤後以證交所收盤價驗證，命中與否全部公開，未命中的報告不可修改。
- **完全免費**：證交所、期交所、Yahoo Finance 公開資料＋ Astro 靜態網站＋ GitHub Pages，沒有伺服器與資料庫。

## 給 AI 的規則

所有工作規則都寫在 **[CLAUDE.md](./CLAUDE.md)**（其他 AI 工具從 [AGENTS.md](./AGENTS.md) 進入）。內容包含：工作流程、因子判定規則、評分公式、驗收清單、頁面與視覺規範、擴充指南與禁止事項。新增報告、新增因子或新增頁面，都照這份文件做。

## 指令

| 指令 | 用途 |
|---|---|
| `npm install` | 安裝套件（需要 Node.js 22.23.4 以上） |
| `npm run fetch -- 2330` | 抓取 2330 的資料快照與自動因子建議 |
| `npm run check` | 驗收所有報告 |
| `npm run verify` | 收盤後驗證預測，寫入 `data/results.json` |
| `npm run dev` | 本機預覽（http://localhost:4321） |
| `npm run build` | 建置靜態網站到 `dist/` |

## 資料夾

```
CLAUDE.md / AGENTS.md     AI 工作規則
templates/report.md       報告範本
src/data/factors.json     因子定義與評分參數（唯一真實來源）
src/content/reports/      AI 寫的報告（Markdown）
data/snapshots/           每份報告對應的資料快照
data/results.json         驗證結果
scripts/                  抓資料、驗收、驗證腳本
src/pages/                網站頁面
```

## 部署

推上 `main` 分支後，GitHub Actions 會執行 `npm run check` 與 `npm run build`，再發布到 GitHub Pages（Settings → Pages → Source 選 **GitHub Actions**）。

## 資料來源

臺灣證券交易所（日成交、三大法人、融資融券）、臺灣期貨交易所（台指期行情、三大法人期貨未平倉）、Yahoo Finance（美股、日韓股、匯率、ADR、分時走勢），以及 AI 透過網路搜尋取得的新聞（每則附原始連結）。
