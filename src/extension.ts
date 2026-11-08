import * as vscode from 'vscode';

import { checkText, createByteToCharIndex, resolvePrima, type CheckResult, type PrimaDiagnostic } from './checker';
import { CheckState, mapLimit } from './controller';

const DIAGNOSTIC_COLLECTION = 'prima';
const ICON_THEME_ID = 'prima-icons';
/** How many `prima check` processes may run at once when checking every open file. */
const CHECK_CONCURRENCY = 4;

/**
 * Owns the diagnostic collection and status bar, and turns `prima check` results into
 * editor diagnostics. All commands are registered up front; the toolchain is resolved
 * asynchronously so a missing `prima` binary degrades to an informative message rather
 * than an unregistered command.
 */
class PrimaChecker {
    private command = '';

    private enabled = true;

    private checkOnSave = true;

    private readonly collection: vscode.DiagnosticCollection;

    private readonly status: vscode.StatusBarItem;

    private inFlight = 0;

    /** Per-document counts and failure state, with stale-result guards. */
    private readonly state = new CheckState();

    /** Last toolchain failure reported to the user, so a broken setup warns once, not on every save. */
    private reportedError: string | undefined;

    /** True once the "toolchain not found" warning has been shown, to avoid one popup per file. */
    private warnedMissingToolchain = false;

    constructor(collection: vscode.DiagnosticCollection, status: vscode.StatusBarItem) {
        this.collection = collection;
        this.status = status;
    }

