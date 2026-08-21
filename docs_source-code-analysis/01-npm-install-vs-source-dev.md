# 01 · npm 官方安装包 vs 源码本地 dev 的区别

## 结论表格

| 维度 | npm 官方安装包 | 源码本地 dev |
|---|---|---|
| 代码来源 | 发布到 registry 的编译产物（每个包 `lib/`） | 仓库工作区的 TypeScript 源码（`src/`） |
| 版本 | 发布时的快照（如 `0.1.0-rc.8`） | 当前分支（dev）的任意状态 |
| 依赖解析 | 按 `package.json` 里的 semver 范围从 registry 拉取 | `workspace:^` 链接到本地 workspace（pnpm symlink） |
| 加载器 | 普通 Node，`node lib/bin.js` | `node --import tsx/esm apps/cli/src/bin.ts`，tsx 按 tsconfig paths 把包名重写到 `src` |
| 插件/bundle 解析 | 从安装锚点（全局 node_modules）解析 | 命中 workspace symlink，落到本地仓库 |
| native 二进制（仅 Linux） | 预编译包（`@deepseek-ai/node-addon-landlock-run` 各架构） | 需自行 `pnpm build:native`（source of record 在 `native/`） |
| 改代码 | 无效 | 改 `src` 即生效（重跑后） |

## 逐点解释

### 1. 编译产物 vs TS 源码
npm 包里每个 workspace 成员都是独立 npm 包（`@deepseek-ai/dsh-*`），`files` 只发布 `lib/*.js` 等编译产物；源码 dev 时 tsx 通过 tsconfig paths 把 import 重写为 `packages/<group>/<pkg>/src/index.ts`，直接加载 TS 源码。

### 2. 快照 vs 当前分支
npm 安装的是发布当刻的产物；源码 dev 就是你 checkout 出来的分支状态，可以任意修改。

### 3. 本地链接 vs registry
npm 用户：`@deepseek-ai/dsh` 的依赖是发布时改写后的 `^0.1.0-rc.8`，去 registry 拉各包；源码 dev：`workspace:^` 让 pnpm 建 symlink 到本地 workspace（机制见 03 篇）。

### 4. 插件解析位置
profile 启动时用 Node 自身 module resolution（`createRequire.resolve.paths` 父目录上溯）从安装锚点 / profile 目录找 bundle 包（见 04 篇）。npm 模式找到全局安装目录，源码 dev 命中 `apps/cli/node_modules` 里的 workspace symlink → 本地仓库。

### 5. native 差异只在 Linux
`native/landlock-run` 发布 linux-x64/arm64 预编译包；源码 dev 在 Linux 上要么装平台包、要么 `pnpm build:native`（需 musl-tools）。macOS/Windows 没有 landlock 平台包，走 Seatbelt / ACL（见 05 篇）。

## 证据文件

- `apps/cli/package.json`：`bin` 指向 `lib/bin.js`，`files` 仅 `lib/*.js` + `config`，依赖全部 `workspace:^`
- `tsconfig.base.json` L30-54：paths 把每个 `@deepseek-ai/dsh-*` 映射到 `.../src/index.ts`
- `pnpm-workspace.yaml`：workspace globs + `linkWorkspacePackages: true`
- `native/landlock-run/README.md`：平台包矩阵、构建回退、probe 'unusable'
