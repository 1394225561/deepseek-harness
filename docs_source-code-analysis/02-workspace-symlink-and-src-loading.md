# 02 · workspace symlink、插件解析到本地、native 构建 —— 三句话详解

三句话分别是：

1. workspace 包经 pnpm symlink 指向 src
2. 插件解析到本地 workspace，改 src 即生效
3. native/ 是 source of record，需本地构建；当前 macOS 本无 landlock，两方式都缺失该能力

## 第一句：workspace 包经 pnpm symlink 指向 src —— 实际上是"两层"

严格说 symlink 指向的是**包目录** `packages/<group>/<pkg>/`，不是 `src/`；`src/` 是 tsx 在运行时加载的。是两层叠加：

- **install 期（pnpm）**：`pnpm-workspace.yaml` 的 globs（`packages/*/*` 等）扫描出全部 workspace 成员；依赖里写 `workspace:^` 时，pnpm 在 `node_modules/@deepseek-ai/<pkg>` 建 symlink → `packages/<group>/<pkg>`。
- **运行期（tsx）**：`node --import tsx/esm` 启动时读 `tsconfig.base.json` 的 `paths`，把 `@deepseek-ai/dsh-*` 的 import 重写到 `.../src/index.ts`。

所以"指向 src" = symlink 定位目录 + tsx paths 选定目录内的源码文件。

## 第二句：插件解析到本地 workspace，改 src 即生效

- 所有产品能力都是 Cordis 插件，运行时由 Loader 按包名动态 `import()` 加载（机制见 04 篇）。
- profile 启动时用 `createRequire(anchor).resolve.paths(packageName)`（Node 父目录上溯）解析 bundle 包（`packages/boot/app-boot/src/profile.ts` L322-352）。
- 源码 dev 下第一锚点是 `apps/cli/package.json`（`INSTALL_ANCHOR`），上溯命中 `apps/cli/node_modules/@deepseek-ai/*` 的 workspace symlink → 落到本地包。
- 改 `src` 后重跑 `pnpm dsh`（tsx 重新翻译当前 `src`）即生效——中间没有"先 build 再跑"这一层。这就是"改 src 即生效"。

注意：npm 模式下 `bin` 是 `lib/bin.js`，改 `src` 无效，只能等下一个发布版本。

## 第三句：native/ 是 source of record，需本地构建 —— 需要修正一半

- `native/landlock-run/` 是 landlock 启动器的 source of record，发布为 `@deepseek-ai/node-addon-landlock-run` 家族（entry + linux-x64/arm64 平台包）。源码 dev 在 Linux 上需要 `pnpm build:native`（README 注明需 musl-tools）。
- 但"当前 macOS 本无 landlock，两方式都缺失该能力"**只对 landlock 这个后端成立，不等于 macOS 缺沙箱能力**。macOS 平台链是 `['seatbelt']`，用 macOS 自带的 `sandbox-exec`（Seatbelt）做完整隔离（详见 05 篇）。真正"npm 拿预编译 vs 源码自建"的差异只发生在 Linux。

## 证据文件

- `pnpm-workspace.yaml` L25 `linkWorkspacePackages: true`
- `tsconfig.base.json` L40-45 paths（如 `@deepseek-ai/dsh-invariants` → `packages/runtime-diagnostics/invariants/src/index.ts`）
- `apps/cli/src/profile-boot.ts`：`INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))`
- `packages/boot/app-boot/src/profile.ts` L322-352（`packageDirFromAnchor` / `resolveBundleDir`）
- `packages/sandbox/sandbox-local/src/index.ts` L159-161（`PLATFORM_CHAINS`）
