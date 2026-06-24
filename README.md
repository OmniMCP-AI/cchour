# cchour

See how much time you actually spend in AI coding tools. `cchour` scans the local
session logs of **Claude Code** and **Codex**, computes your active hours, and
renders a self-contained HTML report — daily, weekly and monthly stacked bars,
hour-of-day distribution, work categories, and top projects.

The report has a built-in **time range picker** (all / today / this week / last
week / this month / last month / last 7/30/90 days / custom dates): pick a
period and every number, chart and ranking recomputes instantly in the browser —
no need to re-run the CLI.

Everything runs locally. Nothing is uploaded anywhere.

## Install

```bash
npm i -g cchour
```

Or with Homebrew:

```bash
brew install jianshuo/tap/cchour
```

Or run without installing:

```bash
npx cchour
```

## Usage

```bash
cchour                    # writes ./cchour-report.html
cchour --open             # ...and opens it in your browser
cchour -o ~/report.html   # custom output path
cchour --days 60          # daily chart window (default 30)
cchour --since 2026-06-01 # only count activity on/after this date
cchour --until 2026-06-10 # only count activity up to this date (inclusive)
cchour --week             # this week (Monday through today)
cchour --week last        # last full week (Mon–Sun) — instant weekly report
cchour --week 2026-06-03  # the week containing that date
cchour --month            # this month so far
cchour --month last       # last full month — instant monthly report
cchour --month 2026-05    # a specific month
cchour --lang en          # generate the report UI in English
cchour --lang cn          # generate the report UI in Chinese
cchour --json             # print report data as JSON to stdout
cchour --json -o out.json # ...or write it to a file
cchour --llm-category --llm-model gpt-5.4-mini --lang en
                         # use an OpenAI-compatible LLM to improve category mapping
cchour --add-exclude-project outofofficehour
                         # globally hide a project/repo from future reports
cchour --add-exclude-path ~/work/ai/private-repo
                         # globally hide sessions exactly at a path
cchour --add-exclude-path '~/work/ai/private-repo/*'
                         # hide sessions under that folder/repo
cchour --add-exclude-path '/Users/dengwei/*'
                         # hide all child folders/repos under /Users/dengwei
cchour --list-excludes   # show global excludes
```

`--since` / `--until` filter events by local-time date before any stats are
computed, so totals, charts, categories and project rows all reflect the range.
The HTML header shows the active range, and the JSON output carries `since` /
`until` fields. Charts anchor their last bar at `--until` when it is in the past.

### Interactive range picker (HTML report)

The generated HTML embeds per-day data and recomputes everything client-side
when you switch the range, so one report answers "this week vs last month"
without regenerating. Selecting **全部 (all)** reproduces the CLI totals
exactly; sub-ranges sum per-day buckets (a work session crossing midnight is
attributed to the day each interval ends on), which can differ from an
equivalent CLI `--since`/`--until` run by a few minutes at the boundaries.
When the CLI is run with a date filter, the report only embeds the filtered
data and the picker narrows within it.

`--week` / `--month` are shortcuts that expand to the equivalent `--since` /
`--until` pair (weeks start on Monday, ranges never extend past today), so
`cchour --week last --json` is a one-liner weekly report. They cannot be
combined with each other or with explicit `--since` / `--until`.

The HTML report also has a **Nightly** checkbox. Checking it keeps the selected
date range unchanged and applies the default 20:00 → 08:00 time filter. The
start and end time fields remain editable in the browser for ad-hoc custom
windows.

### Global excludes

Use global excludes to remove private repos, throwaway worktrees, or noisy
folders from every future report:

```bash
cchour --add-exclude-project my-private-repo
cchour --add-exclude-project 'tmp-*'
cchour --add-exclude-path ~/work/ai/private-repo
cchour --add-exclude-path '~/work/ai/private-repo/*'
cchour --add-exclude-path '/Users/me/*'
cchour --list-excludes
```

