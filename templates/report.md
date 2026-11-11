---
# ───────────────────────────────────────────────────────────────
# 盤前報告範本。複製到 src/content/reports/<target>-<code>.md 後填寫。
# 規則詳見 CLAUDE.md §4～§6。填完務必執行 npm run check。
# ───────────────────────────────────────────────────────────────
code: "2330"                 # 股票代號（字串，加引號）
name: 台積電                  # 與快照 meta.name 相同
target: 2026-11-12           # 預測的交易日 = 快照 meta.target
basedOn: 2026-11-11          # 最後收盤日 = 快照 meta.basedOn
createdAt: 2026-11-12T07:40+08:00
verdict: 偏多                 # 偏多｜偏空｜盤整 —— 必須等於 npm run check 算出的結果
confidence: 68               # 50～85 —— 必須等於 npm run check 算出的結果
summary: 一句話結論，30～60 字，要包含最關鍵的 1～2 個理由與數字
# timingNote: 只有快照 timingOk 為 false 時才填，說明哪些資料不是最新的

factors:
  # ── 程式判定（auto）因子：signal、strength、data、source 直接照抄快照 hints ──
  - key: foreign
    signal: 偏多              # 偏多｜偏空｜中性｜缺漏
    strength: 強              # 強｜中｜弱；中性與缺漏不填（刪掉此行）
    data: 11/11 外資買超 23,000 張（占成交量 12.3%），連 3 日同向
    source: 證交所 T86，2026-11-11
    reason: 外資連 3 日回補且買超量是近 20 日最大，代表國際資金重新加碼，籌碼面支撐隔日股價。
  # ── AI 搜尋因子：先搜尋新聞，再依 factors.json 的 rule 判定 ──
  - key: tariff
    signal: 中性
    data: 近 3 日無新的半導體關稅公告
    source: WebSearch，2026-11-12 07:30
    reason: 本期無新消息，不影響判斷。
  # …其餘必查因子：kline ma volume trust dealer margin txf futures_oi us_market asia fx fed geopolitics national_fund revenue
  # …選用因子（有事件才加）：momentum adr politics earnings_call dividend

news:                        # 至少 3 則，必須是真實存在、可點開的網址
  - title: 新聞標題
    source: 媒體名稱
    date: 2026-11-11
    url: https://example.com/news
    factor: tariff            # 這則新聞支持哪個因子（選填）
---

## 綜合判斷

2～4 句。說明多空雙方最強的理由各是什麼、為什麼最後是這個結論。必須引用至少 2 個具體數字。

## 開盤觀察重點

- 開盤後要看什麼來確認或推翻這個預測（例如：開盤 15 分鐘內外資期貨是否轉為淨買、是否守住 MA20 的 2,357 元）
- 3 點，每點都要有具體價位或數字

## 什麼情況下會看錯

- 列出 2～3 個會讓預測失準的情境（例如：美股盤後財報、盤中重大政策消息）
