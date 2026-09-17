---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-17-external-subagent-activations

English | [中文](2026-09-17-external-subagent-activations.zh.md)

## Summary

Records external subagent identities and complete execution results in their parent Session.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-17-external-subagent-activations
baseline: false
changes:
  - root: "event:subagent/external-end"
    previous: null
    after: "186d78392e03b505c93e7be6fe6a9eb7025aa1e6401b600f6502d8e7860bf215"
    decision: same-version
  - root: "event:subagent/external-start"
    previous: null
    after: "e144bc89d55c5f25971eaac9aecddd1549c48912f709af1f7167ae3895dfdf20"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Adds version-0 subagent/external-start and subagent/external-end events without changing existing events or Session headers. Existing logs remain readable. Builds without these required event types reject logs containing them. External children have no local child Session; the parent projection retains JSON output, structured values, diagnostics, and the final stop reason.

<a id="verification"></a>
## Verification

External records: 8 focused tests passed, including JSONL cold reconstruction, inherited-prefix exclusion, invalid pairing, and JSON validation. External activation: 7 tests passed, including startup cancellation, result-before-cleanup, idempotent disposal, automatic reporting, and preservation of returned output after cleanup failure.

<a id="dev-note"></a>
## Dev Note

None.
