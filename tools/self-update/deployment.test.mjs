import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {generateKeyPairSync} from 'node:crypto';
import {createBundle} from './bundle.mjs';
import {requireForwardUpdate, requirePublishedUpdate} from './deployment.mjs';

test('only advances a signed runtime and makes same-version retries safe', () => {
    const keys = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const other = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const bundle = (version, javascript = 'void 0;', key = keys.privateKey) => createBundle({version, shell: 'a'.repeat(64), javascript, css: 'body{}'}, key);
    const current = bundle('0.1.5');
    const same = bundle('0.1.5');
    const next = bundle('0.1.6');
    assert.doesNotThrow(() => requireForwardUpdate(current, next, keys.publicKey));
    assert.doesNotThrow(() => requireForwardUpdate(current, same, keys.publicKey));
    assert.throws(() => requireForwardUpdate(next, current, keys.publicKey), /older runtime/);
    assert.throws(() => requireForwardUpdate(current, bundle('0.1.5', 'void 1;'), keys.publicKey), /different content/);
    assert.throws(() => requireForwardUpdate(current, bundle('0.1.6', 'void 0;', other.privateKey), keys.publicKey));
    assert.doesNotThrow(() => requirePublishedUpdate(current, current, keys.publicKey));
    assert.throws(() => requirePublishedUpdate(current, same, keys.publicKey), /differs/);
});
