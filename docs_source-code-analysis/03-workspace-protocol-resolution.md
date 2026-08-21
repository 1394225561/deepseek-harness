# 03 · `"@deepseek-ai/dsh-*": "workspace:^"` 的解析全过程

## 一句话

pnpm 不做"按 group 找包"的映射；**group 只是组织目录**。它靠扫描 `pnpm-workspace.yaml` 的 globs、读每个成员的 `package.json.name` 建立"包名 → 目录"索引，`workspace:^` 按名字链接，发布时改写为 semver 范围。

## 逐步过程

### 第 1 步：pnpm 建立 workspace 包索引

`pnpm-workspace.yaml` L2-9 的 globs：

```yaml
- vendor/*
- packages/*/*
- native/landlock-run/packages/*
- apps/*
```

pnpm 展开后递归读每个 `package.json` 的 `name`，得到映射：

| name | 目录 |
|---|---|
| `@deepseek-ai/dsh-cmdline` | packages/boot/cmdline/ |
| `@deepseek-ai/dsh-app-boot` | packages/boot/app-boot/ |
| `@deepseek-ai/dsh-headless` | packages/bundle/headless/ |
| `@deepseek-ai/dsh-sandbox-local` | packages/sandbox/sandbox-local/ |
| `@deepseek-ai/dsh` | apps/cli/ |

`<group>`（boot / bundle / sandbox）纯组织性，glob `packages/*/*` 恰好覆盖两层即匹配，不参与 name 匹配。name 与叶子目录的对应是仓库约定 `@deepseek-ai/dsh-<pkg>`（唯一例外是 CLI 应用 `apps/cli`，name 为 `@deepseek-ai/dsh` 而非 `@deepseek-ai/dsh-cli`），由 hygiene 门禁约束。

### 第 2 步：`workspace:` 协议触发本地链接

`apps/cli/package.json` 里 `"@deepseek-ai/dsh-headless": "workspace:^"` → pnpm 见 `workspace:` 前缀，查索引命中 `packages/bundle/headless/`，在 `apps/cli/node_modules/@deepseek-ai/dsh-headless` 建 symlink → `../../packages/bundle/headless`。`linkWorkspacePackages: true`（pnpm-workspace.yaml L25）只是兜底——让未写 `workspace:` 的裸版本号也优先解析到 workspace。

### 第 3 步：`^` 的语义（发布时才体现）

- 本地：永远链接 workspace，`^` 无实际作用。
- 发布：pnpm 把 `workspace:^` 改写为真实 semver 范围（如 `^0.1.0-rc.8`）。npm 用户据此从 registry 拉取各包。

### 第 4 步：运行时加载哪个文件

- 源码 dev：`node --import tsx/esm apps/cli/src/bin.ts` → tsx 读 tsconfig paths 重写 import 到 `src`（如 `@deepseek-ai/dsh-typert-registry` → `packages/typert/registry/src/index.ts`，tsconfig.base.json L44）。
- npm：`node lib/bin.js` → 无 paths，走各包 exports 默认 `./lib/index.js`。

## 小结：两组查找

| 时机 | 机制 | 结果 |
|---|---|---|
| install 期 | pnpm 按 name 查 workspace 索引 → symlink | 包名 → 仓库目录 |
| 源码 dev 运行期 | tsx tsconfig paths | 仓库目录 → `src/*.ts` |

## 证据文件

- `pnpm-workspace.yaml` L2-9（globs）、L25（`linkWorkspacePackages`）
- `apps/cli/package.json`（`bin` / `files` / `workspace:^` 依赖）
- `tsconfig.base.json` L40-45（paths）
- 命名约定：`docs/cookbook/adding-a-package.md`（`@deepseek-ai/dsh-<name>`）
