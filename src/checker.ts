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
 * Build a one-pass byte-offset → UTF-16-offset mapper for `text`.
 *
 * Encoding the whole document once per diagnostic is `O(n·m)`; mapping many
 * diagnostics from a single check needs `O(n)` work once. Offsets that land in the
 * middle of a multi-byte character resolve to that character's first UTF-16 unit,
 * which is what the editor should highlight.
 */
export function createByteToCharIndex(text: string): (byteOffset: number) => number {
    const byteStarts: number[] = [];
    const characterStarts: number[] = [];
    let byte = 0;
    let character = 0;

    for (const codePoint of text) {
        byteStarts.push(byte);
        characterStarts.push(character);
        byte += Buffer.byteLength(codePoint, 'utf8');
        character += codePoint.length;
    }
    byteStarts.push(byte);
    characterStarts.push(character);

    return (byteOffset: number): number => {
        if (byteOffset <= 0) {
            return 0;
        }
        if (byteOffset >= byte) {
            return character;
        }
        // Binary search for the last character boundary at or before the offset.
        let low = 0;
        let high = byteStarts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (byteStarts[middle] <= byteOffset) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return characterStarts[low];
    };
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
        await execFileAsync(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS, windowsHide: true });
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
    const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;

    let tmpDir: string;
    try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prima-'));
    } catch (err) {
        return failure(-1, `could not create a temporary directory for \`prima check\`: ${describeError(err)}`);
    }

    const tmpFile = path.join(tmpDir, 'check.pra');
    try {
        try {
            fs.writeFileSync(tmpFile, text, 'utf8');
        } catch (err) {
            return failure(-1, `could not write the temporary source file for \`prima check\`: ${describeError(err)}`);
        }

        try {
            const { stdout, stderr } = await execFileAsync(command, ['--json', 'check', tmpFile], {
                timeout: timeoutMs,
                maxBuffer: MAX_OUTPUT_BYTES,
                // Keep a console window from flashing on Windows when the check runs.
                windowsHide: true,
                env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
            });
            const output = joinStreams(stdout, stderr);
            const diagnostics = parseCheckJson(output);
            return { exitCode: 0, diagnostics, error: unexplainedOutput(output, diagnostics) };
        } catch (err) {
            const e = err as ExecFailure;
            if (e.code === 'ENOENT') {
                return failure(-1, `prima executable not found: ${command}`);
            }

            const output = joinStreams(e.stdout, e.stderr);
            const diagnostics = parseCheckJson(output);
            const exitCode = typeof e.code === 'number' ? e.code : 2;

            // A killed or truncated run may still have emitted some diagnostics; they
            // remain useful, but the result must never look complete.
            const interruption = interruptionMessage(e, timeoutMs);
            if (interruption !== undefined) {
                return { exitCode, diagnostics, error: `${interruption} Results may be incomplete.` };
            }

            return {
                exitCode,
                diagnostics,
                // A run that carried diagnostics has already explained itself; a silent
                // non-zero exit has not, and must not masquerade as a pass.
                error: diagnostics.length > 0 ? undefined : failureMessage(output, exitCode),
            };
        }
    } finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Best effort: a transient lock on Windows must not discard a valid result.
        }
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

function failure(exitCode: number, error: string): CheckResult {
    return { exitCode, diagnostics: [], error };
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Explain a run that was interrupted rather than completing: a timeout, a signal,
 * or an output buffer overflow. Returns `undefined` for an ordinary non-zero exit.
 */
function interruptionMessage(e: ExecFailure, timeoutMs: number): string | undefined {
    if (e.code === 'ETIMEDOUT' || (e.killed === true && e.signal !== undefined)) {
        return `\`prima check\` timed out after ${formatSeconds(timeoutMs)} and was killed.`;
    }
    if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        const mebibytes = Math.round(MAX_OUTPUT_BYTES / (1024 * 1024));
        return `\`prima check\` produced more than ${mebibytes} MiB of output and was stopped.`;
    }
    if (typeof e.signal === 'string' && e.signal.length > 0) {
        return `\`prima check\` was killed by ${e.signal}.`;
    }
    return undefined;
}

function formatSeconds(milliseconds: number): string {
    const seconds = milliseconds / 1000;
    return `${seconds < 1 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/** Explain a silent non-zero exit: the captured output if any, else the exit code. */
function failureMessage(output: string, exitCode: number): string {
    const hint = unexplainedOutput(output, []);
    if (hint !== undefined) {
        return hint;
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
