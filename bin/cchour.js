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
const CCHOUR_DIR = path.join(HOME, '.cchour');
const EXCLUDES_FILE = path.join(CCHOUR_DIR, 'excludes.json');
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

const I18N = {
  cn: {
    htmlLang: 'zh-CN',
    appTitle: 'AI 编程工具时间报表',
    generatedAt: '生成于',
    rangeLabel: '统计范围',
    allData: '全部数据',
    clippedNote: '数据已按命令行参数截取',
    dataFrom: '数据来自本机 Claude Code 与 Codex 会话记录',
    activeFormula: '活跃时长 = 相邻操作间隔 ≤ 15 分钟的累计',
    timeFilter: '时间过滤',
    nightly: '夜间',
    taskDetails: 'Agent 工作流摘要',
    spec: 'Spec',
    goal: 'Goal',
    result: 'Result',
    tokens: 'Tokens',
    controls: {
      all: '全部',
      today: '今天',
      week: '本周',
      lastweek: '上周',
      month: '本月',
      lastmonth: '上月',
      d7: '近 7 天',
      d30: '近 30 天',
      d90: '近 90 天',
      custom: '自定义',
    },
    headings: {
      daily: '最近 {n} 天每日使用',
      weekly: '最近 {n} 周每周使用（以周一为起点）',
      monthly: '最近 {n} 个月每月使用',
      hourly: '一天中的时间分布（24 小时）',
      categories: '工作分类',
      projects: '项目时长 Top 20',
    },
    cards: {
      total: '总活跃时长',
      hours: '小时',
      share: '占比',
      dailyAvg: '日均',
      days: '天',
    },
    units: {
      hours: '小时',
      minutes: '分钟',
      latest: '最近',
      none: '该时间段没有数据',
      earliest: '最早',
      today: '今天',
    },
    footer: 'cchour · 全部数据在本机统计，未上传任何服务 · 时间范围切换在浏览器内完成',
    projectsRecent: '最近',
    helpTitle: 'AI 编程工具时间报表 (Claude Code / Codex)',
    helpUsage: '用法: cchour [选项]',
    helpOptions: '选项:',
    helpUnknownArg: '未知参数',
    helpMissingOutput: '缺少 --output 的值',
    helpDateFmt: '需要 YYYY-MM-DD 格式的日期，收到:',
    helpMonthFmt: '--month 需要 last 或 YYYY-MM 格式，收到:',
    helpFutureRange: '指定的范围在未来，没有数据',
    helpSinceAfterUntil: '--since 不能晚于 --until',
    helpWeekMonthConflict: '--week 与 --month 不能同时使用',
    helpShortcutConflict: '不能与 --since/--until 同时使用',
    statusScanning: '扫描数据源…',
    statusProjects: '个项目',
    statusEvents: '个事件',
    statusGenerated: '已生成',
    statusElapsed: '耗时',
    sec: '秒',
    other: '其他',
    miscSuffix: '（杂项）',
    special: {
      codeRootMisc: 'code 根目录（杂项）',
      homeMisc: 'home 目录（杂项）',
      rootMisc: '根目录（杂项）',
      tempDir: '临时目录',
      iCloud: 'iCloud 文档',
      home: 'home',
      unknown: 'unknown',
      downloads: 'Downloads',
      desktop: 'Desktop',
      documents: 'Documents',
    },
    defaultCategories: {
      writing: '写作与发布',
      video: '视频制作',
      website: '网站维护',
      skills: '技能与工具链',
      product: '产品研发',
      data: '数据与表格',
      browser: '浏览器自动化',
      finance: '金融与分析',
      vision: '视觉与多媒体',
      platform: '平台集成',
      misc: '杂项（根目录会话）',
      infra: '基础设施',
    },
    llm: {
      missingApiKey: '启用 LLM 功能需要环境变量 OPENAI_API_KEY',
      missingModel: '启用 LLM 功能需要 --llm-model 或环境变量 CCHOUR_LLM_MODEL',
      classifying: '使用 LLM 改进分类映射…',
      summarizing: '使用 LLM 改进工作流摘要…',
      summary: 'LLM 已重分类 {projects} 个项目，新增/使用 {categories} 个分类',
      otherSummary: '当前“其他”仍有 {projects} 个项目，共 {hours} 小时。前几个：{top}',
    },
  },
  en: {
    htmlLang: 'en',
    appTitle: 'AI Coding Time Report',
    generatedAt: 'Generated',
    rangeLabel: 'Range',
    allData: 'All data',
    clippedNote: 'Data was clipped by CLI range',
    dataFrom: 'Data comes from local Claude Code and Codex session logs',
    activeFormula: 'Active time = accumulated gaps between actions <= 15 minutes',
    timeFilter: 'Time filter',
    nightly: 'Nightly',
    taskDetails: 'Agent workflow summaries',
    spec: 'Spec',
    goal: 'Goal',
    result: 'Result',
    tokens: 'Tokens',
    controls: {
      all: 'All',
      today: 'Today',
      week: 'This week',
      lastweek: 'Last week',
      month: 'This month',
      lastmonth: 'Last month',
      d7: 'Last 7 days',
      d30: 'Last 30 days',
      d90: 'Last 90 days',
      custom: 'Custom',
    },
    headings: {
      daily: 'Daily usage for the last {n} days',
      weekly: 'Weekly usage for the last {n} weeks (Mon-based)',
      monthly: 'Monthly usage for the last {n} months',
      hourly: 'Hour-of-day distribution (24h)',
      categories: 'Work categories',
      projects: 'Top 20 projects by time',
    },
    cards: {
      total: 'Total active time',
      hours: 'hours',
      share: 'Share',
      dailyAvg: 'Daily avg',
      days: 'days',
    },
    units: {
      hours: 'hours',
      minutes: 'minutes',
      latest: 'latest',
      none: 'No data in this range',
      earliest: 'earliest',
      today: 'today',
    },
    footer: 'cchour · all stats are computed locally · nothing is uploaded · range switching happens in the browser',
    projectsRecent: 'latest',
    helpTitle: 'AI coding time report (Claude Code / Codex)',
    helpUsage: 'Usage: cchour [options]',
    helpOptions: 'Options:',
    helpUnknownArg: 'Unknown argument',
    helpMissingOutput: 'Missing value for --output',
    helpDateFmt: 'expects a date in YYYY-MM-DD format, got:',
    helpMonthFmt: '--month expects last or YYYY-MM, got:',
    helpFutureRange: 'the selected range is in the future, no data to show',
    helpSinceAfterUntil: '--since must not be later than --until',
    helpWeekMonthConflict: '--week and --month cannot be used together',
    helpShortcutConflict: 'cannot be combined with --since/--until',
    statusScanning: 'Scanning data sources...',
    statusProjects: 'projects',
    statusEvents: 'events',
    statusGenerated: 'Generated',
    statusElapsed: 'Elapsed',
    sec: 's',
    other: 'Other',
    miscSuffix: ' (misc)',
    special: {
      codeRootMisc: 'code root (misc)',
      homeMisc: 'home (misc)',
      rootMisc: 'root (misc)',
      tempDir: 'temp directory',
      iCloud: 'iCloud Drive',
      home: 'home',
      unknown: 'unknown',
      downloads: 'Downloads',
      desktop: 'Desktop',
      documents: 'Documents',
    },
    defaultCategories: {
      writing: 'Writing & Publishing',
      video: 'Video Production',
      website: 'Website Maintenance',
      skills: 'Skills & Tooling',
      product: 'Product Engineering',
      data: 'Data & Spreadsheets',
      browser: 'Browser Automation',
      finance: 'Finance & Analytics',
      vision: 'Vision & Media',
      platform: 'Platform Integrations',
      misc: 'Misc (root sessions)',
      infra: 'Infrastructure',
    },
    llm: {
      missingApiKey: 'LLM options require OPENAI_API_KEY',
      missingModel: 'LLM options require --llm-model or CCHOUR_LLM_MODEL',
      classifying: 'Using LLM to improve category mapping...',
      summarizing: 'Using LLM to improve workflow summaries...',
      summary: 'LLM reclassified {projects} projects across {categories} categories',
      otherSummary: 'Other still has {projects} projects totaling {hours} hours. Top few: {top}',
    },
  },
};

function tr(lang) {
  return I18N[lang] || I18N.cn;
}

function fill(s, vars) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

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

function getSpecialDirs(t) {
  return {
    [`${FH}-code`]: t.special.codeRootMisc,
    [FH]: t.special.homeMisc,
    '-': t.special.rootMisc,
    '-private-tmp': t.special.tempDir,
  };
}

// 这些目录下的会话不属于具体项目，按会话首条用户消息做内容级分类
function isMiscClaudeDir(dirname) {
  if (dirname in getSpecialDirs(tr('cn'))) return true;
  if (dirname.startsWith(`${FH}-Library-Mobile-Documents`)) return true; // iCloud 文档
  return [`${FH}-Downloads`, `${FH}-Desktop`, `${FH}-Documents`].includes(dirname);
}

function codeMiscProjects(t) {
  return new Set([
    t.special.homeMisc, t.special.codeRootMisc, t.special.downloads, t.special.desktop, t.special.documents,
  ]);
}

function claudeProjectName(dirname, t) {
  const specialDirs = getSpecialDirs(t);
  if (specialDirs[dirname]) return specialDirs[dirname];
  if (dirname.startsWith(`${FH}-Library-Mobile-Documents`)) return t.special.iCloud;
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
  return p || t.special.home;
}

// 读文件头 256KB（session 元信息和首条用户消息都在这里）
function readHead(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, n);
  } catch {
    return '';
  }
}

function codexProjectName(head, t) {
  // session_meta 在首行但可能超长，直接在文件头里正则取第一个 cwd
  const m = head.match(/"cwd"\s*:\s*"([^"]+)"/);
  if (!m) return t.special.unknown;
  const cwd = m[1].replace(/\/+$/, '');
  if (cwd === HOME) return t.special.homeMisc;
  const codeRoot = path.join(HOME, 'code');
  if (cwd === codeRoot) return t.special.codeRootMisc;
  if (cwd.startsWith(codeRoot + '/')) {
    const rel = cwd.slice(codeRoot.length + 1).split('/');
    // ~/code/products/foo 取 foo，其余取第一段
    if (rel[0] === 'products' && rel.length > 1) return rel[1];
    return rel[0];
  }
  return path.basename(cwd) || t.special.home;
}

