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

## 五、构建覆盖面与「最新代码生效」的判定模型

本节把「三条命令执行完之后，还有哪些东西可能是旧的」系统化，依据是一次真实的合并后重建排障（2026-09-22，fork 的 dev 分支，Node v22.21.1 / Windows，源码启动 `pnpm dsh web --no-open`）。

### 1. 三条命令各自负责什么

| 命令 | 覆盖 | 明确不覆盖 |
|---|---|---|
| `pnpm install` | workspace 链接与 `node_modules`；postinstall 安装的 Lefthook 钩子与翻译 merge driver | Harness 家目录下的 profile（`~/.dsh/profiles/*`） |
| `pnpm run clean` | 按 tsconfig 项目引用图删除所有 outDir（各包 `lib/`、`apps/web/lib`、native entry lib）、`.dsh-build`、根级遗留 `*.tsbuildinfo`、以及「只剩已知生成物」的孤儿包目录 | `apps/web/dist`（Vite 产物）；profile 与任何仓库外目录 |
| `pnpm run build` | `build:native-system`（仅 Host Node 插件）→ `build:lib`（host/client 各一遍 `tsc -b` + tsdown）→ `build:web`（Vite）→ 写回 client build record | Desktop 产物、完整原生二进制集、Python 主运行时 |

`pnpm run build` 已内含两侧类型检查：`build:lib:host` 与 `build:lib:client` 分别执行 `tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json`，与 `pnpm run typecheck` 覆盖的是同两个程序，因此 build 成功之后不必再单独跑 typecheck。`clean` 在跨上游更新时值得保留（尤其是上游增删包），日常同分支迭代可以省掉——`tsc -b`、tsdown 与 Vite 的增量都是安全的。

### 2. 判定模型：安装域与 profile 域，只有一类受仓库命令刷新

`createRuntimeResolution`（`packages/boot/app-boot/src/profile.ts:404`）把可见包分成两个作用域，`entries` 按「安装域 → profile 域」排列：

- **安装域**：`collectInstallationScopePackages`（同文件 336 行）从正在运行的 dsh 安装的 `package.json` 出发，对依赖与 peerDependencies 做 BFS。源码启动时锚点是 `apps/cli/package.json`，每个包都经 `apps/cli/node_modules/@deepseek-ai/*` symlink 指向仓库 workspace——**这一域完全受 `pnpm install` + `pnpm run build` 刷新**。
- **profile 域**：`collectProfileScopePackages`（同文件 511 行）取「不在安装域中的 bundle 层」再做依赖闭包；`installedProfilePackageNames`（同文件 463 行）只认 profile 自己 `node_modules` 里真实存在的依赖。这一域的代码位于 Harness 家目录，仓库的三条命令碰不到。

自检方法：读 `~/.dsh/profiles/<name>/package.json`。`dependencies` 为空（本次排查的 web profile 即为空）说明没有域外包，三条命令足够；非空则列出的每个包都是家目录里的独立副本，只能通过插件管理器的安装流程更新，与仓库构建无关。所有出厂 bundle（`dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-acp-app`、`dsh-sdk-app`、`dsh-sdk-minimal`）都是 `apps/cli` 的依赖，因此默认 profile 的 bundle 层及其插件闭包整体落在安装域内；profile 域只在家目录安装了域外 bundle 或第三方插件时才出现。

### 3. 三条命令之外仍需单独执行的产物

| 产物 | 命令 | 何时需要 |
|---|---|---|
| Python 主运行时与锁定 wheels | `pnpm run prepare:primary-runtime` | 使用 PTC / workspace-dependencies 相关功能；需联网，按 `scripts/primary-runtime/lock.json` 校验下载 |
| Desktop 应用 | `pnpm run build:desktop` | 使用桌面端；`pnpm run build` 不产出 |
| 完整原生二进制集 | `pnpm run build:native-system`（不带 `--host-addon-only`） | 需要 Host Node 插件之外的原生二进制 |

### 4. 已排除的怀疑：tsx 转换缓存

`pnpm dsh` 走 `node --import tsx/esm`，tsx 会在 `%TEMP%\tsx-<user>` 落一份转换缓存（本次排查时有 1058 个条目）。缓存键是 `sha1(源码 + 文件URL + esbuild 选项 + tsx 版本 + 缓存格式版本)`，**源码文本进键**，文件一改动键必然变化，不可能读到旧转换；进程内的 `Map` 随退出清空，磁盘条目按 `floor(Date.now()/1e8)` 分桶、超过 7 桶（约 8 天）删除。因此更新代码后不需要手动清理该目录，也不必设置 `TSX_DISABLE_CACHE`。

### 5. 真正会让「最新代码不生效」的失效模式

