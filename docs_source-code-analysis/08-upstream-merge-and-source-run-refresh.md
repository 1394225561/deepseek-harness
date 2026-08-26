# 08 · upstream 更新合并进 dev 后，让「从源码运行」持续生效的操作序列

前提：本地已按 01 篇方式成功从源码运行（`pnpm install && pnpm run build && pnpm dsh …`）。本文回答：fork 的 dev 分支合并了 upstream 的重大更新之后，要在本地继续以「从源码运行」方式吃到这些更新，需要按什么顺序做哪些事、为什么。基于 dev 分支 `0.1.1-rc.2`（2026-08-26 调研）。

## 一、背景：源码运行的产物依赖模型

### 1. CLI 入口永远跑 TS 源码

根 `package.json` 的 `dsh` script：

```json
"dsh": "node --import tsx/esm apps/cli/src/bin.ts"
```

tsx 的 ESM-only hook 负责 TypeScript 转换，并按 `tsconfig.base.json` 的 `paths` 把 `@deepseek-ai/dsh-*` 工作区导入重写到各包 `src/`（两层机制见 01、02 篇）。所以**纯 TS 源码层面的改动保存后重跑即生效**，中间没有「先 build 再跑」这一层。

该启动向量的决策记录：`.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md`——Node 26 移除 `--experimental-transform-types` 导致旧的 Node 原生转换链整体瘫痪后，TUI/Web/headless 统一收敛到 `node --import tsx/esm`，一个向量覆盖整个 engines 范围；CI 用 `apps/cli/tests/source-launch.compat.spec.ts` 把这个向量钉死。

### 2. 但有三类内容不走源码平面，来自构建产物

source launch 与 repository build 是**刻意分离的两个操作**（`.agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.md`）：

| 内容 | 由哪一步生成 | 缺失时的表现 |
|---|---|---|
| Typert 生成的 Host 反射产物 / Host-for-Client Remote 投影 | `build:lib` 的 Host tsdown 阶段（seed 为 `tsconfig.host.json`） | profile 启动直接以模块解析错误失败，**不会提示去 build** |
| Web 前端 bundle + client 插件的浏览器产物 | `build:web` + Client tsdown（`DSH_BUILD_FACE=client`） | 启动时报错并**明确指向 `pnpm run build`** |
| 配置子进程（cordis.yml 加载等）执行的代码 | 各包构建产物（tsc emit + tsdown bundle），plain Node 直接跑 | 按**构建时刻**的产物执行 |

`scripts/build.ts` 的实际步骤：删除 client build record → `build:lib`（host tsc → host tsdown【含 Typert 生成】→ client tsc → client tsdown）→ `build:web` → 写回 record（把本次 `DSH_CLIENT_*` 环境绑定到 Vite 输出与动态 client bundle；release packing 和 built Web 测试会拒绝缺失或不一致的 record）。

### 3. 新鲜度模型：stale 产物被静默接受

启动器**刻意不校验产物新鲜度**：产物存在就直接用。后果是——合并 upstream 更新后若不重建，TUI/headless 可能照常启动，但 Web UI 会静默跑旧的前端/client 代码，「可以一直跑旧的浏览器代码直到下一次 build」。这是设计决定（避免每次启动支付全仓构建延迟），同时意味着**让更新生效是使用者的责任**。另有分工：`pnpm run dev:web` 只重建声明了 `dsh.client` 的包并启用热更新路径，但不重建前端 shell。

## 二、操作序列（合并后按序执行）

### 第 1 步：完成 git 合并

```sh
git fetch upstream
git checkout dev
git merge upstream/master   # 或上游对应分支；解决冲突后提交
```

### 第 2 步：核对工具链约束是否变化

看合并后根 `package.json` 两处：

- `"packageManager": "pnpm@11.7.0"` —— 上游若升版，corepack 方案会自动跟随该字段下载对应版本（机制见 07 篇）；用 npm 全局装的 pnpm 则可能错版；
- `"engines": { "node": "^22.19.0 || >=24.0.0" }` —— 本地 node 必须落在范围内。

历史教训：Node 26 一度移除 `--experimental-transform-types`，使当时的源码启动链完全无法启动且无 CI 信号捕获（见上文 Agent Note）。engines/packageManager 变化不是小事，先对齐工具链再往下走。

### 第 3 步：`pnpm install`（必做）

合并几乎必然带来 `pnpm-lock.yaml` 与依赖变化；upstream **新增**的包会被根 workspaces globs（`packages/*/*` 等）自动扫描收录并建立 symlink（收录与链接机制见 02、03 篇）。跳过这步会出现缺依赖或链接过期。

