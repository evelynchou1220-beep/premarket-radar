// 報告的資料結構（schema）。欄位說明見 CLAUDE.md §4 與 templates/report.md。
// 建置時若任何報告不符合 validateReport() 的規則，npm run build 會直接失敗。
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { FACTOR_KEYS, validateReport } from './lib/validate.mjs';

// Astro 的 YAML 解析器會把 2026-11-12 轉成 Date 物件，這裡統一轉回字串。
const date = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD'),
);

const reports = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/reports' }),
  schema: z
    .object({
      code: z.string().regex(/^\d{4,6}$/),
      name: z.string(),
      target: date,
      basedOn: date,
      createdAt: z.string(),
      // auto＝程式版（每個開盤日排程自動產生）；ai＝AI 完整版（含新聞因子）。舊報告未填時視為 ai。
      mode: z.enum(['auto', 'ai']).default('ai'),
      verdict: z.enum(['偏多', '偏空', '盤整']),
      confidence: z.number().int().min(50).max(85),
      summary: z.string().min(10).max(80),
      timingNote: z.string().optional(),
      factors: z.array(
        z.object({
          key: z.enum(FACTOR_KEYS as [string, ...string[]]),
          signal: z.enum(['偏多', '偏空', '中性', '缺漏']),
          strength: z.enum(['強', '中', '弱']).nullable().optional(),
          // 新聞因子對「開盤」的影響強度，不填則與 strength 相同（CLAUDE.md §5.6）
          openStrength: z.enum(['強', '中', '弱']).optional(),
          data: z.string().min(4),
          source: z.string().min(2),
          reason: z.string().min(4),
        }),
      ),
      news: z.array(
        z.object({
          title: z.string(),
          source: z.string(),
          date: date,
          url: z.string(),
          factor: z.string().optional(),
        }),
      ),
    })
    .superRefine((fm, ctx) => {
      for (const message of validateReport(fm)) ctx.addIssue({ code: 'custom', message });
    }),
});

export const collections = { reports };
