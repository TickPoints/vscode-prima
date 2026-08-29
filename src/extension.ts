import * as vscode from 'vscode';

/**
 * v0.1 activation.
 *
 * Everything this release contributes (TextMate grammar, `.pra` file icon theme,
 * language configuration, snippets) is declared statically in `package.json`, so
 * activation itself has no mandatory work. This is the mount point for the
 * language server client (v0.2+): instantiate a `LanguageClient` here and call
 * `start()` once the `prima` server binary is available on PATH.
 */
export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('prima.showVersion', async () => {
            const version = context.extension.packageJSON.version as string;
            void vscode.window.showInformationMessage(`Prima language extension v${version}`);
        }),
    );
}

export function deactivate(): void {
    // Stop the language server client here once one is started (v0.2+).
}
