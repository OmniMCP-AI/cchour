# TODO — cctime AI 编程工具时间报表

## 迭代 1（2026-06-11）— 全部完成 ✅

- [x] 1. 探查数据源
  - [x] Claude Code: `~/.claude/projects/*/*.jsonl`（1061 个文件，783MB，每行带 timestamp + cwd）
  - [x] Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（95 个）+ `archived_sessions`（11 个）
- [x] 2. 写解析脚本 `cctime.py`
- [x] 3. 生成 HTML 报表 `report.html`（浅色白底、纯静态零依赖）
- [x] 4. 无头浏览器截图验证渲染
- [x] 5. 写 STATE.md

## 迭代 2（2026-06-11）— Node 化 + 发布

- [ ] 1. 检查 npm 包名 `cctime` 是否可用、npm 登录状态、gh CLI 状态
- [ ] 2. 把 cctime.py 移植为 Node.js（零依赖，流式解析，逻辑与 Python 版一致）
- [ ] 3. package.json：`bin: { cctime }`，可 `npx cctime` / 全局安装后直接运行
- [ ] 4. 本地运行验证：生成 report.html，数字与 Python 版对齐
- [ ] 5. 写 README.md（英文，npm 风格）+ .gitignore + LICENSE
- [ ] 6. git init，建 GitHub public repo 并 push
- [ ] 7. npm publish，验证 `npm i -g cctime` 可装可跑
- [ ] 8. 更新 STATE.md，TODO 全部勾完
