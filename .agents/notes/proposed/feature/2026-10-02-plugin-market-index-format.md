# Agent Note: Plugin market index format

Status: proposed

English | [中文](2026-10-02-plugin-market-index-format.zh.md)

## Problem

DSH installs third-party bundles only from a spec the user already knows: an npm name, a Git URL, a tarball, or a local path. Nothing lets a user browse installable bundles. No official market exists, and one may be added later, so a market mechanism must work with indexes that third parties publish.

The smallest possible index is a list of npm names or Git repository URLs, one per line. It identifies every plugin, but a client rendering it must fetch each package's manifest, locale files, and icon before it can show a list. A list page that issues one or more requests per row is slow, fails partially, and puts metadata resolution in every client.

An index must therefore carry everything a list page displays: localized title and description, icon, author, available versions, compatibility, and publish time. Markets also want to publish their own data, such as categories, tags, downloads, and ratings, without DSH knowing what those values mean.

## Proposal

Separate the **index** from the **index generator**. DSH defines and reads one JSON index format. How an index is produced, and from which source list, belongs to the generator. DSH's reader, its Discover page, and a reference generator are separate changes that consume this format. Indexes list [profile plugin bundles](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) and install them through [guided plugin installation](../../implemented/architecture/2026-09-15-guided-plugin-installation.md).

Package authors use [npm declarations](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/). An index caches selected package metadata and adds localized display data, source pins, and market metadata. Readers and generators use maintained npm parsers and normalizers. They do not introduce another author-maintained package identity, compatibility declaration, or author field.

### Example

```json
{
  "format": 1,
  "title": { "en": "Example Market", "zh": "示例市场" },
  "description": { "en": "Community DSH bundles", "zh": "社区 DSH bundle" },
  "metadata": {
    "categories": {
      "productivity": { "title": { "en": "Productivity", "zh": "效率" } }
    },
    "labels": {
      "official": { "title": { "en": "Official", "zh": "官方" } }
    },
    "sortKeys": {
      "downloads": { "title": { "en": "Downloads", "zh": "下载量" }, "order": "desc" },
      "rating": { "title": { "en": "Rating", "zh": "评分" }, "order": "desc" }
    }
  },
  "plugins": [
    {
      "name": "@example/dsh-auto-review",
      "title": { "en": "Auto Review", "zh": "自动审查" },
      "description": { "en": "Per-tool LLM authorization review", "zh": "逐工具 LLM 授权审查" },
      "icon": "icons/auto-review.svg",
      "author": "Example Labs",
      "homepage": "https://example.com/dsh-auto-review",
      "metadata": {
        "category": "productivity",
        "labels": ["official"],
        "sortKeys": { "downloads": 12034, "rating": 4.6 }
      },
      "dist-tags": { "latest": "0.2.0-rc.1", "next": "0.2.0-rc.2" },
      "versions": [
        {
          "version": "0.2.0-rc.2",
          "publishTimestamp": 1790476800,
          "source": { "type": "npm" },
          "engines": { "dsh": "0.2.0-rc.2" },
          "peerDependencies": { "@deepseek-ai/dsh-tools": "0.2.0-rc.2" }
        },
        {
          "version": "0.2.0-rc.1",
          "publishTimestamp": 1789872000,
          "source": { "type": "npm" },
          "engines": { "dsh": "0.2.0-rc.1" },
          "peerDependencies": { "@deepseek-ai/dsh-tools": "0.2.0-rc.1" }
        }
      ]
    },
    {
      "name": "dsh-plugin-foo",
      "title": "Foo",
      "icon": "https://example.com/foo.png",
      "dist-tags": { "latest": "1.0.0" },
      "versions": [
        {
          "version": "1.0.0",
          "publishTimestamp": 1788000000,
          "source": {
            "type": "git",
            "url": "https://github.com/author/dsh-plugins",
            "commit": "3f9c2e1d8a4b6c0e7f1a2b3c4d5e6f708192a3b4",
            "path": "packages/foo"
          }
        }
      ]
    }
  ]
}
```

`LocalizedText` below is the `LocalizedText` type of [`dsh-package-manifest`](../../../../packages/util/package-manifest/src/types.ts), a string or an object of strings that contains `en`, with two additional rules: object keys are lowercase language ids matching `^[a-z]{2,8}(-[a-z0-9]{1,8})*$`, and every string contains at least one non-whitespace character.

### Root fields

