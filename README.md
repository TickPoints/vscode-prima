# Prima for Visual Studio Code

Language support for [Prima](https://github.com/TickPoints/prima-language), a
symbol-first scientific computing language.

The extension covers the editor surface statically — syntax highlighting, a
`.pra` file icon, language configuration, and snippets — and, when the `prima`
toolchain is on your `PATH`, surfaces its `prima check` diagnostics directly in
the editor.

## Features

- **Static checking** — when a `prima` binary is available, the extension runs
  `prima --json check` on demand and on save, and maps the toolchain's
  diagnostics into VS Code problems. Codes (`error[E0010]`, `warning[W0003]`, …),
  notes, and `= help:` suggestions are shown; the status bar reflects the latest
  result and re-checks every open `.pra` file when clicked.
- **Syntax highlighting** — a full TextMate grammar (`source.prima`) covering:
  - keywords and reserved words (`let`, `fn`, `class`, `self`, `match`,
    `parfor`, `config`, `import`, `async`/`trait`, ...);
  - the numeric tower and container types (`Integer`, `Rational`, `Number`,
    `Complex`, `F64`, `I8..U128`, `Array<T>`, `Dict`, `Set`, `Result<A, B>`,
    `Fn(...) -> T`, ...);
  - string family: `"..."`, `'...'`, raw `r"..."`/`r'...'`, f-strings
    `f"..."`/`f'...'`/`rf"..."` (with `{expr}` interpolation), and TeX literals
    `tex"..."`;
  - number literals (decimal, `0x`/`0b`, floats);
  - operators including `^`, `@`/`@.`, `..`/`..=`, `:=`, `->`/`=>`, `∪`/`∩`;
  - annotations `@builtin`, `@jit`, `@gpu`, `@parallel`, `@c_api::extern`;
  - enum variants (`Some`/`None`/`Ok`/`Err`) and comments (`///` docs, `//!`
    module docs, `//`, `/* */`).
- **File icon** — a lightweight *Prima Icons* theme (File icon theme → *Prima
  Icons*) gives `.pra` files the Prima mark; everything else keeps the default
  icon set.
- **Language configuration** — `//` / `/* */` comments, bracket
  auto-closing/surrounding, and `{` / `}` indentation rules.
- **Snippets** — `fn`, `class`, `for`, `while`, `if`/`if-else`, `match`,
  `import`, `config`, `parfor`, `println`, and more.

## Requirements

- The [Prima toolchain](https://github.com/TickPoints/prima-language) is
  **optional** — syntax highlighting, icons, and snippets work without it. The
  *check* commands and diagnostics need a `prima` binary (0.4 or newer, for the
  `--json` diagnostic stream) on your `PATH`; point the extension at a different
  location with the `prima.command` setting.

## Install

- From the [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
  (once published): search **Prima**.
- From a `.vsix`: `code --install-extension prima-lang-0.2.0.vsix`.

## Usage

Open any `.pra` file (or set the language to **Prima**). The `.pra` extension is
registered automatically; to use the custom file icon, select *Prima Icons* in
the command palette (*Preferences: File Icon Theme*) or run **Prima: Enable .pra
File Icons**.

`.pra` files are checked automatically on save when a `prima` binary is found.
The following commands are available from the command palette:

- **Prima: Check Current File** — run `prima check` on the active editor.
- **Prima: Check All Open Files** — check every open `.pra` document.
- **Prima: Enable .pra File Icons** — switch to the *Prima Icons* theme.
- **Prima: Show Version** — report the extension version.

## Settings

- `prima.command` — the `prima` executable path or command name used for
  `prima check` (default: `prima`).

## Development

The JavaScript toolchain is [Bun](https://bun.sh):

```bash
bun install
bun run compile       # tsc -> out/
bun run package       # vsce package -> prima-lang-*.vsix
bun run test          # @vscode/test-electron suite (headless: xvfb-run -a bun run test)
```

CI (`.github/workflows/ci.yml`) compiles, runs the test suite, and packages a
`.vsix` on every push and PR.

## Roadmap

- Language server protocol client + `prima`-backed server (hover from stdlib
  docs, completion, go-to-definition; `prima check` already covers diagnostics).
- `prima fmt` on save.

## License

[MIT](./LICENSE)
