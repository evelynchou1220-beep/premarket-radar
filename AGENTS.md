# AGENTS.md

本專案的完整規則寫在 **[CLAUDE.md](./CLAUDE.md)**。不論你是 Claude、Codex、Gemini 或其他 AI 工具，開始工作前都必須完整讀完 CLAUDE.md，並遵守其中的流程與禁止事項。

## 30 秒摘要

- **專案**：盤前雷達，台股開盤前的個股多空分析網站（Astro＋GitHub Pages）。
- **兩種報告**：
  - **程式版**（`mode: auto`）：GitHub Actions 每個開盤日 05:45 產生，17:30 對答案並抓盤後數據（不做預測）；由雲端排程推觸發分支啟動，cron 備援（CLAUDE.md §7.1）。雲端 AI 07:20 寫 AI 完整版與今早新聞重點、17:30 寫盤後分析（CLAUDE.md §7.5、§7.6）。
  - **AI 完整版**（`mode: ai`）：使用者交辦後由 AI 加入新聞因子。
- **開始工作前**：先 `git pull --rebase`，因為排程機器人每天都會 commit。
- **最常見的任務**：使用者說「分析今天的 2330」：
  1. `npm run fetch -- 2330`
  2. 搜尋最後收盤 13:30 之後的新聞（週一涵蓋整個週末）
  3. 把程式版報告升級成 `mode: ai`，或依 `templates/report.md` 新寫一份
  4. `npm run check`
  5. `npm run build`
- **收盤後**：排程會自動驗證；手動補做用 `npm run verify`。
- **最重要的規則**：
  1. 不准捏造數據、新聞或網址。
  2. 每個理由都要有數字、來源、影響機制與強度。
  3. 結論與信心度只能用公式（`src/lib/scoring.mjs`）計算。
  4. 台股配色是紅漲綠跌。
  5. 開盤後與已驗證的報告不可修改。
- **唯一真實來源**：
  - 因子與規則：`src/data/factors.json`
  - 追蹤清單：`src/data/watchlist.json`
  - 交易日：證交所休市日曆（`scripts/lib/calendar.mjs`）
