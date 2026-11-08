import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface Rule {
    name: string;
    begin?: string;
    match?: string;
    beginCaptures?: Record<string, unknown>;
    patterns?: Rule[];
    comment?: string;
}

interface Grammar {
    patterns: Rule[];
    repository: Record<string, Rule | { patterns: Rule[] }>;
}

function grammar(): Grammar {
    const file = path.resolve(__dirname, '../../../syntaxes/prima.tmLanguage.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Grammar;
}

/** Every object that carries a `begin` or `match` regex, anywhere in the grammar. */
function rules(node: unknown, out: Rule[] = []): Rule[] {
    if (Array.isArray(node)) {
        for (const item of node) {
            rules(item, out);
        }
        return out;
    }
    if (node === null || typeof node !== 'object') {
        return out;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.begin === 'string' || typeof record.match === 'string') {
        out.push(record as unknown as Rule);
    }
    for (const [key, value] of Object.entries(record)) {
        if (key !== 'begin' && key !== 'end') {
            rules(value, out);
        }
    }
    return out;
}

/**
 * Count capturing groups in a TextMate/Oniguruma pattern, ignoring escaped
 * parentheses, character classes, and the non-capturing forms `(?:`, `(?=`,
 * `(?!`, `(?<=`, `(?<!`. Named groups `(?<name>…)` do capture.
 */
function captureCount(pattern: string): number {
    let count = 0;
    for (let i = 0; i < pattern.length; i += 1) {
        const char = pattern[i];
        if (char === '\\') {
            i += 1;
        } else if (char === '[') {
            i += 1;
            while (i < pattern.length && pattern[i] !== ']') {
                if (pattern[i] === '\\') {
                    i += 1;
                }
                i += 1;
            }
        } else if (char === '(') {
            if (pattern[i + 1] !== '?') {
                count += 1;
            } else if (pattern[i + 2] === ':' || pattern[i + 2] === '=' || pattern[i + 2] === '!') {
                i += 2;
            } else if (pattern[i + 2] === '<' && (pattern[i + 3] === '=' || pattern[i + 3] === '!')) {
                i += 3;
            } else {
                count += 1;
            }
        }
    }
    return count;
}

function patternOf(rule: Rule): string {
    return rule.begin ?? rule.match ?? '';
}

/** Find a repository entry by the comment that labels it, so renames stay cheap. */
function byComment(fragment: string): Rule {
    const found = rules(grammar()).find((rule) => (rule.comment ?? '').includes(fragment));
    assert.ok(found, `no grammar rule commented with "${fragment}"`);
    return found;
}

suite('Prima grammar', () => {
    test('every beginCaptures key refers to a real capturing group', () => {
        for (const rule of rules(grammar())) {
            if (!rule.beginCaptures) {
                continue;
            }
            const count = captureCount(rule.begin ?? '');
            for (const key of Object.keys(rule.beginCaptures)) {
                const index = Number(key);
                assert.ok(Number.isInteger(index) && index >= 0, `${patternOf(rule)}: capture key "${key}" is not a group index`);
                assert.ok(
                    index <= count,
                    `${patternOf(rule)}: beginCaptures references group ${index} but the pattern has ${count} group(s)`,
                );
            }
        }
    });

    test('highlights every built-in enum variant, including Nil', () => {
        const variants = new RegExp(patternOf(byComment('built-in enum variants')));
        for (const name of ['Some', 'None', 'Ok', 'Err', 'Nil']) {
            assert.ok(variants.test(name), `${name} should be a variant`);
        }
    });

    test('recognises Error as a type', () => {
        const types = new RegExp(patternOf(byComment('numeric-tower and container types')));
        assert.ok(types.test('Error'), 'Error should be a type');
    });

    test('recognises the console input builtins', () => {
        const builtins = (grammar().repository.builtins as { patterns: Rule[] }).patterns.map(patternOf).join('|');
        const regex = new RegExp(builtins);
        assert.ok(regex.test('input'), 'input should be a builtin');
        assert.ok(regex.test('read_line'), 'read_line should be a builtin');
    });

    test('does not highlight the removed |> operator', () => {
        const operators = (grammar().repository.operators as { patterns: Rule[] }).patterns.map(patternOf).join('|');
        // A bare `|` may still be an operator, but `|>` must never match as one token.
        const matched = new RegExp(operators).exec('|>')?.[0];
        assert.notStrictEqual(matched, '|>', '|> was removed from the language (E0010)');
    });

    test('treats rf"…" as a raw string without escapes', () => {
        const raw = (grammar().repository.rfstring as { patterns: Rule[] }).patterns[0];
        assert.ok(raw, 'rf-strings need their own rule');
        assert.ok(new RegExp(raw.begin ?? '').test('rf"'), 'rf" should start a raw f-string');
        const matchers = (raw.patterns ?? []).map((pattern) => pattern.match ?? '').join(' ');
        assert.ok(!matchers.includes('[abfnrtv'), 'raw strings must not highlight backslash escapes');
    });

    test('accepts Unicode identifiers after fn and class', () => {
        for (const rule of ((grammar().repository['def-name'] as { patterns: Rule[] }).patterns ?? [])) {
            const regex = new RegExp(patternOf(rule), 'u');
            const sample = rule.comment?.includes('class') === true ? 'class Ωmega' : 'fn α';
            assert.ok(regex.test(sample), `${sample} should match ${patternOf(rule)}`);
        }
    });

    test('every include resolves to a repository entry', () => {
        const includes = [...JSON.stringify(grammar()).matchAll(/"include":\s*"#([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
        for (const id of includes) {
            assert.ok(grammar().repository[id], `include #${id} has no repository entry`);
        }
    });
});
