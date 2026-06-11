# STATE — cchour 项目状态

## 当前状态（迭代 5 完成，2026-06-11）

Node.js 零依赖 CLI，**v1.2.0（本地，待 publish）**：

- 代码：`bin/cchour.js`（单文件，零依赖，Node ≥ 18）
- GitHub：https://github.com/jianshuo/cchour （public，main，已 push v1.2.0）
- npm：**cchour@1.1.0 已发布**（用户用 OTP 完成），`npx cchour@1.1.0 --version` 验证通过；
  **1.2.0 待发布**——publish 仍卡 2FA，需用户在项目目录跑 `npm publish --access public --otp=<验证码>`
- 迭代 5 改动：杂项（根目录会话）内容级分类——杂项占比 **48% → 29%**

## 内容级分类（迭代 5 新增）

- 分类规则格式扩展为 `[["分类名", [项目名关键词], [内容关键词]?], ...]`，第三个数组可选、向后兼容
- 对杂项目录（home / `~/code` 根 / `/` / private-tmp）下的每个 Claude Code 会话，
  读文件头 256KB 逐行解析出**首条真实用户消息**（跳过 isMeta / Caveat / 标签），
  用内容关键词匹配；命中则拆成合成项目「code 根目录 · 写作与发布」并覆盖分类，未命中留在杂项
- Codex 杂项会话暂未做内容分类（格式不同，量小），下次可做
- `~/.cchour/categories.json` 已补全 8 类的内容关键词（公众号/字幕/百姓网/tailscale 等）
- 验证：杂项 128.1h·48% → 82.0h·29%；剩余的抽样看多为真杂项（hello、随机问题、系统折腾）

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

## 下次迭代可做

1. **npm publish 1.2.0（唯一卡点）**：用户跑 `npm publish --access public --otp=<code>`，再 `npx cchour@1.2.0 --version` 验证
2. Codex 杂项会话也做内容级分类（rollout 格式里取首条 input_text）
3. 「iCloud 文档」「Downloads」目录会话也可走内容级分类（目前只对 SPECIAL_DIRS 四个目录生效）
4. 其他工具（Gemini CLI / Copilot）目前本机无会话日志，等有数据再接
5. 可加 launchd 定时刷新（数据在本地，无 iCloud 限制）
