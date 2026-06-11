# STATE — cctime 项目状态

## 当前状态（迭代 1 完成，2026-06-11）

可用产物：
- `cctime.py` — 解析脚本，零依赖（仅 Python3 标准库），运行 `python3 cctime.py` 约 1 秒
- `report.html` — 浅色静态 HTML 报表，无外部依赖，直接双击打开

## 数据源与方法

| 工具 | 数据位置 | 说明 |
|------|----------|------|
| Claude Code | `~/.claude/projects/<flattened-cwd>/*.jsonl` | 每行 JSON 带 `"timestamp":"…Z"`（UTC），项目名从目录名还原，worktree 归并到主项目 |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `~/.codex/archived_sessions/` | session_meta 行的 `cwd` 字段定项目 |

- 解析方式：流式 4MB 分块 + 正则提取时间戳（不做整行 json.loads），783MB 数据约 0.6 秒
- 活跃时长 = 间隔法：相邻事件间隔 ≤ 300 秒计入，超过视为离开；孤立事件计 30 秒（`GAP`/`MIN_EVENT` 常量在脚本顶部）
- 工具总时长按该工具全部事件的并集算，避免同一时间多项目并行被重复计入
- 时区：UTC 时间戳统一转 +8（Asia/Shanghai）再按天/按小时切分

## 迭代 1 的结果数字（2026-06-11 运行）

- 总活跃 198 小时（自 2026-05-01 起 40 天）
- Claude Code 186.7h（94%，日均 4.7h）；Codex 11.6h（6%，日均 0.3h）
- 报表包含：总览卡片、最近 30 天每日堆叠柱状图、24 小时分布、工作分类条形图、Top 20 项目

## 已知问题 / 下次迭代可做

1. **「杂项（根目录会话）」占比最大（~48%）**——大量会话直接在 `~/code` 根目录启动，目录名无法区分实际工作内容。下一步可以读这些会话 JSONL 里的首条用户消息或 `gitBranch`/`cwd` 字段做内容级分类。
2. 工作分类是关键词映射（`CATEGORY_RULES`，按序匹配），新项目出现后需要补关键词，否则落入「其他」。
3. 目前只支持 Claude Code 和 Codex；Gemini CLI / Copilot 等其他工具未接入（本机暂无数据）。
4. 报表是一次性生成的快照，如需每天自动刷新可加 launchd 定时任务（注意：launchd 不能读 iCloud 路径，本项目数据都在本地，无此问题）。

## 验证方式

用 gstack browse 无头浏览器截图核对过：日图、小时图、分类、Top 项目均正常渲染；浅色白底符合用户 UI 偏好。
