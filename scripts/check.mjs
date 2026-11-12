#!/usr/bin/env node
// 報告驗收：npm run check [-- <報告檔名或 id>]
// 檢查所有（或指定）報告是否符合 CLAUDE.md §6 的驗收清單。全部通過才可以 build / push。
import { readFile, readdir, access } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateReport, validateBody, validateGovBank } from '../src/lib/validate.mjs';
import { closeScore } from '../src/lib/scoring.mjs';

const DIR = 'src/content/reports';
const only = process.argv[2]?.replace(/\.md$/, '');
const files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && (!only || f.startsWith(only)));

if (!files.length) {
  console.log(only ? `找不到報告：${only}` : '目前沒有任何報告。');
  process.exit(only ? 1 : 0);
}

let failed = 0;
for (const file of files) {
  const raw = (await readFile(`${DIR}/${file}`, 'utf8')).replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const errors = [];
  let fm = {};
  if (!m) errors.push('找不到 frontmatter（檔案開頭須為 ---）');
  else {
    fm = parse(m[1]);
    const expected = `${fm.target}-${fm.code}.md`;
    if (file !== expected) errors.push(`檔名應為 ${expected}`);
    const snapPath = `data/snapshots/${fm.target}/${fm.code}.json`;
    let snapshot;
    try {
      await access(snapPath);
      snapshot = JSON.parse(await readFile(snapPath, 'utf8'));
    } catch {
      errors.push(`找不到對應快照 ${snapPath}（請先執行 npm run fetch -- ${fm.code}）`);
    }
    errors.push(...validateReport(fm, snapshot), ...validateBody(m[2]));
  }
  if (errors.length) {
    failed++;
    console.log(`✘ ${file}`);
    errors.forEach((e) => console.log(`   - ${e}`));
  } else {
    const s = closeScore(fm.factors, fm.target);
    console.log(`✔ ${file}  ${fm.verdict}｜信心度 ${fm.confidence}%｜得分 ${s.score}/${s.max}（多 ${s.bull}・空 ${s.bear}・中性 ${s.neutral}・缺漏 ${s.missing}）`);
  }
}
console.log(`\n${files.length - failed}/${files.length} 份報告通過驗收`);

// 八大官股資料（使用者提供）
const GOV = 'data/govbanks';
let govFiles = [];
try { govFiles = (await readdir(GOV)).filter((f) => f.endsWith('.json')); } catch { /* 還沒有資料 */ }
for (const f of govFiles) {
  let errs;
  try { errs = validateGovBank(JSON.parse(await readFile(`${GOV}/${f}`, 'utf8')), f); }
  catch (e) { errs = [`[${f}] 不是合法的 JSON：${e.message}`]; }
  if (errs.length) { failed++; console.log(`✘ ${GOV}/${f}`); errs.forEach((e) => console.log(`   - ${e}`)); }
  else console.log(`✔ ${GOV}/${f}`);
}
if (govFiles.length) console.log(`官股資料 ${govFiles.length} 份`);
process.exit(failed ? 1 : 0);
