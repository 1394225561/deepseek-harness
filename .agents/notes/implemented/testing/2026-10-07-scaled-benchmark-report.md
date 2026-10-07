# Agent Note: Scaled machine and memory-pressure benchmark report

Status: implemented

English | [中文](2026-10-07-scaled-benchmark-report.zh.md)

## Problem

Benchmark budgets state whether one endpoint regressed on the hosted runner. They do not tell readers how slow the same endpoint is on an older laptop or a typical cloud instance, or whether its working set fits a machine with 4 GB or 8 GB of available memory, so a passing or failing number does not convey user impact.

## Decision

Every `test:bench` run writes `benchmarks/.dsh-report/report.html`, a self-contained page without network resources. Bench files pass each budgeted wall-clock median to `recordTimings` and whole-process peak RSS to `recordPeakMemory` from [scaling-report.ts](../../../../benchmarks/support/scaling-report.ts) before asserting budgets. A Vitest global setup clears the results before the run and renders the page after it, including after failed cases. Budgets and assertions do not change.

### Machine scaling

[machine-profiles.ts](../../../../benchmarks/support/machine-profiles.ts) lists laptops from 2015, 2019, 2023, and 2026 with SSD storage, mainstream cloud instances with their default system disks, the hosted runners, and the M4 Pro calibration reference. Each profile has a PassMark single-thread rating, retrieved on 2026-10-07, and a typical 4 KiB queue-depth-1 latency of its storage. A scaled endpoint is `ms × ((1 − io) × cpuScore(measured) / cpuScore(target) + io × ioLatency(target) / ioLatency(measured))`. `io` is a commented storage-wait estimate declared per endpoint beside the benchmark; the page lets readers change it per endpoint. The measuring machine is matched from the CPU model and can be changed in the page.

On Apple M5 Pro the first content-index search measured 58.7 s; the model predicts 168 s on the EPYC 7763 runner, against a recorded hosted median of 144 s.

### Memory pressure

The Session corpus list, search, and fork cases report whole-process peak RSS for the largest synthetic working sets. The page shows each peak as a share of 4 GB and 8 GB of available memory. Peaks are not scaled.

### Exclusions

Long-Session `first`, `input`, and `streamWall` include paced replay waits and are not recorded. The browser page heap is read after a forced garbage collection, so it is not a peak and is not recorded. Core count, memory size, and thermal limits are not modelled.

## Alternatives considered

**Run cases under an operating-system memory limit.** A cgroup limit needs root on Linux CI and is unavailable on macOS. The measured peaks stay below 1 GB, so a 4 GB limit would not change the timed path while adding privileged setup to a required gate.

**Measure storage wait from CPU time.** Wall time minus CPU time also contains event-loop yields, timers, and child scheduling, so it does not isolate storage. Most workers do not report CPU time either.

**Benchmark-wide storage share.** Session open restores and projects after closing its file, so one share per benchmark overstates high-latency disks for memory-only endpoints.

**Multi-core or Geekbench scores.** Timed endpoints run on one JavaScript thread. Geekbench pages were not retrievable for citation; PassMark single-thread ratings were.

## Consequences

Readers can see each endpoint on reviewed machines and adjust the storage estimate, without changing any gate. The page depends on reviewed constants: cross-ISA ratings, shared vCPUs, and disk latency classes are coarse, so results are estimates rather than measurements. The memory view does not measure swap or reclaim costs. Publishing the page from CI requires an upload step in the `node 24 / benchmarks` job.
