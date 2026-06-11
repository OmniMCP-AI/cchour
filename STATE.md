# STATE — cchour 项目状态

## 当前状态（迭代 6 完成，2026-06-11）

Node.js 零依赖 CLI，**v1.3.0（本地，待 publish）**：

- 代码：`bin/cchour.js`（单文件，零依赖，Node ≥ 18）
- GitHub：https://github.com/jianshuo/cchour （public，main，已 push v1.3.0）
- npm：**cchour@1.1.0 已发布**；1.2.0 / 1.3.0 均未发布——publish 卡 2FA，
  需用户在项目目录跑 `npm publish --access public --otp=<验证码>`（直接发 1.3.0 即可）
- 迭代 6 改动：内容级分类扩展到 Codex 杂项会话 + 更多目录——杂项占比 **29% → 22%**

## 内容级分类（迭代 5 引入，迭代 6 扩展）

- 分类规则格式 `[["分类名", [项目名关键词], [内容关键词]?], ...]`，第三个数组可选、向后兼容
- 适用目录：SPECIAL_DIRS 四个（home / `~/code` 根 / `/` / private-tmp）+
  迭代 6 新增 iCloud 文档（前缀匹配）、Downloads / Desktop / Documents（精确匹配），
  见 `isMiscClaudeDir()`；Codex 侧按解析出的项目名匹配 `CODEX_MISC_PROJECTS`
- Claude Code：读文件头 256KB（共用 `readHead()`）逐行解析首条真实用户消息（跳过 isMeta / Caveat / 标签）
- Codex（迭代 6 新增 `codexFirstUserText()`）：rollout 里 `response_item` payload `role=user` 的
  `input_text`（兼容 `event_msg`/`user_message`）；**必须整块剔除 `<environment_context>` /
  `<user_instructions>` / `<turn_context>`**——环境块里含 "codex" 等字样会误命中内容关键词
- 命中后拆成合成项目「code 根目录 · 写作与发布」并覆盖分类，未命中留在杂项
- `~/.cchour/categories.json` 杂项类已补 desktop / documents 关键词（默认规则同步）
- 验证：迭代 5 杂项 128.1h·48% → 82.0h·29%；迭代 6 → 63.4h·22%（新拆出 iCloud 文档·视频制作 / 公司与业务等）

## 用法

```bash
npm i -g cchour   # 或 npx cchour
cchour --open     # 生成 ./cchour-report.html 并打开
cchour -o report.html --days 60
```

## 数据源与方法

| 工具 | 数据位置 | 说明 |
|------|----------|------|
| Claude Code | `~/.claude/projects/<flattened-cwd>/*.jsonl` | 时间戳正则流式提取，worktree 归并主项目 |
| Codex | `~/.codex/sessions/` + `~/.codex/archived_sessions/` | 文件头 256KB 正则取 `cwd`（session_meta 首行可能超长，不能按行 JSON.parse——迭代 2 踩过的坑） |

- 活跃时长 = 间隔法：相邻事件 ≤ 900 秒（15 分钟，按需求定义）计入，孤立事件计 30 秒
- 工具总时长按事件并集，避免并行会话重复计；时区用系统本地时区
- 性能：约 800MB 数据 0.6 秒（含内容级分类的额外 256KB 头部读取）
- 注意：buildReport 里 `sec < 60` 的项目会整体跳过（含其事件），拆分杂项后小项目可能被滤掉，对总数影响 < 0.5h

## 个人化与公开包的分离

- 公开包内置通用分类规则（含通用内容关键词）；个人规则在 `~/.cchour/categories.json`
- `report.html` / `cchour-report.html` 在 .gitignore 里，个人数据不进公开仓库

## 验证记录

- 迭代 2（GAP=300s）：Node 版与 Python 版对齐：186.9h / 11.6h
- 迭代 3（GAP=900s）：228.1h / 13.9h
- 迭代 5：228.5h / 13.9h（数据自然增长）；杂项 48%→29%；浏览器截图核对全部板块渲染正常
- 迭代 6：228.6h / 13.9h；杂项 29%→22%；截图核对正常。
  踩坑：browse 的旧标签页会残留上一版 report 的缓存内容，`goto file://` 偶发 chrome-error，
  核对数字前先 `load-html` 重新加载，别信旧标签页

## 下次迭代可做

1. **npm publish 1.3.0（唯一卡点）**：用户在项目目录跑 `npm publish --access public --otp=<code>`，
   再 `npx cchour@1.3.0 --version` 验证（1.2.0 从未发布，跳过即可）
2. 剩余杂项 63.4h 里抽样多为真杂项；如还想降，可改为扫描会话**前几条**用户消息而非仅首条
3. 其他工具（Gemini CLI / Copilot）目前本机无会话日志，等有数据再接
4. 可加 launchd 定时刷新（数据在本地，无 iCloud 限制）
5. 可考虑 `--json` 输出模式，方便别的脚本消费