1. **改了客户端代码却只重启 `pnpm dsh web`**：Host 侧跑 TS 源码，浏览器加载的却是 `apps/web/dist` 里的构建产物。改 client 代码后要么补跑 `pnpm run build:web`，要么改用 `pnpm run dev:web`（它监听并重建 client bundle）。每次全量 `pnpm run build` 的用法不受影响。
2. **上游删了包，`pnpm run clean` 会直接失败**：规划阶段发现无 `package.json` 的包目录里含未知文件时整体拒绝删除并列出条目，按提示手动清理后重跑。
3. **切换 Node 主版本**：原生插件 ABI 变化，需重跑 `pnpm install` 与 `pnpm run build`。
4. **postinstall 被跳过或依赖从缓存还原**：补跑 `node scripts/install-lefthook.mjs`；只影响 Git 钩子，不影响运行时代码。
5. **浏览器缓存**：Vite 产物使用内容 hash 文件名，基本无虞；个别情况硬刷新即可。

### 6. 案例：合并重建后设置页全部插件报「包元信息错误」

这是一次「构建完全成功、行为却仍旧不对」的完整定位记录，用来说明第 5 条之外的第六类失效模式——源码与产物都是新的，但一条既有代码路径在新的启动方式下假设失效。

**现象**：`pnpm install` → `pnpm run clean` → `pnpm run build` → `pnpm dsh web --no-open` 之后，设置页「内置插件」里每个插件卡片都显示 `包元信息错误：Plugin metadata for @deepseek-ai/dsh-<pkg>: TypeError: Cannot assign to read only property 'stack' of object 'Error: Package subpath './locale/en.json' is not defined by "exports" in …package.json imported from …\profiles\web\'`。

**定位链**：`packages/host/plugin-inventory/src/index.ts:88` → `PluginPackages.metaOf`（`packages/boot/app-boot/src/profile-resolution/service.ts:114`）→ `readPluginMeta`（`packages/boot/app-boot/src/package-meta.ts:148`）。

**设计意图是软失败**：`readPluginMeta` 先探测 `<pkg>/locale/en.json`。抽查的内置插件（`dsh-tool-bash`、`dsh-agent-instructions`、`dsh-persona`）既没有 `locale/` 目录，`exports` 里也没有 `./locale/*`，只有真正带本地化元数据的包才导出它（例如 `packages/experimental/agent-team`，其 `locale/en.json` 与 `locale/zh.json` 存在）。因此 Node 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` 是预期结果，`optionalResourcePath` 配 `missingResource`（同文件 59-72 行）本应吞掉它并回退到 package.json 的 `name`/`description`；`docs/cookbook/adding-a-package.zh.md` 也要求导出 `<包名>/locale/en.json` 供 locale 查询，即未导出等于无本地化元数据。

**缺陷点**：解析被 `installRuntimeInterception` 路由到安装域副本，失败时走 `throwWithImporter`（`packages/boot/app-boot/src/profile-resolution/resolver.ts:655`）。它先改 `error.message`，再无条件执行 `error.stack = stack.replace(...)`（665 行）。在 `node --import tsx/esm` 启动下，从 `loader.resolveSync` 抛出的错误是一个包装后的 Error，其 `stack` 是**只读数据属性**（`writable: false`），这行赋值于是抛出 `TypeError`。该 TypeError 没有 `code`，`missingResource` 不认识它，于是一路冒泡到 `package-meta.ts:170`，拼成界面上的「包元信息错误」。报错里的 importer 已从路由父目录改写回 profile 目录，证明消息改写确实发生过、失败发生在紧随其后的栈赋值上。

**最小复现**（在能解析到该包的目录下执行，例如 `apps/cli`）：

```mjs
try {
  import.meta.resolve('@deepseek-ai/dsh-tool-bash/locale/en.json')
} catch (error) {
  const descriptor = Object.getOwnPropertyDescriptor(error, 'stack')
  console.log('code:', error.code, '| writable:', descriptor?.writable, '| accessor:', !!descriptor?.get)
}
```

分别用 `node` 与 `node --import tsx/esm` 运行，得到下表中的两行结果（Node v22.21.1，同一 specifier、同一父 URL）：

| 启动方式 | 错误对象 `stack` | 赋值结果 |
|---|---|---|
| `node repro.mjs` | 访问器（get/set，configurable） | 成功 |
| `node --import tsx/esm repro.mjs` | 数据属性，`writable: false` | `TypeError: Cannot assign to read only property 'stack'` |

用 `throwWithImporter` + `optionalResourcePath` 的等价模拟做端到端验证：现状精确复现报错文案，加锁后返回 `undefined`，与普通 node 一致。

**为什么仓库门禁没有抓到**：触发需要三个条件同时成立——tsx 源码启动、profile 解析拦截层已安装、目标插件没有 `./locale/*` 导出。仓库测试跑在 vitest 下（未注册 ESM hook，拿到的是原始 Node 错误，栈可写）；`scripts/verify-package-meta.ts` 虽然也用 tsx 运行，但不安装拦截层，根本不经过 `throwWithImporter`。

**影响面**：仅展示元数据。`PluginLocalizedMeta` 只被 client 展示层消费（`packages/client/ui-plugin-manager/src/client/presentation.ts` 在没有 `meta.title` 时回退为模块名），插件加载、启停、装包与会话均不受影响，`packages/llm/plugin-package-inventory-deepseek` 也不读它。附带代价更值得注意：任何被路由的 ESM 解析失败（`ERR_MODULE_NOT_FOUND` 与 `ERR_PACKAGE_PATH_NOT_EXPORTED` 都已实测为只读栈）都会被改写成这个 TypeError，真实原因被抹掉——排障时看到它就等于「某个模块没解析到」，与构建新旧无关。

**修复**：`resolver.ts:665` 增加可写判断，只重写可写的栈，消息改写保留：

```ts
    const stack = error.stack
    error.message = message
    /* v8 ignore next -- Node's resolver errors always carry a stack */
    if (stack !== undefined && Object.getOwnPropertyDescriptor(error, 'stack')?.writable !== false) {
      error.stack = stack.replace(originalMessage, message)
    }
