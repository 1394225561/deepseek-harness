# Agent Note: Discover Official bundles without installing their runtimes

Status: implemented

English | [中文](2026-10-05-official-on-demand-bundles.zh.md)

## Problem

Native subagent integrations bring their own runtimes. Shipping those dependencies with every DSH installation charges that cost to people who never delegate to them, while requiring a package name hides the integrations from the Plugins page.

## Decision

`ON_DEMAND_BUNDLES` admits the Claude Code and Codex bundles to an installation-owned catalog. The catalog embeds their package-owned localized metadata and icons, so discovery works offline without resolving or importing either package. Official identifies project maintenance; optional delivery and experimental maturity remain independent properties.

Selection uses the ordinary third-party bundle installer, profile dependency, scoped patches, compatibility evaluation, progress, cancellation, registry fallback, and build-script approval. The catalog supplies the exact running DSH version and saves an exact dependency pin. An application upgrade offers an explicit package update; it does not download providers at startup. Native authentication and configuration remain provider-owned.

Every Official package remains in the DSH release family. Packed DSH dependencies, optional dependencies, and peers use the exact family version. Publication prerequisites place catalog packages before the DSH package advertising them without adding their runtimes to DSH production dependencies. Catalog verification rejects missing metadata, unsupported membership, and stale generated content.

The [shipped optional-bundle policy](../process/2026-09-15-shipped-optional-bundles.md) still owns lightweight installation-provided bundles. The [optional-composition decision](2026-09-21-experimental-capabilities-as-optional-bundles.md) owns shared patch and preset-generation behavior. Native bundles require the full Web preset targets; custom profiles mount their providers and tools explicitly. The [identity compatibility decision](2026-10-06-web-desktop-plugin-identity-compatibility.md) owns retained names, selectors, and deferred naming cleanup.

## Alternatives considered

**Ship the native runtimes with every installation.** This makes first activation offline, but increases the default download for unused integrations.

**Query the registry to build the discovery list.** This avoids embedded metadata, but makes discovery depend on network availability and does not bind the offered package version to the running application.

**Give Official packages a separate installer or activation registry.** A second path would duplicate package-operation and profile-composition behavior. Installation-owned discovery data can reuse the existing third-party mechanisms.

## Consequences

First installation and explicit updates require a reachable registry. Off only deselects; Remove remains separate and respects retained preset modules. Activation failure can retain the saved dependency and selection; there is no rollback. Offline metadata, exact pins, clean installed artifacts, and release ordering have dedicated checks, while native-provider authentication is not part of catalog discovery.
