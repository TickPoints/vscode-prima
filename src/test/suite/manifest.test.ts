import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/** The shipped manifest, read straight from the extension root. */
function manifest(): Record<string, any> {
    const file = path.resolve(__dirname, '../../../package.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
}

suite('Extension manifest', () => {
    test('pins the executable setting to machine scope', () => {
        const command = manifest().contributes.configuration.properties['prima.command'];
        assert.strictEqual(
            command.scope,
            'machine',
            'a repository must not be able to redirect which binary the extension executes',
        );
    });

    test('declares its behaviour in restricted mode', () => {
        const capabilities = manifest().capabilities?.untrustedWorkspaces;
        assert.ok(capabilities, 'capabilities.untrustedWorkspaces must be declared');
        assert.ok(
            capabilities.supported === 'limited' || capabilities.supported === false,
            'untrusted workspaces must be limited or unsupported',
        );
    });

    test('exposes enable and checkOnSave switches', () => {
        const properties = manifest().contributes.configuration.properties;
        assert.strictEqual(properties['prima.enable'].type, 'boolean');
        assert.strictEqual(properties['prima.enable'].default, true);
        assert.strictEqual(properties['prima.checkOnSave'].type, 'boolean');
        assert.strictEqual(properties['prima.checkOnSave'].default, true);
    });

    test('contributes every command the code registers', () => {
        const commands = manifest().contributes.commands.map((c: { command: string }) => c.command);
        for (const id of ['prima.checkDocument', 'prima.checkAll', 'prima.enableIcons', 'prima.showVersion']) {
            assert.ok(commands.includes(id), `${id} should be contributed`);
        }
    });
});
