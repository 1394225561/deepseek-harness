# Agent Note: PR artifact builds and aggregate TypeScript checks

Status: implemented

English | [中文](2026-10-05-pr-artifact-typechecks.zh.md)

## Problem

PR jobs need the same compiled packages for benchmarks, compatibility, packaging, and runtime checks. Building the repository-wide test and script programs in every artifact job repeats expensive diagnostics. In the allowed #3661 baseline, benchmark build preparation takes about 304 seconds before 432 seconds of serial measurements. A cold macOS arm64 Host compiler profile on Node 24.19.0 takes 84.01 seconds, including 55.92 seconds in the aggregate program; its 282 emitted projects take 24.33 seconds combined. Increasing concurrency consumes more shared-runner resources.

## Decision

Required Linux consumer and native Windows build jobs retain normal builds, including both complete aggregate programs. Public `build` and `typecheck` keep the same checks. [Node version ownership](2026-07-06-node-engine-floor.md) and [native Windows ownership](2026-08-08-native-windows-pull-request-ci.md) remain in force.

PR artifact builds compile every existing project reference from each compiler face with one serial `tsc -b` process, then run the ordinary Typert, bundling, Desktop, and Web stages. The helper reads the existing Host and Client aggregates rather than maintaining another package list. It omits only each root's additional test and script program; package diagnostics, emitted outputs, and Host-before-Client ordering remain required. Non-PR release and real-API workflow builds retain their normal checks.

CI invokes the internal build helpers directly and keeps the root package manifest unchanged. Root manifest edits activate the separate native-addon platform matrix even when only build aliases change; avoiding that trigger preserves the existing workflow set and concurrent-job ceiling without weakening native validation.

Job inventory, runner selectors, and benchmark sample counts stay fixed; gate and worker ceilings do not increase. The three compatibility cases use at most two concurrent jobs; the two-target Python runtime matrix follows their completion. Before that matrix, four Linux lanes, two compatibility jobs, the Python SDK, and three Windows lanes permit at most ten worker jobs. Afterwards, the remaining eight lanes and two runtime targets keep the same ceiling. Coverage partitions reuse compact file-cost metadata within their platform and runner pool. Parallel release packing uses pnpm's existing bounded scheduler; serial publication keeps family order.

Each Node version runs the same seven source compatibility specs in one serial Vitest invocation. Both file parallelism and the CLI worker limit are fixed to one, and the gate sets `VITEST_MAX_WORKERS=1` because that environment variable overrides Vitest's CLI limit. Files retain fork isolation; the build-backed Node 22 lazy-search smoke keeps its separate build dependency. Three paired local samples preserve all 253 assertion outcomes and reduce startup-only median time from 11.52 to 8.69 seconds, without increasing owned descendant-process peak.

## Alternatives considered

**Raise job or worker concurrency.** Rejected because the shared runner must keep its current resource ceiling.

**Remove aggregate checks from every build.** Rejected because package projects do not typecheck all repository tests and scripts; required Linux and Windows jobs must retain those diagnostics.

**Cache compiled outputs across revisions.** Deferred because cache correctness and invalidation add obligations that removing duplicate aggregate work does not need.

## Consequences

The cold Host reference build takes 23.49 seconds with 1.91 GiB peak RSS, compared with 84.01 seconds and 3.87 GiB for the complete compiler pass. All 5,932 emitted files match by path and SHA-256. These are single local compiler samples, excluding bundling and tests; current-head CI owns the PR latency result. The benchmark scenarios and their budgets remain unchanged.

Parallel packing relies on the pinned pnpm CLI to honor exact recursive filters, the pack destination, the workspace concurrency limit, and each package's lifecycle hooks. A pnpm upgrade must pass the real-CLI checks in `scripts/release/pack.spec.ts` before release packing adopts it.

Coverage weights sum Vitest's distinct environment, preparation, setup, collection, and execution costs. CI's platform/environment/pool cache prefixes exclude the previous `coverage-times-<run>` archives. Persistent local checkouts can retain wall-clock weights for files not measured during rollout; removing `.coverage-times.json` resets that history. These advisory weights affect partition assignment, while the complete inventory and merged coverage thresholds remain required.

Artifact builds deliberately do not diagnose aggregate-only test or script errors. Required normal builds reject those errors; fixture checks also reject package errors on both paths and compare emitted JavaScript, declarations, maps, and build information. Removing or changing a required full build requires transferring both aggregate checks to another blocking owner first. Master serial references remain complete under their [existing policy](2026-07-21-serial-cross-platform-ci-reference.md).
