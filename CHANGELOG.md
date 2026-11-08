# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `prima.enable` to switch diagnostics off entirely, and `prima.checkOnSave` to
  keep manual checks while muting checks on every save.
- A *Known issues* section in the README covering the false positives of the
  current `prima check`.
- `test:unit` (plain mocha, no VS Code download) and `test:integration`
  (`@vscode/test-electron`) scripts, with unit coverage for the grammar,
  snippets, language configuration, manifest and check scheduling.

### Changed

- `prima.command` is machine-scoped, so a cloned repository can no longer
  redirect which binary the extension executes; restricted-mode behaviour is
  declared in `capabilities.untrustedWorkspaces`.
- Manual check commands re-probe `PATH`, so a toolchain installed after the
  window opened is picked up without a reload.
- Grammar: raw f-strings (`rf"..."`) no longer highlight `\n` as an escape,
  opening quotes of f-strings/raw/TeX strings get their punctuation scope,
  `Nil`, `Error`, `input` and `read_line` are highlighted, the removed `|>`
  operator is gone, and identifiers after `fn`/`class` may be Unicode.
- Snippets for `const`, `pub`, `if let`/`while let`, `impl`, `with config`,
  comprehensions, f-strings, TeX literals and `Nil`; class methods return
  `Self`.
- Indentation after `(` and `[`, outdenting on `)`/`]`, and `///`/`//!`
  continuation on Enter.
- CI pins Bun to the `packageManager` version, caches Bun and the VS Code test
  download, and lists packaged files with `vsce ls`.

### Fixed

- A check that exited non-zero, timed out, was killed by a signal, or produced
  no diagnostics no longer shows a green check; it reports a failure.
- Overlapping checks no longer overwrite fresher results: a result is applied
  only if its document is still open, unchanged since the check started, and no
  newer check has begun.
- Failure state is tracked per document, so one failing file cannot be masked
  by another file passing.
- The "toolchain not found" warning appears once instead of once per file and
  per save.
- **Prima: Check Current File** refuses non-Prima editors instead of parsing
  them as Prima.
- **Prima: Enable .pra File Icons** writes at the scope that actually decides
  the value, and warns when a higher-priority setting overrides it.
- Diagnostics without a span can point at the end of a line.

## [0.2.0]

### Added

- `prima check` integration: the extension resolves the `prima` toolchain and
  runs `prima --json check` on the active file, on save, and on demand, mapping
  the toolchain's diagnostics (severity, code, message, span, notes, `help`
  suggestions) into VS Code problems.
- Commands **Prima: Check Current File**, **Prima: Check All Open Files**, and
  **Prima: Enable .pra File Icons**.
- The `prima.command` setting, to select the `prima` executable path or name.
- A status bar item showing the latest check result (ok / warnings / errors)
  that re-checks every open `.pra` document when clicked.

### Changed

- Static diagnostics now consume the machine-readable NDJSON stream
  (`prima --json check`), replacing the previous parsing of human-readable caret
  output; spans are mapped by UTF-8 byte offset for exact ranges and multiple
  diagnostics per run are supported.
- Grammar synced with the current language: `self` is highlighted, `Dict`/`Set`
  are recognised as types, and the stale `Real`/`Value` types and `0o` octal
  literal were removed. `@`-annotations no longer swallow the binary `@`
  operator, and the enum variants `Some`/`None`/`Ok`/`Err` are highlighted.
- Development toolchain migrated from npm to [Bun](https://bun.sh):
  `bun install` / `bun run …` with a `bun.lock` lockfile, and CI now uses
  `oven-sh/setup-bun`.

### Fixed

- All contributed commands are registered even when no `prima` binary is found,
  so they no longer report "command not found"; they show an actionable message
  instead.
- Diagnostics are cleared when a `.pra` document is closed.
- The status bar now reflects the real state — checking, ok, warnings, errors, or
  a failed toolchain run — and aggregates across every open `.pra` document
  instead of only the last one checked.
- A check that cannot run (for example, an older `prima` without `--json`)
  surfaces one warning message and a warning status instead of failing silently.

## [0.1.0]

### Added

- TextMate grammar (`source.prima`) for `.pra` files: keywords and reserved
  words, numeric-tower and container types, the full string family (plain, raw,
  f-string with `{expr}` interpolation, `tex"..."`), number literals, operators
  (incl. `@`/`@.`, `..=`/`:=`, `->`/`=>`, `∪`/`∩`), annotations, and comments
  (`///`, `//!`, `//`, `/* */`).
- Language contribution: `prima` language id for `.pra`, plus language
  configuration (line/block comments, bracket auto-closing and surrounding,
  indentation rules).
- *Prima Icons* file icon theme giving `.pra` files a custom icon.
- Snippets for common constructs (`fn`, `class`, `for`, `while`, `if`,
  `match`, `import`, `config`, `parfor`, `println`, ...).
- Extension activation entry point (`src/extension.ts`).
- Test suite scaffolded with `@vscode/test-electron`; CI compiles, tests, and
  packages a `.vsix`.
