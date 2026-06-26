# 夜间代理报告实施计划

> **给代理工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务逐项实现本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 新增一个 20:00-08:00 的夜间代理任务报告，包含 spec、goal、result、活跃小时数和 token 统计，并同时支持 HTML 与 CLI/JSON 输出。

**架构：** 尽可能保留默认报告中现有的快速“仅时间戳”路径，然后为夜间/时间过滤报告引入更丰富的会话扫描器。将活动表示为紧凑的活跃时间段，使浏览器过滤器可以按日期和一天中的时间重新计算，包括跨午夜窗口。将 spec/goal/result 提取视为对本地日志文本的有界、尽力而为的摘要层；如果字段无法推断，则显示 `unknown`，不要编造内容。

**技术栈：** Node.js >=18，内置 `fs/path/os/child_process`，内置 `node:test`，零运行时依赖。

---

## 文件结构

- 修改：`bin/cchour.js`
  - 添加受 `if (require.main === module)` 保护的可测试导出。
  - 添加精确的时间窗口解析和夜间范围展开。
  - 添加 JSONL 会话扫描，用于任务详情和 token 使用量。
  - 对 Codex，优先使用 `task_started` / `task_complete` 作为任务边界，使用 `thread_goal_updated.payload.goal.objective` 作为目标，使用 `task_complete.last_agent_message` 作为结果。
  - 对 Claude Code，将每个会话文件视为最安全的任务边界；只有当实现可以避免重复计算父任务和旁路工作时，才有意识地纳入嵌套的 `subagents/*.jsonl`。
  - 添加活跃时间段生成和聚合。
  - 添加日期范围、时间范围/夜间预设的 HTML 控件。
  - 扩展 JSON 输出，加入 `nightly`、`tasks`、`tokens` 和过滤后的总计。
- 创建：`test/cchour.test.js`
  - 使用 Node 内置测试覆盖夜间窗口、跨午夜过滤、token 聚合和任务摘要提取。
- 修改：`package.json`
  - 添加 `"test": "node --test"` 脚本。
- 修改：`README.md`
  - 记录 `--nightly`、时间过滤器、任务详情字段和 token 统计注意事项。

## 任务 1：让 CLI 内部逻辑可测试

**文件：**
- 修改：`bin/cchour.js`
- 修改：`package.json`
- 创建：`test/cchour.test.js`

- [ ] **步骤 1：编写失败的冒烟测试**

创建 `test/cchour.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cchour = require('../bin/cchour.js');

test('exports testable helpers without running main', () => {
  assert.equal(typeof cchour.dayKey, 'function');
  assert.equal(typeof cchour.activeSeconds, 'function');
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test`

预期：失败，因为 require `bin/cchour.js` 会执行 CLI，而不是导出 helper。

- [ ] **步骤 3：保护 CLI 入口并导出 helper**

在 `bin/cchour.js` 底部，将无条件的 `main().catch(...)` 代码块替换为：

```js
if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  activeSeconds,
  bucketActive,
  dayKey,
  parseArgs,
  renderJson,
};
```

- [ ] **步骤 4：添加测试脚本**

在 `package.json` 中，将 scripts 改为：

```json
"scripts": {
  "start": "node bin/cchour.js",
  "test": "node --test"
}
```

- [ ] **步骤 5：运行测试**

运行：`npm test`

预期：通过。

## 任务 2：添加夜间窗口解析

**文件：**
- 修改：`bin/cchour.js`
- 修改：`test/cchour.test.js`

- [ ] **步骤 1：编写失败测试**

追加到 `test/cchour.test.js`：

