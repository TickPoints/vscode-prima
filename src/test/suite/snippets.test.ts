import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface Snippet {
    prefix: string;
    body: string[] | string;
    description?: string;
}

function snippets(): Record<string, Snippet> {
    const file = path.resolve(__dirname, '../../../snippets/prima.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Snippet>;
}

/** Every `$` must start a tabstop (`$1`, `${1:…}`) or be escaped as `\$`. */
function badDollar(body: string): number {
    return [...body.matchAll(/\$(?![\d{]|\$)/g)].length;
}

/** Every `${` must be closed; literal braces and tabstop syntax are tracked by depth. */
function unbalancedTabstops(body: string): boolean {
    let depth = 0;
    for (let i = 0; i < body.length; i += 1) {
        if (body[i] === '\\') {
            i += 1;
            continue;
        }
        if (body.startsWith('${', i)) {
            depth += 1;
            i += 1;
        } else if (body[i] === '}' && depth > 0) {
            depth -= 1;
        }
    }
    return depth !== 0;
}

suite('Prima snippets', () => {
    test('parses and every entry is well formed', () => {
        const all = Object.entries(snippets());
        assert.ok(all.length > 0);

        const prefixes = new Set<string>();
        for (const [name, snippet] of all) {
            assert.ok(snippet.prefix?.length > 0, `${name}: missing prefix`);
            assert.ok(!prefixes.has(snippet.prefix), `${name}: duplicate prefix "${snippet.prefix}"`);
            prefixes.add(snippet.prefix);

            const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
            assert.ok(typeof body === 'string' && body.length > 0, `${name}: missing body`);
            assert.strictEqual(badDollar(body), 0, `${name}: unescaped $ in body`);
            assert.ok(!unbalancedTabstops(body), `${name}: unbalanced \${…} tabstop`);
        }
    });

    test('covers the constructs the language documents', () => {
        const prefixes = new Set(Object.values(snippets()).map((snippet) => snippet.prefix));
        for (const prefix of [
            'const',
            'publet',
            'pubfn',
            'iflet',
            'whilelet',
            'impl',
            'withconfig',
            'listcomp',
            'dictcomp',
            'setcomp',
            'fstring',
            'tex',
        ]) {
            assert.ok(prefixes.has(prefix), `missing snippet "${prefix}"`);
        }
    });
});
