---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-19-external-subagent-catalog

English | [中文](2026-09-19-external-subagent-catalog.zh.md)

## Summary

Add an optional external execution outcome to parent catalog entries.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-external-subagent-catalog
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-09-11-initial"
    after: "e6c1b140467c8a4a41ca50676e4213d238f082c3b11b9f998fc9fd4ac21e929a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing one-shot and continuable catalog facts remain valid without the optional external field. The field identifies a child without a local Session and records pending or a terminal outcome. Pending means no terminal outcome is recorded, not that a process is live. Settlement appends a complete catalog fact with the same identity and creation time; the projection keeps one row per child. No new Session event type, full result payload, or Session format version is introduced.

<a id="verification"></a>
## Verification

Focused catalog and external activation tests cover restoration, direct and descendant discovery, publication updates, cancellation, resource release, and output-independent catalog payload size.

<a id="dev-note"></a>
## Dev Note

None.
