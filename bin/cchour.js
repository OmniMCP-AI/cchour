#!/usr/bin/env node
/*
 * cchour — 统计在各 AI 编程工具（Claude Code / Codex）上的使用时间，输出 HTML 报表。
 *
 * 数据源:
 *   Claude Code: ~/.claude/projects/<flattened-cwd>/*.jsonl  (每行 JSON 带 "timestamp":"...Z")
 *   Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl + ~/.codex/archived_sessions/
 *                (session_meta 行带 cwd)
 *
 * 活跃时长算法（间隔法）: 同一组内事件按时间排序，相邻间隔 <= GAP（15 分钟）计入时长，
 * 超过视为离开，不计。每个孤立事件至少计 MIN_EVENT 秒。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const pkg = require('../package.json');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude', 'projects');
const CODEX_DIRS = [
  path.join(HOME, '.codex', 'sessions'),
  path.join(HOME, '.codex', 'archived_sessions'),
];

const GAP = 900; // 相邻事件最大间隔（秒）：15 分钟以内算持续工作
const MIN_EVENT = 30; // 孤立事件的最小计时（秒）
const CHUNK = 4 * 1024 * 1024;

// Claude Code 把会话 cwd 里的 / 和 . 都替换成 - 作为目录名
const FH = HOME.replace(/[/.]/g, '-');

const TS_RE = /"timestamp"\s*:\s*"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/g;

function scanTimestamps(file, out) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return;
  }
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let tail = '';
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const s = tail + buf.toString('latin1', 0, n);
      TS_RE.lastIndex = 0;
      let m;
      while ((m = TS_RE.exec(s)) !== null) {
        out.push(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000);
      }
      tail = s.slice(-64);
    }
  } finally {
    fs.closeSync(fd);
  }
}

const SPECIAL_DIRS = {
  [`${FH}-code`]: 'code 根目录（杂项）',
  [FH]: 'home 目录（杂项）',
  '-': '根目录（杂项）',
  '-private-tmp': '临时目录',
};

function claudeProjectName(dirname) {
  if (SPECIAL_DIRS[dirname]) return SPECIAL_DIRS[dirname];
  if (dirname.startsWith(`${FH}-Library-Mobile-Documents`)) return 'iCloud 文档';
  let p = dirname;
  const prefixes = [
    `${FH}-code-products-`,
    `${FH}-code-`,
    `${FH}--claude-`,
    `${FH}--`,
    `${FH}-`,
    '-private-tmp-',
    '-private-',
    '-',
  ];
  for (const prefix of prefixes) {
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  // worktree 归并到主项目
  p = p.replace(/--claude-worktrees.*$/, '');
  return p || 'home';
}

function codexProjectName(file) {
  // session_meta 在首行但可能超长，直接在文件头 256KB 里正则取第一个 cwd
  let head;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.toString('utf8', 0, n);
  } catch {
    return 'unknown';
  }
  const m = head.match(/"cwd"\s*:\s*"([^"]+)"/);
  if (!m) return 'unknown';
  const cwd = m[1].replace(/\/+$/, '');
  if (cwd === HOME) return 'home 目录（杂项）';
  const codeRoot = path.join(HOME, 'code');
  if (cwd === codeRoot) return 'code 根目录（杂项）';
  if (cwd.startsWith(codeRoot + '/')) {
    const rel = cwd.slice(codeRoot.length + 1).split('/');
    // ~/code/products/foo 取 foo，其余取第一段
    if (rel[0] === 'products' && rel.length > 1) return rel[1];
    return rel[0];
  }
  return path.basename(cwd) || 'home';
}

// 默认分类规则；可用 ~/.cchour/categories.json 覆盖，
// 格式: [["分类名", ["项目名关键词", ...], ["内容关键词", ...]?], ...]
// 第二个数组按顺序匹配项目名（小写包含）；可选的第三个数组用于杂项目录会话的
// 内容级分类——匹配会话首条用户消息，命中则把该会话从「杂项」挪进对应分类。
const DEFAULT_CATEGORIES = [
  ['写作与发布',
    ['wechat', 'publish', 'hugo', 'blog', 'article', 'tweet', 'newsletter', 'syndicat'],
    ['公众号', '文章', '博客', '润色', '推文', 'tweet', 'blog', 'newsletter']],
  ['视频制作',
    ['video', 'multicam', 'dub', 'subtitle', 'overlay', 'transcrib', 'podcast', 'youtube', 'audio'],
    ['视频', '字幕', '配音', '剪辑', '转写', 'srt', 'video', 'youtube', '音频']],
  ['网站维护',
    ['website', 'site'],
    ['网站', 'website', 'seo', '域名']],
  ['技能与工具链',
    ['skill', 'claude-code', 'claude-logs', 'memory', 'agents', '.claude', 'tmp', 'tool'],
    ['skill', 'mcp', 'plugin', '插件', '记忆', 'claude code', 'codex']],
  ['杂项（根目录会话）', ['杂项', 'downloads', 'icloud', '临时']],
  ['基础设施',
    ['infra', 'dns', 'cloudflare', 'server', 'backup', 'deploy'],
    ['cloudflare', 'dns', '服务器', '部署', 'deploy', '备份', 'backup', '代理', 'proxy', '网盘', 'launchd']],
];

function loadCategories() {
  const p = path.join(HOME, '.cchour', 'categories.json');
  try {
    const rules = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(rules) && rules.length) return rules;
  } catch {
    /* 无配置文件时用默认规则 */
  }
  return DEFAULT_CATEGORIES;
}

