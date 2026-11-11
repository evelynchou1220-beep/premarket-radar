#!/usr/bin/env node
// 預測驗證：npm run verify
// 找出「預測交易日已收盤、但還沒對答案」的報告，抓證交所官方收盤價，寫入 data/results.json。
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { getJSON, num, round, ymd } from './lib/http.mjs';
import { judge, programScore, flatBand, openScore, OPEN_LABEL } from '../src/lib/scoring.mjs';

const RESULTS = 'data/results.json';
const results = JSON.parse(await readFile(RESULTS, 'utf8'));
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const cache = new Map();

async function monthRows(code, date) {
  const key = `${code}-${date.slice(0, 7)}`;
  if (!cache.has(key)) {
    const j = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ymd(date).slice(0, 6)}01&stockNo=${code}&response=json`, { delay: 1000 });
    cache.set(key, j.stat === 'OK' ? j.data.map((r) => {
      const [y, m, d] = r[0].split('/');
      return { date: `${Number(y) + 1911}-${m}-${d}`, open: num(r[3]), close: num(r[6]) };
    }) : []);
  }
  return cache.get(key);
}

let updated = 0;
for (const file of (await readdir('src/content/reports')).filter((f) => f.endsWith('.md')).sort()) {
  const id = file.replace(/\.md$/, '');
  if (results[id]) continue;
  const fm = parse((await readFile(`src/content/reports/${file}`, 'utf8')).replace(/\r\n/g, '\n').split('---\n')[1]);
  if (fm.target > today) { console.log(`… ${id}：預測日 ${fm.target} 尚未到`); continue; }

  const rows = await monthRows(fm.code, fm.target);
  const day = rows.find((r) => r.date === fm.target);
  if (!day) {
    const later = rows.some((r) => r.date > fm.target);
    if (later) {
      // 預測日沒有開盤（例如颱風臨時停市）：作廢，不列入戰績，報告本身不修改
      results[id] = { code: fm.code, target: fm.target, mode: fm.mode ?? 'ai', void: true, note: `${fm.target} 未開盤（臨時休市），此預測作廢、不列入戰績`, verifiedAt: new Date().toISOString() };
      updated++;
      console.log(`⊘ ${id}：${fm.target} 未開盤，預測作廢`);
    } else {
      console.log(`… ${id}：證交所尚未公布 ${fm.target} 收盤（通常 14:30 後）`);
    }
    continue;
  }
  const prevRows = fm.basedOn.slice(0, 7) === fm.target.slice(0, 7) ? rows : await monthRows(fm.code, fm.basedOn);
  const prev = prevRows.find((r) => r.date === fm.basedOn);
  if (!prev) { console.log(`⚠ ${id}：找不到 ${fm.basedOn} 收盤價`); continue; }

  const changePct = round(((day.close - prev.close) / prev.close) * 100);
  const openPct = round(((day.open - prev.close) / prev.close) * 100);
  // 盤整範圍依個股近 20 日波動計算；程式版判定由快照重算（AI 完整版報告也記錄，用來比較兩種方法的命中率）
  const snap = JSON.parse(await readFile(`data/snapshots/${fm.target}/${fm.code}.json`, 'utf8'));
  const band = flatBand(snap.daily);
  const { actual, hit } = judge(fm.verdict, changePct, band);
  // 開盤預測：開盤價相對前一日收盤的跳空，與該股的開盤平盤範圍比較
  const openBand = flatBand(snap.daily, 'open');
  const op = openScore(fm.factors);
  const openJudge = judge(op.verdict, openPct, openBand);
  const prog = programScore(snap.hints);
  const mode = fm.mode ?? 'ai';
  results[id] = {
    code: fm.code, target: fm.target, mode, verdict: fm.verdict, confidence: fm.confidence,
    programVerdict: prog.verdict, programConfidence: prog.confidence,
    prevClose: prev.close, open: day.open, close: day.close, openPct, changePct, band, actual,
    hit, programHit: prog.verdict === actual,
    openVerdict: op.label, openConfidence: op.confidence, openBand, openActual: OPEN_LABEL[openJudge.actual], openHit: openJudge.hit,
    verifiedAt: new Date().toISOString(),
  };
  updated++;
  console.log(`開盤 ${openJudge.hit ? '✔' : '✘'} 預測${op.label}、實際${OPEN_LABEL[openJudge.actual]}（${openPct}%，範圍 ±${openBand}%）｜收盤 ${hit ? '✔ 命中' : '✘ 未中'} ${id}：${mode === 'ai' ? 'AI 完整版' : '程式版'}預測 ${fm.verdict}${mode === 'ai' ? `（程式版 ${prog.verdict}）` : ''}，實際 ${actual}（開盤 ${openPct}%、收盤 ${changePct}%，盤整範圍 ±${band}%）`);
}

await writeFile(RESULTS, JSON.stringify(Object.fromEntries(Object.entries(results).sort()), null, 2) + '\n');
const all = Object.values(results).filter((r) => !r.void);
const rate = (list, key) => `${list.filter((r) => r[key]).length}/${list.length}（${list.length ? round((list.filter((r) => r[key]).length / list.length) * 100, 1) : 0}%）`;
const ai = all.filter((r) => r.mode === 'ai');
console.log(`\n本次新增 ${updated} 筆；累計有效預測 ${all.length} 筆`);
console.log(`  程式版命中：${rate(all, 'programHit')}`);
console.log(`  AI 完整版命中：${rate(ai, 'hit')}`);
console.log(`  開盤預測命中：${rate(all, 'openHit')}`);
