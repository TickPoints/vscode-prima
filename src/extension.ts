import * as vscode from 'vscode';

import { charOffsetAtByte, checkText, resolvePrima, type CheckResult, type PrimaDiagnostic } from './checker';

const DIAGNOSTIC_COLLECTION = 'prima';
const ICON_THEME_ID = 'prima-icons';

/**
 * Owns the diagnostic collection and status bar, and turns `prima check` results into
 * editor diagnostics. All commands are registered up front; the toolchain is resolved
 * asynchronously so a missing `prima` binary degrades to an informative message rather
 * than an unregistered command.
 */
class PrimaChecker {
    private command = '';

    private readonly collection: vscode.DiagnosticCollection;

    private readonly status: vscode.StatusBarItem;

    private inFlight = 0;

    /** Diagnostic counts per open document, summed for the status bar. */
    private readonly counts = new Map<string, { errors: number; warnings: number }>();

    /** True when the most recent checks could not run (e.g. an older `prima` without `--json`). */
    private failing = false;

    /** Last toolchain failure reported to the user, so a broken setup warns once, not on every save. */
    private reportedError: string | undefined;

    constructor(collection: vscode.DiagnosticCollection, status: vscode.StatusBarItem) {
        this.collection = collection;
        this.status = status;
    }

    /** Resolve the toolchain and render the initial status. Safe to call again on config changes. */
    async start(): Promise<void> {
        this.command = await resolvePrima(vscode.workspace.getConfiguration('prima').get<string>('command'));
        this.render();
    }

    async checkDocument(doc?: vscode.TextDocument): Promise<void> {
        const target = doc ?? vscode.window.activeTextEditor?.document;
        if (!target) {
            void vscode.window.showWarningMessage('No active editor to check.');
            return;
        }
        await this.check(target);
    }

    async checkAll(): Promise<void> {
        const documents = vscode.workspace.textDocuments.filter((doc) => doc.languageId === 'prima');
        await Promise.all(documents.map((doc) => this.check(doc)));
    }

    /** Drop diagnostics for a document that is no longer open. */
    forget(uri: vscode.Uri): void {
        this.counts.delete(uri.toString());
        this.collection.delete(uri);
        this.render();
    }

    private async check(doc: vscode.TextDocument): Promise<void> {
        if (this.command.length === 0) {
            void vscode.window.showWarningMessage(
                'The `prima` toolchain was not found. Install it or set `prima.command`.',
            );
            return;
        }

        this.inFlight += 1;
        this.render();
        try {
            const result = await checkText(doc.getText(), this.command);
            const diagnostics = this.toDiagnostics(doc, result);
            this.collection.set(doc.uri, diagnostics);

            const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
            this.counts.set(doc.uri.toString(), { errors, warnings: result.diagnostics.length - errors });
            this.failing = result.error !== undefined;

            if (result.error) {
                void this.reportToolchainError(doc, result.error);
            }
        } finally {
            this.inFlight -= 1;
            this.render();
        }
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

    private toDiagnostics(doc: vscode.TextDocument, result: CheckResult): vscode.Diagnostic[] {
        const text = doc.getText();
        return result.diagnostics.map((d) => {
            const severity = d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
            const diagnostic = new vscode.Diagnostic(rangeFor(doc, text, d), messageFor(d), severity);
            diagnostic.source = 'prima';
            if (d.code) {
                diagnostic.code = d.code;
            }
            return diagnostic;
        });
    }

    private render(): void {
        if (this.command.length === 0) {
            this.status.text = '$(warning) prima not found';
            this.status.tooltip = 'The `prima` toolchain was not found on PATH. Install it or set `prima.command`.';
            this.status.command = { command: 'workbench.action.openSettings', title: '', arguments: ['prima.command'] };
            this.status.show();
            return;
        }

        const { errors, warnings } = this.totals();
        if (this.inFlight > 0) {
            this.status.text = '$(sync~spin) prima';
            this.status.tooltip = 'Checking…';
        } else if (this.failing) {
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

    /** Sum the per-document counts so the status bar reflects every open `.pra` file. */
    private totals(): { errors: number; warnings: number } {
        let errors = 0;
        let warnings = 0;
        for (const counts of this.counts.values()) {
            errors += counts.errors;
            warnings += counts.warnings;
        }
        return { errors, warnings };
    }
}

/**
 * Map a diagnostic's byte span to a range. `prima --json` reports UTF-8 byte offsets;
 * VS Code positions count UTF-16 code units, so the bytes are decoded up to the offset.
 * Falls back to the reported line/column when the diagnostic carries no span.
 */
function rangeFor(doc: vscode.TextDocument, text: string, d: PrimaDiagnostic): vscode.Range {
    if (d.byteStart >= 0 && d.byteEnd >= d.byteStart) {
        const start = doc.positionAt(charOffsetAtByte(text, d.byteStart));
        const end = doc.positionAt(charOffsetAtByte(text, d.byteEnd));
        const range = new vscode.Range(start, end.isAfter(start) ? end : start.translate(0, 1));
        return doc.validateRange(range);
    }

    const line = Math.min(Math.max(0, d.line), Math.max(0, doc.lineCount - 1));
    const lineText = doc.lineAt(line).text;
    const startChar = Math.min(Math.max(0, d.column), Math.max(0, lineText.length - 1));
    return doc.validateRange(
        new vscode.Range(new vscode.Position(line, startChar), new vscode.Position(line, startChar + 1)),
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
    if (workbench.get<string>('iconTheme') === ICON_THEME_ID) {
        void vscode.window.showInformationMessage('Prima Icons is already active.');
        return;
    }
    await workbench.update('iconTheme', ICON_THEME_ID, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('Prima Icons enabled. .pra files now show the Prima icon.');
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
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === 'prima') {
                void checker.checkDocument(doc);
            }
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            if (doc.languageId === 'prima') {
                checker.forget(doc.uri);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('prima.command')) {
                void checker.start();
            }
        }),
    );

    void checker.start().then(() => checker.checkAll());
}

export function deactivate(): void {
    // Diagnostics and the status bar are disposed through `context.subscriptions`.
}
