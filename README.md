# Prima for Visual Studio Code

Language support for [Prima](https://github.com/TickPoints/prima-language), a
symbol-first scientific computing language.

The extension covers the editor surface statically — syntax highlighting, a
`.pra` file icon, language configuration, and snippets — and, when the `prima`
toolchain is on your `PATH`, surfaces its `prima check` diagnostics directly in
the editor.

## Features

- **Static checking** — when a `prima` binary is available, the extension runs
  `prima --json check` on demand and on save (`prima.checkOnSave`), and maps the
  toolchain's diagnostics into VS Code problems. Codes (`error[E0010]`,
  `warning[W0003]`, …), notes, and `= help:` suggestions are shown; the status
  bar reflects the latest result per open file and re-checks every open `.pra`
  file when clicked. A run that cannot produce diagnostics (missing binary, a
  timeout, a crash) is reported as a failure, never as a pass.
- **Syntax highlighting** — a full TextMate grammar (`source.prima`) covering:
  - keywords and reserved words (`let`, `fn`, `class`, `self`, `match`,
    `parfor`, `config`, `import`, `async`/`trait`, ...);
  - the numeric tower and container types (`Integer`, `Rational`, `Number`,
    `Complex`, `F64`, `I8..U128`, `Array<T>`, `Dict`, `Set`, `Result<A, B>`,
    `Result<T, Error>`, `Fn(...) -> T`, ...);
  - string family: `"..."`, `'...'`, raw `r"..."`/`r'...'`, f-strings
    `f"..."`/`f'...'` (with `{expr}` interpolation), raw f-strings `rf"..."`,
    and TeX literals `tex"..."`;
  - number literals (decimal, `0x`/`0b`, floats);
  - operators including `^`, `@`/`@.`, `..`/`..=`, `:=`, `->`/`=>`, `∪`/`∩`
    (the removed `|>` is not highlighted);
  - annotations `@builtin`, `@jit`, `@gpu`, `@parallel`, `@c_api::extern`;
  - enum variants (`Some`/`None`/`Ok`/`Err`/`Nil`) and comments (`///` docs,
    `//!` module docs, `//`, `/* */`);
  - Unicode identifiers (for example `fn α(x)`).
- **File icon** — a lightweight *Prima Icons* theme (File icon theme → *Prima
  Icons*) gives `.pra` files the Prima mark; everything else keeps the default
  icon set.
- **Language configuration** — `//` / `/* */` comments, bracket
  auto-closing/surrounding, indentation after `{`, `(` and `[`, and automatic
  continuation of `///` and `//!` comments.
- **Snippets** — `let`, `const`, `pub let`/`pub fn`, `fn`, `class`, `impl`,
  `for`, `while`, `if`/`if-else`/`if let`/`while let`, `match`, `import`,
  `config`/`with config`, `parfor`, comprehensions, `println`, and more.

## Requirements