```

CommonJS 路径实测不受影响（tsx 下 `require.resolve` 的错误栈仍是可写访问器），因此 `throwWithoutCjsAnchor`（688 行）暂时不必改；但它是同一段模式，将来 CJS 解析若也经过 hook 包装会复现。

**未定边界**：只确认了「是什么/什么时候发生」（tsx 启动下 resolver 错误的 `stack` 变为只读数据属性），没有定位到 Node/tsx 内部具体是哪一层创建的该属性；已排除 JS 层 `Object.defineProperty`、hook 数量、`setSourceMapsEnabled`、`Error.prepareStackTrace`、`Object.freeze/seal` 等解释。修复不依赖这一层机制。

**临时规避**：用普通 node 跑已构建的 CLI，绕过 tsx hook——`node apps/cli/lib/bin.js web --no-open`（`apps/cli/package.json` 的 bin 即 `lib/bin.js`）。这只是诊断捷径，不是受支持的开发loop。

### 7. 更新后的最小验证组合

`pnpm run build` 成功即代表两侧类型检查与全部产物就绪。再要一道行为信号，选覆盖合并面的最小检查：`pnpm run test:snapshot`（keyless 录播回放，不需要 API key）比全量 `pnpm run test` 便宜，又能抓到产物层面的回归；随后照常做一次启动冒烟（`pnpm dsh web --no-open` 或 `pnpm dsh --profile headless "…"`）。设置页出现「包元信息错误」时按第 6 节判定，不要去折腾构建。

## 六、一句话总结

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
- `packages/boot/app-boot/src/profile.ts`：`collectInstallationScopePackages` 的安装域 BFS、`installedProfilePackageNames` 与 `collectProfileScopePackages` 的 profile 域、`createRuntimeResolution` 的 installation→profile 条目顺序
- `packages/boot/app-boot/src/profile-resolution/resolver.ts`：`throwWithImporter` 的消息与栈改写、`throwWithoutCjsAnchor` 的同模式 CJS 版本、`installRuntimeInterception` 的 ESM 适配与 `restoreImporter`
- `packages/boot/app-boot/src/package-meta.ts`：`missingResource`/`optionalResourcePath` 的软失败设计、`readPluginMeta` 的诊断包装
- `packages/boot/app-boot/src/profile-resolution/service.ts` 与 `packages/host/plugin-inventory/src/index.ts`：`PluginPackages.metaOf` 及其以 `ctx.baseUrl` 调用的位置
- `packages/client/ui-plugin-manager/src/client/presentation.ts`：`meta.title` 缺失时回退为模块名，证明元信息仅作用于展示
- `docs/development.md`「Application commands」：`start:web` 与 `pnpm dsh web` 是同一次启动、`dev:web` 重建 client bundle、浏览器加载的是构建产物
- `docs/cookbook/adding-a-package.zh.md`：导出 `<包名>/locale/en.json` 供 locale 查询的要求，以及 package.json 字段回退
- `apps/cli/package.json`：六个出厂 bundle 均为其依赖（安装域判定依据）、`bin.dsh` 指向 `lib/bin.js`（临时规避）
- `packages/shell/tool-bash/package.json` 等内置插件清单：无 `./locale/*` 导出且无 `locale/` 目录；对照 `packages/experimental/agent-team` 的 `./locale/*.json` 导出与 `locale/en.json`、`locale/zh.json`
- `scripts/primary-runtime/prepare.ts` 与 `scripts/primary-runtime/lock.json`：Python 主运行时的锁定下载，不在 `pnpm run build` 内
- `scripts/verify-package-meta.ts`：不安装拦截层，因此不经过 `throwWithImporter`（门禁未抓到该缺陷的原因）
- tsx 4.22.4 `dist/index-XurvG3JN.mjs`：`FileCache` 的键构造（源码文本进键）与按 `floor(Date.now()/1e8)` 分桶的过期清理