### 第 4 步（条件）：上游删除/改名了包 → `pnpm run clean`

`scripts/clean.ts` 移除 `.dsh-build`、根级遗留 `.typecheck`/`*.tsbuildinfo`、以及「仅含已知残留（`node_modules`/`lib`/`.typecheck`）」的孤儿包目录；规划阶段先全量校验，发现不安全的孤儿目标就**整体拒绝删除**，因此是安全的。删包后不清掉残留 `lib/`，会在后续 build/hygiene/knip 出现难以理解的错误。

### 第 5 步：`pnpm run build`（更新真正生效的关键一步）

必须重建的原因对应第一节的三类产物：

- 上游改动触及 Typert 类型图（如 `SessionEventMap` 新事件、新的插件/服务类型）→ 生成产物必须重出；
- 触及任何 `dsh.client` 浏览器侧插件 → Web UI bundle 必须重出；
- 配置子进程消费的是构建产物 → 必须刷新。

注意 `pnpm run typecheck` 会顺带跑完整个 Host lib 阶段（`docs/development.md`：typecheck = `build:lib:host` + client tsc，Host tsdown 含 Typert 生成），**但不含 Client tsdown 与 `build:web`**——所以大合并后应完整 `pnpm run build`，而不是只 typecheck。

### 第 6 步：验证

```sh
pnpm run typecheck          # 全仓类型通过；顺带刷新 Host 侧产物
pnpm run test               # 或按合并面过滤跑聚焦用例
pnpm run test:snapshot      # keyless 回放装配后的应用转录，验证没漂移
pnpm dsh web                # 或 pnpm dsh --profile headless "…" 做启动冒烟
```

仓库约定：不必全量门禁（CI 负责穷尽覆盖），选覆盖合并面的最小检查即可；`test:e2e` 需要 `DEEPSEEK_API_KEY`，无 key 自动跳过。

## 三、特殊面速查表

| 面 | 合并后要做什么 |
|---|---|
| `vendor/`（vendored Cordis） | 树内固定副本（pinned source copies），随 merge **自动带入，无需任何额外动作**；只有想主动升级 vendor 时才走 `vendor/README.md` 的 sync 流程 |
| `native/landlock-run` | 属于同一 pnpm workspace 和 lockfile；平台包是 npm `optionalDependencies`，macOS 本地源码运行不受影响（macOS 沙箱走 Seatbelt，见 05 篇）；Linux 使用方或 launcher 契约变化由 `pnpm install && pnpm run build` 覆盖开发态 |
| `python/` | 不影响 Node 侧源码运行；除非同时使用 Python SDK 且上游动了 `python/`，才需按 `python/README.md` 重装 |
| `.env` / `DEEPSEEK_API_KEY` | 本地文件，merge 不触碰 |

## 四、常见坑

1. **忘了第 5 步**：TUI/headless 照常启动（Typert 产物还是旧的但存在），Web UI 静默跑旧代码——新鲜度不校验是设计决定，不是 bug。
2. **删包后忘了 clean**：孤儿 `lib/` 目录干扰后续构建与门禁，报错位置离病因很远。
3. **Node 版本落在 engines 之外**：CI 的 source-launch smoke（`apps/cli/tests/source-launch.compat.spec.ts`）会红；本地表现为启动失败或语法拒绝。
4. **只 typecheck 不 build web**：Web UI 要么报缺产物，要么继续用旧 bundle。

## 五、一句话总结

`git merge` → 核对 engines/packageManager → `pnpm install` →（有删包则 `pnpm run clean`）→ `pnpm run build` → typecheck + 聚焦测试 + 启动冒烟。

---

## 证据文件

- 根 `package.json`：`packageManager`/`engines` 字段；`dsh` script（tsx/esm 启动向量）；`build`/`build:lib:*`/`build:web`/`clean`/`typecheck` 全套 script 定义
- `README.md`「Run from source」小节：install → build → `pnpm dsh web`，并明示「`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.」
- `.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md`：tsx/esm 向量决策、Node 26 事故、paths 无条件应用、smoke 门
- `.agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.md`：Typert 产物缺失的报错形态、stale 产物静默接受、`dev:web` 分工
- `scripts/build.ts`：删 record → `build:lib` → `build:web` → 写 record 的顺序与环境绑定
- `scripts/clean.ts`：`knownOrphanEntries`、先校验后删除的整体拒绝语义
- `docs/development.md`「TypeScript project layout」附近：root build 的依赖顺序、Typert 仅在 Host tsdown 运行、typecheck 先行 Host lib、静态面经 `paths` 解析到 `src`
- `native/README.md`：landlock-run 属于根 workspace、平台包为 optionalDependencies