// 默认分类规则；可用 ~/.cchour/categories.json 覆盖，
// 格式: [["分类名", ["项目名关键词", ...], ["内容关键词", ...]?], ...]
// 第二个数组按顺序匹配项目名（小写包含）；可选的第三个数组用于杂项目录会话的
// 内容级分类——匹配会话首条用户消息，命中则把该会话从「杂项」挪进对应分类。
const DEFAULT_CATEGORY_RULES = [
  ['writing',
    ['wechat', 'publish', 'hugo', 'blog', 'article', 'tweet', 'newsletter', 'syndicat'],
    ['公众号', '文章', '博客', '润色', '推文', 'tweet', 'blog', 'newsletter']],
  ['video',
    ['video', 'multicam', 'dub', 'subtitle', 'overlay', 'transcrib', 'podcast', 'youtube', 'audio'],
    ['视频', '字幕', '配音', '剪辑', '转写', 'srt', 'video', 'youtube', '音频']],
  ['website',
    ['website', 'site'],
    ['网站', 'website', 'seo', '域名']],
  ['skills',
    ['skill', 'claude-code', 'claude-logs', 'memory', 'agents', '.claude', 'tmp', 'tool'],
    ['skill', 'mcp', 'plugin', '插件', '记忆', 'claude code', 'codex']],
  ['data',
    ['excelize', 'sheet', 'table', 'kingdee', 'dagster', 'data-export', 'maibei', 'bi', 'spreadsheet', 'workbook'],
    ['excel', 'sheet', 'table', 'spreadsheet', '报表', '表格', '工作簿', 'data pipeline', 'dagster']],
  ['browser',
    ['browser', 'harness', 'hermes', 'cua', 'chrome-open', 'inspect-the-current-in-app-browser', 'captcha'],
    ['browser', 'chrome', 'playwright', '自动化', '网页', '抓取', 'harness', 'agent']],
  ['finance',
    ['btc', 'portfolio', 'financial', 'fin-', 'trading', 'quant'],
    ['btc', 'finance', 'portfolio', 'trading', '量化', '金融', '股票', 'crypto']],
  ['vision',
    ['camera', 'cv2', 'cv', 'image-generation', 'multica', 'contentcreator', 'bfgf', 'video'],
    ['图片', '图像', '视觉', 'camera', 'cv', 'image', 'multicam', '生成图像']],
  ['platform',
    ['shein', 'tiktok', 'shoppee', 'shopee', 'salesforce'],
    ['电商', '店铺', '商品', '广告', 'shopee', 'tiktok', 'salesforce']],
  ['product',
    ['maybeai', 'app-factory', 'openclaw', 'claw', 'github', 'chat', 'apps', 'fastestai', 'teable', 'symphony', 'work-ai', 'work-github'],
    ['产品', '功能', '需求', 'app', 'product', 'github repo']],
  ['misc', ['杂项', 'downloads', 'desktop', 'documents', 'icloud', '临时', 'misc']],
  ['infra',
    ['infra', 'dns', 'cloudflare', 'server', 'backup', 'deploy'],
    ['cloudflare', 'dns', '服务器', '部署', 'deploy', '备份', 'backup', '代理', 'proxy', '网盘', 'launchd']],
];

function defaultCategoriesForLang(lang) {
  const t = tr(lang);
  return DEFAULT_CATEGORY_RULES.map(([id, projectKeys, contentKeys]) => [
    t.defaultCategories[id], projectKeys, contentKeys,
  ]);
}

function loadCategories(lang) {
  const p = path.join(CCHOUR_DIR, 'categories.json');
  try {
    const rules = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(rules) && rules.length) return rules;
  } catch {
    /* 无配置文件时用默认规则 */
  }
  return defaultCategoriesForLang(lang);
}

function expandUserPath(p, home = HOME) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (s === '~') return home;
  if (s.startsWith('~/')) return path.join(home, s.slice(2));
  return s;
}

function normalizeProjectName(s) {
  return String(s || '').trim().toLowerCase();
}

function normalizePathPrefix(p, home = HOME) {
  const expanded = expandUserPath(p, home);
  if (!expanded) return '';
  return path.resolve(expanded).replace(/\/+$/, '');
}

function hasWildcard(s) {
  return String(s || '').includes('*');
}

function wildcardToRegExp(pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function wildcardToContainsRegExp(pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^\\s\\])>"\']*');
  return new RegExp(escaped);
}

function normalizeExcludeConfig(config = {}, home = HOME) {
  const projectValues = Array.isArray(config.projects) ? config.projects : [];
  const pathValues = Array.isArray(config.paths) ? config.paths : [];
  return {
    projects: Array.from(new Set(projectValues.map(normalizeProjectName).filter(Boolean))).sort(),
    paths: Array.from(new Set(pathValues.map((p) => normalizePathPrefix(p, home)).filter(Boolean))).sort(),
  };
}

function loadExcludeConfig(file = EXCLUDES_FILE) {
  try {
    return normalizeExcludeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalizeExcludeConfig();
  }
}

function saveExcludeConfig(config, file = EXCLUDES_FILE) {
  const normalized = normalizeExcludeConfig(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

function addExcludeEntry(config, type, value, home = HOME) {
  const normalized = normalizeExcludeConfig(config, home);
  if (type === 'project') {
    const project = normalizeProjectName(value);
    if (project && !normalized.projects.includes(project)) normalized.projects.push(project);
  } else if (type === 'path') {
    const p = normalizePathPrefix(value, home);
    if (p && !normalized.paths.includes(p)) normalized.paths.push(p);
  }
  normalized.projects.sort();
  normalized.paths.sort();
  return normalized;
}

function valueMatchesPattern(candidate, pattern) {
  if (!candidate || !pattern) return false;
  if (hasWildcard(pattern)) return wildcardToRegExp(pattern).test(candidate);
  return candidate === pattern;
}

function pathMatchesPattern(candidate, pattern) {
  if (!candidate || !pattern) return false;
  const c = path.resolve(candidate).replace(/\/+$/, '');
  return valueMatchesPattern(c, pattern);
}

function textMentionsExcludedPath(text, excludes) {
  const body = String(text || '');
  if (!body) return false;
  const normalized = normalizeExcludeConfig(excludes);
  return normalized.paths.some((pattern) => {
    if (hasWildcard(pattern)) return wildcardToContainsRegExp(pattern).test(body);
    return body.includes(pattern);
  });
}

function shouldExcludeTaskDetail(task, excludes) {
  if (!task) return false;
  if (shouldExcludeSession({
    project: task.project,
    cwd: task.cwd,
    path: task.sourceFile,
    file: task.sourceFile,
  }, excludes)) return true;
  const texts = [
    task.spec,
    task.goal,
    task.result,
    ...(task.userTexts || []),
    ...(task.assistantTexts || []),
  ];
  return texts.some((text) => textMentionsExcludedPath(text, excludes));
}

function shouldExcludeSession(meta, excludes) {
  const normalized = normalizeExcludeConfig(excludes);
  const project = normalizeProjectName(meta && meta.project);
  if (project && normalized.projects.some((p) => valueMatchesPattern(project, p))) return true;
  const paths = [meta && meta.cwd, meta && meta.path, meta && meta.file].filter(Boolean);
  return normalized.paths.some((pattern) => paths.some((p) => pathMatchesPattern(expandUserPath(p), pattern)));
}

function cwdFromHead(head) {
  const m = String(head || '').match(/"cwd"\s*:\s*"([^"]+)"/);
  return m ? m[1].replace(/\/+$/, '') : '';
}

function makeCategorize(rules) {
  return (project) => {
    const p = project.toLowerCase();
    for (const [cat, keys] of rules) {
      for (const k of keys) {
        if (p.includes(k)) return cat;
      }
    }
    return null;
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

// 取 Claude Code 会话前几条真实用户消息的文本（头 256KB 内逐行解析）。
// 只看首条容易漏：不少会话第一句是"继续"、"看看这个"之类，主题在第 2-3 条才出现。
const CONTENT_MSGS = 3;

function claudeUserTexts(head) {
  const texts = [];
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
    texts.push(t.slice(0, 2000));
    if (texts.length >= CONTENT_MSGS) break;
  }
  return texts.join('\n');
}

function messageContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((x) => {
      if (!x) return '';
      if (typeof x.text === 'string') return x.text;
      if (x.type === 'input_text' && typeof x.text === 'string') return x.text;
      return '';
    }).filter(Boolean).join(' ');
  }
  return '';
}

function claudeLineText(j) {
  if (j.type === 'user' && j.message && !j.isMeta) {
    const text = clipText(messageContentText(j.message.content), 2000);
    if (text && !text.startsWith('Caveat:')) return { role: 'user', text };
  }
  if (j.type === 'assistant' && j.message) {
    const text = clipText(messageContentText(j.message.content), 2000);
    if (text) return { role: 'assistant', text };
  }
  if ((j.type === 'last-prompt' || j.lastPrompt) && typeof (j.lastPrompt || j.prompt) === 'string') {
    const text = clipText(j.lastPrompt || j.prompt, 2000);
    if (text) return { role: 'user', text };
  }
  return null;
}

// 取 Codex 会话前几条真实用户输入（rollout 格式：response_item payload 里
// role=user 的 input_text）。首条往往是 <environment_context> 环境信息，
// 文本里含 "codex" 等字样会误命中内容关键词，需整块剔除后再判断。
function codexUserTexts(head) {
  const texts = [];
  for (const line of head.split('\n')) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const p = j && j.payload;
    if (!p) continue;
    let t = '';
    if (j.type === 'response_item' && p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
      t = p.content.filter((x) => x && x.type === 'input_text').map((x) => x.text).join(' ');
    } else if (j.type === 'event_msg' && p.type === 'user_message' && typeof p.message === 'string') {
      t = p.message;
    } else {
      continue;
    }
    t = t
      .replace(/<(environment_context|user_instructions|turn_context)>[\s\S]*?<\/\1>/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .trim();
    if (!t) continue;
    t = t.slice(0, 2000);
    // 同一条输入可能以 response_item 和 event_msg 两种形式各出现一次，去重
    if (texts[texts.length - 1] !== t) texts.push(t);
    if (texts.length >= CONTENT_MSGS) break;
  }
  return texts.join('\n');
}

function codexPayloadText(j) {
  const p = j && j.payload;
  if (!p) return null;
  if (j.type === 'response_item' && p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
    const text = p.content.filter((x) => x && x.type === 'input_text').map((x) => x.text).join(' ');
    return { role: 'user', text: clipText(text, 2000) };
  }
  if (j.type === 'event_msg' && p.type === 'user_message' && typeof p.message === 'string') {
    return { role: 'user', text: clipText(p.message, 2000) };
  }
  if (j.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && Array.isArray(p.content)) {
    return { role: 'assistant', text: clipText(messageContentText(p.content), 2000) };
  }
  return null;
}

function trimCategorySuffix(project, t) {
  return project.replace(t.miscSuffix, '').trim();
}

function cleanCategoryName(name, fallback) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

function addLlmCandidate(llmCandidates, key, next) {
  if (!llmCandidates.has(key)) {
    llmCandidates.set(key, { tool: next.tool, project: next.project, samples: [] });
  }
  const cur = llmCandidates.get(key);
  for (const sample of next.samples || []) {
    if (!sample || cur.samples.includes(sample)) continue;
    cur.samples.push(sample);
    if (cur.samples.length >= 2) break;
  }
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

function buildActiveSegments(ts) {
  const u = uniqSorted(ts);
  const out = [];
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const prev = i > 0 ? u[i - 1] : null;
    const next = i < u.length - 1 ? u[i + 1] : null;
    if (next !== null && next - t <= GAP) {
      out.push({ start: t, end: next, seconds: next - t });
    } else if ((prev === null || t - prev > GAP) && next === null) {
      out.push({ start: t, end: t + MIN_EVENT, seconds: MIN_EVENT });
    } else if ((prev === null || t - prev > GAP) && next !== null && next - t > GAP) {
      out.push({ start: t, end: t + MIN_EVENT, seconds: MIN_EVENT });
    }
  }
  return out.filter((s) => s.seconds > 0);
}