function makeCategorize(rules) {
  return (project) => {
    const p = project.toLowerCase();
    for (const [cat, keys] of rules) {
      for (const k of keys) {
        if (p.includes(k)) return cat;
      }
    }
    return '其他';
  };
}

// 内容级分类：只用带第三个数组（内容关键词）的规则，未命中返回 null（留在杂项）
function makeContentCategorize(rules) {
  const contentRules = rules.filter((r) => Array.isArray(r[2]) && r[2].length);
  return (text) => {
    if (!text) return null;
    const p = text.toLowerCase();
    for (const [cat, , keys] of contentRules) {
      for (const k of keys) {
        if (p.includes(k.toLowerCase())) return cat;
      }
    }
    return null;
  };
}

// 取 Claude Code 会话首条真实用户消息的文本（头 256KB 内逐行解析）
function firstUserText(file) {
  let head;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.toString('utf8', 0, n);
  } catch {
    return '';
  }
  for (const line of head.split('\n')) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type !== 'user' || !j.message || j.isMeta) continue;
    const c = j.message.content;
    let t = typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ')
        : '';
    t = t.replace(/<[^>]*>/g, ' ').trim();
    if (!t || t.startsWith('Caveat:')) continue;
    return t.slice(0, 2000);
  }
  return '';
}

function uniqSorted(ts) {
  const set = new Set();
  for (const t of ts) set.add(Math.floor(t));
  return Array.from(set).sort((a, b) => a - b);
}

function activeSeconds(ts) {
  if (!ts.length) return 0;
  const u = uniqSorted(ts);
  let total = 0;
  let prev = null;
  for (const t of u) {
    if (prev !== null && t - prev <= GAP) total += t - prev;
    else total += MIN_EVENT;
    prev = t;
  }
  return total;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKey(t) {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 周以周一为起点，key 为周一的日期字符串
function weekKey(t) {
  const d = new Date(t * 1000);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
}

function monthKey(t) {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function bucketActive(ts, keyFn) {
  const out = new Map();
  const u = uniqSorted(ts);
  let prev = null;
  for (const t of u) {
    const k = keyFn(t);
    const inc = prev !== null && t - prev <= GAP ? t - prev : MIN_EVENT;
    out.set(k, (out.get(k) || 0) + inc);
    prev = t;
  }
  return out;
}

const dailyActive = (ts) => bucketActive(ts, dayKey);
const weeklyActive = (ts) => bucketActive(ts, weekKey);
const monthlyActive = (ts) => bucketActive(ts, monthKey);
const hourlyActive = (ts) => bucketActive(ts, (t) => new Date(t * 1000).getHours());

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function walkJsonl(dir, cb) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, cb);
    else if (e.isFile() && e.name.endsWith('.jsonl')) cb(full);
  }
}

