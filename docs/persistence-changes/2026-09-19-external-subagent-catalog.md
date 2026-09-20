---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-19-external-subagent-catalog

English | [中文](2026-09-19-external-subagent-catalog.zh.md)

## Summary

Add an optional external execution outcome to one-shot parent catalog entries.

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
    previous: "2026-09-20-unknown-child-catalog"
    after: "289dc7167ce5942019b86cab1ccfacb72eaf7460ef3c45e3c23780bf8e030376"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing version-0 and version-1 one-shot and continuable catalog facts remain valid without the optional external field. Version-1 unknown-mode facts remain unchanged. The field identifies a child without a local Session and records pending or a terminal outcome. Pending means no terminal outcome is recorded, not that a process is live. Settlement appends a complete catalog fact with the same identity and creation time; the projection keeps one row per child. No new Session event type, full result payload, or Session format version is introduced.

<a id="verification"></a>
## Verification

Catalog projection, V3-to-V4 catalog completion and validation, and JSONL catalog migration tests passed: 124 tests passed and one skipped. Coverage includes mixed unknown-mode and external entries at both supported payload versions, external pending-to-terminal updates, and rejection of external fields on unknown or continuable entries.

<a id="dev-note"></a>
## Dev Note

None.
