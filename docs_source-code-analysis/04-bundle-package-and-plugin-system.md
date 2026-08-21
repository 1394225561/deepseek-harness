# 04 · 如何判断 bundle 包，以及插件系统如何实现

## 一、$DSH_HOME：用户数据的单根目录

`$DSH_HOME` 由 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` 解析（profile.ts L32 引入；实现于 `packages/util/home-paths/src/index.ts` L87-91）。**三级优先级，取第一个命中的**：

| 优先级 | 取值 | 说明 |
|---|---|---|
| 1（最高） | 显式配置的路径（`configured` 参数） | 由 CLI 等显式传入 |
| 2 | 环境变量 `$DSH_HOME` | 空白/纯空格视为未设置，不会解析成当前工作目录 |
| 3（默认） | `~/.dsh`（`join(homedir(), '.dsh')`，index.ts L12/61-63） | `DSH_HOME_DIR_NAME = '.dsh'` |

最后经 `expandHomePath`（支持 `~`、`~/`、`~\` 前缀展开为 `os.homedir()`）+ `resolve()` 规范化成绝对路径（index.ts L90）。当前 macOS 上、未显式配置也未设环境变量时，默认值就是 `/Users/root-mac/.dsh`。

Harness 把**所有用户数据**都收拢在这个单根之下（index.ts L80 "The harness keeps all user data under one root"），profile 相关的两个子目录：

- `$DSH_HOME/profiles/<name>/` —— profile 目录（`package.json` 声明 `dsh.profile.bundles` + 用户 `cordis.patch.yml`）；
- `$DSH_HOME/profiles/node_modules/` —— 平铺 symlink 兜底目录（见下文 `healProfilesModuleFallback`）。

代码位置：`packages/util/home-paths/src/index.ts`（`DSH_HOME_DIR_NAME` L12 / `DSH_HOME_ENV` L18 / `defaultDshHome` L61-63 / `resolveDshHome` L87-91 / `dshHomePath` L98-100）。

## 二、判断依据：package.json 里的 `dsh.bundle`

bundle 包的标志是顶层字段：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

对应 `packages/boot/app-boot/src/profile.ts` L42-46 的 `DshBundleManifest`。实例：`packages/bundle/headless/package.json` L41-45。

反过来，profile 目录（`$DSH_HOME/profiles/<name>/`）的 package.json 带 `"dsh": { "profile": { "bundles": [...] } }`（profile.ts L48-51 `DshProfileManifest`）。强校验：profile 列出的 bundle 若 package.json 没有 `dsh.bundle`，启动直接报错 `declares no dsh.bundle`（profile.ts L393）。

## 三、解析路径：Node 自己的 module resolution

`loadProfile`（profile.ts L371-400）对 `bundles` 列表（如 headless = `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']`，`PROFILE_TEMPLATES` L114）逐个：

1. `resolveBundleDir`（L344-355）：遍历两个锚点——安装锚点（`apps/cli/package.json`）优先、profile 目录次之；
2. `packageDirFromAnchor`（L322-341）：`createRequire(anchor).resolve.paths(packageName)` 做普通 node_modules 父目录上溯；
3. 找不到 → 抛错 `cannot resolve profile bundle ... run 'dsh plugin --profile ... install'`（L352）；
4. 读 `dsh.bundle.patch`，用 `loadOverlayPatches` 解析 patch 层（L396）。

源码 dev 时上溯会命中 `apps/cli/node_modules` 里的 workspace symlink → 本地仓库。注释明确契约："in-box bundle 永远来自与当前 dsh 同一套安装"。

`healProfilesModuleFallback`（L223-241）：维护 `$DSH_HOME/profiles/node_modules` 平铺目录，对 app 的依赖闭包（`dependencies` + `peerDependencies` BFS）各建一个 symlink，让 profile 里用户后装的第三方插件也能通过父目录上溯找到 in-box 插件。

## 四、patch 组合与覆盖语义

bundle 的 payload 是 `cordis.patch.yml` —— patch 条目列表，每个条目有 `id`、`name`、`inject`、`config`、`disabled`，以及 `insert` / `override` 等操作。例（base patch）：

```yaml
- insert:
    - id: llm
      name: '@deepseek-ai/dsh-llm'
    - id: session
      name: '@deepseek-ai/dsh-session'
```

headless patch 插入：

```yaml
- insert:
    - id: headless-runner
      name: '@deepseek-ai/dsh-headless'
      inject: [headlessStartup]
      config:
        task: !!js ctx.headlessStartup.task
```

组合树 = 空根 + 各 bundle patch 按序叠加 + 用户 profile `cordis.patch.yml` + `--patch` 覆盖；按行 `id` 合并，后者覆盖前者。应用由 `@deepseek-ai/cordis-plugin-include` 负责。

## 五、插件系统的两种形态（packages/CLAUDE.md）

- **函数插件**：named-export `name` / `inject`（依赖的服务名数组）/ `Config`（schemastery schema）/ `apply(ctx, config)`，无 default export。实例 `packages/bundle/headless/src/index.ts`：

  ```ts
  export const name = 'headless-runner'
  export const inject = ['agentDefaultModel', 'agents', 'sessions']
  export const Config: z<Config> = z.object({ task: z.string().required() })
  export function apply(ctx: Context, config: Config): void { ... }
  ```

- **服务插件**：default-export 一个继承 Cordis `Service` 的类，注册到 `ctx.<key>`（如 dsh-session 提供 `ctx.sessions`）。

`@deepseek-ai/cordis-plugin-loader` 读组合树，对每个 `name` 动态 `import()` 并实例化进 `Context`；插件内注册一律走 `ctx.effect()` / `ctx.on()` 保证可卸载。混合两种形态会让 Loader 丢弃函数插件命名空间（postmortem `docs/postmortem/0001-acp-default-export-drops-inject.md`）。

## 六、完整链路示例（headless profile 启动）

1. dsh 启动 → `prepareProfile`（`apps/cli/src/profile-boot.ts`）；
2. `loadProfile` 读 profile 的 `dsh.profile.bundles = [dsh-base, dsh-headless]`；
3. 两锚点解析 → 源码 dev 命中本地 workspace → 读到两份 `cordis.patch.yml`；
4. patch 叠加出组合树（含 `headless-runner` 一行，`config.task` 由 `ctx.headlessStartup.task` 注入）；
5. Loader import `@deepseek-ai/dsh-headless` → 函数插件 `apply` 执行：`await ctx.get('loader')?.await()` → `agents.create(...)` → 送任务 → `sessions.flush(...)` → 输出最终文本 → `ctx.get('appExit')` 退出（headless/src/index.ts L96-150）。

## 证据文件

- `packages/boot/app-boot/src/profile.ts`：`DshBundleManifest` L42 / `DshProfileManifest` L48 / `PROFILE_TEMPLATES` L114 / `healProfilesModuleFallback` L223 / `packageDirFromAnchor` L322 / `resolveBundleDir` L344 / `loadProfile` L371
- `packages/util/home-paths/src/index.ts`：`DSH_HOME_DIR_NAME` L12 / `DSH_HOME_ENV` L18 / `resolveDshHome` L87-91 / `dshHomePath` L98-100（`$DSH_HOME` 解析）
- `packages/bundle/headless/package.json` L41-45（`dsh.bundle`）
- `packages/bundle/base/cordis.patch.yml`、`packages/bundle/headless/cordis.patch.yml`
- `packages/bundle/headless/src/index.ts`（函数插件形态）
- `packages/CLAUDE.md`（插件导出约定）、`docs/postmortem/0001-acp-default-export-drops-inject.md`
