# AGENTS.md

本專案的完整規則寫在 **[CLAUDE.md](./CLAUDE.md)**。不論你是 Claude、Codex、Gemini 或其他 AI 工具，開始工作前都必須完整讀完 CLAUDE.md，並遵守其中的流程與禁止事項。

## 30 秒摘要

- **專案**：盤前雷達，台股開盤前的個股多空分析網站（Astro＋GitHub Pages）。
- **最常見的任務**：使用者說「分析今天的 2330」→ `npm run fetch -- 2330` → 搜尋新聞 → 依 `templates/report.md` 寫 `src/content/reports/<target>-<code>.md` → `npm run check` → `npm run build`。
- **收盤後**：「驗證昨天的預測」→ `npm run verify`。
- **最重要的規則**：
  1. 不准捏造數據、新聞或網址。
  2. 每個理由都要有數字、來源、影響機制與強度。
  3. 結論與信心度只能用公式（`src/lib/scoring.mjs`）計算。
  4. 台股配色是紅漲綠跌。
- **因子與規則的唯一來源**：`src/data/factors.json`。
