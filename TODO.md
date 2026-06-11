# TODO — cchour AI 编程工具时间报表

# TODO 迭代 5（2026-06-11）— npm 发布收尾 + 杂项会话内容级分类

- [ ] 1. 确认 npm 发布成功：registry 上已有 cchour@1.1.0，用 `npx cchour@1.1.0 --version` 验证可安装可运行
- [ ] 2. 杂项（根目录会话）内容级分类：读会话首条用户消息，按关键词归入已有分类，降低「杂项」占比
- [ ] 3. 本地运行验证：总时长数字不变（分类不影响间隔法统计），杂项占比明显下降，截图核对
- [ ] 4. 版本 bump 1.2.0，README 同步，commit + push
- [ ] 5. npm publish 1.2.0（若再卡 2FA OTP，留指令给用户）
- [ ] 6. 更新 STATE.md / TODO.md

# TODO 迭代 4（2026-06-11）— 按更新后的 CLAUDE.md 改名 cctime → cchour

- [x] 1. 确认 npm 包名 `cchour` 可用（E404，未被占用）
- [x] 2. 改名：package.json（name/bin）、bin/cchour.js、README、HTML footer、默认输出文件名、.gitignore；个人配置已复制 ~/.cctime/categories.json → ~/.cchour/
- [x] 3. 本地运行验证：`cchour --version` = 1.1.0，报表数字与迭代 3 一致（228.1h / 13.9h）
- [x] 4. commit + push；GitHub 仓库已改名 → https://github.com/jianshuo/cchour（旧 URL 自动跳转，本地 remote 已更新）
- [ ] 5. npm publish cchour — **唯一剩余事项，卡在 2FA**：请在项目目录跑 `npm publish --access public --otp=<验证码>`
- [x] 6. 更新 STATE.md / TODO.md

## 迭代 3（2026-06-11）— 对齐需求规格

- [x] 1. GAP 阈值改为 900 秒（需求：相邻 15 分钟以内算持续工作；原实现误用 300 秒）
- [x] 2. HTML 报表增加按周（最近 12 周，周一起点）、按月（最近 12 个月）堆叠图；README 同步更新
- [x] 3. 本地运行验证：Claude Code 228.1h / Codex 13.9h（阈值放宽后比 300 秒版的 186.9h/11.6h 增加，符合预期），0.6 秒；截图核对周/月图渲染正常
- [x] 4. 版本号 bump 到 1.1.0，commit + push 到 GitHub
- [ ] 5. npm publish — **仍卡在 npm 2FA OTP**（已重试确认 EOTP），需用户跑 `npm publish --otp=<验证码>`
- [x] 6. 更新 STATE.md / TODO.md

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