| Field | Required | Rule |
|---|---|---|
| `format` | yes | Integer `1`. |
| `title` | yes | `LocalizedText` naming the market. |
| `description` | no | `LocalizedText`. |
| `metadata` | no | Object holding the three declaration maps below. |
| `metadata.categories` | no | Object mapping category id → `{ title: LocalizedText }`. |
| `metadata.labels` | no | Object mapping label id → `{ title: LocalizedText }`. |
| `metadata.sortKeys` | no | Object mapping sort-key id → `{ title: LocalizedText, order: "asc" \| "desc" }`; `order` is the initial sort direction. |
| `plugins` | yes | Array of plugins, possibly empty; its order is the index's default ordering. |

Category, label, and sort-key ids are non-empty strings. Readers look ids up as own properties, so ids such as `constructor` have no special meaning.

### Plugin fields

| Field | Required | Rule |
|---|---|---|
| `name` | yes | Package name accepted by npm's maintained package-name validator for new packages; unique within the index. |
| `title` | no | `LocalizedText`; a reader displays `name` when absent. |
| `description` | no | `LocalizedText` for catalog display, derived from locale metadata and the npm description. |
| `icon` | no | Either `data:<type>;base64,<payload>`, where `<type>` is `image/svg+xml`, `image/png`, `image/jpeg`, or `image/webp`, `<payload>` is canonically padded base64, and the decoded payload is at most 256 KiB; or a URL reference whose resolution against the index URL is an `https:` URL or has the index URL's origin. |
| `author` | no | Display name containing a non-whitespace character, projected from the npm author declaration; see Generator obligations. |
| `homepage` | no | Absolute `https:` or `http:` URL of a page about the plugin. |
| `metadata` | no | Object holding the three values below. |
| `metadata.category` | no | One declared category id. |
| `metadata.labels` | no | Array of distinct declared label ids. |
| `metadata.sortKeys` | no | Object mapping a declared sort-key id → finite number. |
| `dist-tags` | no | Object mapping npm distribution-tag names to exact version strings listed in `versions`. Absent means no recorded channels. |
| `versions` | yes | Non-empty array of versions; see below. Array order does not select a default version. |

### Version fields

| Field | Required | Rule |
|---|---|---|
| `version` | yes | Exact package version parsed by npm's `node-semver`; preserve its complete string, including build metadata. The exact string is unique within the plugin. |
| `publishTimestamp` | yes | Integer Unix timestamp in seconds, in `[0, 10^11)`. |
| `source` | yes | Where `version` is installed from; see below. |
| `engines` | no | npm manifest object mapping engine names to requirement strings, copied without range rewriting. |
| `engines.dsh` | no | Requirement string for the running DSH process. An empty or invalid range is incompatible; absence adds no host requirement. |
| `peerDependencies` | no | npm manifest object mapping package names to requirement strings, copied without range rewriting. DSH peers constrain compatibility; other peers remain package-manager requirements. |

A relative `icon` reference resolves against the index URL, as an HTML image reference resolves against its page. For an index at `https://market.example/dsh/index.json`, `"icon": "icons/foo.svg"` names `https://market.example/dsh/icons/foo.svg`. A generator can therefore publish the index and its icon files as one directory on any static host without knowing the final URL. Absolute icon URLs on other origins must use `https:`; the same-origin allowance lets an `http:` index on a loopback or intranet host serve its own icons. Readers resolve the reference when they read the index, so clients receive absolute URLs.

`source` takes one of two forms, and readers reject any other `type`:

- `{ "type": "npm", "registry"?: string }`. `registry` is an `http:` or `https:` URL without credentials, query, or fragment; `http:` is admitted for intranet mirrors, as in DSH's [install registries](../../implemented/architecture/2026-09-18-plugin-install-registries.md).
- `{ "type": "git", "url": string, "commit": string, "path"?: string }`. `url` is a canonical `https:` URL (equal to its WHATWG URL serialization) with at least two non-empty path segments and no trailing slash, without credentials, query, or fragment, and not ending in `.tgz` or `.tar.gz`. `commit` is a lowercase 40-hex-digit SHA. `path` is a `/`-separated relative directory whose segments contain only ASCII letters, digits, and `._@+-`, and are neither `.` nor `..`; absent means the repository root.

### Install arguments

A client installs one version with exactly these pnpm arguments:

- npm: the spec `<name>@<version>`. Without `registry`, the client asks its configured registries as it does for any install. With `registry`, the client follows DSH's [registry plan](../../implemented/architecture/2026-09-18-plugin-install-registries.md): it asks `registry` first and falls back to its other configured registries only when `registry` is one of them; any other `registry` is asked alone, so a private registry never falls through to a public one that may publish a different package under the same name and version.
- git: the spec `git+<url>.git#<commit>`, without doubling a trailing `.git`, followed by `&path:/<path>` when `path` is present. The `git+` prefix makes pnpm treat URLs with more than two path segments, such as GitLab subgroups, as Git repositories.

### DSH compatibility