function segmentOverlapSeconds(seg, lo, hi) {
  const start = Math.max(seg.start, lo);
  const end = Math.min(seg.end, hi);
  return Math.max(0, end - start);
}

function emptyTokenUsage() {
  return { input: 0, cachedInput: 0, output: 0, reasoningOutput: 0, total: 0, available: false };
}

function normalizeTokenUsage(raw) {
  if (!raw) return null;
  const input = +(raw.input_tokens || 0);
  const cachedInput = +(raw.cached_input_tokens || raw.cache_creation_input_tokens || 0)
    + +(raw.cache_read_input_tokens || 0);
  const output = +(raw.output_tokens || 0);
  const reasoningOutput = +(raw.reasoning_output_tokens || 0);
  const total = +(raw.total_tokens || 0) || input + cachedInput + output;
  return { input, cachedInput, output, reasoningOutput, total, available: true };
}

function extractTokenUsage(tool, j) {
  if (tool === 'Codex' && j.type === 'event_msg' && j.payload && j.payload.type === 'token_count') {
    return normalizeTokenUsage(j.payload.info && j.payload.info.last_token_usage);
  }
  if (tool === 'Claude Code' && j.type === 'assistant' && j.message && j.message.usage) {
    return normalizeTokenUsage(j.message.usage);
  }
  return null;
}

function sumTokenUsage(items) {
  const out = emptyTokenUsage();
  for (const item of items) {
    if (!item || !item.available) continue;
    out.input += item.input;
    out.cachedInput += item.cachedInput;
    out.output += item.output;
    out.reasoningOutput += item.reasoningOutput;
    out.total += item.total;
    out.available = true;
  }
  return out;
}

function cleanTaskText(s) {
  return String(s || '')
    .replace(/<(environment_context|user_instructions|turn_context)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(s, n = 260) {
  const clean = cleanTaskText(s);
  return clean.length > n ? `${clean.slice(0, n - 3)}...` : clean;
}

function inferGoal(spec) {
  const s = cleanTaskText(spec);
  const m = s.match(/\b(?:goal|objective|need|want|please|add|build|fix|report)\b[:\s]+(.{8,220})/i);
  return clipText(m ? m[1] : s, 220) || 'unknown';
}

function extractWorkflowCommandGoal(text) {
  const body = String(text || '');
  const m = body.match(/(?:^|\r?\n)\s*\/(?:goal|loop)\s+([^\r\n]{4,260})/i);
  return m ? clipText(m[1], 220) : '';
}

function extractWorkflowCommandSpec(text) {
  const body = String(text || '');
  const m = body.match(/(?:^|\r?\n)\s*\/spec\s+([^\r\n]{4,360})/i);
  if (m) return clipText(m[1], 320);
  return extractGeneratedPlanSpec(body);
}

function extractGeneratedPlanSpec(text) {
  const body = String(text || '');
  const generated = /(?:generated|created|wrote|saved|added|produced|drafted|updated|生成|创建|写入|保存|新增|产出|起草|更新)/i;
  const fileRe = /[^\s`"'<>，。；、]+(?:plan|计划)[^\s`"'<>，。；、]*\.md/giu;
  const files = [];
  let m;
  while ((m = fileRe.exec(body))) {
    const before = body.slice(Math.max(0, m.index - 80), m.index);
    if (!generated.test(before)) continue;
    const file = m[0].replace(/[),.;:!?，。；：！？]+$/u, '');
    if (file.includes('*')) continue;
    if (!files.includes(file)) files.push(file);
    if (files.length >= 3) break;
  }
  return files.length ? clipText(files.join(', '), 320) : '';
}

function extractTaskSummary(session) {
  const texts = [...(session.userTexts || []), ...(session.assistantTexts || [])];
  const explicitSpec = clipText(session.spec, 320)
    || texts.map(extractWorkflowCommandSpec).find(Boolean);
  const spec = explicitSpec || 'unknown';
  const explicitGoal = clipText(session.goal, 220)
    || (session.agentWorkflow ? '' : texts.map(extractWorkflowCommandGoal).find(Boolean));
  const goal = explicitGoal || 'unknown';
  const result = clipText(session.result || [...(session.assistantTexts || [])].reverse().find(Boolean), 320) || 'unknown';
  const agentWorkflow = Boolean(session.agentWorkflow || explicitSpec || explicitGoal);
  return { spec, goal, result, agentWorkflow };
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

function collect(contentCategorize, t, excludes = normalizeExcludeConfig()) {
  // tool -> Map(project -> [timestamps])
  const data = new Map();
  // 杂项会话经内容级分类拆出的合成项目名 -> 分类（覆盖按项目名的分类）
  const catOverride = new Map();
  const llmCandidates = new Map();
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
      const proj = claudeProjectName(d, t);
      const isMisc = isMiscClaudeDir(d);
      for (const fn of fs.readdirSync(full)) {
        if (!fn.endsWith('.jsonl')) continue;
        const file = path.join(full, fn);
        let p = proj;
        const head = readHead(file);
        if (shouldExcludeSession({ project: proj, cwd: cwdFromHead(head), file }, excludes)) continue;
        if (isMisc) {
          const content = claudeUserTexts(head);
          const cat = contentCategorize(content);
          if (cat) {
            p = `${trimCategorySuffix(proj, t)} · ${cat}`;
            catOverride.set(p, cat);
          } else if (content) {
            addLlmCandidate(llmCandidates, `Claude Code\t${proj}`, { tool: 'Claude Code', project: proj, samples: [content] });
          }
        }
        scanTimestamps(file, bucket('Claude Code', p));
      }
    }
  }

  for (const rootDir of CODEX_DIRS) {
    walkJsonl(rootDir, (file) => {
      const head = readHead(file);
      const proj = codexProjectName(head, t);
      if (shouldExcludeSession({ project: proj, cwd: cwdFromHead(head), file }, excludes)) return;
      let p = proj;
      if (codeMiscProjects(t).has(proj)) {
        const content = codexUserTexts(head);
        const cat = contentCategorize(content);
        if (cat) {
          p = `${trimCategorySuffix(proj, t)} · ${cat}`;
          catOverride.set(p, cat);
        } else if (content) {
          addLlmCandidate(llmCandidates, `Codex\t${proj}`, { tool: 'Codex', project: proj, samples: [content] });
        }
      }
      scanTimestamps(file, bucket('Codex', p));
    });
  }

  for (const [tool, projects] of data) {
    for (const [proj, ts] of projects) {
      if (!ts.length || catOverride.has(proj)) continue;
      const key = `${tool}\t${proj}`;
      addLlmCandidate(llmCandidates, key, { tool, project: proj, samples: [] });
    }
  }

  return { data, catOverride, llmCandidates };
}

function scanSessionFile(file, tool, project, category, textExtractor) {
  const timestamps = [];
  const tokenItems = [];
  const userTexts = [];
  const assistantTexts = [];
  let sessionId = path.basename(file, '.jsonl');
  let cwd = '';
  let result = '';
  let goal = '';
  let source = '';
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (const line of source.split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.sessionId) sessionId = j.sessionId;
    if (j.cwd) cwd = j.cwd;
    if (j.timestamp) {
      const ts = Date.parse(j.timestamp);
      if (!Number.isNaN(ts)) timestamps.push(ts / 1000);
    }
    const usage = extractTokenUsage(tool, j);
    if (usage) tokenItems.push(usage);
    if (j.type === 'event_msg' && j.payload && j.payload.type === 'thread_goal_updated' && j.payload.goal) {
      goal = j.payload.goal.objective || goal;
    }
    if (j.type === 'event_msg' && j.payload && j.payload.type === 'task_complete') {
      result = j.payload.last_agent_message || result;
    }
    const text = textExtractor ? textExtractor(j) : null;
    if (text && text.role === 'user' && text.text && userTexts.length < 5 && userTexts[userTexts.length - 1] !== text.text) {
      userTexts.push(text.text);
      const workflowGoal = extractWorkflowCommandGoal(text.text);
      if (workflowGoal && !goal) goal = workflowGoal;
    }
    if (text && text.role === 'assistant' && text.text) {
      assistantTexts.push(text.text);
      if (assistantTexts.length > 5) assistantTexts.shift();
    }
  }
  if (!timestamps.length) return null;
  return {
    id: `${tool}:${sessionId}:${file}`,
    tool,
    project,
    category,
    sessionId,
    turnId: null,
    sourceFile: file,
    cwd,
    firstTs: Math.min(...timestamps),
    lastTs: Math.max(...timestamps),
    timestamps,
    tokens: sumTokenUsage(tokenItems),
    userTexts,
    assistantTexts,
    goal,
    result,
    agentWorkflow: Boolean(goal),
  };
}

function readJsonl(file, cb) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  for (const line of source.split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    cb(j);
  }
  return true;
}

function extractCodexTaskDetails(file, project, category) {
  const turns = new Map();
  const fallbackTexts = { userTexts: [], assistantTexts: [] };
  let sessionId = path.basename(file, '.jsonl');
  let currentTurn = null;
  let sawBoundary = false;
  const ensureTurn = (turnId, ts) => {
    const id = turnId || currentTurn || 'session';
    if (!turns.has(id)) {
      turns.set(id, {
        id: `Codex:${sessionId}:${id}:${file}`,
        tool: 'Codex',
        project,
        category,
        sessionId,
        turnId: id === 'session' ? null : id,
        sourceFile: file,
        firstTs: ts || null,
        lastTs: ts || null,
        timestamps: [],
        tokenItems: [],
        userTexts: [],
        assistantTexts: [],
        goal: '',
        goalStatus: '',
        goalTokensUsed: null,
        goalTimeUsedSeconds: null,
        result: '',
      });
    }
    return turns.get(id);
  };

  const ok = readJsonl(file, (j) => {
    if (j.payload && j.payload.id) sessionId = j.payload.id;
    if (j.timestamp) {
      const ts = Date.parse(j.timestamp);
      const sec = Number.isNaN(ts) ? null : ts / 1000;
      const p = j.payload || {};
      if (j.type === 'event_msg' && p.turn_id) currentTurn = p.turn_id;
      if (j.type === 'event_msg' && p.type === 'task_started') {
        sawBoundary = true;
        currentTurn = p.turn_id || currentTurn || `turn-${turns.size + 1}`;
        const turn = ensureTurn(currentTurn, sec);
        if (sec) {
          turn.firstTs = turn.firstTs == null ? sec : Math.min(turn.firstTs, sec);
          turn.lastTs = turn.lastTs == null ? sec : Math.max(turn.lastTs, sec);
          turn.timestamps.push(sec);
        }
        return;
      }
      const turn = ensureTurn(currentTurn || p.turn_id || 'session', sec);
      if (sec) {
        turn.firstTs = turn.firstTs == null ? sec : Math.min(turn.firstTs, sec);
        turn.lastTs = turn.lastTs == null ? sec : Math.max(turn.lastTs, sec);
        turn.timestamps.push(sec);
      }
      if (j.type === 'event_msg' && p.type === 'thread_goal_updated' && p.goal) {
        turn.goal = p.goal.objective || turn.goal;
        turn.goalStatus = p.goal.status || turn.goalStatus;
        turn.goalTokensUsed = p.goal.tokensUsed == null ? turn.goalTokensUsed : p.goal.tokensUsed;
        turn.goalTimeUsedSeconds = p.goal.timeUsedSeconds == null ? turn.goalTimeUsedSeconds : p.goal.timeUsedSeconds;
        turn.agentWorkflow = true;
      }
      if (j.type === 'event_msg' && p.type === 'task_complete') {
        sawBoundary = true;
        turn.result = p.last_agent_message || turn.result;
        currentTurn = null;
      }
      const usage = extractTokenUsage('Codex', j);
      if (usage) turn.tokenItems.push(usage);
      const text = codexPayloadText(j);
      if (text && text.role === 'user' && text.text) {
        if (fallbackTexts.userTexts[fallbackTexts.userTexts.length - 1] !== text.text) fallbackTexts.userTexts.push(text.text);
        if (turn.userTexts[turn.userTexts.length - 1] !== text.text) turn.userTexts.push(text.text);
        const workflowGoal = extractWorkflowCommandGoal(text.text);
        if (workflowGoal && !turn.goal) {
          turn.goal = workflowGoal;
          turn.agentWorkflow = true;
        }
      }
      if (text && text.role === 'assistant' && text.text) {
        fallbackTexts.assistantTexts.push(text.text);
        turn.assistantTexts.push(text.text);
        if (turn.assistantTexts.length > 5) turn.assistantTexts.shift();
      }
    }
  });
  if (!ok) return [];
  if (!sawBoundary) {
    const fallback = scanSessionFile(file, 'Codex', project, category, codexPayloadText);
    return fallback ? [Object.assign(fallback, extractTaskSummary(fallback))] : [];
  }
  return Array.from(turns.values()).filter((turn) => turn.timestamps.length).map((turn) => {
    const tokens = sumTokenUsage(turn.tokenItems);
    const session = {
      ...turn,
      tokens,
      userTexts: turn.userTexts.length ? turn.userTexts : fallbackTexts.userTexts,
      assistantTexts: turn.assistantTexts.length ? turn.assistantTexts : fallbackTexts.assistantTexts,
    };
    return { ...session, ...extractTaskSummary(session) };
  });
}