```js
test('nightly date maps to 20:00 start and next-day 08:00 end in local time', () => {
  const r = cchour.expandNightlyRange('2026-06-23', '20:00', '08:00');
  assert.equal(r.since.getFullYear(), 2026);
  assert.equal(r.since.getMonth(), 5);
  assert.equal(r.since.getDate(), 23);
  assert.equal(r.since.getHours(), 20);
  assert.equal(r.until.getFullYear(), 2026);
  assert.equal(r.until.getMonth(), 5);
  assert.equal(r.until.getDate(), 24);
  assert.equal(r.until.getHours(), 8);
});

test('time window detects cross-midnight membership', () => {
  assert.equal(cchour.isInTimeWindow(21, 0, 20, 0, 8, 0), true);
  assert.equal(cchour.isInTimeWindow(2, 30, 20, 0, 8, 0), true);
  assert.equal(cchour.isInTimeWindow(12, 0, 20, 0, 8, 0), false);
});
```

- [ ] **步骤 2：运行测试**

运行：`npm test`

预期：失败，因为 helper 还不存在。

- [ ] **步骤 3：实现 helper**

添加到 `bin/cchour.js` 中 `parseDayArg` 附近：

```js
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
    base = now.getHours() < end.h || (now.getHours() === end.h && now.getMinutes() < end.min)
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
      : today;
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
```

导出 `expandNightlyRange` 和 `isInTimeWindow`。

- [ ] **步骤 4：添加 CLI 选项**

扩展 `parseArgs` 的默认值：

```js
nightly: null, nightStart: '20:00', nightEnd: '08:00',
```

添加解析分支：

```js
else if (a === '--nightly') {
  const next = argv[i + 1];
  opts.nightly = next && !next.startsWith('-') ? argv[++i] : true;
} else if (a === '--night-start') opts.nightStart = argv[++i] || '20:00';
else if (a === '--night-end') opts.nightEnd = argv[++i] || '08:00';
```

在 `expandShortcutRange(opts)` 之后添加：

```js
if (opts.nightly) {
  if (opts.since || opts.until || opts.week || opts.month) {
    console.error('--nightly cannot be combined with --since/--until/--week/--month');
    process.exit(1);
  }
  const r = expandNightlyRange(opts.nightly, opts.nightStart, opts.nightEnd, new Date(), opts.lang);
  opts.since = r.since;
  opts.until = r.until;
}
```

- [ ] **步骤 5：运行测试**

运行：`npm test`

预期：通过。

## 任务 3：添加会话详情扫描器和 Token 统计

**文件：**
- 修改：`bin/cchour.js`
- 修改：`test/cchour.test.js`

- [ ] **步骤 1：编写 token 聚合测试**

追加到 `test/cchour.test.js`：

```js
test('codex token_count uses last_token_usage to avoid double counting cumulative totals', () => {
  const state = {};
  const first = cchour.extractTokenUsage('Codex', {
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: {
      input_tokens: 10, cached_input_tokens: 3, output_tokens: 2, reasoning_output_tokens: 1, total_tokens: 12,
    } } },
  }, state);
  const second = cchour.extractTokenUsage('Codex', {
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: {
      input_tokens: 7, cached_input_tokens: 4, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 12,
    } } },
  }, state);
  assert.deepEqual(cchour.sumTokenUsage([first, second]), {
    input: 17, cachedInput: 7, output: 7, reasoningOutput: 1, total: 24, available: true,
  });
});

test('claude assistant usage maps cache fields into token totals', () => {
  const usage = cchour.extractTokenUsage('Claude Code', {
    type: 'assistant',
    message: { usage: {
      input_tokens: 5, cache_creation_input_tokens: 11, cache_read_input_tokens: 13,
      output_tokens: 7,
    } },
  }, {});
  assert.deepEqual(usage, {
    input: 5, cachedInput: 24, output: 7, reasoningOutput: 0, total: 36, available: true,
  });
});
```

- [ ] **步骤 2：运行测试**

运行：`npm test`

预期：失败，因为 token helper 还不存在。

- [ ] **步骤 3：实现 token helper**

在 `bin/cchour.js` 中 `activeSeconds` 之后添加：

```js
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

function extractTokenUsage(tool, j, state) {
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
```

导出 `extractTokenUsage` 和 `sumTokenUsage`。

- [ ] **步骤 4：添加 JSONL 会话扫描器**