function collect(contentCategorize) {
  // tool -> Map(project -> [timestamps])
  const data = new Map();
  // 杂项会话经内容级分类拆出的合成项目名 -> 分类（覆盖按项目名的分类）
  const catOverride = new Map();
  const bucket = (tool, proj) => {
    if (!data.has(tool)) data.set(tool, new Map());
    const m = data.get(tool);
    if (!m.has(proj)) m.set(proj, []);
    return m.get(proj);
  };

  if (isDir(CLAUDE_DIR)) {
    for (const d of fs.readdirSync(CLAUDE_DIR).sort()) {
      const full = path.join(CLAUDE_DIR, d);
      if (!isDir(full)) continue;
      const proj = claudeProjectName(d);
      const isMisc = Boolean(SPECIAL_DIRS[d]);
      for (const fn of fs.readdirSync(full)) {
        if (!fn.endsWith('.jsonl')) continue;
        const file = path.join(full, fn);
        let p = proj;
        if (isMisc) {
          const cat = contentCategorize(firstUserText(file));
          if (cat) {
            p = `${proj.replace('（杂项）', '')} · ${cat}`;
            catOverride.set(p, cat);
          }
        }
        scanTimestamps(file, bucket('Claude Code', p));
      }
    }
  }

  for (const rootDir of CODEX_DIRS) {
    walkJsonl(rootDir, (file) => {
      const proj = codexProjectName(file);
      scanTimestamps(file, bucket('Codex', proj));
    });
  }

  return { data, catOverride };
}

function fmtH(sec) {
  const h = sec / 3600;
  if (h >= 1) return `${h.toFixed(1)} 小时`;
  return `${Math.round(sec / 60)} 分钟`;
}

function buildReport(data, categorize, catOverride, ndays) {
  const toolSeconds = new Map();
  const toolDaily = new Map();
  const toolWeekly = new Map();
  const toolMonthly = new Map();
  const toolHourly = new Map();
  const projRows = []; // {tool, proj, sec, cat, first, last}
  const catSeconds = new Map();

  for (const [tool, projects] of data) {
    const allTs = [];
    for (const [proj, ts] of projects) {
      if (!ts.length) continue;
      const sec = activeSeconds(ts);
      if (sec < 60) continue;
      const cat = catOverride.get(proj) || categorize(proj);
      catSeconds.set(cat, (catSeconds.get(cat) || 0) + sec);
      let first = Infinity;
      let last = -Infinity;
      for (const t of ts) {
        if (t < first) first = t;
        if (t > last) last = t;
      }
      projRows.push({ tool, proj, sec, cat, first, last });
      for (const t of ts) allTs.push(t);
    }
    toolSeconds.set(tool, activeSeconds(allTs));
    toolDaily.set(tool, dailyActive(allTs));
    toolWeekly.set(tool, weeklyActive(allTs));
    toolMonthly.set(tool, monthlyActive(allTs));
    toolHourly.set(tool, hourlyActive(allTs));
  }

  projRows.sort((a, b) => b.sec - a.sec);

  const days = [];
  const now = new Date();
  for (let i = ndays - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }

  // 最近 12 周（周一为起点）与最近 12 个月
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    weeks.push(weekKey(now.getTime() / 1000 - i * 7 * 86400));
  }
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  return {
    toolSeconds, toolDaily, toolWeekly, toolMonthly, toolHourly,
    projRows, catSeconds, days, weeks, months,
  };
}

