import * as fs from 'fs';
import * as path from 'path';

import Mocha from 'mocha';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
    });

    const suiteDir = path.resolve(__dirname);
    fs.readdirSync(suiteDir)
        .filter((file) => file.endsWith('.test.js'))
        .forEach((file) => mocha.addFile(path.resolve(suiteDir, file)));

    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} test(s) failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}