添加一个新函数，在请求详情时解析单个会话文件：

```js
function scanSessionFile(file, tool, project, category, textExtractor) {
  const timestamps = [];
  const tokenItems = [];
  const userTexts = [];
  const assistantTexts = [];
  const state = {};
  let sessionId = path.basename(file, '.jsonl');
  let cwd = '';
  let lineNo = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    lineNo++;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.sessionId) sessionId = j.sessionId;
    if (j.cwd) cwd = j.cwd;
    if (j.timestamp) {
      const ts = Date.parse(j.timestamp);
      if (!Number.isNaN(ts)) timestamps.push(ts / 1000);
    }
    const usage = extractTokenUsage(tool, j, state);
    if (usage) tokenItems.push(usage);
    const text = textExtractor ? textExtractor(j) : null;
    if (text && text.role === 'user' && userTexts.length < 5) userTexts.push(text.text);
    if (text && text.role === 'assistant') {
      assistantTexts.push(text.text);
      if (assistantTexts.length > 5) assistantTexts.shift();
    }
  }
  return {
    id: `${tool}:${sessionId}:${file}`,
    tool,
    project,
    category,
    file,
    cwd,
    firstTs: timestamps.length ? Math.min(...timestamps) : null,
    lastTs: timestamps.length ? Math.max(...timestamps) : null,
    timestamps,
    tokens: sumTokenUsage(tokenItems),
    userTexts,
    assistantTexts,
  };
}
```

仅将此用于 `opts.nightly` 或未来的 `opts.details`，这样常规报告仍然保留当前的流式时间戳扫描器。

- [ ] **步骤 5：添加 Codex 回合级提取**

添加 `extractCodexTaskDetails(file, project, category)`，并在处理 Codex 文件时优先使用它，而不是通用会话扫描器。它必须产出：

```js
// Per task row, grouped by event_msg.payload.turn_id when present.
{
  tool: 'Codex',
  project,
  category,
  sessionId,
  turnId,
  sourceFile: file,
  startTs,
  endTs,
  timestamps,
  tokens,
  spec,
  goal,
  result,
}
```

解析规则：

- `event_msg.payload.type === 'task_started'`：为 `turn_id` 创建/打开对应行，并设置 `startTs`。
- `event_msg.payload.type === 'user_message'`：将清洗后的消息文本追加到该回合的候选 spec 中，并对 `response_item` 中重复的用户副本去重。
- `response_item.payload.role === 'user'`：在尚未捕获相同用户消息时，追加清洗后的 `input_text` 内容。
- `event_msg.payload.type === 'thread_goal_updated'`：从 `payload.goal.objective` 设置 `goal`，并在存在时捕获 `payload.goal.status`、`payload.goal.tokensUsed` 和 `payload.goal.timeUsedSeconds`。
- `event_msg.payload.type === 'task_complete'`：设置 `endTs`，并从 `payload.last_agent_message` 提取 `result`。
- `event_msg.payload.type === 'token_count'`：尽可能将 `last_token_usage` 记到当前/打开的回合；否则按时间戳分配给最近的活跃回合。

如果 Codex 文件缺少任务边界事件，则回退到 `scanSessionFile()`。

- [ ] **步骤 6：添加 Claude 会话级提取**

添加 `extractClaudeTaskDetails(file, project, category)`，并为每个会话文件生成一条任务记录：

```js
{
  tool: 'Claude Code',
  project,
  category,
  sessionId,
  turnId: null,
  sourceFile: file,
  startTs,
  endTs,
  timestamps,
  tokens,
  spec,
  goal,
  result,
}
```

解析规则：

- `type === 'user' && message.content`：第一条有意义的用户消息作为 `spec`。
- `type === 'last-prompt'` / `lastPrompt`：仅作为备用用户请求使用，绝不能当作结果。
- `type === 'assistant' && message.content[].text`：最后一段有意义的 assistant 文本作为 `result`。
- `type === 'assistant' && message.usage`：将 usage 字段累加为 token 数据。
- `goal` 从 `spec` 推断，除非未来 Claude 日志字段提供显式 objective。