- The [Prima toolchain](https://github.com/TickPoints/prima-language) is
  **optional** — syntax highlighting, icons, and snippets work without it. The
  *check* commands and diagnostics need a `prima` binary (0.4 or newer, for the
  `--json` diagnostic stream) on your `PATH`; point the extension at a different
  location with the `prima.command` setting.

## Install

- From the [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
  (once published): search **Prima**.
- From a `.vsix`: `code --install-extension prima-lang-<version>.vsix`.

## Usage

Open any `.pra` file (or set the language to **Prima**). The `.pra` extension is
registered automatically; to use the custom file icon, select *Prima Icons* in
the command palette (*Preferences: File Icon Theme*) or run **Prima: Enable .pra
File Icons**.

`.pra` files are checked automatically on save when a `prima` binary is found
(turn this off with `prima.checkOnSave`). The following commands are available
from the command palette:

- **Prima: Check Current File** — run `prima check` on the active editor.
- **Prima: Check All Open Files** — check every open `.pra` document.
- **Prima: Enable .pra File Icons** — switch to the *Prima Icons* theme.
- **Prima: Show Version** — report the extension version.

Region folding uses the extension's own `//#region` / `//#endregion` markers;
the language itself has no such convention.

## Settings

- `prima.enable` — enable `prima check` diagnostics and the status bar item
  (default: `true`).
- `prima.checkOnSave` — check automatically when a `.pra` file is saved
  (default: `true`). Turn this off to silence known false positives while still
  allowing manual checks.
- `prima.command` — the `prima` executable path or command name used for
  `prima check` (default: `prima`). This setting is machine-scoped: a workspace
  cannot change which binary runs.

## Known issues

The current `prima check` (0.4.x) reports false positives on valid programs,
which the extension shows as-is rather than filtering:

- symbolic variables left unbound on purpose (`x`, `pi`, `e`, `nil`);
- guard variables in `match` arms;
- class members reported as unused bindings;
- `refutable pattern in let` for patterns the specification allows.

If a project is dominated by these, switch off `prima.checkOnSave` and use
**Prima: Check Current File** deliberately. The minimal reproductions are being
tracked upstream rather than hidden in the extension.

## Development

The JavaScript toolchain is [Bun](https://bun.sh):

```bash
bun install
bun run compile            # tsc -> out/ (required before the other steps)
bun run test:unit          # pure mocha, no VS Code download (~1s)
bun run test:integration   # @vscode/test-electron (headless: xvfb-run -a bun run test:integration)
bun run test               # compile + unit + integration
bun run package            # vsce package -> prima-lang-*.vsix (run compile first)
```

CI (`.github/workflows/ci.yml`) compiles, runs the unit and integration suites,
and packages a `.vsix` on every push and PR; it also lists the packaged files to
catch `.vscodeignore` regressions.

## Publishing

Pushing a `v*` tag compiles, tests, and packages the extension, then attaches
the resulting `.vsix` to a matching GitHub Release — CI holds no credentials:

```bash
# bump the version in package.json and CHANGELOG.md first, then:
git tag v0.2.0
git push origin v0.2.0
```

The tag must equal the `version` in `package.json` — plain `major.minor.patch`,
because the Marketplace rejects semver pre-release suffixes — and the workflow
fails otherwise. The tag also selects the channel: an **even minor** version
(`v0.2.0`) is a stable release, an **odd minor** version (`v0.3.0`) is a
pre-release, and the GitHub Release is flagged accordingly. That is the
[recommended convention](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions),
which keeps a release ahead of the pre-release it supersedes. The `release`
workflow can also be started manually from the Actions tab, passing an existing
tag.

### Publishing to the Marketplace

Putting the extension on the
[VS Code Marketplace](https://marketplace.visualstudio.com/) is a deliberate,
manual step — CI holds no publish credentials. Build the `.vsix` and publish that
same artifact, so the Marketplace build matches the release:

```bash
bun run compile && bun run package
bunx vsce publish --no-dependencies --packagePath prima-lang-<version>.vsix
# odd minor (pre-release): add --pre-release
```

`vsce` can authenticate two ways:

- **Personal access token** — `bunx vsce login TickPoints` once; the token needs
  the *Marketplace → Manage* scope. Azure DevOps
  [retires global PATs on 2026-12-01](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/),
  so this is a stopgap.
- **Microsoft Entra ID** — after `az login` with an account that is a member of
  the `TickPoints` publisher, pass `--azure-credential`. Preferred once PATs are
  gone, and no app registration is needed for local use.

## Roadmap

- Language server protocol client + `prima`-backed server (hover from stdlib
  docs, completion, go-to-definition; `prima check` already covers diagnostics).
- Formatter integration: the toolchain already ships `prima fmt` (`-w`,
  `--check`, stdout), so this needs only a `DocumentFormattingEditProvider` and
  an optional format-on-save hook.

## License

[MIT](./LICENSE)
