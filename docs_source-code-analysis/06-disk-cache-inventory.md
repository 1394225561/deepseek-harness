# 06 · 源码本地 dev 日常使用产生的磁盘数据全清单

## 总览

所有用户数据收拢在**单根目录** `$DSH_HOME`（默认 `~/.dsh`）下，由 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` 解析：显式配置路径 → `$DSH_HOME` 环境变量（空/纯空格视为未设置）→ `~/.dsh`（`packages/util/home-paths/src/index.ts` L87-91）。整体搬家只需设 `$DSH_HOME`。

按触发时机分四类：**每次运行**、**首次/懒初始化**、**用户主动或配置驱动**、**临时目录**。此外源码 dev 模式还会产生**构建产物**（npm 安装模式不发这些）。

---

## 第一类：每次运行必写

### 1. `$DSH_HOME/sessions/<projectKey(cwd)>/<encoded-session-id>/session.jsonl.zstd`

- **用途**：会话持久化主日志（JSONL，默认 Zstandard 压缩 + packChunks 批量打块；同目录伴随块文件/索引）。
- **路径**：`packages/session/session-persistence-jsonl/src/format.ts` L176-208 —— `projectDir`（无 cwd → `_no-cwd`）、`sessionDir`、`logPath`（`session` + 后缀）。
- **装配**：`packages/bundle/base/cordis.patch.yml` L98-101 `root: !!js dshHomePath('sessions')`。
- **写入**：`index.ts` L529-569 `materializePosix`（0700 目录 + 临时文件 fsync + `link()` 发布，防并发覆盖）、L651-679 `appendLines`。会话开始建目录、事件追加批量写入、结束时 flush/close。
- **root 必填无默认**：`index.ts` L62-68 / L127 —— 刻意避免散落到 cwd。
- **改路径**：`$DSH_HOME`，或 base patch 里 `session-persistence-jsonl.config.root` 覆盖。

### 2. `$DSH_HOME/profiles/node_modules/`

- **用途**：模块解析平铺兜底目录。`healProfilesModuleFallback` 对 app 依赖闭包（`dependencies` + `peerDependencies` BFS）各建一个 symlink，让 profile 里用户后装的第三方插件能通过父目录上溯找到 in-box 插件。
- **写入**：`packages/boot/app-boot/src/profile.ts` L223-255（`mkdirSync(modulesDir, { recursive: true })` L226 + `ensureSymlink`）；每次启动检查，缺失则重建。
- **改路径**：`$DSH_HOME`。

### 3. `$DSH_HOME/profiles/<name>/cordis.yml`

- **用途**：CLI 每次运行把最终组合树写回 profile 根 `cordis.yml`（空 root 入口 + 各补丁层）。
- **写入**：`apps/cli/src/profile-boot.ts` L101 `writeFileSync(join(profile.dir, 'cordis.yml'), ...)`；`PROFILE_ROOT_FILENAME = 'cordis.yml'` L67。
- **改路径**：`$DSH_HOME`。

---

## 第二类：首次运行 / 懒初始化

### 4. `$DSH_HOME/.anonymous-user-id`

- **用途**：匿名用户身份 ID（UUID v4），一次性生成后复用；遥测上报时作为 Resource 的 `user.id`。
- **写入**：`packages/identity/anonymous-user-id/src/index.ts` L29（文件名常量 `.anonymous-user-id`）、L69（`join(resolveDshHome(...), '.anonymous-user-id')`）、L78（mkdir 0700）、L79（`writeFileSync` + `'wx'` 排他写）、L89（并发冲突兜底覆盖）。
- **改路径**：`$DSH_HOME`；删除该文件即重置身份。

### 5. `$DSH_HOME/profiles/<name>/`（profile 清单本身）

- **用途**：`package.json`（manifest `dsh.profile.bundles`）+ `cordis.patch.yml`（profile 补丁层）+ `pnpm-workspace.yaml`（模板）。
- **写入**：`packages/boot/app-boot/src/profile.ts` L36（`PROFILES_DIR = 'profiles'`）、L39、L114-117（web / headless 模板）、L152-168（`initProfile` 建目录+写文件）；`apps/cli/src/plugin.ts` L90 / L122-124（`dsh plugin` 更新重写 package.json）。`loadProfile` 缺 profile 时自动 `initProfile`（profile.ts L383）。
- **改路径**：`$DSH_HOME`。

### 6. `$DSH_HOME/storages/<unit>.json`（仅 web-app profile）

- **用途**：KV 存储域，每个 domain 一个 JSON 文件，原子整体重写。实际触发：domain 首次 open 时 `mkdir`，写操作时更新。
- **装配**：`packages/bundle/web-app/cordis.patch.yml` L51-62 —— `storage-json` `root: !!js dshHomePath('storages')`、`storage-domain` `backend: json`。
- **实现**：`packages/storage/storage-json/src/index.ts` L34（root 必填无默认）、L64（`mkdir 0700`）、L65（每 unit 一个 `<name>.json`）。
- **实际域名**：
  - `workspace` → `workspace.json`（`packages/workspace/workspace/src/spec.ts` L68）
  - `message_feedback` → `message_feedback.json`（`packages/feedback/message-feedback/src/spec.ts` L85）
  - `session_projcache` → `session_projcache.json`（投影检查点缓存，`packages/session/session-projection-cache/`；按 `writeEveryEvents: 200` / `writeIntervalMs: 5000` 节流落盘 + turn/结束/断开强制落盘，web-app patch L76-80）
- **改路径**：`$DSH_HOME`，或 web-app patch 里 `storage-json.config.root` 覆盖。

---

## 第三类：用户主动 / 配置驱动

### 7. `$DSH_HOME/settings.yaml`

- **用途**：用户全局设置，支持 YAML/JSON，chokidar 热重载，跨进程写锁。
- **写入**：`packages/settings/settings-file/src/index.ts` L55-56 `join(resolveDshHome(config.dshHome), 'settings.yaml')`，原子写。
- **改路径**：`$DSH_HOME`，或 settings 配置里显式 `path`。

### 8. `$DSH_HOME/.credentials.yaml`

- **用途**：凭据（密钥/token）持久化。
- **写入**：`packages/credentials/credentials-local/src/index.ts` L52（`CREDENTIALS_FILENAME = '.credentials.yaml'`）、L81（`join(resolveDshHome(config.dshHome), CREDENTIALS_FILENAME)`）。
- **改路径**：`$DSH_HOME`，或凭据配置里显式 `path`。

### 9. `$DSH_HOME/attachments/v1/objects/<sha256[0:2]>/<sha256>`

- **用途**：附件本地内容寻址存储（sha256 两级分桶）。
- **写入**：`packages/attachment/attachment-local/src/index.ts` L63（`root = resolve(join(resolveDshHome(config.dshHome), 'attachments', 'v1'))`）。
- **装配**：base patch L106-107 `attachment-local`。
- **改路径**：`$DSH_HOME`，或 attachment-local 配置 `root`。

### 10. `$DSH_HOME/cordis.patch.yml`（用户 home 层补丁）

- **用途**：用户手写补丁层；boot 时叠加顺序 = bundle 层 > profile 层 > home 层 > `--patch` overlays > telemetry 开关。
- **加载**：`apps/cli/src/profile-boot.ts` L49-51 `homePatchPath() = join(resolveDshHome(), PROFILE_PATCH_FILENAME)`（`PROFILE_PATCH_FILENAME = 'cordis.patch.yml'`）。**运行时只读，由用户手工维护**。

### 11. `$DSH_HOME/.agent-presets/`

- **用途**：用户自己创作的 agent preset（信任级 `user`）；与随包发布的 `config/agent-presets/`（信任级 `root`，非用户数据）分开。
- **加载**：`packages/preset/agent-presets/src/discovery.ts` L41（`USER_PRESET_DIR = '.agent-presets'`）、`src/index.ts` L134（`dshHomePath(USER_PRESET_DIR)`，trust `'user'`）。运行时扫描/创作，非启动自动写入。

---

## 第四类：操作系统临时目录（非 `$DSH_HOME`）

### 12. `<tmpdir>/dsh-spill-*`

- **用途**：spill 溢出临时存储（超 `maxInlineBytes: 50000` 的 tool 结果落到这里），`mkdtemp` 0700 防其他本地用户读取。
- **写入**：`packages/spill/spill-local/src/store.ts` L28（`mkdtempSync(join(tmpdir(), 'dsh-spill-'))`）、L113-115（`open('wx', 0o600)`）。
- **改路径**：spill-local 配置 `root`（base patch L346-347；maxInlineBytes L351-352）。

### 13. `<tmpdir>/dsh-subprocess-*`

- **用途**：子进程默认 spill/日志目录。
- **写入**：`packages/subprocess/subprocess-local/src/spawn.ts` L90（`mkdtempSync(join(tmpdir(), 'dsh-subprocess-'))`）。
- **改路径**：`defaultSpillDir` / `spillDir` 配置。

### 14. `<tmpdir>/dsh-*`

- **用途**：sandbox 工作区/临时目录（探测运行时 `--workspace <tmpdir> --temp <tmpdir>`）。
- **写入**：`packages/sandbox/sandbox-local/src/index.ts` L415（`mkdtempSync(join(tmpdir(), 'dsh-'))`）。
- **改路径**：sandbox-local 配置 `workspaceRoot` / `tmp`（base patch `workspaceRoot: !!js process.cwd()` L176）。

---

## 确认不落盘 / 纯内存项

| 项 | 说明 |
|---|---|
| `session-query-sqlite` | `path: ':memory:'` + `openAt: never`（base patch L117-121），不落盘；若被显式配置为文件路径才产生 `*.db` + `*.db-wal` + `*.db-shm` |
| `session-telemetry-otel` | OTLP/HTTP **网络上报**，无本地文件；`mode: DISABLED` 默认（base patch L148-164），`DSH_TELEMETRY_MODE` 显式开启，`DSH_TELEMETRY_DISABLED` 任一非空即禁用 |
| session-title / session-stats / compaction / schedule | 走内存/存储域/事件流，无直接文件写入 |
| `.env` 层 | 只读加载（继承 env > `<cwd>/.env` > `<home>/.env`），**永不写入**；`apps/cli/src/profile-boot.ts` 的 `loadLayeredEnv`（`packages/boot/app-boot/src/index.ts` L177-198） |

---

## 源码 dev 特有的构建产物（npm 安装模式不发这些）

| 路径 | 内容 | 依据 |
|---|---|---|
| `packages/*/lib/types/` | 每包 tsc 输出（`outDir: lib/types`） | 各包 tsconfig（`rootDir: src` / `outDir` / `composite`） |
| `*.tsbuildinfo` | TypeScript 增量构建缓存（`composite`/`incremental`） | 各包 tsconfig + `.gitignore` |
| `apps/web/dist/` | web 前端构建产物 | `.gitignore` |
| `.dsh-build/` | 顶层构建中间产物 | `.gitignore` |
| `dist-exe/` | 打包可执行产物目录 | `.gitignore` |
| `node_modules/`（仓库内） | 依赖安装产物 | `.gitignore` 首行 |

注意：npm 安装模式也有 `node_modules`，但源码 dev 的 `lib/types/`、`*.tsbuildinfo`、`apps/web/dist/`、`.dsh-build/`、`dist-exe/` 是 npm 用户不会产生的（他们拿预编译 `lib/*.js`）。

---

## 触发时机汇总表

| 时机 | 条目 |
|---|---|
| 每次运行 | 会话 `session.jsonl.zstd`（追加写）、`profiles/node_modules` 兜底重建、profile 根 `cordis.yml` 重写 |
| 首次运行/懒初始化 | `.anonymous-user-id`、`profiles/<name>/` 清单、`storages/*.json` domain 首次 open（web 专属） |
| 用户主动/配置驱动 | `settings.yaml`、`.credentials.yaml`、`attachments/v1/`、`.agent-presets/`、`cordis.patch.yml` |
| 按需临时（`os.tmpdir()`） | `dsh-spill-*`、`dsh-subprocess-*`、`dsh-*`（sandbox 探测） |

## 证据文件索引

- `packages/util/home-paths/src/index.ts`：`resolveDshHome` L87-91 / `dshHomePath` L98-100 / `DSH_HOME_DIR_NAME` L12 / `DSH_HOME_ENV` L18
- `packages/session/session-persistence-jsonl/src/format.ts`：`projectDir` L176 / `sessionDir` L189 / `logPath` L201
- `packages/session/session-persistence-jsonl/src/index.ts`：`materializePosix` L529 / root 必填 L62-68
- `packages/identity/anonymous-user-id/src/index.ts`：L29 / L69 / L78-89
- `packages/settings/settings-file/src/index.ts`：L55-56
- `packages/credentials/credentials-local/src/index.ts`：L52 / L81
- `packages/attachment/attachment-local/src/index.ts`：L63
- `packages/storage/storage-json/src/index.ts`：L34 / L64-65
- `packages/boot/app-boot/src/profile.ts`：`PROFILES_DIR` L36 / `healProfilesModuleFallback` L223 / `initProfile` L152-168
- `apps/cli/src/profile-boot.ts`：`cordis.yml` L67/L101 / `homePatchPath` L49-51 / `loadLayeredEnv`
- `packages/spill/spill-local/src/store.ts`：L28 / L113-115
- `packages/subprocess/subprocess-local/src/spawn.ts`：L90
- `packages/sandbox/sandbox-local/src/index.ts`：L415
- `packages/bundle/base/cordis.patch.yml`：session L98-101 / sqlite L117-121 / telemetry L148-164 / spill L346-352 / attachment L106-107
- `packages/bundle/web-app/cordis.patch.yml`：storage L51-62 / projection-cache L76-80
