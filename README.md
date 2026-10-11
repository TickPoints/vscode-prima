# Prima for Visual Studio Code

Language support for [Prima](https://github.com/TickPoints/prima-language), a
symbol-first scientific computing language.

> **v0.1 scope**: this first release is purely client-side — syntax highlighting,
> a `.pra` file icon, language configuration (comments, brackets, auto-closing,
> indentation), and snippets. A language server (diagnostics, go-to-definition,
> hover, completion) will land in later releases.

## Features

- **Syntax highlighting** — a full TextMate grammar (`source.prima`) covering:
  - keywords and reserved words (`let`, `fn`, `class`, `match`, `parfor`,
    `config`, `import`, `async`/`trait`, `try`/`catch`, ...);
  - the numeric tower and container types (`Integer`, `Rational`, `Number`,
    `F64`, `I8..U128`, `Array<T>`, `Result<A, B>`, `Fn(...) -> T`, ...);
  - string family: `"..."`, `'...'`, raw `r"..."`/`r'...'`, f-strings
    `f"..."`/`f'...'`/`rf"..."` (with `{expr}` interpolation), and TeX literals
    `tex"..."`;
  - number literals (decimal, `0x`/`0o`/`0b`, floats);
  - operators including `^`, `@`/`@.`, `..`/`..=`, `:=`, `->`/`=>`, `∪`/`∩`;
  - annotations `@builtin`, `@jit`, `@gpu`, `@parallel`, `@c_api::extern`;
  - comments: `///` docs, `//!` module docs, `//`, `/* */`.
- **File icon** — a lightweight *Prima Icons* theme (File icon theme → *Prima
  Icons*) gives `.pra` files the Prima mark; everything else keeps the default
  icon set.
- **Language configuration** — `//` / `/* */` comments, bracket
  auto-closing/surrounding, and `{` / `}` indentation rules.
- **Snippets** — `fn`, `class`, `for`, `while`, `if`/`if-else`, `match`,
  `import`, `config`, `parfor`, `println`, and more.

## Install

- From the [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
  (once published): search **Prima**.
- From a `.vsix`: `code --install-extension prima-lang-0.1.0.vsix`.

## Usage

Open any `.pra` file (or set the language to **Prima**). The `.pra` extension is
registered automatically; to use the custom file icon, select *Prima Icons* in
the command palette (*Preferences: File Icon Theme*).

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

- Language server protocol client + `prima`-backed server (diagnostics via
  `prima check`, hover from stdlib docs, completion, go-to-definition).
- `prima fmt` on save.

## License

[MIT](./LICENSE)