An index carries the manifest's `peerDependencies` and `engines` as separate declarations. DSH tests every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer against the running DSH version. A declared `engines.dsh` adds a host requirement; it does not replace those peers. The version is compatible only when every applicable requirement matches. Missing declarations add no requirement.

The index reader and installation use one DSH compatibility evaluator with npm's `node-semver` parser and `includePrerelease: true`. Empty or invalid DSH ranges are incompatible. The existing peer rule maps `workspace:*`, `workspace:^`, and `workspace:~` to the running DSH version; other `workspace:` peer ranges are incompatible. Engine ranges do not use that peer mapping. Exact local `name@version` exemptions apply to both kinds of DSH requirement and are not published in the index.

Generators preserve each requirement string. Readers evaluate the strings separately; they do not concatenate or expand their ranges. npm owns package peer resolution and its Node/npm engine checks. DSH owns enforcement of its custom `engines.dsh` key, as recorded in the [public manifest decision](../../implemented/architecture/2026-09-10-public-package-manifest.md).

### Generator obligations

A reader cannot verify these rules; a generator that violates them publishes a misleading index.

- `name` and each `version` equal the package manifest of the installed source.
- `publishTimestamp` is the registry publish time of `version` for npm sources and the committer time of `commit` for Git sources.
- `engines` and `peerDependencies` copy the source manifest. npm sources use published metadata, including npm's publication rewriting. Git sources use the pinned manifest. Invalid DSH ranges remain visible as incompatible requirements; they are not omitted or converted into another declaration.
- `dist-tags` snapshots the registry's [distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/). A generator includes each retained tag's target version, or omits that tag when its target is outside the listed bundle versions. For Git sources, the publisher or market supplies the same exact tag-to-version mapping.
- Each listed version declares `dsh.bundle`. Installation independently refuses a package without a bundle patch.
- Package-derived display fields come from the exact version named by `dist-tags.latest`. Without that tag, generators omit those display fields and readers use the package-name fallback. `title`, `description`, and `icon` follow installed-plugin display metadata rules, subject to this format's `LocalizedText` requirements. Localized text is catalog display data, not another npm manifest declaration. `homepage` copies the selected manifest's `homepage` and is absent without one.
- npm's `author` may be a person object or shorthand string. For an object, generators copy its `name` when it contains a non-whitespace character. For a shorthand string, they use a maintained npm person normalizer and take its `name` under the same condition. They omit an absent or whitespace-only name and do not copy email or URL into this display field. They normalize only the author projection, preserving version strings and exemption identities.

### Reader rules

A reader rejects the whole index when the document violates any rule in Root fields, Plugin fields, Version fields, or the `source` forms, including an undeclared category, label, or sort-key reference, an unlisted distribution-tag target, a duplicate `name` or exact `version` string, or a `format` other than `1`. Each such defect is a generator bug, and dropping entries silently would hide it. Readers may bound the document size.

A reader ignores members that this note does not define, at every level; an unknown `source.type` value is rejected. Format 1 can then gain optional members without breaking existing readers; a change that existing readers would misinterpret uses a new `format` value.

Entries in `engines`, `peerDependencies`, and `dist-tags` are declared data, not unknown members to discard. Their values must be strings; a non-string value invalidates the index. A DSH requirement string can be empty or syntactically invalid and remains visible as incompatible. Distribution-tag names use npm's tag validation, and targets match listed version strings exactly.

Categories, labels, and sort keys are opaque: a reader filters and sorts by them, displays their `title`, and never interprets an id. Readers display declarations in the order of their localized `title`. When sorting plugins, a plugin without a value for the selected sort key follows all plugins with a value in either direction, and equal values keep the index order. Sorting by publish time uses a plugin's greatest `publishTimestamp`.

A reader evaluates each version's declared requirements with the rule in DSH compatibility. It orders versions by npm SemVer precedence; equally ranked versions keep their index order for display only. Full version strings identify entries, including versions that differ only in build metadata.

The initial channel is `latest`. Its exact tag target is the version selected by the publisher or market, even when another version has higher SemVer precedence. A client installs the listed exact version or commit, never `name@latest`. If `latest` is absent, version selection is required. If its target is incompatible, the client reports that requirement and offers other versions for explicit selection. It does not switch channels or select another release or prerelease automatically.

Clients identify prereleases when users choose an exact version or channel, and in the installation confirmation. A publisher may deliberately tag a prerelease as `latest`; its presence does not authorize installation without that explicit confirmation. Clients attribute display fields, labels, categories, and scores to the index URL. A market label such as `official` is not DSH verification, and scores from different markets do not imply a shared scale.

## Alternatives considered

**A plain list of npm names or repository URLs.** It identifies every plugin but forces one or more requests per row before a list renders, which is the cost this format removes.