function extractClaudeTaskDetails(file, project, category) {
  const session = scanSessionFile(file, 'Claude Code', project, category, claudeLineText);
  return session ? [{ ...session, ...extractTaskSummary(session) }] : [];
}

function collectDetailedSessions(contentCategorize, categorize, t, excludes = normalizeExcludeConfig()) {
  const out = [];
  const categoryForProject = (project) => categorize(project) || t.other;

  if (isDir(CLAUDE_DIR)) {
    for (const d of fs.readdirSync(CLAUDE_DIR).sort()) {
      const full = path.join(CLAUDE_DIR, d);
      if (!isDir(full)) continue;
      const proj = claudeProjectName(d, t);
      const isMisc = isMiscClaudeDir(d);
      for (const fn of fs.readdirSync(full)) {
        if (!fn.endsWith('.jsonl')) continue;
        const file = path.join(full, fn);
        const head = readHead(file);
        if (shouldExcludeSession({ project: proj, cwd: cwdFromHead(head), file }, excludes)) continue;
        let p = proj;
        let cat = categoryForProject(proj);
        if (isMisc) {
          const content = claudeUserTexts(head);
          const c = contentCategorize(content);
          if (c) {
            p = `${trimCategorySuffix(proj, t)} · ${c}`;
            cat = c;
          }
        }
        out.push(...extractClaudeTaskDetails(file, p, cat));
      }
    }
  }

  for (const rootDir of CODEX_DIRS) {
    walkJsonl(rootDir, (file) => {
      const head = readHead(file);
      const proj = codexProjectName(head, t);
      if (shouldExcludeSession({ project: proj, cwd: cwdFromHead(head), file }, excludes)) return;
      let p = proj;
      let cat = categoryForProject(proj);
      if (codeMiscProjects(t).has(proj)) {
        const c = contentCategorize(codexUserTexts(head));
        if (c) {
          p = `${trimCategorySuffix(proj, t)} · ${c}`;
          cat = c;
        }
      }
      out.push(...extractCodexTaskDetails(file, p, cat));
    });
  }

  return out;
}

function buildReport(data, categorize, catOverride, ndays, range = {}, otherLabel = 'Other') {
  const toolSeconds = new Map();
  const toolDaily = new Map();
  const toolWeekly = new Map();
  const toolMonthly = new Map();
  const toolHourly = new Map();
  const toolDayHour = new Map(); // tool -> Map("YYYY-MM-DD|H" -> sec)，供报表内按范围重算 24 小时分布
  const projRows = []; // {tool, proj, sec, cat, first, last, daily}
  const catSeconds = new Map();

  for (const [tool, projects] of data) {
    const allTs = [];
    for (const [proj, ts] of projects) {
      if (!ts.length) continue;
      const sec = activeSeconds(ts);
      if (sec < 60) continue;
      const cat = catOverride.get(proj) || categorize(proj) || otherLabel;
      catSeconds.set(cat, (catSeconds.get(cat) || 0) + sec);
      let first = Infinity;
      let last = -Infinity;
      for (const t of ts) {
        if (t < first) first = t;
        if (t > last) last = t;
      }
      projRows.push({
        tool, proj, sec, cat, first, last,
        daily: dailyActive(ts),
        dayHour: bucketActive(ts, (t) => `${dayKey(t)}|${new Date(t * 1000).getHours()}`),
      });
      for (const t of ts) allTs.push(t);
    }
    toolSeconds.set(tool, activeSeconds(allTs));
    toolDaily.set(tool, dailyActive(allTs));
    toolWeekly.set(tool, weeklyActive(allTs));
    toolMonthly.set(tool, monthlyActive(allTs));
    toolHourly.set(tool, hourlyActive(allTs));
    toolDayHour.set(tool, bucketActive(allTs, (t) => `${dayKey(t)}|${new Date(t * 1000).getHours()}`));
  }

  projRows.sort((a, b) => b.sec - a.sec);

  return {
    toolSeconds, toolDaily, toolWeekly, toolMonthly, toolHourly, toolDayHour,
    projRows, catSeconds, daysOpt: ndays,
    range: {
      since: range.since ? dayKey(range.since.getTime() / 1000) : null,
      until: range.until ? dayKey(range.until.getTime() / 1000) : null,
    },
  };
}

function buildNightlyTasks(sessions, since, until, startClock = '20:00', endClock = '08:00') {
  const lo = since.getTime() / 1000;
  const hi = until.getTime() / 1000;
  const start = parseClockArg('--night-start', startClock, 'en');
  const end = parseClockArg('--night-end', endClock, 'en');
  const tasks = [];
  for (const session of sessions) {
    const segments = buildActiveSegments(session.timestamps || []);
    const seconds = segments.reduce((sum, seg) => sum + segmentOverlapSeconds(seg, lo, hi), 0);
    if (seconds < 60) continue;
    const firstTs = Math.max(session.firstTs || lo, lo);
    const lastTs = Math.min(session.lastTs || hi, hi);
    tasks.push({
      ...session,
      firstTs,
      lastTs,
      seconds,
      hours: +(seconds / 3600).toFixed(2),
      windowDate: nightWindowDate(firstTs, start.h, end.h),
    });
  }
  tasks.sort((a, b) => (a.firstTs || 0) - (b.firstTs || 0));
  return tasks;
}

function mergeWorkflowRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = [row.tool, row.project, row.spec || 'unknown', row.goal || 'unknown'].join('\0');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row, tokens: row.tokens || emptyTokenUsage() });
      continue;
    }
    existing.firstTs = Math.min(existing.firstTs || row.firstTs, row.firstTs || existing.firstTs);
    existing.lastTs = Math.max(existing.lastTs || row.lastTs, row.lastTs || existing.lastTs);
    existing.seconds += row.seconds || 0;
    existing.hours = +(existing.seconds / 3600).toFixed(2);
    existing.tokens = sumTokenUsage([existing.tokens, row.tokens]);
    if ((row.lastTs || 0) >= (existing.lastTs || 0) && row.result && row.result !== 'unknown') {
      existing.result = row.result;
    }
  }
  return Array.from(byKey.values());
}

function workflowSummaryPayload(rows) {
  return (rows || []).map((row, i) => ({
    id: String(row.id || `row-${i + 1}`),
    tool: row.tool || '',
    project: row.project || '',
    spec: row.spec || 'unknown',
    goal: row.goal || 'unknown',
    result: row.result || 'unknown',
    hours: row.hours == null ? +(+(row.seconds || 0) / 3600).toFixed(2) : row.hours,
    tokens: row.tokens && row.tokens.available ? row.tokens.total : null,
  }));
}

function cleanWorkflowSummaryField(value, fallback, maxLen) {
  const text = clipText(value, maxLen);
  if (!text || text === 'unknown') return fallback || 'unknown';
  return text;
}

async function applyLlmWorkflowSummaries(rows, llmSummarize) {
  if (!llmSummarize || !rows || !rows.length) return rows || [];
  const payload = workflowSummaryPayload(rows);
  try {
    const mapping = await llmSummarize(payload);
    if (!mapping || !mapping.size) return rows;
    return rows.map((row, i) => {
      const id = String(row.id || `row-${i + 1}`);
      const next = mapping.get(id);
      if (!next) return row;
      return {
        ...row,
        spec: cleanWorkflowSummaryField(next.spec, row.spec || 'unknown', 320),
        goal: cleanWorkflowSummaryField(next.goal, row.goal || 'unknown', 220),
        result: cleanWorkflowSummaryField(next.result, row.result || 'unknown', 320),
      };
    });
  } catch {
    return rows;
  }
}

function buildTaskRowsForReport(sessions, lo = -Infinity, hi = Infinity, limit = 300, excludes = normalizeExcludeConfig()) {
  const rows = [];
  for (const session of sessions) {
    if (shouldExcludeTaskDetail(session, excludes)) continue;
    const hasWorkflowEvidence = Boolean(
      session.agentWorkflow
      || (session.spec && session.spec !== 'unknown')
      || (session.goal && session.goal !== 'unknown')
    );
    if (!hasWorkflowEvidence) continue;
    const segments = buildActiveSegments(session.timestamps || []);
    const seconds = Number.isFinite(lo) || Number.isFinite(hi)
      ? segments.reduce((sum, seg) => sum + segmentOverlapSeconds(seg, lo, hi), 0)
      : segments.reduce((sum, seg) => sum + seg.seconds, 0);
    if (seconds < 60) continue;
    const firstTs = Number.isFinite(lo) ? Math.max(session.firstTs || lo, lo) : session.firstTs;
    const lastTs = Number.isFinite(hi) ? Math.min(session.lastTs || hi, hi) : session.lastTs;
    const row = {
      ...session,
      firstTs,
      lastTs,
      seconds,
      hours: +(seconds / 3600).toFixed(2),
      tokens: session.tokens || emptyTokenUsage(),
      spec: session.spec || 'unknown',
      goal: session.goal || 'unknown',
      result: session.result || 'unknown',
    };
    if (shouldExcludeTaskDetail(row, excludes)) continue;
    rows.push(row);
  }
  const merged = mergeWorkflowRows(rows);
  merged.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  return merged.slice(0, limit);
}