const TOOL_COLORS = { 'Claude Code': '#D97757', Codex: '#4A7DBE' };
const CAT_COLORS = ['#D97757', '#4A7DBE', '#5BA88B', '#C9A227', '#9B7BB8', '#D86F8C', '#8A9BA8'];

function stackedBars(keys, tools, byTool, color, labelFn, height) {
  let max = 1;
  for (const k of keys) {
    const v = tools.reduce((a, t) => a + (byTool.get(t).get(k) || 0), 0);
    if (v > max) max = v;
  }
  let bars = '';
  for (const k of keys) {
    let segs = '';
    let total = 0;
    for (const t of tools) {
      const v = byTool.get(t).get(k) || 0;
      total += v;
      const h = (v / max) * height;
      if (h > 0.5) segs += `<div class="seg" style="height:${h.toFixed(1)}px;background:${color(t)}"></div>`;
    }
    const tip = `${k} · ${(total / 3600).toFixed(1)}h`;
    bars += `<div class="bar" title="${tip}"><div class="bar-stack">${segs}</div><div class="bar-x">${labelFn(k)}</div></div>`;
  }
  return bars;
}

function renderHtml({
  toolSeconds, toolDaily, toolWeekly, toolMonthly, toolHourly,
  projRows, catSeconds, days, weeks, months,
}) {
  const total = Array.from(toolSeconds.values()).reduce((a, b) => a + b, 0);
  const tools = Array.from(toolSeconds.keys()).sort((a, b) => toolSeconds.get(b) - toolSeconds.get(a));
  const now = new Date();
  const genTime = `${dayKey(now.getTime() / 1000)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const firstTs = projRows.length ? Math.min(...projRows.map((r) => r.first)) : 0;
  const spanDays = firstTs ? Math.max(1, Math.floor((Date.now() / 1000 - firstTs) / 86400)) : 1;
  const color = (t) => TOOL_COLORS[t] || '#888';

  // ---- 总览卡片 ----
  let cards = `
    <div class="card"><div class="card-label">总活跃时长</div>
      <div class="card-value">${(total / 3600).toFixed(0)}<span class="unit">小时</span></div>
      <div class="card-sub">自 ${firstTs ? dayKey(firstTs) : '—'} 起，${spanDays} 天</div></div>`;
  for (const t of tools) {
    const pct = total ? (toolSeconds.get(t) / total) * 100 : 0;
    cards += `
    <div class="card"><div class="card-label"><span class="dot" style="background:${color(t)}"></span>${t}</div>
      <div class="card-value">${(toolSeconds.get(t) / 3600).toFixed(0)}<span class="unit">小时</span></div>
      <div class="card-sub">占比 ${pct.toFixed(0)}% · 日均 ${(toolSeconds.get(t) / 3600 / spanDays).toFixed(1)} 小时</div></div>`;
  }

  // ---- 每日 / 每周 / 每月堆叠柱状图 ----
  const bars = stackedBars(days, tools, toolDaily, color, (d) => d.slice(5).replace('-', '/'), 160);
  const weekBars = stackedBars(weeks, tools, toolWeekly, color, (w) => w.slice(5).replace('-', '/'), 150);
  const monthBars = stackedBars(months, tools, toolMonthly, color, (m) => m.slice(2).replace('-', '/'), 150);

  const legend = tools
    .map((t) => `<span class="lg"><span class="dot" style="background:${color(t)}"></span>${t}</span>`)
    .join('');

  // ---- 24 小时分布 ----
  const hourTotal = [];
  let maxHour = 1;
  for (let h = 0; h < 24; h++) {
    const v = tools.reduce((a, t) => a + (toolHourly.get(t).get(h) || 0), 0);
    hourTotal.push(v);
    if (v > maxHour) maxHour = v;
  }
  let hourBars = '';
  for (let h = 0; h < 24; h++) {
    let segs = '';
    for (const t of tools) {
      const v = toolHourly.get(t).get(h) || 0;
      const hh = (v / maxHour) * 120;
      if (hh > 0.5) segs += `<div class="seg" style="height:${hh.toFixed(1)}px;background:${color(t)}"></div>`;
    }
    hourBars += `<div class="bar" title="${pad2(h)}:00 · ${(hourTotal[h] / 3600).toFixed(1)}h"><div class="bar-stack">${segs}</div><div class="bar-x">${h}</div></div>`;
  }

  // ---- 工作分类 ----
  const cats = Array.from(catSeconds.entries()).sort((a, b) => b[1] - a[1]);
  const catTotal = cats.reduce((a, [, v]) => a + v, 0) || 1;
  let catRows = '';
  cats.forEach(([cat, sec], i) => {
    const pct = (sec / catTotal) * 100;
    const c = CAT_COLORS[i % CAT_COLORS.length];
    catRows += `
      <div class="hrow">
        <div class="hname"><span class="dot" style="background:${c}"></span>${cat}</div>
        <div class="htrack"><div class="hfill" style="width:${pct.toFixed(1)}%;background:${c}"></div></div>
        <div class="hval">${fmtH(sec)} · ${pct.toFixed(0)}%</div>
      </div>`;
  });

  // ---- Top 项目 ----
  const top = projRows.slice(0, 20);
  const maxProj = top.length ? top[0].sec : 1;
  let projHtml = '';
  for (const r of top) {
    const pct = (r.sec / maxProj) * 100;
    const last = new Date(r.last * 1000);
    const lastS = `${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
    projHtml += `
      <div class="hrow">
        <div class="hname" title="${r.proj}">${r.proj}</div>
        <div class="htrack"><div class="hfill" style="width:${pct.toFixed(1)}%;background:${color(r.tool)}"></div></div>
        <div class="hval">${fmtH(r.sec)} <span class="muted">· ${r.cat} · 最近 ${lastS}</span></div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 编程工具时间报表</title>
<style>
  :root { --ink:#2c2c2c; --muted:#8a8a8a; --line:#ececec; --bg:#fafaf8; --card:#ffffff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;
          background:var(--bg); color:var(--ink); padding:40px 24px 80px; }
  .wrap { max-width:980px; margin:0 auto; }
  h1 { font-size:26px; font-weight:700; letter-spacing:.5px; }
  .sub { color:var(--muted); font-size:13px; margin-top:6px; }
  h2 { font-size:16px; font-weight:600; margin:36px 0 14px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-top:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; }
  .card-label { font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px; }
  .card-value { font-size:32px; font-weight:700; margin-top:6px; }
  .card-value .unit { font-size:14px; font-weight:400; color:var(--muted); margin-left:4px; }
  .card-sub { font-size:12px; color:var(--muted); margin-top:4px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; }
  .chart { display:flex; align-items:flex-end; gap:3px; height:190px; }
  .bar { flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; min-width:0; }
  .bar-stack { width:100%; display:flex; flex-direction:column-reverse; border-radius:3px 3px 0 0; overflow:hidden; }
  .bar:hover .bar-stack { opacity:.75; }
  .bar-x { font-size:9px; color:var(--muted); margin-top:5px; white-space:nowrap;
            transform:rotate(-45deg); transform-origin:top center; height:26px; }
  .hourchart .bar-x { transform:none; height:auto; }
  .legend { display:flex; gap:16px; margin-top:6px; font-size:12px; color:var(--muted); }
  .lg { display:flex; align-items:center; gap:5px; }
  .hrow { display:flex; align-items:center; gap:12px; padding:7px 0; border-bottom:1px solid var(--line); }
  .hrow:last-child { border-bottom:none; }
  .hname { width:200px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
            display:flex; align-items:center; gap:6px; flex-shrink:0; }
  .htrack { flex:1; height:14px; background:#f3f3f0; border-radius:7px; overflow:hidden; }
  .hfill { height:100%; border-radius:7px; }
  .hval { width:230px; font-size:12px; text-align:right; flex-shrink:0; }
  .muted { color:var(--muted); }
  footer { margin-top:48px; font-size:12px; color:var(--muted); text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>AI 编程工具时间报表</h1>
  <div class="sub">生成于 ${genTime} · 数据来自本机 Claude Code 与 Codex 会话记录 · 活跃时长 = 相邻操作间隔 ≤ 15 分钟的累计</div>

  <div class="cards">${cards}
  </div>

  <h2>最近 ${days.length} 天每日使用</h2>
  <div class="panel">
    <div class="chart">${bars}</div>
    <div class="legend">${legend}</div>
  </div>

  <h2>最近 ${weeks.length} 周每周使用（以周一为起点）</h2>
  <div class="panel">
    <div class="chart" style="height:180px">${weekBars}</div>
    <div class="legend">${legend}</div>
  </div>

  <h2>最近 ${months.length} 个月每月使用</h2>
  <div class="panel">
    <div class="chart" style="height:180px">${monthBars}</div>
    <div class="legend">${legend}</div>
  </div>

  <h2>一天中的时间分布（24 小时）</h2>
  <div class="panel hourchart">
    <div class="chart" style="height:150px">${hourBars}</div>
    <div class="legend">${legend}</div>
  </div>

  <h2>工作分类</h2>
  <div class="panel">${catRows}
  </div>

  <h2>项目时长 Top 20</h2>
  <div class="panel">${projHtml}
  </div>

  <footer>cchour · 全部数据在本机统计，未上传任何服务</footer>
</div>
</body>
</html>`;
}

function printHelp() {
  console.log(`cchour v${pkg.version} — AI 编程工具时间报表 (Claude Code / Codex)

用法: cchour [选项]

选项:
  -o, --output <文件>   输出 HTML 路径（默认 ./cchour-report.html）
      --days <N>        每日图表显示最近 N 天（默认 30）
      --open            生成后用系统默认浏览器打开
  -h, --help            显示帮助
  -v, --version         显示版本

分类规则可用 ~/.cchour/categories.json 自定义，格式:
  [["分类名", ["项目名关键词", ...], ["内容关键词", ...]?], ...]
按顺序对项目名做小写包含匹配，未命中归入「其他」。
可选的第三个数组用于杂项目录（home / code 根目录等）会话的内容级分类:
匹配会话首条用户消息，命中则把该会话挪进对应分类。`);
}

function parseArgs(argv) {
  const opts = { output: 'cchour-report.html', days: 30, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') opts.output = argv[++i];
    else if (a === '--days') opts.days = Math.max(1, parseInt(argv[++i], 10) || 30);
    else if (a === '--open') opts.open = true;
    else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    } else if (a === '-v' || a === '--version') {
      console.log(pkg.version);
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}\n`);
      printHelp();
      process.exit(1);
    }
  }
  if (!opts.output) {
    console.error('缺少 --output 的值');
    process.exit(1);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  console.error('扫描数据源…');
  const rules = loadCategories();
  const { data, catOverride } = collect(makeContentCategorize(rules));
  for (const [tool, projects] of data) {
    let n = 0;
    for (const ts of projects.values()) n += ts.length;
    console.error(`  ${tool}: ${projects.size} 个项目, ${n} 个事件`);
  }

  const report = buildReport(data, makeCategorize(rules), catOverride, opts.days);
  const html = renderHtml(report);

  const outPath = path.resolve(opts.output);
  fs.writeFileSync(outPath, html, 'utf8');

  const sorted = Array.from(report.toolSeconds.entries()).sort((a, b) => b[1] - a[1]);
  for (const [t, s] of sorted) console.error(`  ${t}: ${(s / 3600).toFixed(1)} 小时`);
  console.error(`已生成 ${outPath}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);

  if (opts.open) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', outPath] : [outPath];
    spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
  }
}

main();
