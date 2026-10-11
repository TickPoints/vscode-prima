# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