// 报表内嵌数据：每工具按日 / 按日×小时，每项目按日（工作分类由前端按项目行聚合得出），
// 页面里切换时间范围时就地重算所有数字。秒数取整以减小体积。
// 语义：按「日桶归属」求和（增量记到后一事件所在天），选「全部」与 CLI 总数完全一致，
// 子范围与 CLI --since/--until 仅在跨午夜的会话边界处有分钟级差异。
function buildEmbedData({ toolSeconds, toolDaily, toolDayHour, projRows, range, daysOpt }) {
  const round = (m) => {
    const o = {};
    for (const [k, v] of Array.from(m.entries()).sort()) o[k] = Math.round(v);
    return o;
  };
  const roundDayHour = (m) => {
    const dayHour = {};
    for (const [k, v] of m || []) {
      const [d, h] = k.split('|');
      if (!dayHour[d]) dayHour[d] = new Array(24).fill(0);
      dayHour[d][+h] += Math.round(v);
    }
    return dayHour;
  };
  const tools = {};
  let minDay = null;
  for (const t of Array.from(toolSeconds.keys()).sort((a, b) => toolSeconds.get(b) - toolSeconds.get(a))) {
    const daily = round(toolDaily.get(t));
    for (const k in daily) if (!minDay || k < minDay) minDay = k;
    tools[t] = { daily, dayHour: roundDayHour(toolDayHour.get(t)) };
  }
  const now = new Date();
  const genDay = dayKey(now.getTime() / 1000);
  return {
    genDay,
    genTime: `${genDay} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    minDay: minDay || genDay,
    daysOpt,
    range,
    tools,
    nightly: arguments[0].nightly || null,
    projects: projRows.map((r) => ({
      tool: r.tool,
      proj: r.proj,
      cat: r.cat,
      daily: round(r.daily),
      dayHour: roundDayHour(r.dayHour),
    })),
    tasks: (arguments[0].tasks || []).map((task) => ({
      id: task.id,
      tool: task.tool,
      project: task.project,
      cat: task.category,
      windowDate: task.windowDate,
      firstTs: task.firstTs,
      lastTs: task.lastTs,
      seconds: Math.round(task.seconds || 0),
      hours: +(task.seconds / 3600).toFixed(2),
      tokens: task.tokens || emptyTokenUsage(),
      spec: task.spec || 'unknown',
      goal: task.goal || 'unknown',
      result: task.result || 'unknown',
    })),
  };
}

function renderHtml(report, lang) {
  const t = tr(lang);
  const embed = buildEmbedData(report);
  // </script> 防注入：JSON 里的 < 转义后再嵌入
  const json = JSON.stringify(embed).replace(/</g, '\\u003c');
  const r = report.range;
  const clipNote = r && (r.since || r.until)
    ? ` · ${t.clippedNote} ${r.since || t.units.earliest} ~ ${r.until || t.units.today}`
    : '';

  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.appTitle}</title>
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
  .bar-top { font-size:10px; line-height:1; color:var(--muted); margin-bottom:5px; white-space:nowrap; }
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
  .proj-track { flex:1; height:18px; background:#f3f3f0; border-radius:9px; overflow:hidden; position:relative; min-width:0; }
  .proj-fill { height:100%; border-radius:9px; min-width:2px; }
  .proj-val { width:230px; font-size:12px; text-align:right; flex-shrink:0; line-height:1.3; }
  .muted { color:var(--muted); }
  .controls { margin-top:18px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .chip { border:1px solid var(--line); background:var(--card); border-radius:16px; padding:5px 13px;
          font-size:13px; color:var(--ink); cursor:pointer; font-family:inherit; }
  .chip:hover { border-color:#c5c5c0; }
  .chip.active { background:var(--ink); color:#fff; border-color:var(--ink); }
  .custom { font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px; margin-left:6px; }
  .custom input { border:1px solid var(--line); border-radius:8px; padding:4px 8px; font-size:13px;
                  color:var(--ink); background:var(--card); font-family:inherit; }
  .task-row { padding:12px 0; border-bottom:1px solid var(--line); font-size:13px; line-height:1.45; }
  .task-row:last-child { border-bottom:none; }
  .task-row strong { font-size:14px; }
  .task-row div + div { margin-top:4px; }
  footer { margin-top:48px; font-size:12px; color:var(--muted); text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${t.appTitle}</h1>
  <div class="sub">${t.generatedAt} ${embed.genTime} · <span id="range-label"></span>${clipNote} · ${t.dataFrom} · ${t.activeFormula}</div>

  <div class="controls">
    <button class="chip" data-preset="all">${t.controls.all}</button>
    <button class="chip" data-preset="today">${t.controls.today}</button>
    <button class="chip" data-preset="week">${t.controls.week}</button>
    <button class="chip" data-preset="lastweek">${t.controls.lastweek}</button>
    <button class="chip" data-preset="month">${t.controls.month}</button>
    <button class="chip" data-preset="lastmonth">${t.controls.lastmonth}</button>
    <button class="chip" data-preset="d7">${t.controls.d7}</button>
    <button class="chip" data-preset="d30">${t.controls.d30}</button>
    <button class="chip" data-preset="d90">${t.controls.d90}</button>
    <span class="custom">${t.controls.custom} <input type="date" id="d-since"> ~ <input type="date" id="d-until"></span>
    <label class="custom"><input type="checkbox" id="night-only"> ${t.nightly}</label>
    <span class="custom">${t.timeFilter} <input type="time" id="t-start" value="20:00"> ~ <input type="time" id="t-end" value="08:00"></span>
  </div>

  <div class="cards" id="cards"></div>

  <h2 id="h-daily"></h2>
  <div class="panel">
    <div class="chart" id="chart-daily"></div>
    <div class="legend" id="legend-daily"></div>
  </div>

  <h2 id="h-weekly"></h2>
  <div class="panel">
    <div class="chart" id="chart-weekly" style="height:180px"></div>
    <div class="legend" id="legend-weekly"></div>
  </div>

  <h2 id="h-monthly"></h2>
  <div class="panel">
    <div class="chart" id="chart-monthly" style="height:180px"></div>
    <div class="legend" id="legend-monthly"></div>
  </div>

  <h2>${t.headings.hourly}</h2>
  <div class="panel hourchart">
    <div class="chart" id="chart-hourly" style="height:150px"></div>
    <div class="legend" id="legend-hourly"></div>
  </div>

  <h2>${t.headings.categories}</h2>
  <div class="panel" id="cats"></div>

  <h2>${t.headings.projects}</h2>
  <div class="panel" id="projects"></div>

  <h2>${t.taskDetails}</h2>
  <div class="panel" id="tasks"></div>

  <footer>${t.footer}</footer>
</div>

<script type="application/json" id="cchour-data">${json}</script>
<script>
'use strict';
/* 范围切换全部在前端完成：按「日桶归属」对内嵌的按日数据求和。 */
var D = JSON.parse(document.getElementById('cchour-data').textContent);
var T = ${JSON.stringify(t).replace(/</g, '\\u003c')};
var TOOL_COLORS = { 'Claude Code': '#D97757', 'Codex': '#4A7DBE' };
var CAT_COLORS = ['#D97757', '#4A7DBE', '#5BA88B', '#C9A227', '#9B7BB8', '#D86F8C', '#8A9BA8'];
var TOOLS = Object.keys(D.tools);

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function hrs(sec) { var h = sec / 3600; return h >= 100 ? h.toFixed(0) : h.toFixed(1); }
function fmt(s, vars) { return s.replace(/\\{(\\w+)\\}/g, function (_, k) { return vars[k] == null ? '' : String(vars[k]); }); }
function fmtH(sec) { var h = sec / 3600; return h >= 1 ? h.toFixed(1) + ' ' + T.units.hours : Math.round(sec / 60) + ' ' + T.units.minutes; }
function fmtBar(sec) {
  if (sec <= 0) return '';
  var h = sec / 3600;
  if (h >= 10) return h.toFixed(0) + 'h';
  if (h >= 1) return h.toFixed(1) + 'h';
  return Math.round(sec / 60) + 'm';
}
function color(t) { return TOOL_COLORS[t] || '#888'; }
function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
function inR(k, lo, hi) { return (!lo || k >= lo) && (!hi || k <= hi); }
function sumRange(daily, lo, hi) { var s = 0; for (var k in daily) if (inR(k, lo, hi)) s += daily[k]; return s; }
function timeMinutes(s) { var p = (s || '00:00').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
function allDay() { return cur.tStart === cur.tEnd; }
function timeFilterEnabled() { return document.getElementById('night-only').checked; }
function hourInTime(h) {
  if (!timeFilterEnabled() || allDay()) return true;
  var start = timeMinutes(cur.tStart), end = timeMinutes(cur.tEnd), min = h * 60;
  if (start < end) return min >= start && min < end;
  return min >= start || min < end;
}
function sumDayHours(dayHour, day) {
  var arr = dayHour && dayHour[day], s = 0;
  if (!arr) return 0;
  for (var h = 0; h < 24; h++) if (hourInTime(h)) s += arr[h] || 0;
  return s;
}
function sumRangeTime(item, lo, hi) {
  if (!timeFilterEnabled() || allDay() || !item.dayHour) return sumRange(item.daily, lo, hi);
  var s = 0;
  for (var day in item.dayHour) if (inR(day, lo, hi)) s += sumDayHours(item.dayHour, day);
  return s;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}
function tokenText(tokens) {
  if (!tokens || !tokens.available) return 'tokens n/a';
  return tokens.total.toLocaleString() + ' ' + T.tokens;
}

var cur = { since: null, until: null, tStart: '20:00', tEnd: '08:00' };

function stackedBars(keys, tools, valFn, labelFn, height) {
  var max = 1, totals = [], i, t, v;
  for (i = 0; i < keys.length; i++) {
    v = 0;
    for (t = 0; t < tools.length; t++) v += valFn(tools[t], keys[i]);
    totals.push(v);
    if (v > max) max = v;
  }
  var html = '';
  for (i = 0; i < keys.length; i++) {
    var segs = '';
    for (t = 0; t < tools.length; t++) {
      v = valFn(tools[t], keys[i]);
      var h = (v / max) * height;
      if (h > 0.5) segs += '<div class="seg" style="height:' + h.toFixed(1) + 'px;background:' + color(tools[t]) + '"></div>';
    }
    var label = fmtBar(totals[i]);
    html += '<div class="bar" title="' + keys[i] + ' · ' + (totals[i] / 3600).toFixed(1) + 'h">' +
      '<div class="bar-top">' + label + '</div><div class="bar-stack">' + segs + '</div><div class="bar-x">' + labelFn(keys[i]) + '</div></div>';
  }
  return html;
}

function render() {
  var lo = cur.since, hi = cur.until, i;
  var toolSec = {}, total = 0;
  TOOLS.forEach(function (t) { toolSec[t] = sumRangeTime(D.tools[t], lo, hi); total += toolSec[t]; });
  var tools = TOOLS.slice().sort(function (a, b) { return toolSec[b] - toolSec[a]; });

  var start = lo && lo > D.minDay ? lo : D.minDay;
  var end = hi && hi < D.genDay ? hi : D.genDay;
  if (end < start) end = start;
  var spanDays = Math.max(1, Math.round((parseDay(end) - parseDay(start)) / 86400000) + 1);

  document.getElementById('range-label').textContent =
    ((lo || hi) ? T.rangeLabel + ' ' + (lo || T.units.earliest) + ' ~ ' + (hi || T.units.today) : T.rangeLabel + ' ' + T.allData) +
    (!timeFilterEnabled() || allDay() ? '' : ' · ' + T.timeFilter + ' ' + cur.tStart + '~' + cur.tEnd);

  // 总览卡片
  var cards = '<div class="card"><div class="card-label">' + T.cards.total + '</div>' +
    '<div class="card-value">' + hrs(total) + '<span class="unit">' + T.cards.hours + '</span></div>' +
    '<div class="card-sub">' + start + ' ~ ' + end + ' · ' + spanDays + ' ' + T.cards.days + '</div></div>';
  tools.forEach(function (t) {
    var pct = total ? (toolSec[t] / total) * 100 : 0;
    cards += '<div class="card"><div class="card-label"><span class="dot" style="background:' + color(t) + '"></span>' + t + '</div>' +
      '<div class="card-value">' + hrs(toolSec[t]) + '<span class="unit">' + T.cards.hours + '</span></div>' +
      '<div class="card-sub">' + T.cards.share + ' ' + pct.toFixed(0) + '% · ' + T.cards.dailyAvg + ' ' + (toolSec[t] / 3600 / spanDays).toFixed(1) + ' ' + T.cards.hours + '</div></div>';
  });
  document.getElementById('cards').innerHTML = cards;

  var legend = tools.map(function (t) {
    return '<span class="lg"><span class="dot" style="background:' + color(t) + '"></span>' + t + '</span>';
  }).join('');
  ['legend-daily', 'legend-weekly', 'legend-monthly', 'legend-hourly'].forEach(function (id) {
    document.getElementById(id).innerHTML = legend;
  });

  // 每日图：锚定范围末尾，最多 daysOpt 根
  var endD = parseDay(end);
  var days = [];
  for (i = D.daysOpt - 1; i >= 0; i--) {
    var ds = dayStr(addDays(endD, -i));
    if (ds < start) continue;
    days.push(ds);
  }
  document.getElementById('h-daily').textContent = fmt(T.headings.daily, { n: days.length });
  document.getElementById('chart-daily').innerHTML = stackedBars(days, tools, function (t, k) {
    return (!timeFilterEnabled() || allDay()) ? (D.tools[t].daily[k] || 0) : sumDayHours(D.tools[t].dayHour, k);
  }, function (k) { return k.slice(5).replace('-', '/'); }, 160);

  // 周 / 月聚合（只含范围内的天）
  var wkByTool = {}, moByTool = {};
  tools.forEach(function (t) {
    var w = {}, m = {}, daily = D.tools[t].daily, k;
    for (k in daily) {
      if (!inR(k, lo, hi)) continue;
      var dayVal = (!timeFilterEnabled() || allDay()) ? daily[k] : sumDayHours(D.tools[t].dayHour, k);
      var wk = dayStr(mondayOf(parseDay(k)));
      w[wk] = (w[wk] || 0) + dayVal;
      var mk = k.slice(0, 7);
      m[mk] = (m[mk] || 0) + dayVal;
    }
    wkByTool[t] = w;
    moByTool[t] = m;
  });
  var weeks = [], endWeek = mondayOf(endD), startWeek = dayStr(mondayOf(parseDay(start)));
  for (i = 11; i >= 0; i--) {
    var wkk = dayStr(addDays(endWeek, -7 * i));
    if (wkk < startWeek) continue;
    weeks.push(wkk);
  }
  document.getElementById('h-weekly').textContent = fmt(T.headings.weekly, { n: weeks.length });
  document.getElementById('chart-weekly').innerHTML = stackedBars(weeks, tools, function (t, k) {
    return wkByTool[t][k] || 0;
  }, function (k) { return k.slice(5).replace('-', '/'); }, 150);

  var months = [], startMonth = start.slice(0, 7);
  for (i = 11; i >= 0; i--) {
    var md = new Date(endD.getFullYear(), endD.getMonth() - i, 1);
    var mk2 = md.getFullYear() + '-' + pad2(md.getMonth() + 1);
    if (mk2 < startMonth) continue;
    months.push(mk2);
  }
  document.getElementById('h-monthly').textContent = fmt(T.headings.monthly, { n: months.length });
  document.getElementById('chart-monthly').innerHTML = stackedBars(months, tools, function (t, k) {
    return moByTool[t][k] || 0;
  }, function (k) { return k.slice(2).replace('-', '/'); }, 150);

  // 24 小时分布
  var hourByTool = {};
  tools.forEach(function (t) {
    var arr = [], j;
    for (j = 0; j < 24; j++) arr.push(0);
    var dh = D.tools[t].dayHour, k;
    for (k in dh) {
      if (!inR(k, lo, hi)) continue;
      for (j = 0; j < 24; j++) if (hourInTime(j)) arr[j] += dh[k][j];
    }
    hourByTool[t] = arr;
  });
  var hourKeys = [];
  for (i = 0; i < 24; i++) hourKeys.push(i);
  document.getElementById('chart-hourly').innerHTML = stackedBars(hourKeys, tools, function (t, h) {
    return hourByTool[t][h];
  }, function (h) { return String(h); }, 120);

  // 工作分类（由项目行聚合，口径与 CLI 一致：分类只含具体项目，不含工具并集差额）
  var catSec = {};
  D.projects.forEach(function (p) {
    var s = sumRangeTime(p, lo, hi);
    if (s > 0) catSec[p.cat] = (catSec[p.cat] || 0) + s;
  });
  var cats = Object.keys(catSec).sort(function (a, b) { return catSec[b] - catSec[a]; });
  var catTotal = cats.reduce(function (a, c) { return a + catSec[c]; }, 0) || 1;
  var catRows = '';
  cats.forEach(function (c, idx) {
    var pct = (catSec[c] / catTotal) * 100;
    var col = CAT_COLORS[idx % CAT_COLORS.length];
    catRows += '<div class="hrow"><div class="hname"><span class="dot" style="background:' + col + '"></span>' + c + '</div>' +
      '<div class="htrack"><div class="hfill" style="width:' + pct.toFixed(1) + '%;background:' + col + '"></div></div>' +
      '<div class="hval">' + fmtH(catSec[c]) + ' · ' + pct.toFixed(0) + '%</div></div>';
  });
  document.getElementById('cats').innerHTML = catRows || '<div class="muted" style="font-size:13px">' + T.units.none + '</div>';

  // Top 项目
  var rows = [];
  D.projects.forEach(function (p) {
    var s = sumRangeTime(p, lo, hi);
    if (s <= 0) return;
    var lastDay = null, k;
    for (k in p.daily) if (inR(k, lo, hi) && (!lastDay || k > lastDay)) lastDay = k;
    rows.push({ proj: p.proj, tool: p.tool, cat: p.cat, sec: s, last: lastDay });
  });
  rows.sort(function (a, b) { return b.sec - a.sec; });
  var top = rows.slice(0, 20);
  var maxProj = top.length ? top[0].sec : 1;
  var projHtml = '';
  top.forEach(function (r) {
    var pct = maxProj ? (r.sec / maxProj) * 100 : 0;
    projHtml += '<div class="hrow"><div class="hname" title="' + r.proj + '">' + r.proj + '</div>' +
      '<div class="proj-track"><div class="proj-fill" style="width:' + pct.toFixed(1) + '%;background:' + color(r.tool) + '"></div></div>' +
      '<div class="proj-val">' + fmtH(r.sec) + ' <span class="muted">· ' + r.cat + ' · ' + T.projectsRecent + ' ' + r.last.slice(5) + '</span></div></div>';
  });
  document.getElementById('projects').innerHTML = projHtml || '<div class="muted" style="font-size:13px">' + T.units.none + '</div>';

  var taskRows = [];
  (D.tasks || []).forEach(function (task) {
    var firstDay = dayStr(new Date(task.firstTs * 1000));
    var lastDay = dayStr(new Date(task.lastTs * 1000));
    if (lo && lastDay < lo) return;
    if (hi && firstDay > hi) return;
    if (timeFilterEnabled() && !allDay()) {
      var h = new Date((task.firstTs || task.lastTs) * 1000).getHours();
      if (!hourInTime(h)) return;
    }
    taskRows.push(task);
  });
  taskRows.sort(function (a, b) { return b.seconds - a.seconds; });
  document.getElementById('tasks').innerHTML = taskRows.length ? taskRows.map(function (task) {
    return '<div class="task-row">' +
      '<div><strong>' + esc(task.project) + '</strong> <span class="muted">' + esc(task.tool) + ' · ' + fmtH(task.seconds) + ' · ' + esc(tokenText(task.tokens)) + '</span></div>' +
      '<div><span class="muted">' + T.spec + ':</span> ' + esc(task.spec) + '</div>' +
      '<div><span class="muted">' + T.goal + ':</span> ' + esc(task.goal) + '</div>' +
      '<div><span class="muted">' + T.result + ':</span> ' + esc(task.result) + '</div>' +
    '</div>';
  }).join('') : '<div class="muted" style="font-size:13px">' + T.units.none + '</div>';
}

function presetRange(name) {
  var t = new Date();
  var today = dayStr(t);
  var mon = mondayOf(t);
  if (name === 'today') return [today, today];
  if (name === 'week') return [dayStr(mon), today];
  if (name === 'lastweek') { var lm = addDays(mon, -7); return [dayStr(lm), dayStr(addDays(lm, 6))]; }
  if (name === 'month') return [today.slice(0, 8) + '01', today];
  if (name === 'lastmonth') {
    return [dayStr(new Date(t.getFullYear(), t.getMonth() - 1, 1)), dayStr(new Date(t.getFullYear(), t.getMonth(), 0))];
  }
  if (name === 'd7') return [dayStr(addDays(t, -6)), today];
  if (name === 'd30') return [dayStr(addDays(t, -29)), today];
  if (name === 'd90') return [dayStr(addDays(t, -89)), today];
  return [null, null]; // all
}

function setRange(since, until, activeChip) {
  cur.since = since;
  cur.until = until;
  document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
  if (activeChip) activeChip.classList.add('active');
  document.getElementById('d-since').value = since || '';
  document.getElementById('d-until').value = until || '';
  render();
}

document.querySelectorAll('.chip').forEach(function (c) {
  c.addEventListener('click', function () {
    var r = presetRange(c.dataset.preset);
    setRange(r[0], r[1], c);
  });
});

function onCustom() {
  var s = document.getElementById('d-since').value || null;
  var u = document.getElementById('d-until').value || null;
  if (s && u && s > u) { var tmp = s; s = u; u = tmp; }
  cur.tStart = document.getElementById('t-start').value || '00:00';
  cur.tEnd = document.getElementById('t-end').value || '00:00';
  setRange(s, u, null);
}
document.getElementById('d-since').addEventListener('change', onCustom);
document.getElementById('d-until').addEventListener('change', onCustom);
document.getElementById('t-start').addEventListener('change', onCustom);
document.getElementById('t-end').addEventListener('change', onCustom);
document.getElementById('night-only').addEventListener('change', function () {
  if (this.checked) {
    document.getElementById('t-start').value = D.nightly && D.nightly.start ? D.nightly.start : '20:00';
    document.getElementById('t-end').value = D.nightly && D.nightly.end ? D.nightly.end : '08:00';
  } else {
    document.getElementById('t-start').value = '20:00';
    document.getElementById('t-end').value = '08:00';
  }
  onCustom();
});

if (D.nightly) {
  var startDay = D.nightly.since ? dayStr(new Date(D.nightly.since)) : null;
  var endDay = D.nightly.until ? dayStr(new Date(D.nightly.until)) : startDay;
  document.getElementById('night-only').checked = true;
  document.getElementById('t-start').value = D.nightly.start || '20:00';
  document.getElementById('t-end').value = D.nightly.end || '08:00';
  cur.tStart = document.getElementById('t-start').value;
  cur.tEnd = document.getElementById('t-end').value;
  setRange(startDay, endDay, null);
} else {
  setRange(null, null, document.querySelector('.chip[data-preset="all"]'));
}
</script>
</body>
</html>`;
}

// --json 输出：报表数据序列化为 JSON，方便其他脚本消费
function renderJson({ toolSeconds, toolDaily, toolWeekly, toolMonthly, toolHourly, projRows, catSeconds, range, tasks, nightly }) {
  const m2o = (m) => Object.fromEntries(Array.from(m.entries()).sort());
  const tools = {};
  for (const [t, sec] of toolSeconds) {
    tools[t] = {
      seconds: sec,
      hours: +(sec / 3600).toFixed(2),
      daily: m2o(toolDaily.get(t)),
      weekly: m2o(toolWeekly.get(t)),
      monthly: m2o(toolMonthly.get(t)),
      hourly: m2o(toolHourly.get(t)),
    };
  }
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    gapSeconds: GAP,
    since: range ? range.since : null,
    until: range ? range.until : null,
    totalSeconds: Array.from(toolSeconds.values()).reduce((a, b) => a + b, 0),
    tools,
    categories: m2o(catSeconds),
    projects: projRows.map((r) => ({
      tool: r.tool,
      project: r.proj,
      seconds: r.sec,
      category: r.cat,
      firstTs: r.first,
      lastTs: r.last,
    })),
    nightly: nightly || null,
    tokens: sumTokenUsage((tasks || []).map((task) => task.tokens)),
    tasks: (tasks || []).map((task) => ({
      tool: task.tool,
      project: task.project,
      category: task.category,
      sessionId: task.sessionId,
      turnId: task.turnId,
      windowDate: task.windowDate,
      seconds: Math.round(task.seconds),
      hours: +(task.seconds / 3600).toFixed(2),
      tokens: task.tokens || emptyTokenUsage(),
      spec: task.spec || 'unknown',
      goal: task.goal || 'unknown',
      result: task.result || 'unknown',
      firstTs: task.firstTs,
      lastTs: task.lastTs,
      sourceFile: task.sourceFile,
    })),
  }, null, 2);
}

