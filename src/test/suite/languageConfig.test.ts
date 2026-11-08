import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface LanguageConfiguration {
    indentationRules?: { increaseIndentPattern: string; decreaseIndentPattern: string };
    onEnterRules?: Array<{ beforeText: string; action: { indent: string; appendText?: string } }>;
    folding?: { markers?: { start: string; end: string } };
}

function configuration(): LanguageConfiguration {
    const file = path.resolve(__dirname, '../../../language-configuration.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LanguageConfiguration;
}

suite('Prima language configuration', () => {
    test('indents after an open brace, parenthesis or bracket', () => {
        const rules = configuration().indentationRules;
        assert.ok(rules, 'indentationRules are required');

        const increase = new RegExp(rules.increaseIndentPattern);
        assert.ok(increase.test('if x {'), 'open brace should indent');
        assert.ok(increase.test('let y = foo('), 'open parenthesis should indent');
        assert.ok(increase.test('let z = [1,'), 'open bracket should indent');

        const decrease = new RegExp(rules.decreaseIndentPattern);
        assert.ok(decrease.test('}'), 'close brace should outdent');
        assert.ok(decrease.test(')'), 'close parenthesis should outdent');
        assert.ok(decrease.test(']'), 'close bracket should outdent');
    });

    test('continues /// and //! comments on Enter', () => {
        const rules = configuration().onEnterRules ?? [];
        for (const marker of ['///', '//!']) {
            const rule = rules.find((candidate) => new RegExp(candidate.beforeText).test(`    ${marker} doc`));
            assert.ok(rule, `no onEnter rule for ${marker}`);
            assert.strictEqual(rule?.action.appendText, `${marker} `);
            assert.strictEqual(rule?.action.indent, 'none');
        }
    });

    test('declares the region folding markers it uses', () => {
        const markers = configuration().folding?.markers;
        assert.ok(markers, 'custom folding markers should stay declared');
        assert.ok(new RegExp(markers?.start ?? '').test('//#region setup'));
        assert.ok(new RegExp(markers?.end ?? '').test('//#endregion'));
    });
});
