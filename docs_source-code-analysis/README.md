# DeepSeek Harness 源码分析笔记

针对 DeepSeek Harness 仓库（dev 分支，`0.1.0-rc.8`）"官方 npm 安装包 vs 源码本地 dev"两种使用机制的源码级分析。每篇独立成文、可单独查阅；文末各有"证据文件"小节指向代码位置。

## 目录

| 编号 | 主题 | 文件 |
|---|---|---|
| 01 | npm 官方安装包 vs 源码本地 dev 的整体区别 | [01-npm-install-vs-source-dev.md](01-npm-install-vs-source-dev.md) |
| 02 | workspace symlink、插件解析到本地、native 构建三句话详解 | [02-workspace-symlink-and-src-loading.md](02-workspace-symlink-and-src-loading.md) |
| 03 | `workspace:^` 依赖的逐步解析过程 | [03-workspace-protocol-resolution.md](03-workspace-protocol-resolution.md) |
| 04 | bundle 包判定与 Cordis 插件系统的实现 | [04-bundle-package-and-plugin-system.md](04-bundle-package-and-plugin-system.md) |
| 05 | macOS 无 Landlock 的影响与平台沙箱机制 | [05-landlock-macos-sandbox-impact.md](05-landlock-macos-sandbox-impact.md) |
| 06 | 源码 dev 日常使用产生的磁盘数据全清单 | [06-disk-cache-inventory.md](06-disk-cache-inventory.md) |
| 07 | pnpm 缺失定位、corepack 安装机制与本机残留清理 | [07-pnpm-install-and-corepack.md](07-pnpm-install-and-corepack.md) |
| 08 | upstream 更新合并进 dev 后，让「从源码运行」持续生效的操作序列 | [08-upstream-merge-and-source-run-refresh.md](08-upstream-merge-and-source-run-refresh.md) |
| 09 | 第三方提供方（自定义 provider）的推理强度设置 | [09-custom-provider-reasoning-effort.md](09-custom-provider-reasoning-effort.md) |
| 10 | 让 dsh 出站请求走本地 HTTP 代理（NODE_USE_ENV_PROXY） | [10-outbound-http-proxy.md](10-outbound-http-proxy.md) |

## 阅读顺序建议

- 先看 01 建立整体认知；
- 02、03 深入"包解析"机制（symlink、`workspace:^`、tsconfig paths）；
- 04 讲插件与组合（bundle、profile、Loader）；
- 05 讲沙箱（Landlock / Seatbelt / fail-closed）；
- 06 是运行期磁盘数据清单（`$DSH_HOME` 下各落盘点 + 临时目录 + 构建产物）。

## 速览

- **npm 包** = 编译产物快照（`lib/`），依赖按 semver 从 registry 拉取；**源码 dev** = tsx 加载 `src` TS 源码，依赖解析到本地 workspace。
- **`workspace:^`** 本地永远链接到同名 workspace 成员；发布时被改写为 `^<版本>` 供 npm 用户拉取。
- **group 目录不参与解析**；包名 `@deepseek-ai/dsh-<pkg>` 由叶子目录名约定而成。
- **bundle 包** = package.json 带 `dsh.bundle.patch`；**profile** = 带 `dsh.profile.bundles`；插件系统 = Cordis 组合树 + Loader 动态 import。
- **Landlock 只在 Linux 链上是回退**；macOS 用原生 Seatbelt（`sandbox-exec`），同为 `full` 强制级别，无 Landlock 无实际影响。
- **运行期磁盘数据**全部收拢在 `$DSH_HOME`（默认 `~/.dsh`）单根下：会话日志（`sessions/`）、身份（`.anonymous-user-id`）、设置/凭据/附件、profiles 清单；另有 `os.tmpdir()` 下的 spill/子进程/sandbox 临时目录（见 06 篇）。
