import {packageVersion, runtimeMessage} from '../runtime-status';

test('identifies the installed IPK separately from the updated runtime', () => {
	expect(packageVersion({version: '0.1.3'}, '0.1.4')).toBe('0.1.3');
	expect(packageVersion(null, '0.1.4')).toBe('0.1.4');
});

test('explains when an update needs a new IPK', () => {
	expect(runtimeMessage({status: 'incompatible'})).toContain('IPK');
	expect(runtimeMessage({status: 'ready', version: '0.1.4'})).toContain('0.1.4');
});
