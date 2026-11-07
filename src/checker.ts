import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** How long a single `prima check` invocation may run before it is killed. */
const CHECK_TIMEOUT_MS = 10_000;
/** How long the `prima --version` probe used to resolve the toolchain may run. */
const PROBE_TIMEOUT_MS = 5_000;
/** Upper bound on captured stdout+stderr, so a runaway toolchain cannot exhaust memory. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export type Severity = 'error' | 'warning';

/**
 * One diagnostic from `prima check --json`, already normalised to 0-based positions.
 *
 * Byte offsets are kept alongside line/column because the editor converts bytes to
 * VS Code positions itself (see the extension layer): `column` counts characters,
 * while `byteStart`/`byteEnd` are UTF-8 offsets into the checked source.
 */
export interface PrimaDiagnostic {
    /** 0-based line. */
    line: number;
    /** 0-based character column. */
    column: number;
    /** UTF-8 byte offset of the span start, or -1 when the diagnostic carries no span. */
    byteStart: number;
    /** UTF-8 byte offset of the span end (exclusive), or -1 when absent. */
    byteEnd: number;
    message: string;
    severity: Severity;
    /** Toolchain code such as `E0010` or `W0003`, when present. */
    code?: string;
    /** Extra `note:` lines attached to the diagnostic. */
    notes: string[];
    /** The toolchain's `= help:` suggestion, when present. */
    help?: string;
}

export interface CheckResult {
    exitCode: number;
    diagnostics: PrimaDiagnostic[];
    /** Set when the run failed for a reason other than reported diagnostics. */
    error?: string;
}

/** Tuning knobs for {@link checkText}; production callers use the defaults. */
export interface CheckOptions {
    /** How long the `prima check` invocation may run before it is killed. */
    timeoutMs?: number;
}

/** Shape of one NDJSON diagnostic emitted by `prima --json` (see `src/diagnostics.rs`). */
interface JsonSpan {
    file?: string;
    line?: number;
    column?: number;
    byte_start?: number;
    byte_end?: number;
    is_primary?: boolean;
}

interface JsonDiagnostic {
    severity?: string;
    code?: string | null;
    message?: string;
    spans?: JsonSpan[];
    notes?: string[] | null;
    help?: string | null;
}

/**
 * Parse the NDJSON stream produced by `prima --json check <file>`.
 *
 * The toolchain writes one JSON object per diagnostic to stderr (and nothing to
 * stdout). Non-JSON lines — banners, clap usage errors — are skipped so a partial
 * or unexpected stream degrades to "no diagnostics" rather than throwing.
 */
export function parseCheckJson(output: string): PrimaDiagnostic[] {
    const diagnostics: PrimaDiagnostic[] = [];

    for (const raw of output.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.length === 0 || line[0] !== '{') {
            continue;
        }

        let value: JsonDiagnostic;
        try {
            value = JSON.parse(line) as JsonDiagnostic;
        } catch {
            continue;
        }

        // Only `error`/`warning` objects are diagnostics; anything else is a
        // non-diagnostic JSON line and is ignored.
        const severity = value.severity;
        if (severity !== 'error' && severity !== 'warning') {
            continue;
        }

        const spans = Array.isArray(value.spans) ? value.spans : [];
        const primary = spans.find((span) => span?.is_primary === true) ?? spans[0];
        const line1 = typeof primary?.line === 'number' ? primary.line : 1;
        const column1 = typeof primary?.column === 'number' ? primary.column : 1;

        diagnostics.push({
            line: Math.max(0, line1 - 1),
            column: Math.max(0, column1 - 1),
            byteStart: typeof primary?.byte_start === 'number' ? primary.byte_start : -1,
            byteEnd: typeof primary?.byte_end === 'number' ? primary.byte_end : -1,
            message: (value.message ?? '').trim(),
            severity,
            code: typeof value.code === 'string' && value.code.length > 0 ? value.code : undefined,
            notes: Array.isArray(value.notes) ? value.notes.filter((n): n is string => typeof n === 'string') : [],
            help: typeof value.help === 'string' && value.help.length > 0 ? value.help : undefined,
        });
    }

    return diagnostics;
}

/**
 * Convert a UTF-8 byte offset into a UTF-16 code-unit offset for the same text.
 *
 * `prima --json` reports byte offsets, while editor positions count UTF-16 code
 * units; decoding up to the byte offset yields the code-unit index VS Code wants.
 * Offsets past the end are clamped, so a stale or malformed span cannot throw.
 */
