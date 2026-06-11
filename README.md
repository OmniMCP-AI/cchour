# cchour

See how much time you actually spend in AI coding tools. `cchour` scans the local
session logs of **Claude Code** and **Codex**, computes your active hours, and
renders a self-contained HTML report — daily, weekly and monthly stacked bars,
hour-of-day distribution, work categories, and top projects.

Everything runs locally. Nothing is uploaded anywhere.

## Install

```bash
npm i -g cchour
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
Desktop, Documents, iCloud Drive): the first user message of each such session
is matched against these content keywords, and the session is moved out of the
"misc" bucket into the matching category (shown as e.g. `code root · Writing`
in the project list). Sessions with no match stay in misc. This works for both
Claude Code and Codex sessions.

## Requirements

- Node.js ≥ 18
- Zero dependencies

## License

MIT