function logOtherSummary(report, t) {
  const others = report.projRows.filter((r) => r.cat === t.other).sort((a, b) => b.sec - a.sec);
  if (!others.length) return;
  const top = others.slice(0, 8).map((r) => `${r.proj} (${(r.sec / 3600).toFixed(1)}h)`).join(', ');
  const hours = (others.reduce((sum, r) => sum + r.sec, 0) / 3600).toFixed(1);
  console.error(fill(t.llm.otherSummary, { projects: others.length, hours, top }));
}

function printHelp(lang) {
  if (lang === 'en') {
    console.log(`cchour v${pkg.version} - ${tr('en').helpTitle}

${tr('en').helpUsage}

${tr('en').helpOptions}
  -o, --output <file>   Output HTML path (default ./cchour-report.html)
      --days <N>        Show the last N days in the daily chart (default 30)
      --since <date>    Only count activity on/after this date, format YYYY-MM-DD
      --until <date>    Only count activity through this date, inclusive
      --week [W]        Weekly shortcut: no value=this week; last=last full week;
                        YYYY-MM-DD=the week containing that date
      --month [M]       Monthly shortcut: no value=this month; last=last full month;
                        YYYY-MM=a specific month
      --lang <en|cn>    UI/help language for the generated report and CLI messages
      --llm-category    Ask an OpenAI-compatible LLM to improve category mapping
      --llm-workflow-summary
                        Ask an OpenAI-compatible LLM to rewrite workflow summaries
      --llm-model <m>   Model for LLM options (or use CCHOUR_LLM_MODEL)
      --add-exclude-project <name>
                        Globally exclude a project/repo name from future reports
      --add-exclude-path <path>
                        Globally exclude sessions under a path from future reports
      --list-excludes   Show global excludes from ~/.cchour/excludes.json
      --open            Open the generated report in the default browser
      --json            Output JSON instead of HTML
  -h, --help            Show help
  -v, --version         Show version

Custom category rules can be defined in ~/.cchour/categories.json:
  [["Category", ["project keyword", "..."], ["content keyword", "..."]?], ...]
Project keywords match against lowercased project names in order.
The optional third array is used for content-level classification of misc sessions.`);
    return;
  }
  console.log(`cchour v${pkg.version} — ${tr('cn').helpTitle}

${tr('cn').helpUsage}

${tr('cn').helpOptions}
  -o, --output <文件>   输出 HTML 路径（默认 ./cchour-report.html）
      --days <N>        每日图表显示最近 N 天（默认 30）
      --since <日期>    只统计该日期（含）之后的活动，格式 YYYY-MM-DD
      --until <日期>    只统计该日期（含当天整天）之前的活动，格式 YYYY-MM-DD
      --week [W]        周报快捷范围：不带值=本周（周一起到今天）；last=上一整周；
                        YYYY-MM-DD=该日期所在的周（周一 ~ 周日，不超过今天）
      --month [M]       月报快捷范围：不带值=本月；last=上个整月；YYYY-MM=指定月
      --lang <en|cn>    生成报表与 CLI 提示语言
      --llm-category    使用 OpenAI 兼容 LLM 改进分类映射
      --llm-workflow-summary
                        使用 OpenAI 兼容 LLM 改写工作流摘要
      --llm-model <m>   LLM 功能使用的模型（或环境变量 CCHOUR_LLM_MODEL）
      --add-exclude-project <名称>
                        全局排除某个项目/repo 名称
      --add-exclude-path <路径>
                        全局排除某个路径下的会话
      --list-excludes   显示 ~/.cchour/excludes.json 中的全局排除项
      --open            生成后用系统默认浏览器打开
      --json            输出 JSON 而非 HTML（默认打到 stdout，配 -o 则写文件）
  -h, --help            显示帮助
  -v, --version         显示版本

分类规则可用 ~/.cchour/categories.json 自定义，格式:
  [["分类名", ["项目名关键词", ...], ["内容关键词", ...]?], ...]
按顺序对项目名做小写包含匹配；可选第三个数组用于杂项目录会话的内容级分类。`);
}

