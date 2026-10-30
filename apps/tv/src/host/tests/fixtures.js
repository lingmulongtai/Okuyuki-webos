// The shared protocol fixtures (protocol/fixtures/v2), which the phone's tests read as well.
/* global __dirname */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '../../../../../protocol/fixtures/v2');

export function fixture (name) {
	return JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8'));
}

export function fixtureNames () {
	return fs.readdirSync(DIR).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
}
