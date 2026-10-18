# R1 交接：Windows 本地化（给 Sol）

R1 是在云端 Linux 上写的。请在 Windows 上确认它能跑，有平台问题直接修。按 AGENTS.md 交付，报告不超过 15 行。

## 要做的

1. `git pull` 集成分支，运行 `npm install`。新增的依赖：prettier、eslint、typescript、@types/node、yaml。
2. `npm run check`：格式、lint、类型检查和 21 个测试都要通过。
3. 命令行走一遍：
   ```
   node app/cli.js --data .sciencescope-local/temp/r1 project-create 气候政策
   node app/cli.js --data .sciencescope-local/temp/r1 meeting-create 方法讨论 --project <上一步的 id>
   node app/cli.js --data .sciencescope-local/temp/r1 post <会议 id> 你好
   node app/cli.js --data .sciencescope-local/temp/r1 edit plans <项目 id> append "{\"text\":\"- [ ] 测试\"}"
   ```
   在资源管理器里打开数据根，确认 `projects\气候政策-<id>\workbench\plans.md` 可读，中文文件夹名正常。
4. `node app/main.js --data .sciencescope-local/temp/r1` 能打印启动行，Ctrl+C 能正常退出。
5. 补打标签（云端代理推不了）：
   `git tag -a v0-prototype 6d2b10c -m "v0 prototype line" && git push origin v0-prototype`

## 重点看的 Windows 问题

- 项目改名会重命名文件夹：确认文件夹被资源管理器或编辑器打开时会发生什么，必要时改为重试或给出明确提示。
- 原子写入用"临时文件 + 重命名"：确认在 Windows 上替换已存在的文件不会报 EPERM 或 EBUSY（杀毒软件或索引服务占用时），必要时加短暂重试。
- SQLite 的 WAL 文件（`-wal`、`-shm`）在退出后能正常清理。

## 不做的事

- 不改 `desktop/`、`scripts/`、`adapters/` 的旧代码。
- 不做原生外壳的接线，那是 R3 之后的 L1。
