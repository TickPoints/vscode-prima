import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { charOffsetAtByte, checkText, parseCheckJson, resolvePrima } from '../../checker';

/** One NDJSON line as emitted by `prima --json check`. */
function ndjson(value: Record<string, unknown>): string {
    return JSON.stringify(value);
}

/**
 * Write an executable stand-in for `prima` and return its path. Tests use it to
 * exercise the failure paths (non-zero exit, hang, signal) without a real toolchain.
 */
function fakePrima(script: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prima-fake-'));
    const file = path.join(dir, 'prima');
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return file;
}

suite('Prima checker', () => {
    test('parses a single error and normalises its span', () => {
        const output = ndjson({
            code: 'E0010',
            help: null,
            message: 'expected expression, found `;`',
            notes: [],
            severity: 'error',
            spans: [{ byte_start: 8, byte_end: 9, column: 9, file: 'x.pra', is_primary: true, line: 1 }],
        });

        const diags = parseCheckJson(output);
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].severity, 'error');
        assert.strictEqual(diags[0].code, 'E0010');
        assert.strictEqual(diags[0].message, 'expected expression, found `;`');
        assert.strictEqual(diags[0].line, 0);
        assert.strictEqual(diags[0].column, 8);
        assert.strictEqual(diags[0].byteStart, 8);
        assert.strictEqual(diags[0].byteEnd, 9);
    });

    test('distinguishes warnings and keeps their code', () => {
        const output = ndjson({
            code: 'W0003',
            help: null,
            message: 'unused binding: `y`',
            notes: [],
            severity: 'warning',
            spans: [{ byte_start: 15, byte_end: 16, column: 5, file: 'x.pra', is_primary: true, line: 2 }],
        });

        const diags = parseCheckJson(output);
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].severity, 'warning');
        assert.strictEqual(diags[0].code, 'W0003');
        assert.strictEqual(diags[0].line, 1);
        assert.strictEqual(diags[0].column, 4);
    });

    test('parses every diagnostic in a multi-line stream', () => {
        const output = [
            ndjson({ severity: 'error', message: 'first', code: 'E0001', spans: [] }),
            ndjson({ severity: 'warning', message: 'second', code: 'W0002', spans: [] }),
        ].join('\n');

        const diags = parseCheckJson(output);
        assert.strictEqual(diags.length, 2);
        assert.deepStrictEqual(
            diags.map((d) => d.message),
            ['first', 'second'],
        );
    });

    test('ignores non-JSON lines and JSON that is not a diagnostic', () => {
        const output = [
            'warning: this looks like human output',
            'not json',
            '{ broken',
            '{}',
            ndjson({ message: 'no severity field' }),
        ].join('\n');

        assert.deepStrictEqual(parseCheckJson(output), []);
    });

    test('keeps a span-less diagnostic with an empty message', () => {
        const diags = parseCheckJson(ndjson({ severity: 'error' }));
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].message, '');
        assert.strictEqual(diags[0].byteStart, -1);
        assert.strictEqual(diags[0].byteEnd, -1);
    });

    test('prefers the primary span and folds notes and help', () => {
        const output = ndjson({
            severity: 'error',
            message: 'boom',
            code: 'E0099',
            notes: ['see the manual', 42, null],
            help: 'add a semicolon',
            spans: [
                { line: 3, column: 2, byte_start: 20, byte_end: 21, is_primary: false },
                { line: 5, column: 7, byte_start: 40, byte_end: 44, is_primary: true },
            ],
        });

        const diags = parseCheckJson(output);
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].line, 4);
        assert.strictEqual(diags[0].column, 6);
        assert.strictEqual(diags[0].byteStart, 40);
        assert.deepStrictEqual(diags[0].notes, ['see the manual']);
        assert.strictEqual(diags[0].help, 'add a semicolon');
    });

    test('returns empty for clean output', () => {
        assert.deepStrictEqual(parseCheckJson(''), []);
        assert.deepStrictEqual(parseCheckJson('\n\n'), []);
    });

    test('maps UTF-8 byte offsets to UTF-16 code units', () => {
        // `l e t ␠ α ␠ = ␠ " 汉 字 " ;` — α is 2 bytes, 汉/字 are 3 bytes each.
        const text = 'let α = "汉字";\n';
        assert.strictEqual(charOffsetAtByte(text, 0), 0);
        assert.strictEqual(charOffsetAtByte(text, 4), 4);
        assert.strictEqual(charOffsetAtByte(text, 6), 5);
        assert.strictEqual(charOffsetAtByte(text, 10), 9);
        assert.strictEqual(charOffsetAtByte(text, 13), 10);
    });

    test('clamps out-of-range byte offsets', () => {
        assert.strictEqual(charOffsetAtByte('abc', 999), 3);
        assert.strictEqual(charOffsetAtByte('abc', -5), 0);
    });

    test('reports a missing executable without throwing', async () => {
        const result = await checkText('let a = 1;\n', '/nonexistent/prima-does-not-exist');
        assert.strictEqual(result.exitCode, -1);
        assert.strictEqual(result.diagnostics.length, 0);
        assert.match(result.error ?? '', /not found/);
    });

    test('reports a non-zero exit with no diagnostics instead of passing', async () => {
        const fake = fakePrima('exit 3');
        const result = await checkText('let a = 1;\n', fake);

        assert.strictEqual(result.exitCode, 3);
        assert.deepStrictEqual(result.diagnostics, []);
        assert.ok(result.error, 'a silent non-zero exit must not look like a pass');
        assert.match(result.error ?? '', /exited with code 3/);
    });

    test('reports a killed invocation as an error, not a pass', async function () {
        this.timeout(10000);
        // `sleep` outlives the timeout, so the child is killed with no diagnostics.
        const fake = fakePrima('sleep 30');
        const result = await checkText('let a = 1;\n', fake, { timeoutMs: 300 });

        assert.deepStrictEqual(result.diagnostics, []);
        assert.ok(result.error, 'a timed-out check must not look like a pass');
        assert.match(result.error ?? '', /timed out/i);
    });

    test('keeps diagnostics when a run exits non-zero with output', async () => {
        const diagnostic = ndjson({
            code: 'E0010',
            message: 'expected expression',
            severity: 'error',
            spans: [{ byte_end: 9, byte_start: 8, column: 9, is_primary: true, line: 1 }],
        });
        const fake = fakePrima(`printf '%s\\n' '${diagnostic}' >&2\nexit 1`);
        const result = await checkText('let a = ;\n', fake);

        assert.strictEqual(result.exitCode, 1);
        assert.strictEqual(result.diagnostics.length, 1);
        assert.strictEqual(result.error, undefined, 'reported diagnostics explain the failure');
    });

    test('checkText surfaces diagnostics from a live toolchain', async function () {
        this.timeout(20000);
        const command = await resolvePrima('prima');
        if (command.length === 0) {
            this.skip();
            return;
        }

        const broken = await checkText('let a = ;\n', command);
        assert.strictEqual(broken.exitCode, 1);
        assert.ok(broken.diagnostics.length >= 1, 'expected at least one syntax diagnostic');
        assert.strictEqual(broken.diagnostics[0].severity, 'error');
        assert.ok(broken.diagnostics[0].byteStart >= 0, 'expected a byte span');

        const clean = await checkText('let x = 1;\nprintln(x);\n', command);
        assert.strictEqual(clean.exitCode, 0);
        assert.deepStrictEqual(clean.diagnostics, []);
    });
});
