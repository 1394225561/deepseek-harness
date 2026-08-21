# 05 · macOS 没有 Landlock 的影响与平台沙箱机制

## 核心结论

macOS 不是"缺了沙箱"，而是**根本不用 Landlock** —— 平台链 darwin 上是原生 Seatbelt（`sandbox-exec`）。Landlock 缺席对 macOS 零影响。

## 平台 runner 链

`packages/sandbox/sandbox-local/src/index.ts` L159-162 `PLATFORM_CHAINS`：

```ts
linux:  ['bwrap', 'landlock']   // bwrap 优先，landlock 只是第二档回退
darwin: ['seatbelt']            // 唯一 = sandbox-exec（macOS 原生）
win32:  ['windows-acl']
```

`STATIC_ENFORCEMENT`（L177-180）：bwrap / landlock / seatbelt 都是 `'full'`。

- Landlock 只在 **Linux 链**上、且排在 bwrap 之后 —— Linux 有 bwrap 时根本用不到 landlock。
- macOS 用 `seatbeltProfileArgs`（`profiles.ts` L51-58）生成 SBPL：

  ```ts
  ['(version 1)', '(allow default)', '(deny file-write*)',
   '(allow file-write* (literal "/dev/null"))',
   ...每个 writableRoots 一个 '(allow file-write* (subpath "..."))']
  ```

  writableRoots 与进程内 fs 围栏 `@deepseek-ai/dsh-fs-sandbox` 共用，保证 Seatbelt 与 fs 围栏永不漂移。

## fail-closed：宁可拒绝，不静默裸跑

`selectRunner`（index.ts L493-494）缓存 `chainVerdict()`；`'unavailable'` 时 `confine()` 抛 `SandboxUnavailableError`（index.ts L494）。`defaultProbeSeatbelt`（L85）用 `sandbox-exec -p ... 'true'` 探测（exit 0 = 内核接受）。代码注释明示：若 sandbox-exec 未来消失，是这个 probe 负责 fail-closed。

## 对 macOS 用户的意义

| 问题 | 答案 |
|---|---|
| macOS 无 Landlock 影响能力吗？ | 不影响。macOS 从不走 landlock，走原生 Seatbelt，同为 full 强制级别 |
| 沙箱失效时会怎样？ | fail-closed：抛 `SandboxUnavailableError`，拒绝无沙箱执行，而非静默裸跑 |
| 有什么实际限制？ | ① macOS（SBPL 进程沙箱）与 Linux（mount namespace + landlock）实现不同，跨平台沙箱行为不能互相外推，一致性验证放 Linux；② 若某版本 macOS 移除 sandbox-exec → probe 失败 → 拒绝运行；③ 无 landlock 二进制可本地构建（native 只发布 linux-x64/arm64） |

## 对先前表述的修正

"当前 macOS 本无 landlock，两方式都缺失该能力" —— **只对 landlock 后端成立**。macOS 的沙箱能力由 Seatbelt 提供且是完整隔离，不是缺失。真正"npm 拿预编译 vs 源码自建"的差异只发生在 Linux。

## 证据文件

- `packages/sandbox/sandbox-local/src/index.ts`：`PLATFORM_CHAINS` L159-162 / `STATIC_ENFORCEMENT` L177-180 / `defaultProbeSeatbelt` L85 / `selectRunner` L493-494 / `landlockLauncher` L542 / `seatbeltExec` L547
- `packages/sandbox/sandbox-local/src/profiles.ts`：`seatbeltProfileArgs` L51-58 / `landlockProfileArgs` L30-36 / `bwrapProfileArgs` L16-23
- `native/landlock-run/README.md`：平台包矩阵、仅 Linux 5.13+、构建回退、probe 'unusable'
