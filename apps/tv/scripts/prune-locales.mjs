/* eslint-disable no-console */
// Keeps only the iLib locale data this app is used with: the shared root data, Japanese,
// US English and the time zones. The full set that `enact pack` copies is over 80 MB, which
// would make the IPK and its install on the TV needlessly large. The manifest is rewritten
// to match, so iLib never asks for a file that is not there.
import {existsSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';

const dist = process.argv[2] || 'dist';
const root = join(dist, 'node_modules', 'ilib', 'locale');
const KEEP = [
	/^[^/]+\.json$/,
	/^ja\//,
	/^en\/[^/]+\.json$/,
	/^en\/US\//,
	/^und\/(JP|US)\//,
	/^zoneinfo\//
];

if (!existsSync(root)) {
	console.log('No iLib locale data in ' + dist + '; nothing to prune.');
	process.exit(0);
}

function walk (dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function removeEmpty (dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) removeEmpty(path);
	}
	if (dir !== root && readdirSync(dir).length === 0) rmdirSync(dir);
}

let removed = 0;
const kept = [];
for (const file of walk(root)) {
	const name = relative(root, file).split(sep).join('/');
	if (name === 'ilibmanifest.json') continue;
	if (KEEP.some((pattern) => pattern.test(name))) {
		kept.push(name);
	} else {
		rmSync(file);
		removed++;
	}
}
removeEmpty(root);

const manifest = join(root, 'ilibmanifest.json');
const data = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
data.files = kept.sort();
writeFileSync(manifest, JSON.stringify(data));
console.log('iLib locale data: kept ' + kept.length + ' files, removed ' + removed + '.');
