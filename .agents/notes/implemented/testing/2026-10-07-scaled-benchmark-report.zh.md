# Agent Note: 按机器缩放与内存压力的基准报告

Status: implemented

[English](2026-10-07-scaled-benchmark-report.md) | 中文

## 问题

基准预算只说明某个端点是否在托管 runner 上回归。读者无法据此判断同一端点在旧笔记本或典型云服务器上有多慢，也无法判断其工作集能否放进 4 GB 或 8 GB 可用内存，因此通过或失败的数字无法体现对用户的影响。

## 决定

每次 `test:bench` 运行都会写出 `benchmarks/.dsh-report/report.html`，这是一个不依赖网络资源的独立页面。基准文件在断言预算之前，把每个有预算的墙钟中位数传给 [scaling-report.ts](../../../../benchmarks/support/scaling-report.ts) 的 `recordTimings`，把整进程峰值 RSS 传给 `recordPeakMemory`。Vitest global setup 在运行前清空结果，在运行后渲染页面，用例失败时也会渲染。预算和断言不变。

### 机器缩放

[machine-profiles.ts](../../../../benchmarks/support/machine-profiles.ts) 列出 2015、2019、2023、2026 年使用 SSD 的笔记本，带默认系统盘的主流云服务器，托管 runner，以及 M4 Pro 校准参考机。每个配置包含 2026-10-07 获取的 PassMark 单线程评分，以及其存储的典型 4 KiB 队列深度 1 延迟。缩放后的端点为 `ms × ((1 − io) × cpuScore(measured) / cpuScore(target) + io × ioLatency(target) / ioLatency(measured))`。`io` 是在基准旁按端点声明并注释的存储等待估计值；页面允许读者按端点修改。测量机器按 CPU 型号匹配，也可以在页面中修改。

在 Apple M5 Pro 上，首次内容索引搜索实测 58.7 s；模型预测 EPYC 7763 runner 上为 168 s，托管 CI 记录的中位数为 144 s。

### 内存压力

Session 语料的列表、搜索和 fork 用例报告最大合成工作集的整进程峰值 RSS。页面把每个峰值显示为 4 GB 和 8 GB 可用内存的占比。峰值不做缩放。

### 排除项

长 Session 的 `first`、`input` 和 `streamWall` 包含按节奏回放的等待，不记录。浏览器页面堆在强制垃圾回收后读取，不是峰值，不记录。不建模核心数、内存容量和散热限制。

## 备选方案

**在操作系统内存限制下运行用例。** Linux CI 上的 cgroup 限制需要 root，macOS 上不可用。实测峰值低于 1 GB，4 GB 限制不会改变计时路径，却会给必需门禁增加特权配置。

**根据 CPU 时间测量存储等待。** 墙钟时间减去 CPU 时间还包含事件循环让出、定时器和子进程调度，无法单独分离存储。大多数 worker 也不报告 CPU 时间。

**按基准统一存储占比。** Session open 在关闭文件后才执行恢复和投影，按基准使用一个占比会高估高延迟磁盘对纯内存端点的影响。

**多核或 Geekbench 分数。** 被计时端点运行在单个 JavaScript 线程上。Geekbench 页面无法获取以供引用，PassMark 单线程评分可以获取。

## 影响

读者可以在经审阅的机器上查看每个端点并调整存储估计值，而不改变任何门禁。页面依赖经审阅的常量：跨指令集评分、共享 vCPU 和磁盘延迟等级都较粗略，因此结果是估计值而不是测量值。内存视图不测量交换和回收成本。要从 CI 发布该页面，需要在 `node 24 / benchmarks` job 中添加上传步骤。