- [ ] **步骤 7：运行测试**

运行：`npm test`

预期：通过。

## 任务 4：为时间过滤生成活跃时间段

**文件：**
- 修改：`bin/cchour.js`
- 修改：`test/cchour.test.js`

- [ ] **步骤 1：编写时间段测试**

追加：

```js
test('buildActiveSegments turns timestamps into billable active intervals', () => {
  assert.deepEqual(cchour.buildActiveSegments([100, 200, 2000]), [
    { start: 100, end: 200, seconds: 100 },
    { start: 2000, end: 2030, seconds: 30 },
  ]);
});

test('segment overlaps exact nightly range', () => {
  const start = new Date(2026, 5, 23, 20, 0).getTime() / 1000;
  const end = new Date(2026, 5, 24, 8, 0).getTime() / 1000;
  assert.equal(cchour.segmentOverlapSeconds({ start: start - 60, end: start + 60 }, start, end), 60);
  assert.equal(cchour.segmentOverlapSeconds({ start: end + 1, end: end + 30 }, start, end), 0);
});
```

- [ ] **步骤 2：实现时间段 helper**

添加：

```js
function buildActiveSegments(ts) {
  const u = uniqSorted(ts);
  const out = [];
  let prev = null;
  for (const t of u) {
    if (prev !== null && t - prev <= GAP) out.push({ start: prev, end: t, seconds: t - prev });
    else out.push({ start: t, end: t + MIN_EVENT, seconds: MIN_EVENT });
    prev = t;
  }
  return out.filter((s) => s.seconds > 0);
}

function segmentOverlapSeconds(seg, lo, hi) {
  const start = Math.max(seg.start, lo);
  const end = Math.min(seg.end, hi);
  return Math.max(0, end - start);
}
```

导出这两个 helper。

- [ ] **步骤 3：在详细报告中使用时间段**

在 `buildEmbedData` 中，当 `report.tasks` 存在时，添加一个紧凑的 `tasks` 数组：

```js
tasks: (report.tasks || []).map((task) => ({
  id: task.id,
  tool: task.tool,
  project: task.project,
  cat: task.category,
  firstTs: task.firstTs,
  lastTs: task.lastTs,
  seconds: Math.round(task.seconds || 0),
  tokens: task.tokens,
  spec: task.spec,
  goal: task.goal,
  result: task.result,
}))
```

- [ ] **步骤 4：运行测试**

运行：`npm test`

预期：通过。

## 任务 5：提取 Spec、Goal 和 Result

**文件：**
- 修改：`bin/cchour.js`
- 修改：`test/cchour.test.js`

- [ ] **步骤 1：编写摘要测试**

追加：

```js
test('extractTaskSummary derives spec goal and result without fabricating missing data', () => {
  const s = cchour.extractTaskSummary({
    userTexts: ['i need report nightly agent task details, including spec, goal, and result'],
    assistantTexts: ['Implemented nightly report support and verified tests.'],
  });
  assert.equal(s.spec, 'i need report nightly agent task details, including spec, goal, and result');
  assert.equal(s.goal, 'report nightly agent task details, including spec, goal, and result');
  assert.equal(s.result, 'Implemented nightly report support and verified tests.');
});

test('extractTaskSummary returns unknown fields for empty sessions', () => {
  assert.deepEqual(cchour.extractTaskSummary({ userTexts: [], assistantTexts: [] }), {
    spec: 'unknown',
    goal: 'unknown',
    result: 'unknown',
  });
});
```

- [ ] **步骤 2：实现确定性提取器**

添加：