export function charOffsetAtByte(text: string, byteOffset: number): number {
    const bytes = Buffer.from(text, 'utf8');
    const clamped = Math.max(0, Math.min(byteOffset, bytes.length));
    return bytes.subarray(0, clamped).toString('utf8').length;
}

/**
 * Resolve the `prima` executable. Returns the configured command when a path is
 * given, otherwise probes PATH for `prima` by invoking `--version`. Returns the
 * empty string when no executable is available.
 */
export async function resolvePrima(command: string | undefined): Promise<string> {
    const bin = (command ?? 'prima').trim();
    if (bin.length === 0) {
        return '';
    }

    try {
        await execFileAsync(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS });
        return bin;
    } catch {
        return '';
    }
}

/**
 * Run `prima --json check` on the given file contents.
 *
 * The toolchain only checks an on-disk path, so the text is written to a temporary
 * `.pra` file first. Module resolution during `check` is limited to the embedded
 * stdlib, so the temporary location does not change the result.
 */
export async function checkText(text: string, command: string, options: CheckOptions = {}): Promise<CheckResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prima-'));
    const tmpFile = path.join(tmpDir, 'check.pra');
    const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;

    try {
        fs.writeFileSync(tmpFile, text, 'utf8');

        const { stdout, stderr } = await execFileAsync(command, ['--json', 'check', tmpFile], {
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT_BYTES,
            env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
        });
        const output = joinStreams(stdout, stderr);
        const diagnostics = parseCheckJson(output);
        return { exitCode: 0, diagnostics, error: unexplainedOutput(output, diagnostics) };
    } catch (err) {
        const e = err as ExecFailure;
        if (e.code === 'ENOENT') {
            return { exitCode: -1, diagnostics: [], error: `prima executable not found: ${command}` };
        }

        const output = joinStreams(e.stdout, e.stderr);
        const diagnostics = parseCheckJson(output);
        const exitCode = typeof e.code === 'number' ? e.code : 2;
        return {
            exitCode,
            diagnostics,
            // A run that carried diagnostics has already explained itself. Everything
            // else — a non-zero exit, a timeout, a signal, a buffer overflow — must
            // surface as an error; otherwise "could not run" masquerades as "passed".
            error: diagnostics.length > 0 ? undefined : failureMessage(e, exitCode, output, timeoutMs),
        };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

/** The subset of a rejected `execFile` error that the failure path inspects. */
interface ExecFailure {
    code?: number | string | null;
    killed?: boolean;
    signal?: string | null;
    stdout?: string;
    stderr?: string;
}

/**
 * Explain why a check produced no diagnostics. Prefers the most specific cause the
 * process reports (timeout, signal, oversized output), falling back to the captured
 * output and finally to the exit code itself.
 */
function failureMessage(e: ExecFailure, exitCode: number, output: string, timeoutMs: number): string {
    if (e.code === 'ETIMEDOUT' || (e.killed === true && e.signal !== undefined)) {
        return `\`prima check\` timed out after ${Math.round(timeoutMs / 1000)}s and was killed.`;
    }
    if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return `\`prima check\` produced more than ${Math.round(MAX_OUTPUT_BYTES / (1024 * 1024))} MiB of output and was stopped.`;
    }

    const hint = unexplainedOutput(output, []);
    if (hint !== undefined) {
        return hint;
    }
    if (typeof e.signal === 'string' && e.signal.length > 0) {
        return `\`prima check\` was killed by ${e.signal}.`;
    }
    return `\`prima check\` exited with code ${exitCode} and reported no diagnostics.`;
}

/** Join captured streams with a newline so a line from one cannot merge with the other. */
function joinStreams(stdout: string | undefined, stderr: string | undefined): string {
    return [stdout ?? '', stderr ?? ''].filter((s) => s.length > 0).join('\n');
}

/**
 * Turn output that produced no diagnostics into a human hint, or `undefined` when
 * there is nothing to say. Detects the case where the installed toolchain predates
 * the `--json` flag so the user gets an actionable message instead of silence.
 */
function unexplainedOutput(output: string, diagnostics: PrimaDiagnostic[]): string | undefined {
    if (diagnostics.length > 0) {
        return undefined;
    }
    const text = output.trim();
    if (text.length === 0) {
        return undefined;
    }

    const firstLines = text.split(/\r?\n/).slice(0, 3).join('\n');
    if (/unexpected argument|unrecognized|invalid value|^Usage:/im.test(text)) {
        return `the installed \`prima\` does not support \`--json\`; upgrade the Prima toolchain.\n${firstLines}`;
    }
    return firstLines;
}
