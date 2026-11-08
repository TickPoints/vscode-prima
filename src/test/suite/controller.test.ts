import * as assert from 'assert';

import { CheckState } from '../../controller';

const A = 'file:///a.pra';
const B = 'file:///b.pra';

suite('Prima check state', () => {
    test('records counts and failure per document', () => {
        const state = new CheckState();
        const token = state.begin(A, 1);

        assert.strictEqual(state.settle(token, { errors: 2, warnings: 1 }, false, 1), true);
        assert.deepStrictEqual(state.totals(), { errors: 2, warnings: 1, failed: false, documents: 1 });
    });

    test('drops a result that a newer check has superseded', () => {
        const state = new CheckState();
        const first = state.begin(A, 1);
        const second = state.begin(A, 1);

        assert.strictEqual(state.isCurrent(first), false);
        assert.strictEqual(state.settle(first, { errors: 5, warnings: 0 }, false, 1), false);
        assert.strictEqual(state.settle(second, { errors: 1, warnings: 0 }, false, 1), true);
        assert.deepStrictEqual(state.totals(), { errors: 1, warnings: 0, failed: false, documents: 1 });
    });

    test('drops a result computed for an older document version', () => {
        const state = new CheckState();
        const token = state.begin(A, 1);

        // The document was edited while the check ran; the result describes stale text.
        assert.strictEqual(state.settle(token, { errors: 4, warnings: 0 }, true, 2), false);
        assert.deepStrictEqual(state.totals(), { errors: 0, warnings: 0, failed: false, documents: 1 });
    });

    test('forget drops counts and invalidates an in-flight result', () => {
        const state = new CheckState();
        const token = state.begin(A, 1);
        state.forget(A);

        assert.strictEqual(state.isCurrent(token), false);
        assert.strictEqual(state.settle(token, { errors: 3, warnings: 0 }, false, 1), false);
        assert.deepStrictEqual(state.totals(), { errors: 0, warnings: 0, failed: false, documents: 0 });
    });

    test('aggregates across documents and reports any failure', () => {
        const state = new CheckState();
        state.settle(state.begin(A, 1), { errors: 1, warnings: 0 }, false, 1);
        state.settle(state.begin(B, 1), { errors: 0, warnings: 2 }, true, 1);

        assert.deepStrictEqual(state.totals(), { errors: 1, warnings: 2, failed: true, documents: 2 });
    });

    test('a recovered document clears its own failure', () => {
        const state = new CheckState();
        state.settle(state.begin(A, 1), { errors: 0, warnings: 0 }, true, 1);
        assert.strictEqual(state.totals().failed, true);

        state.settle(state.begin(A, 1), { errors: 0, warnings: 0 }, false, 1);
        assert.strictEqual(state.totals().failed, false);
    });

    test('a failure in one document is not masked by a pass in another', () => {
        const state = new CheckState();
        state.settle(state.begin(A, 1), { errors: 0, warnings: 0 }, true, 1);
        state.settle(state.begin(B, 1), { errors: 0, warnings: 0 }, false, 1);

        assert.strictEqual(state.totals().failed, true);
    });

    test('forget only drops the named document', () => {
        const state = new CheckState();
        state.settle(state.begin(A, 1), { errors: 1, warnings: 0 }, false, 1);
        state.settle(state.begin(B, 1), { errors: 2, warnings: 0 }, false, 1);

        state.forget(A);

        assert.deepStrictEqual(state.totals(), { errors: 2, warnings: 0, failed: false, documents: 1 });
    });

    test('clear drops every document and every in-flight attempt', () => {
        const state = new CheckState();
        const inFlight = state.begin(A, 1);
        state.settle(state.begin(B, 1), { errors: 2, warnings: 0 }, true, 1);

        state.clear();

        assert.strictEqual(state.isCurrent(inFlight), false);
        assert.deepStrictEqual(state.totals(), { errors: 0, warnings: 0, failed: false, documents: 0 });
    });
});