function parseDayArg(name, s, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  let d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  // new Date 会把 2026-13-99 这类值自动进位，回验分量拦住
  if (d && (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3])) d = null;
  if (!d || isNaN(d.getTime())) {
    console.error(`${name} ${tr(lang).helpDateFmt} ${s}`);
    process.exit(1);
  }
  return d;
}

function parseClockArg(name, s, lang) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  const h = m ? +m[1] : NaN;
  const min = m ? +m[2] : NaN;
  if (!m || h < 0 || h > 23 || min < 0 || min > 59) {
    console.error(`${name} expects HH:MM, got: ${s}`);
    process.exit(1);
  }
  return { h, min };
}

function isInTimeWindow(hour, minute, startHour, startMinute, endHour, endMinute) {
  const cur = hour * 60 + minute;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (start === end) return true;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function expandNightlyRange(value, startClock = '20:00', endClock = '08:00', now = new Date(), lang = 'cn') {
  const start = parseClockArg('--night-start', startClock, lang);
  const end = parseClockArg('--night-end', endClock, lang);
  let base;
  if (!value || value === true || value === 'last') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMin = start.h * 60 + start.min;
    const endMin = end.h * 60 + end.min;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const offset = startMin >= endMin
      ? (nowMin >= endMin ? -1 : -2)
      : (nowMin >= endMin ? 0 : -1);
    base = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  } else if (value === 'today') {
    base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    base = parseDayArg('--nightly', value, lang);
  }
  const since = new Date(base.getFullYear(), base.getMonth(), base.getDate(), start.h, start.min, 0, 0);
  const crossesMidnight = (start.h * 60 + start.min) >= (end.h * 60 + end.min);
  const endBase = crossesMidnight
    ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
    : base;
  const until = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), end.h, end.min, 0, 0);
  return { since, until, startClock, endClock };
}

function nightWindowDate(ts, startHour = 20, endHour = 8) {
  const d = new Date(ts * 1000);
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (startHour > endHour && d.getHours() < endHour) {
    base.setDate(base.getDate() - 1);
  }
  return dayKey(base.getTime() / 1000);
}

// --week/--month 展开成 since/until。周一为一周起点（与周图一致），范围不超过今天。
function expandShortcutRange(opts) {
  const t = tr(opts.lang);
  if (!opts.week && !opts.month) return;
  if (opts.week && opts.month) {
    console.error(t.helpWeekMonthConflict);
    process.exit(1);
  }
  if (opts.since || opts.until) {
    console.error(`--${opts.week ? 'week' : 'month'} ${t.helpShortcutConflict}`);
    process.exit(1);
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let since, until;
  if (opts.week) {
    let anchor;
    if (opts.week === true) anchor = today;
    else if (opts.week === 'last') anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    else anchor = parseDayArg('--week', opts.week, opts.lang);
    const dow = (anchor.getDay() + 6) % 7; // 周一=0
    since = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - dow);
    until = new Date(since.getFullYear(), since.getMonth(), since.getDate() + 6);
  } else {
    let y, mo;
    if (opts.month === true) { y = today.getFullYear(); mo = today.getMonth(); }
    else if (opts.month === 'last') { y = today.getFullYear(); mo = today.getMonth() - 1; }
    else {
      const m = /^(\d{4})-(\d{2})$/.exec(opts.month);
      if (!m || +m[2] < 1 || +m[2] > 12) {
        console.error(`${t.helpMonthFmt} ${opts.month}`);
        process.exit(1);
      }
      y = +m[1];
      mo = +m[2] - 1;
    }
    since = new Date(y, mo, 1);
    until = new Date(y, mo + 1, 0);
  }
  if (since > today) {
    console.error(`--${opts.week ? 'week' : 'month'} ${t.helpFutureRange}`);
    process.exit(1);
  }
  if (until > today) until = today;
  opts.since = since;
  opts.until = until;
}

