/** Fail a release instead of replacing a compatible TV update with an incompatible one. */
export function requireCompatibleShell(actual, required) {
    if (!required) return;
    if (!/^[0-9a-f]{64}$/.test(required) || actual !== required) {
        throw new Error('TV runtime shell does not match the required installed package');
    }
}
