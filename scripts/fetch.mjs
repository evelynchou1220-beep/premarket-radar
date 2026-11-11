#!/usr/bin/env node
// 盤前資料抓取：npm run fetch -- <股票代號> [--target YYYY-MM-DD]
// 產出 data/snapshots/<target>/<code>.json，並印出自動因子建議判定與警告（CLAUDE.md §4 步驟 1）。
import { fetchSnapshot } from './lib/snapshot.mjs';

const args = process.argv.slice(2);
const code = args.find((a) => /^\d{4,6}$/.test(a));
const tIdx = args.indexOf('--target');
if (!code) {
  console.error('用法：npm run fetch -- <股票代號> [--target YYYY-MM-DD]');
  process.exit(1);
}

const { snapshot, path } = await fetchSnapshot(code, { target: tIdx >= 0 ? args[tIdx + 1] : undefined });
const m = snapshot.meta;

console.log(`\n✔ 已寫入 ${path}`);
if (m.closedDays.length) {
  console.log(`\n📅 ${m.basedOn} 收盤後到 ${m.target} 之間休市 ${m.closedDays.length} 天（${m.closedDays.join('、')}）。`);
  console.log(`   新聞要搜尋 ${m.basedOn} 13:30 之後到現在的所有事件。`);
}
console.log('\n自動因子建議判定（寫報告時直接採用）：');
for (const [k, h] of Object.entries(snapshot.hints)) {
  console.log(`  ${k.padEnd(11)} ${h.signal}${h.strength ? '・' + h.strength : ''}｜${h.data}`);
}
if (m.warnings.length) {
  console.log('\n⚠ 注意：');
  m.warnings.forEach((w) => console.log('  -', w));
}
