import {verifyBundle} from './bundle.mjs';

function checked(envelope, key) {
    const payload = verifyBundle(envelope, key);
    if (payload.schema !== 1 || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(payload.version) || !/^[0-9a-f]{64}$/.test(payload.shell)) {
        throw new Error('Invalid signed runtime metadata');
    }
    return payload;
}

/** Refuse older runtimes and changed content under an already published version. */
export function requireForwardUpdate(currentEnvelope, nextEnvelope, key) {
    const current = checked(currentEnvelope, key);
    const next = checked(nextEnvelope, key);
    const previous = current.version.split('.').map(Number);
    const proposed = next.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (proposed[i] > previous[i]) return;
        if (proposed[i] < previous[i]) throw new Error('Refusing to publish an older runtime');
    }
    if (JSON.parse(currentEnvelope).payload !== JSON.parse(nextEnvelope).payload) throw new Error('Runtime version is already published with different content');
}

/** Check exact delivered bytes as well as their signature. */
export function requirePublishedUpdate(actual, expected, key) {
    checked(actual, key);
    checked(expected, key);
    if (actual !== expected) throw new Error('Published runtime differs from the signed release');
}
