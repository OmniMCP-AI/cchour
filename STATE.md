# STATE — cchour 项目状态

## 当前状态（迭代 7 完成，2026-06-11）

Node.js 零依赖 CLI，**v1.4.0（本地，待 publish）**：

- 代码：`bin/cchour.js`（单文件，零依赖，Node ≥ 18）
- GitHub：https://github.com/jianshuo/cchour （public，main，已 push v1.4.0）
- npm：**cchour@1.1.0 已发布**；1.2.0–1.4.0 均未发布——publish 卡 2FA，
  需用户在项目目录跑 `npm publish --access public --otp=<验证码>`（直接发 1.4.0 即可）
- 迭代 7 改动：① `--json` 输出模式；② 内容级分类改为扫描前 3 条用户消息——杂项 **22% → 18%**

## --json 输出（迭代 7 引入）

- `cchour --json` 打 JSON 到 stdout（进度信息全在 stderr，可安全 pipe）；配 `-o` 则写文件
- 结构：`{generatedAt, gapSeconds, totalSeconds, tools: {名: {seconds, hours, daily, weekly, monthly, hourly}}, categories, projects: [{tool, project, seconds, category, firstTs, lastTs}]}`
- parseArgs 加了 `outputSet` 标记区分「默认输出名」和「用户显式 -o」

## 内容级分类（迭代 5 引入，6/7 扩展）

- 分类规则格式 `[["分类名", [项目名关键词], [内容关键词]?], ...]`，第三个数组可选、向后兼容
- 适用目录：SPECIAL_DIRS 四个（home / `~/code` 根 / `/` / private-tmp）+
  iCloud 文档（前缀匹配）、Downloads / Desktop / Documents（精确匹配），
  见 `isMiscClaudeDir()`；Codex 侧按解析出的项目名匹配 `CODEX_MISC_PROJECTS`
- **迭代 7：从仅首条改为前 3 条用户消息**（`CONTENT_MSGS = 3`），函数改名
  `claudeUserTexts()` / `codexUserTexts()`，多条文本以 `\n` 连接后做关键词匹配
- Claude Code：读文件头 256KB（共用 `readHead()`）逐行解析，跳过 isMeta / Caveat / 标签
- Codex：rollout 里 `response_item` payload `role=user` 的 `input_text`（兼容
  `event_msg`/`user_message`，同一条输入两种形式都出现时做相邻去重）；
  **必须整块剔除 `<environment_context>` / `<user_instructions>` / `<turn_context>`**
  ——环境块里含 "codex" 等字样会误命中内容关键词
- 命中后拆成合成项目「code 根目录 · 写作与发布」并覆盖分类，未命中留在杂项
- 验证：迭代 5 杂项 128.1h·48% → 82.0h·29%；迭代 6 → 63.4h·22%；迭代 7 → **51.8h·18%**

## 用法

```bash
npm i -g cchour   # 或 npx cchour
cchour --open     # 生成 ./cchour-report.html 并打开
cchour -o report.html --days 60
cchour --json | jq '.tools["Claude Code"].hours'
```

## 数据源与方法

| 工具 | 数据位置 | 说明 |
|------|----------|------|
| Claude Code | `~/.claude/projects/<flattened-cwd>/*.jsonl` | 时间戳正则流式提取，worktree 归并主项目 |
| Codex | `~/.codex/sessions/` + `~/.codex/archived_sessions/` | 文件头 256KB 正则取 `cwd`（session_meta 首行可能超长，不能按行 JSON.parse——迭代 2 踩过的坑） |

- 活跃时长 = 间隔法：相邻事件 ≤ 900 秒（15 分钟，按需求定义）计入，孤立事件计 30 秒
- 工具总时长按事件并集，避免并行会话重复计；时区用系统本地时区
- 性能：约 800MB 数据 0.8 秒（多消息扫描略增开销，仍在头 256KB 内）
- 注意：buildReport 里 `sec < 60` 的项目会整体跳过（含其事件），拆分杂项后小项目可能被滤掉，对总数影响 < 0.5h

## 个人化与公开包的分离

- 公开包内置通用分类规则（含通用内容关键词）；个人规则在 `~/.cchour/categories.json`
- `report.html` / `cchour-report.html` 在 .gitignore 里，个人数据不进公开仓库

## 验证记录

- 迭代 2（GAP=300s）：Node 版与 Python 版对齐：186.9h / 11.6h
- 迭代 3（GAP=900s）：228.1h / 13.9h
- 迭代 5：228.5h / 13.9h；杂项 48%→29%
- 迭代 6：228.6h / 13.9h；杂项 29%→22%
- 迭代 7：228.8h / 13.9h；杂项 22%→18%（51.8h）；`--json` 经 JSON.parse 验证；
  截图核对全部板块正常。
  踩坑提醒：browse 的安全策略只允许 load-html 读 /tmp 或 daemon 启动时的 cwd
  （本次 daemon 还记着旧的 cctime 路径），把 report 复制到 /tmp 再 load 即可；
  旧标签页会残留缓存内容，核对数字前先 load-html 重新加载

## 下次迭代可做

1. **npm publish 1.4.0（唯一卡点）**：用户在项目目录跑 `npm publish --access public --otp=<code>`，
   再 `npx cchour@1.4.0 --version` 验证（1.2.0/1.3.0 从未发布，跳过即可）
2. 剩余杂项 51.8h 已多为真杂项（"继续"、零散问答）；再降收益递减
3. 其他工具（Gemini CLI / Copilot）目前本机无会话日志，等有数据再接
4. 可加 launchd 定时刷新（数据在本地，无 iCloud 限制）；`--json` 已为此铺路
5. 可考虑 `--since` / `--until` 日期过滤参数
