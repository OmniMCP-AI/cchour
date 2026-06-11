# STATE — cctime 项目状态

## 当前状态（迭代 2 完成，2026-06-11）

Python 版（迭代 1）已移植为 **Node.js 零依赖 CLI** 并开源：

- 代码：`bin/cctime.js`（单文件，零依赖，Node ≥ 18）
- GitHub：https://github.com/jianshuo/cctime （public，main 分支）
- npm：包名 `cctime` v1.0.0 —— **publish 卡在 npm 2FA OTP，等用户提供验证码**（`npm publish --otp=<code>`）
- 旧的 `cctime.py` 已从仓库删除（个人分类关键词不进公开仓库）

## 用法

```bash
npm i -g cctime   # 或 npx cctime
cctime --open     # 生成 ./cctime-report.html 并打开
cctime -o report.html --days 60
```

## 数据源与方法（与迭代 1 相同）

| 工具 | 数据位置 | 说明 |
|------|----------|------|
| Claude Code | `~/.claude/projects/<flattened-cwd>/*.jsonl` | 时间戳正则流式提取，worktree 归并主项目 |
| Codex | `~/.codex/sessions/` + `~/.codex/archived_sessions/` | 文件头 256KB 正则取 `cwd`（session_meta 首行可能超长，不能按行 JSON.parse——迭代 2 踩过的坑） |

- 活跃时长 = 间隔法：相邻事件 ≤ 300 秒计入，孤立事件计 30 秒
- 工具总时长按事件并集，避免并行会话重复计
- 时区：Node 版用系统本地时区（不再硬编码 +8）
- 性能：783MB 数据约 0.3 秒（比 Python 版还快）

## 个人化与公开包的分离

- 公开包内置**通用**分类规则；个人规则（含公司业务关键词）放在 `~/.cctime/categories.json`（已写好，8 类）
- `report.html` / `cctime-report.html` 在 .gitignore 里，个人数据不进公开仓库
- 路径前缀从 `os.homedir()` 动态算，不再硬编码 `/Users/jianshuo`

## 验证记录（2026-06-11）

- Node 版与 Python 版数字对齐：Claude Code 186.9h / Codex 11.6h、Codex 31 个项目
- `--version` `--help` `-o` 正常；gstack browse 截图核对：卡片 198h/187h/12h、30 天日图、24h 分布、分类、Top20 渲染全部正常，浅色白底

## 下次迭代可做

1. npm publish 完成后用 `npx cctime@1.0.0 --version` 验证安装
2. 「杂项（根目录会话）」仍占比最大，可读会话首条用户消息做内容级分类
3. 其他工具（Gemini CLI / Copilot）接入
4. 可加 launchd 定时刷新（数据在本地，无 iCloud 限制）
