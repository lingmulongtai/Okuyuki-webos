import {Library} from '../library';

function item (id, kind = 'photo') {
	return {id, kind, takenAt: Number(id), stereo: false, hdr: 'none', durationMs: null};
}

function fakeConnection (pages) {
	const listeners = [];
	const client = {
		library: jest.fn(({filter, cursor}) => Promise.resolve(pages[filter + ':' + (cursor || '')]))
	};
	return {
		client,
		listeners,
		onEvent: (listener) => listeners.push(listener),
		request: (call) => call(client)
	};
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

test('loads pages in order and drops items it already has', async () => {
	const connection = fakeConnection({
		'all:': {items: [item('3'), item('2')], next: 'c1', total: 4},
		'all:c1': {items: [item('2'), item('1')], next: null, total: 4}
	});
	const library = new Library(connection);
	await library.loadMore();
	await library.loadMore();
	const list = library.current();
	expect(list.items.map((entry) => entry.id)).toEqual(['3', '2', '1']);
	expect(list).toMatchObject({loaded: true, next: null, total: 4});
	// The last page is in; nothing more to ask for.
	await library.loadMore();
	expect(connection.client.library).toHaveBeenCalledTimes(2);
});

test('keeps one list per filter', async () => {
	const connection = fakeConnection({
		'all:': {items: [item('3'), item('2', 'video')], next: null, total: 2},
		'video:': {items: [item('2', 'video')], next: null, total: 1}
	});
	const library = new Library(connection);
	await library.loadMore();
	library.setFilter('video');
	await flush();
	expect(library.current().items.map((entry) => entry.id)).toEqual(['2']);
	expect(library.getState().lists.all.items).toHaveLength(2);
	library.setFilter('nonsense');
	expect(library.getState().filter).toBe('video');
});

test('starts over when the phone says the library changed', async () => {
	const pages = {'all:': {items: [item('3')], next: null, total: 1}};
	const connection = fakeConnection(pages);
	const library = new Library(connection);
	await library.loadMore();
	pages['all:'] = {items: [item('4'), item('3')], next: null, total: 2};
	connection.listeners.forEach((listener) => listener({type: 'library_changed'}));
	await flush();
	expect(library.current().items.map((entry) => entry.id)).toEqual(['4', '3']);
});

test('shows an error the user can retry from', async () => {
	const connection = fakeConnection({});
	connection.client.library.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('network'), {status: 0})));
	const library = new Library(connection);
	await library.loadMore();
	expect(library.current().error).toBeTruthy();
	expect(library.current().loading).toBe(false);
});
