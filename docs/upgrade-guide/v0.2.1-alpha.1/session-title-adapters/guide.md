---
kind: upgrade-guide
description: "Custom title routes require registered adapters and minimum-effort metadata."
---

# Prepare custom title routes

English | [中文](guide.zh.md)

## Change

Model-backed session titles prepare their requests through `ctx.llm.prepareCall()`. Compositions that serve title routes only through `llm/stream` middleware must also register an adapter. Custom adapters that expose selectable reasoning efforts must declare `reasoning.floorEffort`; otherwise minimum-effort preparation rejects before dispatch. Existing concrete `prepareCall()` inputs remain valid.

## Migration

1. Register the title route with `ctx.llm.registerAdapter()`. Replay compositions can configure the existing `llm-replay` plugin's `providers` list.
2. In the adapter's model metadata, set `reasoning.floorEffort` to the least selectable id in `reasoning.efforts`. Replay models use `floorReasoningEffort` alongside `reasoningEfforts`. Omit reasoning metadata when the route has no selectable controls.
3. Generate a title and check that `session/title-llm-request` records the selected effort and a provider title is saved. Existing Session records without that optional field remain readable.
