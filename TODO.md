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

- [x] 1. 检查 npm 包名 `cctime` 可用 ✓、npm 已登录（jianshuo）✓、gh 已认证 ✓
- [x] 2. 把 cctime.py 移植为 Node.js `bin/cctime.js`（零依赖，流式解析；个人分类规则抽到 ~/.cctime/categories.json）
- [x] 3. package.json：`bin: { cctime }`，支持 `-o` `--days` `--open` `--help` `--version`
- [x] 4. 本地运行验证：186.9h / 11.6h 与 Python 版对齐，0.3 秒；browse 截图核对渲染正常
- [x] 5. README.md + .gitignore（排除 report.html 个人数据）+ LICENSE (MIT)
- [x] 6. git init，https://github.com/jianshuo/cctime 已 push（cctime.py 已移除）
- [ ] 7. npm publish — **卡在 npm 2FA OTP，需用户提供验证码**；之后用 `npx cctime --version` 验证
- [x] 8. 更新 STATE.md