    /** Resolve the toolchain and render the initial status. Safe to call again on config changes. */
    async start(): Promise<void> {
        const config = vscode.workspace.getConfiguration('prima');
        this.enabled = config.get<boolean>('enable', true);
        this.checkOnSave = config.get<boolean>('checkOnSave', true);

        if (!this.enabled) {
            this.command = '';
            this.state.clear();
            this.collection.clear();
            this.render();
            return;
        }

        this.command = await resolvePrima(config.get<string>('command'));
        if (this.command.length > 0) {
            // A toolchain installed after the extension started deserves a fresh warning set.
            this.warnedMissingToolchain = false;
        }
        this.render();
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async checkDocument(doc?: vscode.TextDocument): Promise<void> {
        const target = doc ?? vscode.window.activeTextEditor?.document;
        if (!target) {
            void vscode.window.showWarningMessage('No active editor to check.');
            return;
        }
        if (target.languageId !== 'prima') {
            void vscode.window.showWarningMessage('The active editor is not a Prima file.');
            return;
        }
        if (!this.enabled) {
            void vscode.window.showInformationMessage('Prima checking is disabled (`prima.enable`).');
            return;
        }
        if (!(await this.ensureCommand())) {
            return;
        }
        await this.check(target);
    }

    async checkAll(): Promise<void> {
        if (!this.enabled) {
            return;
        }
        if (!(await this.ensureCommand())) {
            return;
        }
        const documents = vscode.workspace.textDocuments.filter((doc) => doc.languageId === 'prima');
        await mapLimit(documents, CHECK_CONCURRENCY, (doc) => this.check(doc));
    }

    /** The save hook honours both switches without prompting the user. */
    async checkOnSaveDocument(doc: vscode.TextDocument): Promise<void> {
        if (!this.enabled || !this.checkOnSave || doc.languageId !== 'prima') {
            return;
        }
        await this.check(doc);
    }

    /**
     * Make sure a command is available, re-probing when the toolchain was installed
     * after activation. Only manual commands pay for the re-probe; saves do not.
     */
    private async ensureCommand(): Promise<boolean> {
        if (this.command.length > 0) {
            return true;
        }
        await this.start();
        if (this.command.length === 0) {
            this.warnMissingToolchain();
            return false;
        }
        return true;
    }

    /** Drop diagnostics for a document that is no longer open. */
    forget(uri: vscode.Uri): void {
        this.state.forget(uri.toString());
        this.collection.delete(uri);
        this.render();
    }

    private async check(doc: vscode.TextDocument): Promise<void> {
        if (!this.enabled) {
            return;
        }
        if (this.command.length === 0) {
            this.warnMissingToolchain();
            return;
        }

        const token = this.state.begin(doc.uri.toString(), doc.version);
        this.inFlight += 1;
        this.render();
        try {
            const text = doc.getText();
            const result = await checkText(text, this.command);

            // The document may have been closed or edited, or a newer check may have
            // started, while this one ran. Drop the result rather than let a stale
            // run overwrite fresher diagnostics or resurrect a closed document.
            if (doc.isClosed || !this.state.isCurrent(token)) {
                return;
            }

            const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
            const counts = { errors, warnings: result.diagnostics.length - errors };
            if (!this.state.settle(token, counts, result.error !== undefined, doc.version)) {
                return;
            }

            this.collection.set(doc.uri, this.toDiagnostics(doc, text, result));
            if (result.error) {
                void this.reportToolchainError(doc, result.error);
            } else {
                // A later recurrence of the same failure should warn again.
                this.reportedError = undefined;
            }
        } finally {
            this.inFlight -= 1;
            this.render();
        }
    }

    /** Tell the user once that no `prima` binary is configured, no matter how many files are checked. */
    private warnMissingToolchain(): void {
        if (this.warnedMissingToolchain) {
            return;
        }
        this.warnedMissingToolchain = true;
        void vscode.window.showWarningMessage(
            'The `prima` toolchain was not found. Install it or set `prima.command`.',
        );
    }

    /** Surface a check failure once per distinct message instead of only logging it. */
    private async reportToolchainError(doc: vscode.TextDocument, detail: string): Promise<void> {
        const summary = detail.split('\n')[0].trim();
        console.warn(`[prima] check failed for ${doc.uri.fsPath}: ${detail}`);
        if (summary.length === 0 || summary === this.reportedError) {
            return;
        }
        this.reportedError = summary;
        await vscode.window.showWarningMessage(`Prima check could not run: ${summary}`);
    }

    private toDiagnostics(doc: vscode.TextDocument, text: string, result: CheckResult): vscode.Diagnostic[] {
        // Encode the document once, then map every span against the same index.
        const offsetAt = createByteToCharIndex(text);
        return result.diagnostics.map((d) => {
            const severity = d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
            const diagnostic = new vscode.Diagnostic(rangeFor(doc, offsetAt, d), messageFor(d), severity);
            diagnostic.source = 'prima';
            if (d.code) {
                diagnostic.code = d.code;
            }
            return diagnostic;
        });
    }

    private render(): void {
        if (!this.enabled) {
            this.status.hide();
            return;
        }
        if (this.command.length === 0) {
            this.status.text = '$(warning) prima not found';
            this.status.tooltip = 'The `prima` toolchain was not found on PATH. Install it or set `prima.command`.';
            this.status.command = { command: 'workbench.action.openSettings', title: '', arguments: ['prima.command'] };
            this.status.show();
            return;
        }

        const { errors, warnings, failed } = this.state.totals();
        if (this.inFlight > 0) {
            this.status.text = '$(sync~spin) prima';
            this.status.tooltip = 'Checking…';
        } else if (failed) {
            this.status.text = '$(warning) prima';
            this.status.tooltip = 'The last `prima check` could not run.';
        } else if (errors > 0) {
            this.status.text = `$(error) prima ${errors}`;
            this.status.tooltip = `${errors} error(s), ${warnings} warning(s)`;
        } else if (warnings > 0) {
            this.status.text = `$(warning) prima ${warnings}`;
            this.status.tooltip = `${warnings} warning(s)`;
        } else {
            this.status.text = '$(check) prima';
            this.status.tooltip = 'Prima check passed';
        }
        this.status.command = 'prima.checkAll';
        this.status.show();
    }
}

/**
 * Map a diagnostic's byte span to a range. `prima --json` reports UTF-8 byte offsets;
 * VS Code positions count UTF-16 code units, so the prebuilt index converts them.
 * Falls back to the reported line/column when the diagnostic carries no span.
 */
function rangeFor(
    doc: vscode.TextDocument,
    offsetAt: (byteOffset: number) => number,
    d: PrimaDiagnostic,
): vscode.Range {
    if (d.byteStart >= 0 && d.byteEnd >= d.byteStart) {
        const start = doc.positionAt(offsetAt(d.byteStart));
        const end = doc.positionAt(offsetAt(d.byteEnd));
        const range = new vscode.Range(start, end.isAfter(start) ? end : start.translate(0, 1));
        return doc.validateRange(range);
    }

    const line = Math.min(Math.max(0, d.line), Math.max(0, doc.lineCount - 1));
    const lineText = doc.lineAt(line).text;
    // A diagnostic without a span points at a position, not a character. Allow the
    // caret to sit at the end of the line (missing `;`, unclosed block, …) instead
    // of clamping it onto the last character.
    const startChar = Math.min(Math.max(0, d.column), lineText.length);
    const endChar = Math.min(startChar + 1, lineText.length);
    return doc.validateRange(
        new vscode.Range(new vscode.Position(line, startChar), new vscode.Position(line, endChar)),
    );
}

/** Compose the editor-facing message, folding in the toolchain's notes and help text. */
function messageFor(d: PrimaDiagnostic): string {
    let message = d.message;
    for (const note of d.notes) {
        message += `\nnote: ${note}`;
    }
    if (d.help) {
        message += `\nhelp: ${d.help}`;
    }
    return message;
}

async function enableIcons(): Promise<void> {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const inspect = workbench.inspect<string>('iconTheme');

    if (workbench.get<string>('iconTheme') === ICON_THEME_ID) {
        void vscode.window.showInformationMessage('Prima Icons is already active.');
        return;
    }

    // Write at the same scope that currently decides the value, otherwise a
    // workspace `workbench.iconTheme` silently wins and the command lies about
    // having switched the theme.
    const overriddenInWorkspace =
        inspect?.workspaceValue !== undefined || inspect?.workspaceFolderValue !== undefined;
    const target = overriddenInWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await workbench.update('iconTheme', ICON_THEME_ID, target);

    if (workbench.get<string>('iconTheme') === ICON_THEME_ID) {
        void vscode.window.showInformationMessage('Prima Icons enabled. .pra files now show the Prima icon.');
    } else {
        void vscode.window.showWarningMessage(
            'Could not switch the icon theme: a higher-priority `workbench.iconTheme` value wins. Select Prima Icons from the File Icon Theme picker instead.',
        );
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(collection, status);

    const checker = new PrimaChecker(collection, status);

    context.subscriptions.push(
        vscode.commands.registerCommand('prima.showVersion', () => {
            const version = context.extension.packageJSON.version as string;
            void vscode.window.showInformationMessage(`Prima language extension v${version}`);
        }),
        vscode.commands.registerCommand('prima.checkDocument', () => checker.checkDocument()),
        vscode.commands.registerCommand('prima.checkAll', () => checker.checkAll()),
        vscode.commands.registerCommand('prima.enableIcons', () => enableIcons()),
        vscode.workspace.onDidSaveTextDocument((doc) => checker.checkOnSaveDocument(doc)),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            if (doc.languageId === 'prima') {
                checker.forget(doc.uri);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('prima.enable') || event.affectsConfiguration('prima.command')) {
                void checker.start().then(() => {
                    if (checker.isEnabled()) {
                        return checker.checkAll();
                    }
                    return undefined;
                });
            } else if (event.affectsConfiguration('prima.checkOnSave')) {
                void checker.start();
            }
        }),
    );

    void checker.start().then(() => checker.checkAll());
}

export function deactivate(): void {
    // Diagnostics and the status bar are disposed through `context.subscriptions`.
}