```js
function cleanTaskText(s) {
  return String(s || '')
    .replace(/<(environment_context|user_instructions|turn_context)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(s, n = 260) {
  const clean = cleanTaskText(s);
  return clean.length > n ? `${clean.slice(0, n - 1)}...` : clean;
}

function inferGoal(spec) {
  const s = cleanTaskText(spec);
  const m = s.match(/\b(?:goal|objective|need|want|please|add|build|fix|report)\b[:\s]+(.{8,220})/i);
  return clipText(m ? m[1] : s, 220) || 'unknown';
}

function extractTaskSummary(session) {
  const spec = clipText((session.userTexts || []).find(Boolean), 320) || 'unknown';
  const goal = spec === 'unknown' ? 'unknown' : inferGoal(spec);
  const result = clipText([...(session.assistantTexts || [])].reverse().find(Boolean), 320) || 'unknown';
  return { spec, goal, result };
}
```

导出 `extractTaskSummary`。

- [ ] **步骤 3：整合延后返回的子代理结论**

已启动的探索子代理识别出以下明确提取规则。在回退到通用启发式之前，先实现这些规则：

- Codex：使用 `task_started` 和 `task_complete` 作为边界。
- Codex：使用 `thread_goal_updated.payload.goal.objective` 作为显式 `goal`。
- Codex：使用 `task_complete.payload.last_agent_message` 作为 `result`。
- Claude Code：使用会话级记录；在采样日志中没有可靠的显式 goal 字段。
- Claude Code：嵌套 `subagents/*.jsonl` 下的子代理日志可用于“agent task details”，但如果父链和旁路链日志都被聚合，可能会重复计数。

保持以下约束：

- 默认提取不能依赖网络或 LLM。
- 不要在 HTML 中暴露原始完整转录。
- 如果结果不明确，渲染为 `unknown`。
- `spec` 优先使用第一条有意义的用户请求，`goal` 使用简短祈使短语，`result` 使用最后一条最终 assistant 文本。

- [ ] **步骤 4：运行测试**

运行：`npm test`

预期：通过。

## 任务 6：向 CLI 和 JSON 添加夜间详情聚合

**文件：**
- 修改：`bin/cchour.js`
- 修改：`test/cchour.test.js`

- [ ] **步骤 1：从详细会话构建任务记录**

添加：

```js
function buildNightlyTasks(sessions, since, until) {
  const lo = since.getTime() / 1000;
  const hi = until.getTime() / 1000;
  const tasks = [];
  for (const session of sessions) {
    const segments = buildActiveSegments(session.timestamps || []);
    const seconds = segments.reduce((sum, seg) => sum + segmentOverlapSeconds(seg, lo, hi), 0);
    if (seconds < 60) continue;
    const summary = extractTaskSummary(session);
    tasks.push({ ...session, ...summary, seconds });
  }
  tasks.sort((a, b) => (a.firstTs || 0) - (b.firstTs || 0));
  return tasks;
}
```

- [ ] **步骤 2：按夜间起始日期标记窗口**

添加 helper，使任务记录可以为 20:00-08:00 报告 `windowDate`：

```js
function nightWindowDate(ts, startHour = 20, endHour = 8) {
  const d = new Date(ts * 1000);
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (startHour > endHour && d.getHours() < endHour) {
    base.setDate(base.getDate() - 1);
  }
  return dayKey(base.getTime() / 1000);
}
```

在构建夜间任务时设置 `task.windowDate = nightWindowDate(task.startTs || task.firstTs, startHour, endHour)`。

- [ ] **步骤 3：扩展 JSON 输出**

在 `renderJson` 中加入：

```js
tokens: projRows.reduce((sum, r) => sumTokenUsage([sum, r.tokens]), emptyTokenUsage()),
tasks: (arguments[0].tasks || []).map((task) => ({
  tool: task.tool,
  project: task.project,
  category: task.category,
  seconds: Math.round(task.seconds),
  hours: +(task.seconds / 3600).toFixed(2),
  tokens: task.tokens,
  spec: task.spec,
  goal: task.goal,
  result: task.result,
  firstTs: task.firstTs,
  lastTs: task.lastTs,
}))
```

如果某个工具/会话的 token 字段不可用，返回 `"available": false` 和零 token 值。

