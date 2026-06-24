'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cchour = require('../bin/cchour.js');

test('exports testable helpers without running main', () => {
  assert.equal(typeof cchour.dayKey, 'function');
  assert.equal(typeof cchour.activeSeconds, 'function');
});

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

test('nightly last picks latest completed overnight window', () => {
  const r = cchour.expandNightlyRange('last', '20:00', '08:00', new Date(2026, 5, 24, 11, 0));
  assert.equal(r.since.getFullYear(), 2026);
  assert.equal(r.since.getMonth(), 5);
  assert.equal(r.since.getDate(), 23);
  assert.equal(r.since.getHours(), 20);
  assert.equal(r.until.getDate(), 24);
  assert.equal(r.until.getHours(), 8);
});

test('time window detects cross-midnight membership', () => {
  assert.equal(cchour.isInTimeWindow(21, 0, 20, 0, 8, 0), true);
  assert.equal(cchour.isInTimeWindow(2, 30, 20, 0, 8, 0), true);
  assert.equal(cchour.isInTimeWindow(12, 0, 20, 0, 8, 0), false);
});

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

test('html report exposes nightly as a checkbox time filter', () => {
  const report = {
    toolSeconds: new Map([['Codex', 120]]),
    toolDaily: new Map([['Codex', new Map([['2026-06-23', 120]])]]),
    toolDayHour: new Map([['Codex', new Map([['2026-06-23|21', 120]])]]),
    projRows: [{
      tool: 'Codex',
      proj: 'demo',
      cat: 'Product',
      daily: new Map([['2026-06-23', 120]]),
      dayHour: new Map([['2026-06-23|21', 120]]),
    }],
    range: { since: null, until: null },
    daysOpt: 30,
  };
  const html = cchour.renderHtml(report, 'en');
  assert.match(html, /type="checkbox" id="night-only"/);
  assert.match(html, /id="t-start" value="20:00"/);
  assert.match(html, /id="t-end" value="08:00"/);
  assert.doesNotMatch(html, /data-preset="nightly"/);
});

test('html report embeds task detail rows when provided', () => {
  const report = {
    toolSeconds: new Map([['Codex', 120]]),
    toolDaily: new Map([['Codex', new Map([['2026-06-23', 120]])]]),
    toolDayHour: new Map([['Codex', new Map([['2026-06-23|21', 120]])]]),
    projRows: [{
      tool: 'Codex',
      proj: 'demo',
      cat: 'Product',
      daily: new Map([['2026-06-23', 120]]),
      dayHour: new Map([['2026-06-23|21', 120]]),
    }],
    tasks: [{
      id: 'task-1',
      tool: 'Codex',
      project: 'demo',
      category: 'Product',
      firstTs: new Date(2026, 5, 23, 21, 0).getTime() / 1000,
      lastTs: new Date(2026, 5, 23, 21, 2).getTime() / 1000,
      seconds: 120,
      tokens: { available: true, total: 123, input: 100, cachedInput: 0, output: 23, reasoningOutput: 0 },
      spec: 'build nightly details',
      goal: 'show task rows',
      result: 'task rows are visible',
    }],
    range: { since: null, until: null },
    daysOpt: 30,
  };
  const html = cchour.renderHtml(report, 'en');
  assert.match(html, /build nightly details/);
  assert.match(html, /task rows are visible/);
});

test('buildTaskRowsForReport preserves token usage for task details', () => {
  const firstTs = new Date(2026, 5, 23, 21, 0).getTime() / 1000;
  const rows = cchour.buildTaskRowsForReport([{
    id: 'task-1',
    tool: 'Codex',
    project: 'demo',
    category: 'Product',
    firstTs,
    lastTs: firstTs + 120,
    timestamps: [firstTs, firstTs + 120],
    tokens: { available: true, total: 123, input: 100, cachedInput: 0, output: 23, reasoningOutput: 0 },
    spec: 'spec',
    goal: 'goal',
    result: 'result',
  }], -Infinity, Infinity);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seconds, 120);
  assert.equal(rows[0].tokens.total, 123);
});

test('global excludes match project names case-insensitively and exact paths by default', () => {
  const excludes = cchour.normalizeExcludeConfig({
    projects: ['DemoRepo'],
    paths: ['/Users/me/work/private'],
  }, '/Users/me');

  assert.equal(cchour.shouldExcludeSession({ project: 'demorepo', cwd: '/Users/me/work/public' }, excludes), true);
  assert.equal(cchour.shouldExcludeSession({ project: 'other', cwd: '/Users/me/work/private' }, excludes), true);
  assert.equal(cchour.shouldExcludeSession({ project: 'other', cwd: '/Users/me/work/private/repo-a' }, excludes), false);
  assert.equal(cchour.shouldExcludeSession({ project: 'other', cwd: '/Users/me/work/private-ish' }, excludes), false);
});

test('global excludes support star wildcards for project and path matching', () => {
  const excludes = cchour.normalizeExcludeConfig({
    projects: ['demo-*'],
    paths: ['/Users/me/*'],
  }, '/Users/me');

  assert.equal(cchour.shouldExcludeSession({ project: 'demo-api', cwd: '/tmp/ok' }, excludes), true);
  assert.equal(cchour.shouldExcludeSession({ project: 'prod-api', cwd: '/Users/me/work/private/repo-a' }, excludes), true);
  assert.equal(cchour.shouldExcludeSession({ project: 'prod-api', cwd: '/Users/other/work/private' }, excludes), false);
});

test('task detail rows are excluded when spec goal or result mentions an excluded path', () => {
  const firstTs = new Date(2026, 5, 23, 21, 0).getTime() / 1000;
  const excludes = cchour.normalizeExcludeConfig({
    paths: ['/Users/dengwei/work/no7dw/*'],
  });
  const rows = cchour.buildTaskRowsForReport([{
    id: 'task-private',
    tool: 'Codex',
    project: 'hermes-agent',
    category: 'Product',
    firstTs,
    lastTs: firstTs + 120,
    timestamps: [firstTs, firstTs + 120],
    tokens: { available: true, total: 123, input: 100, cachedInput: 0, output: 23, reasoningOutput: 0 },
    spec: 'remove part five',
    goal: 'remove part five',
    result: 'updated [doc](/Users/dengwei/work/no7dw/personal-cv-exp/blog/private.md)',
  }], -Infinity, Infinity, 300, excludes);

  assert.equal(rows.length, 0);
});

test('parseArgs supports global exclude management commands', () => {
  assert.deepEqual(cchour.parseArgs(['--add-exclude-project', 'demo']).excludeAction, {
    type: 'project',
    value: 'demo',
  });
  assert.deepEqual(cchour.parseArgs(['--add-exclude-path', '~/work/private']).excludeAction, {
    type: 'path',
    value: '~/work/private',
  });
  assert.equal(cchour.parseArgs(['--list-excludes']).excludeAction.type, 'list');
});
