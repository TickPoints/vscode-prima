/** Diagnostic counts for one document. */
export interface DiagnosticTally {
    errors: number;
    warnings: number;
}

/** Aggregated view across every open document, used to render the status bar. */
export interface StateTotals extends DiagnosticTally {
    /** True when any open document's latest check could not run. */
    failed: boolean;
    documents: number;
}

interface DocumentState {
    /** Token of the most recently started check for this document. */
    token: number;
    /** Document version the check was started against. */
    version: number;
    counts: DiagnosticTally;
    failed: boolean;
}

/**
 * Bookkeeping for asynchronous checks, free of any `vscode` dependency so the
 * ordering rules are unit-testable.
 *
 * Two races matter: overlapping checks for the same document (a slower, older run
 * must not overwrite a newer one) and edits made while a check runs (a result for
 * version N must not be applied to version N+1). {@link begin} hands out a token
 * that identifies one attempt; {@link settle} accepts a result only when that
 * attempt is still the newest for a document that is still open and still at the
 * version the check started from.
 */
export class CheckState {
    private readonly documents = new Map<string, DocumentState>();

    /** Token → document URI, so `settle` can resolve an attempt from its token alone. */
    private readonly attempts = new Map<number, string>();

    private nextToken = 1;

    /** Register the start of a check. The returned token is passed to {@link settle}. */
    begin(uri: string, version: number): number {
        const token = this.nextToken++;
        const previous = this.documents.get(uri);
        if (previous) {
            // The superseded attempt can no longer settle; stop tracking its token.
            this.attempts.delete(previous.token);
        }
        this.documents.set(uri, {
            token,
            version,
            counts: previous?.counts ?? { errors: 0, warnings: 0 },
            failed: previous?.failed ?? false,
        });
        this.attempts.set(token, uri);
        return token;
    }

    /** True while `token` is the newest attempt for a document that has not been forgotten. */
    isCurrent(token: number): boolean {
        const uri = this.attempts.get(token);
        return uri !== undefined && this.documents.get(uri)?.token === token;
    }

    /**
     * Apply a finished check. Returns false — and changes nothing — when the result
     * is stale: superseded by a newer attempt, computed for an older document
     * version, or belonging to a document that has been closed.
     */
    settle(token: number, counts: DiagnosticTally, failed: boolean, currentVersion: number): boolean {
        const uri = this.attempts.get(token);
        if (uri === undefined) {
            return false;
        }
        const document = this.documents.get(uri);
        if (document === undefined || document.token !== token) {
            return false;
        }
        if (document.version !== currentVersion) {
            return false;
        }

        document.counts = counts;
        document.failed = failed;
        this.attempts.delete(token);
        return true;
    }

    /** Drop a closed document; any in-flight result for it is discarded. */
    forget(uri: string): void {
        const document = this.documents.get(uri);
        if (document !== undefined) {
            this.attempts.delete(document.token);
        }
        this.documents.delete(uri);
    }

    /** Drop every document, e.g. when checking is disabled. */
    clear(): void {
        this.documents.clear();
        this.attempts.clear();
    }

    /** Sum every open document, so one failing file cannot be masked by another's pass. */
    totals(): StateTotals {
        let errors = 0;
        let warnings = 0;
        let failed = false;
        for (const document of this.documents.values()) {
            errors += document.counts.errors;
            warnings += document.counts.warnings;
            failed = failed || document.failed;
        }
        return { errors, warnings, failed, documents: this.documents.size };
    }
}
