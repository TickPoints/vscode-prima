# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Extension activation entry point (`src/extension.ts`) reserving the mount
  point for a future language server client.
- Test suite scaffolded with `@vscode/test-electron`; CI compiles, tests, and
  packages a `.vsix`.