- [ ] **步骤 4：接入 `main()`**

当设置 `opts.nightly` 时：

```js
const sessions = collectDetailedSessions(makeContentCategorize(rules), projectCategorize, catOverride, t);
const tasks = buildNightlyTasks(sessions, opts.since, opts.until);
report.tasks = tasks;
report.nightly = { start: opts.nightStart, end: opts.nightEnd };
```

除非时间过滤需要时间段数据，否则保留现有 `data` 聚合用于标准图表。

- [ ] **步骤 5：手动验证 CLI**

运行：

```bash
node bin/cchour.js --nightly 2026-06-23 --json --lang en > /tmp/cchour-nightly.json
node -e "const r=require('/tmp/cchour-nightly.json'); console.log(r.tasks.length, r.totalSeconds)"
```

预期：JSON 包含 `tasks`，且每个任务都有 `spec`、`goal`、`result`、`hours` 和 `tokens.available`。

## 任务 7：添加 HTML 时间过滤器和夜间任务表

**文件：**
- 修改：`bin/cchour.js`

- [ ] **步骤 1：添加 i18n 文案**

为以下字段添加英文和中文文案：

```js
timeFilter: 'Time filter',
nightly: 'Nightly',
nightlyWindow: 'Nightly window',
taskDetails: 'Agent task details',
spec: 'Spec',
goal: 'Goal',
result: 'Result',
tokens: 'Tokens',
inputTokens: 'Input',
outputTokens: 'Output',
cachedTokens: 'Cached',
reasoningTokens: 'Reasoning',
```

- [ ] **步骤 2：向 `renderHtml` 添加控件**

在 `.controls` 中，自定义日期输入后添加：

```html
<span class="custom">${t.timeFilter} <input type="time" id="t-start" value="00:00"> ~ <input type="time" id="t-end" value="00:00"></span>
<button class="chip" data-preset="nightly">${t.nightly}</button>
```

将 `00:00 ~ 00:00` 定义为全天，以避免改变现有行为。

- [ ] **步骤 3：添加任务详情面板**

在 projects 面板之后添加：

```html
<h2>${t.taskDetails}</h2>
<div class="panel" id="tasks"></div>
```

- [ ] **步骤 4：前端过滤逻辑**

添加 JS helper：

```js
function localDateTimeSeconds(day, hhmm) {
  var p = day.split('-'), c = hhmm.split(':');
  return new Date(+p[0], +p[1] - 1, +p[2], +c[0], +c[1]).getTime() / 1000;
}

function tokenText(tokens) {
  if (!tokens || !tokens.available) return 'tokens n/a';
  return tokens.total.toLocaleString() + ' total';
}
```

更新 `presetRange('nightly')`，将日期和时间值设置为 20:00 到 08:00。对于跨午夜窗口，将日期范围设置为起始日到次日。

- [ ] **步骤 5：渲染任务行**

在 `render()` 中添加：

```js
var taskRows = [];
(D.tasks || []).forEach(function (task) {
  if (lo && dayStr(new Date(task.lastTs * 1000)) < lo) return;
  if (hi && dayStr(new Date(task.firstTs * 1000)) > hi) return;
  taskRows.push(task);
});
taskRows.sort(function (a, b) { return b.seconds - a.seconds; });
document.getElementById('tasks').innerHTML = taskRows.length ? taskRows.map(function (task) {
  return '<div class="task-row">' +
    '<div><strong>' + task.project + '</strong> <span class="muted">' + task.tool + ' · ' + fmtH(task.seconds) + ' · ' + tokenText(task.tokens) + '</span></div>' +
    '<div><span class="muted">' + T.spec + ':</span> ' + task.spec + '</div>' +
    '<div><span class="muted">' + T.goal + ':</span> ' + task.goal + '</div>' +
    '<div><span class="muted">' + T.result + ':</span> ' + task.result + '</div>' +
  '</div>';
}).join('') : '<div class="muted" style="font-size:13px">' + T.units.none + '</div>';
```

