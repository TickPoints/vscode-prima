import * as assert from 'assert';

import * as vscode from 'vscode';

suite('Prima language extension', () => {
    test('activates and registers the `prima` language', async () => {
        const ext = vscode.extensions.getExtension('TickPoints.prima-lang');
        assert.ok(ext, 'extension TickPoints.prima-lang should be loaded in the test host');
        await ext?.activate();

        const languages = await vscode.languages.getLanguages();
        assert.ok(
            languages.includes('prima'),
            `expected "prima" in registered languages, got: ${languages.join(', ')}`,
        );
    });

    test('recognizes .pra files as `prima`', async () => {
        const doc = await vscode.workspace.openTextDocument({
            language: 'prima',
            content: '// hello\nlet x = 1;\nprintln(x);\n',
        });
        assert.strictEqual(doc.languageId, 'prima');
        assert.strictEqual(doc.getText().split('\n').length, 4);
    });

    test('exposes the version command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('prima.showVersion'), 'prima.showVersion should be registered');
    });
});
