---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-03-workflow-run-background

English | [中文](2026-10-03-workflow-run-background.zh.md)

## Summary

Adds an optional background marker to tool-workflow/run-start.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-workflow-run-background
baseline: false
changes:
  - root: "event:tool-workflow/run-start"
    previous: "2026-09-11-initial"
    after: "0dea366b90e202fdbb1a8d79aef14ffc6716b31000e5116309af6ae65d67cecc"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. Writers add the marker only from this change onward: in new records, absence means a foreground run, while background runs recorded earlier also lack it and keep their interrupted presentation after the Tool Step closes. The Web workflow node uses the marker to stop inferring interruption from the closed Tool Step of a run that belongs to a background job.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/workflow/tool-workflow/tests packages/client/ui-workflow-run/tests: 70 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