添加 CSS：

```css
.task-row { padding:12px 0; border-bottom:1px solid var(--line); font-size:13px; line-height:1.45; }
.task-row:last-child { border-bottom:none; }
.task-row strong { font-size:14px; }
```

- [ ] **步骤 6：手动验证 HTML**

运行：

```bash
node bin/cchour.js --nightly 2026-06-23 --lang en -o /tmp/cchour-nightly.html
```

打开 `/tmp/cchour-nightly.html` 并验证：

- 夜间预设 chip 会设置 20:00-08:00。
- 日期和时间控件在移动端宽度下不会重叠。
- 任务详情行会显示 spec/goal/result。
- token 不可用的会话会显示 `tokens n/a`。

## 任务 8：更新 Help 和 README

**文件：**
- 修改：`bin/cchour.js`
- 修改：`README.md`

- [ ] **步骤 1：更新 CLI help**

同时在英文和中文 help 中添加：

```text
      --nightly [D]      Night report: D=YYYY-MM-DD start date, today, or last;
                         default window is 20:00 through next-day 08:00
      --night-start HH:MM  Override nightly start time (default 20:00)
      --night-end HH:MM    Override nightly end time (default 08:00)
```

- [ ] **步骤 2：更新 README 用法示例**

添加：

```md
cchour --nightly                  # latest completed 20:00-08:00 report
cchour --nightly 2026-06-23       # 2026-06-23 20:00 through 2026-06-24 08:00
cchour --nightly 2026-06-23 --json
cchour --nightly --night-start 21:00 --night-end 07:30
```

- [ ] **步骤 3：记录 token 统计注意事项**

添加：

```md
Token stats are best-effort and depend on what the local tool logs contain.
Codex reports `token_count` events; cchour sums `last_token_usage` to avoid
double-counting cumulative totals. Claude Code reports assistant
`message.usage`; cchour sums input, cache creation/read, and output tokens.
Older or failed sessions may show `tokens.available=false`.
```

## 任务 9：最终验证

**文件：**
- 除非验证发现 bug，否则不做修改。

- [ ] **步骤 1：运行自动化测试**

运行：

```bash
npm test
```

预期：所有测试通过。

- [ ] **步骤 2：验证标准报告仍可正常工作**

运行：

```bash
node bin/cchour.js --json --lang en > /tmp/cchour-standard.json
node bin/cchour.js --lang en -o /tmp/cchour-standard.html
```

预期：JSON 仍包含现有的 `tools`、`categories`、`projects`；HTML 可以打开，且现有范围 chips 仍然可用。

- [ ] **步骤 3：验证夜间报告**

运行：

```bash
node bin/cchour.js --nightly last --json --lang en > /tmp/cchour-nightly.json
node -e "const r=require('/tmp/cchour-nightly.json'); if (!Array.isArray(r.tasks)) process.exit(1); console.log(r.tasks.length)"
node bin/cchour.js --nightly last --lang en -o /tmp/cchour-nightly.html
```

预期：JSON 包含任务记录和 token 可用性。HTML 包含时间过滤器和任务详情区域。

- [ ] **步骤 4：提交**

```bash
git add bin/cchour.js package.json README.md test/cchour.test.js docs/superpowers/plans/2026-06-24-nightly-agent-report.md
git commit -m "feat: add nightly agent report plan and implementation"
```

## 说明与风险

- 当前报告对项目只嵌入按天聚合的 bucket，因此任意“时段级”过滤需要依赖活跃时间段或会话任务。不要尝试从按天 bucket 反推出 20:00-08:00 的项目详情。
- token 统计是可行的，但由于 Codex 和 Claude 的日志使用量结构不同，因此它们之间并不能做到完全可比。
- spec/goal/result 应明确标记为尽力而为。这可以避免在本地转录并不包含清晰最终答案时，假装存在完整任务结果。
- 用于 spec/goal/result 的实现子代理是单独启动的；在执行任务 5 之前整合它的结论。