**One opaque install spec string per version.** A reader cannot verify that a free-form spec is pinned. A structured `source` with an exact `version`, or a `commit`, lets the reader verify pinning and lets the client build the spec it installs.

**Installing the latest version instead of a pinned one.** The installed build could then differ from the metadata the list displayed, and a package release would change what an unchanged index installs.

**One entry per version.** Every version would repeat the title, description, icon, author, and market metadata, and readers would group entries by `name` to show one plugin.

**One `source` per plugin, with only the pin per version.** A plugin that moves to another repository, directory, or registry between releases could not list its older versions.

**Display fields per version.** A list shows one row per plugin, so older display text, icons, authors, and homepages would cost index size without a reader that shows them.

**Inline icons only.** A list without extra requests needs inline icons, but 256 KiB of raw bytes is about 341 KiB as base64, so a 100-plugin index could reach about 35 MB. URL icons trade extra requests, and disclosure of the user's IP address to the image host, for a small index.

**Combining peer ranges into one synthetic `engines.dsh`.** This creates another compatibility declaration and requires range-intersection logic. Preserving the npm maps lets the reader and installer evaluate the same requirements, including hyphen ranges and `||` alternatives.

**Letting `engines.dsh` override peers.** Host and package requirements express different obligations. Replacing package requirements with a broad host range can hide an incompatible DSH peer.

**Copying the complete npm person object into the display field.** The catalog needs a name. A documented projection supports npm's original object and shorthand declarations while omitting unused contact fields.

**Opaque sort values for time, including ISO date strings.** Publish time has fixed semantics that clients format and sort, so it is a typed field. Without time, sort values can be numbers only, which needs no per-key value-type rule.

**Root-level `labels` and `sortKeys`, and a plugin field named `sort`.** Grouping market-defined declarations and values under `metadata` at both levels, with matching member names except the single-valued `category`, separates them from fields that clients interpret.

**Declaration order as display order.** JavaScript reorders integer-like object keys, so declaration order would need either an id pattern or array declarations. Clients sort declarations by their localized title instead.

**Dropping workspace or invalid peer ranges.** A generator would then hide requirements that installation reads. Retaining their literal strings lets the shared checker apply the existing workspace rules and report incompatibility.

**Selecting the greatest compatible version.** npm's `latest` tag is publisher-controlled and can name an older release. Replacing it with version ranking loses that choice and leaves equal-precedence builds without a unique target.

**Automatic prerelease fallback.** Missing or incompatible channel targets do not indicate that the user chose a prerelease. A client requires explicit version or channel selection instead.

**Rejecting unknown members.** Every optional addition would then require a new `format` value and break every deployed reader.

## Acceptance criteria

- A validator accepts the example above and rejects one violation of each structural rule in Root fields, Plugin fields, Version fields, and the `source` forms, with a diagnostic naming the JSON path. Invalid DSH range strings are accepted structurally and evaluated as incompatible.
- Install arguments built from every example version are accepted by DSH's install-spec parser and by pnpm.
- A validator ignores unknown members at every level.
- Index and installation compatibility match for the same manifest, runtime version, and local exemptions. Cases cover hyphen ranges, `||` alternatives, workspace shorthands, invalid ranges, and a broad engine range with an incompatible DSH peer.
- Exact `dist-tags` targets select the same source when equally ranked build-metadata versions are reordered. Missing tag targets are rejected; absent or incompatible `latest` never causes an implicit version or channel switch.
- Author objects and shorthand strings produce the declared display name without contact fields or version normalization.
- A parser validates `1.0.0+one` and preserves that complete string for tag lookup, installation identity, and local exemption keys.
- Installation confirmation identifies the selected version, channel when selected, prerelease status, index URL, and source. Market labels and scores remain attributed claims.

## Risks

- An index is unsigned. A market can use a misleading `title`, such as one claiming to be official; clients must show the index URL and each version's `source`.
- A Git version's identity and requirements are claims about the repository. A repository can claim any name, including an `@deepseek-ai/dsh-` name, and the installed manifest decides what is actually installed.
- An npm version's `source.registry` is equally a claim: it directs the install of any `name`, including an `@deepseek-ai/dsh-` name, to a registry the market chooses, and that registry decides what is installed.
- URL icons disclose the user's IP address to image hosts.
- Pinned versions and distribution tags stay stale until the index is regenerated.
- Version pinning does not authenticate a market's identity or guarantee the bytes an arbitrary registry returns. Installed package checks remain independent of the catalog.
- Readers and generators must adopt this revised proposal together before deployment; mixing the original and revised format-1 rules can change compatibility results and version selection.
- Market text reaches users, and models through any client tool that lists plugins, without review by DSH.
