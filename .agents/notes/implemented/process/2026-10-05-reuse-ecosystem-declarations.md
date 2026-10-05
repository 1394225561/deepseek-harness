# Agent Note: Reuse ecosystem declarations

Status: implemented

English | [中文](2026-10-05-reuse-ecosystem-declarations.zh.md)

## Problem

Custom declarations can duplicate information that package ecosystems already define. Converting existing metadata into independently maintained fields introduces additional validation and interpretation rules. Catalogs and user interfaces need selected data, but a second authored declaration can disagree with its source.

## Decision

DSH reuses established ecosystem declarations, formats, and meanings when they satisfy its requirements. Readers use maintained parsers and validators. Catalogs and user interfaces derive their data from the original declarations. A generated projection may omit unused fields or normalize display data, but it preserves the source meaning. The owning package README or generator JSDoc documents the projection rules.

A new field or changed meaning requires a specific unmet requirement and a documented difference from the ecosystem rule. When authors define npm package metadata, they reuse npm's package identity, version and range syntax, and person fields. DSH-specific composition, localized display data, and host enforcement still require explicit DSH rules.

The [dependency policy](2026-07-26-dependencies-over-hand-rolling.md) governs dependency selection. The [public manifest decision](../architecture/2026-09-10-public-package-manifest.md) governs the selected npm fields and DSH declarations. These decisions retain their ownership; this policy governs reuse of declarations and their interpretation.

## Alternatives considered

**Reuse field names but define independent meanings.** Existing tools and authors cannot rely on familiar declarations when their interpretation changes without a stated requirement.

**Copy all ecosystem metadata without adaptation.** Consumers need different field subsets and display formats. Documented generated projections preserve the original declaration without requiring every consumer to retain unused data.

## Consequences

The [root instructions](../../../../AGENTS.md#conventions) require declaration reuse and documented differences. Review checks the source declaration, the reused parser or validator, and each projection's meaning. This policy adds no installer behavior or package metadata migration.