function parseArgs(argv) {
  const opts = {
    output: 'cchour-report.html', outputSet: false, days: 30, open: false, json: false,
    since: null, until: null, week: null, month: null,
    lang: 'cn', llmCategory: false, llmWorkflowSummary: false,
    llmModel: process.env.CCHOUR_LLM_MODEL || '', excludeAction: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lang' && argv[i + 1]) {
      opts.lang = String(argv[i + 1]).toLowerCase();
      break;
    }
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      opts.output = argv[++i];
      opts.outputSet = true;
    } else if (a === '--days') opts.days = Math.max(1, parseInt(argv[++i], 10) || 30);
    else if (a === '--since') opts.since = parseDayArg('--since', argv[++i], opts.lang);
    else if (a === '--until') opts.until = parseDayArg('--until', argv[++i], opts.lang);
    else if (a === '--week' || a === '--month') {
      const next = argv[i + 1];
      opts[a.slice(2)] = next && !next.startsWith('-') ? argv[++i] : true;
    }
    else if (a === '--lang') {
      const next = (argv[++i] || '').toLowerCase();
      if (next !== 'cn' && next !== 'en') {
        console.error(`--lang must be en or cn, got: ${next || '(empty)'}`);
        process.exit(1);
      }
      opts.lang = next;
    } else if (a === '--llm-category') opts.llmCategory = true;
    else if (a === '--llm-workflow-summary') opts.llmWorkflowSummary = true;
    else if (a === '--llm-model') opts.llmModel = argv[++i] || '';
    else if (a === '--add-exclude-project') opts.excludeAction = { type: 'project', value: argv[++i] || '' };
    else if (a === '--add-exclude-path') opts.excludeAction = { type: 'path', value: argv[++i] || '' };
    else if (a === '--list-excludes') opts.excludeAction = { type: 'list' };
    else if (a === '--open') opts.open = true;
    else if (a === '--json') opts.json = true;
    else if (a === '-h' || a === '--help') {
      printHelp(opts.lang);
      process.exit(0);
    } else if (a === '-v' || a === '--version') {
      console.log(pkg.version);
      process.exit(0);
    } else {
      console.error(`${tr(opts.lang).helpUnknownArg}: ${a}\n`);
      printHelp(opts.lang);
      process.exit(1);
    }
  }
  if (!opts.output) {
    console.error(tr(opts.lang).helpMissingOutput);
    process.exit(1);
  }
  expandShortcutRange(opts);
  if (opts.since && opts.until && opts.since > opts.until) {
    console.error(tr(opts.lang).helpSinceAfterUntil);
    process.exit(1);
  }
  return opts;
}

function createLlmCategoryClient(opts, rules, t) {
  if (!opts.llmCategory) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(t.llm.missingApiKey);
    process.exit(1);
  }
  const model = opts.llmModel;
  if (!model) {
    console.error(t.llm.missingModel);
    process.exit(1);
  }
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const categories = Array.from(new Set(rules.map((r) => r[0]).filter(Boolean)));

  return async (candidates) => {
    const payload = candidates.map((candidate) => ({
      project: candidate.project,
      tool: candidate.tool,
      context: candidate.samples.filter(Boolean).slice(0, 2).join('\n---\n') || '',
    }));
    const prompt = opts.lang === 'en'
      ? `You are organizing AI coding work into practical report categories.
Existing categories you should reuse when they fit:
${categories.join(', ')}

Rules:
1. Prefer an existing category when it is a reasonable fit.
2. If none fits, create a short broad category name in English, reusable across multiple projects.
3. Avoid "Other", "Misc", "Unknown", or one-off category names that just repeat the project name.
4. Aim for a small stable taxonomy, roughly 4 to 10 categories for the whole set.
5. Return JSON only.

Return this shape:
{"categories":["cat1","cat2"],"mappings":[{"project":"name","category":"chosen category","reason":"short"}]}

Projects to classify:
${JSON.stringify(payload, null, 2)}`
      : `你要把 AI 编程项目归类为适合报表展示的工作分类。
优先复用这些已有分类：
${categories.join('、')}

规则：
1. 如果已有分类基本合适，优先复用已有分类。
2. 如果都不合适，可以新建简短、宽泛、可复用的中文分类名。
3. 不要使用“其他”“杂项”“未知”，也不要直接把项目名当分类名。
4. 整体尽量收敛成 4 到 10 个稳定分类。
5. 只返回 JSON。

返回格式：
{"categories":["分类1","分类2"],"mappings":[{"project":"项目名","category":"选中的分类","reason":"简短原因"}]}

待分类项目：
${JSON.stringify(payload, null, 2)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: 'You are a strict classifier. Respond with JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
    if (!parsed || !Array.isArray(parsed.mappings)) return null;
    const mapping = new Map();
    for (const item of parsed.mappings) {
      if (!item || !item.project) continue;
      const category = cleanCategoryName(item.category, t.other);
      if (!category) continue;
      mapping.set(item.project, category);
    }
    return mapping;
  };
}

function createLlmWorkflowSummaryClient(opts, t) {
  if (!opts.llmWorkflowSummary) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(t.llm.missingApiKey);
    process.exit(1);
  }
  const model = opts.llmModel;
  if (!model) {
    console.error(t.llm.missingModel);
    process.exit(1);
  }
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  return async (rows) => {
    const prompt = opts.lang === 'en'
      ? `Rewrite AI agent workflow report rows for a concise engineering time report.

Important:
1. Use only the provided row fields. Do not invent specs, goals, results, paths, commits, files, or tests.
2. If a field is "unknown" and there is not enough evidence, keep it as "unknown".
3. Keep each field short and specific. Prefer one sentence or phrase.
4. Preserve the row id exactly.
5. Return JSON only.

Return this shape:
{"summaries":[{"id":"row id","spec":"short spec or unknown","goal":"short goal or unknown","result":"short result or unknown"}]}

Rows:
${JSON.stringify(rows, null, 2)}`
      : `请把 AI agent 工作流报表行改写成更适合工程时间报表的简洁摘要。

重要规则：
1. 只能使用提供的字段，不要编造 spec、goal、result、路径、commit、文件或测试。
2. 如果字段是 "unknown" 且证据不足，保持 "unknown"。
3. 每个字段保持简短、具体，优先一句话或短语。
4. 必须原样保留 row id。
5. 只返回 JSON。

返回格式：
{"summaries":[{"id":"row id","spec":"简短 spec 或 unknown","goal":"简短 goal 或 unknown","result":"简短 result 或 unknown"}]}

报表行：
${JSON.stringify(rows, null, 2)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: 'You rewrite report rows. Respond with JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
    if (!parsed || !Array.isArray(parsed.summaries)) return null;
    const mapping = new Map();
    for (const item of parsed.summaries) {
      if (!item || !item.id) continue;
      mapping.set(String(item.id), {
        spec: item.spec,
        goal: item.goal,
        result: item.result,
      });
    }
    return mapping;
  };
}

async function applyLlmCategoryMapping(data, catOverride, llmCandidates, categorize, llmClassify, t) {
  if (!llmClassify) return;
  console.error(t.llm.classifying);
  const pending = [];
  for (const [, candidate] of llmCandidates) {
    if (catOverride.has(candidate.project)) continue;
    if (categorize(candidate.project)) continue;
    pending.push(candidate);
  }
  if (!pending.length) return;
  try {
    const mapping = await llmClassify(pending);
    if (!mapping || !mapping.size) return;
    let applied = 0;
    const categoriesUsed = new Set();
    for (const candidate of pending) {
      const cat = cleanCategoryName(mapping.get(candidate.project), t.other);
      if (!cat || cat === t.other) continue;
      categoriesUsed.add(cat);
      if (codeMiscProjects(t).has(candidate.project)) {
        const synthetic = `${trimCategorySuffix(candidate.project, t)} · ${cat}`;
        const toolProjects = data.get(candidate.tool);
        const ts = toolProjects && toolProjects.get(candidate.project);
        if (ts && ts.length) {
          toolProjects.delete(candidate.project);
          const next = toolProjects.get(synthetic) || [];
          next.push(...ts);
          toolProjects.set(synthetic, next);
          catOverride.set(synthetic, cat);
          applied++;
        }
      } else {
        catOverride.set(candidate.project, cat);
        applied++;
      }
    }
    if (applied > 0) console.error(fill(t.llm.summary, { projects: applied, categories: categoriesUsed.size }));
  } catch {
    // LLM is best-effort; keep local keyword mapping if the request fails.
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t = tr(opts.lang);
  const t0 = Date.now();

  if (opts.excludeAction) {
    const current = loadExcludeConfig();
    if (opts.excludeAction.type === 'list') {
      console.log(JSON.stringify(current, null, 2));
      return;
    }
    const next = addExcludeEntry(current, opts.excludeAction.type, opts.excludeAction.value);
    saveExcludeConfig(next);
    console.error(`${t.statusGenerated} ${EXCLUDES_FILE}`);
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  console.error(t.statusScanning);
  const rules = loadCategories(opts.lang);
  const projectCategorize = makeCategorize(rules);
  const contentCategorize = makeContentCategorize(rules);
  const excludes = loadExcludeConfig();
  const { data, catOverride, llmCandidates } = collect(contentCategorize, t, excludes);
  await applyLlmCategoryMapping(data, catOverride, llmCandidates, projectCategorize, createLlmCategoryClient(opts, rules, t), t);

  // --since/--until：按本地时区过滤事件，until 含当天整天
  const lo = opts.since ? opts.since.getTime() / 1000 : -Infinity;
  const hi = opts.until ? opts.until.getTime() / 1000 + 86400 : Infinity;
  if (opts.since || opts.until) {
    for (const projects of data.values()) {
      for (const [proj, ts] of projects) {
        const kept = ts.filter((t) => t >= lo && t < hi);
        if (kept.length) projects.set(proj, kept);
        else projects.delete(proj);
      }
    }
  }

  for (const [tool, projects] of data) {
    let n = 0;
    for (const ts of projects.values()) n += ts.length;
    console.error(`  ${tool}: ${projects.size} ${t.statusProjects}, ${n} ${t.statusEvents}`);
  }

  const report = buildReport(data, projectCategorize, catOverride, opts.days, {
    since: opts.since, until: opts.until,
  }, t.other);
  const detailSessions = collectDetailedSessions(contentCategorize, projectCategorize, t, excludes);
  report.tasks = buildTaskRowsForReport(detailSessions, lo, hi, 300, excludes);
  if (opts.llmWorkflowSummary && report.tasks.length) {
    console.error(t.llm.summarizing);
    report.tasks = await applyLlmWorkflowSummaries(report.tasks, createLlmWorkflowSummaryClient(opts, t));
  }
  logOtherSummary(report, t);

  const sorted = Array.from(report.toolSeconds.entries()).sort((a, b) => b[1] - a[1]);
  for (const [tool, s] of sorted) console.error(`  ${tool}: ${(s / 3600).toFixed(1)} ${t.cards.hours}`);

  if (opts.json) {
    const json = renderJson(report);
    if (opts.outputSet) {
      const outPath = path.resolve(opts.output);
      fs.writeFileSync(outPath, json + '\n', 'utf8');
      console.error(`${t.statusGenerated} ${outPath} (${t.statusElapsed} ${((Date.now() - t0) / 1000).toFixed(1)}${t.sec})`);
    } else {
      console.log(json);
      console.error(`${t.statusElapsed} ${((Date.now() - t0) / 1000).toFixed(1)}${t.sec}`);
    }
    return;
  }

  const html = renderHtml(report, opts.lang);
  const outPath = path.resolve(opts.output);
  fs.writeFileSync(outPath, html, 'utf8');
  console.error(`${t.statusGenerated} ${outPath} (${t.statusElapsed} ${((Date.now() - t0) / 1000).toFixed(1)}${t.sec})`);

  if (opts.open) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', outPath] : [outPath];
    spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  activeSeconds,
  applyLlmWorkflowSummaries,
  bucketActive,
  buildActiveSegments,
  buildTaskRowsForReport,
  dayKey,
  addExcludeEntry,
  expandNightlyRange,
  extractTaskSummary,
  extractTokenUsage,
  isInTimeWindow,
  normalizeExcludeConfig,
  parseArgs,
  renderJson,
  renderHtml,
  segmentOverlapSeconds,
  shouldExcludeSession,
  sumTokenUsage,
};
