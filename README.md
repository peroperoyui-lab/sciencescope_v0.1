# ScienceScope

一个在本机运行的学术研究助手：几位 AI 专家和你一起讨论，按完整的研究流程（读资料、分析、写作）帮你理解和推进自己的研究项目。所有数据都在安装目录的 `data/` 下，离开应用也能读。

当前版本：`1.0.0-alpha.0` 预览，正在重做界面并向 1.0.0-alpha 推进。尚无正式发布的安装包，预览包没有数字签名。

## 文档

从 [`docs/README.md`](docs/README.md) 开始，它是全部文档的索引。最常用的几份：

- [产品定位与 alpha 范围](docs/product/VISION.md)
- [现有功能与代码位置](docs/product/FEATURES.md)
- [路线图](docs/plans/ROADMAP.md)
- [决定记录](docs/decisions/DECISIONS.md)
- [协作方式](docs/process/WORKFLOW.md)
- 开发规则：根目录 [`AGENTS.md`](AGENTS.md)

## 开发

需要 Node 22。

```sh
npm install          # 依赖装在 node_modules；国内网络用 npmmirror
npm run start:app    # 开发版：启动新核心（app/），数据在 .sciencescope-local/data
npm run check        # 格式、lint、类型和全部测试
npm run package      # Windows 安装包（NSIS），只在 Windows 上运行
```

Windows 原生外壳（Tauri）的构建环境见 [`docs/process/NATIVE_SETUP.md`](docs/process/NATIVE_SETUP.md)。

## 目录

| 目录 | 内容 |
|---|---|
| `app/` | 新核心：`core/` 数据与事件，`services/` 发言、工具、秘书、资料库等，`runtime/` 智能体运行时（pi-ai），`server/` HTTP 接口，`ui/` 界面（Preact + htm） |
| `src-tauri/` | Windows 原生外壳 |
| `tools/` | 打包脚本 |
| `docs/` | 文档 |
| `ScienceScope.html`、`reference/` | 视觉基线：logo、配色和美术风格的来源 |
| `desktop/`、`scripts/`、`adapters/`、`src/`、`qa/`、`tests/`、`screenshots/` | 旧原型，已冻结，R5 时删除 |

## 署名

Publisher：**peroperoyui**。Contributors：**Codex**（AI 辅助开发）、**Claude**（Anthropic，AI 辅助审阅与开发）。此署名不是 Windows 数字签名。