Excludes are stored locally in `~/.cchour/excludes.json`. Project excludes match
the report project/repo name case-insensitively. Path excludes are exact by
default:

| Entry | Meaning |
|---|---|
| `/Users/dengwei` | Exclude only sessions recorded at exactly `/Users/dengwei` |
| `/Users/dengwei/*` | Exclude sessions under `/Users/dengwei/`, including repos/folders below it |
| `/Users/dengwei/work/ai/github` | Exclude only that exact folder |
| `/Users/dengwei/work/ai/github/*` | Exclude repos/folders under that folder |
| `tmp-*` as a project exclude | Exclude projects whose report name starts with `tmp-` |

Quote wildcard arguments in the shell, e.g. `'/Users/dengwei/*'`, so they are
saved as patterns instead of being expanded by your shell before `cchour` sees
them.

Agent task details use the same excludes. If a task's spec, goal, result, user
text, or assistant text mentions an excluded path pattern such as
`/Users/dengwei/work/no7dw/*`, the whole task detail row is hidden from the HTML
and JSON report.

### Report language

Use `--lang en` or `--lang cn` to choose the generated HTML UI language and CLI
help/status messages. The default is `cn`.

### JSON output

`--json` emits the same data the HTML report is built from, for consumption by
other scripts: per-tool totals and daily/weekly/monthly/hourly buckets, category
totals, and per-project rows (`tool`, `project`, `seconds`, `category`,
`firstTs`, `lastTs`). Progress messages go to stderr, so piping stdout is safe:

```bash
cchour --json | jq '.tools["Claude Code"].hours'
```

## Data sources

| Tool | Location |
|------|----------|
| Claude Code | `~/.claude/projects/<flattened-cwd>/*.jsonl` |
| Codex | `~/.codex/sessions/` and `~/.codex/archived_sessions/` |

Log files are scanned in streaming chunks with a timestamp regex (no full JSON
parsing), so hundreds of MB of logs take about a second.

## How active time is computed

Events are grouped and sorted by time. A gap of **≤ 15 minutes** between adjacent
events counts as continuous work; a longer gap means you stepped away and is not
counted. An isolated event counts as 30 seconds. Per-tool totals are computed on
the union of all events of that tool, so parallel sessions are not double-counted.

## Work categories

Projects are mapped to categories by ordered keyword rules. To customize, create
`~/.cchour/categories.json`:

```json
[
  ["Writing", ["blog", "article", "publish"], ["公众号", "tweet", "draft"]],
  ["Video", ["video", "subtitle", "podcast"], ["字幕", "srt", "youtube"]],
  ["Products", ["myapp", "mytool"]]
]
```

Rules are matched in order against the lowercased project name; unmatched
projects fall into the catch-all category.

The optional third array enables **content-level classification** for sessions
started in non-project directories (home, `~/code` root, `/`, Downloads,
Desktop, Documents, iCloud Drive): the first few user messages of each such
session are matched against these content keywords, and the session is moved out of the
"misc" bucket into the matching category (shown as e.g. `code root · Writing`
in the project list). Sessions with no match stay in misc. This works for both
Claude Code and Codex sessions.

### LLM-assisted category mapping

When local keyword rules are too weak, `--llm-category` can ask an
OpenAI-compatible model to reorganize unmatched projects into a small set of
practical report categories.

Required environment variables:

```bash
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.openai.com/v1   # optional if using OpenAI
```

Then run:

```bash
cchour --llm-category --llm-model gpt-5.4-mini
```

Behavior:

- The LLM is only used as a fallback when a project name does not match any
  configured category rule.
- For misc sessions (home, `~/code`, Downloads, etc.), it can also use the
  first user messages as extra context and move the session into a better
  category.
- The model prefers your existing categories when they fit, but it may also
  propose a few new reusable category names when your current rule set is too
  sparse.
- The CLI prints a short summary like `LLM reclassified 42 projects across 7
  categories` when remapping succeeds.

## Requirements

- Node.js ≥ 18
- Zero dependencies

## License

MIT
