// The phone's library as far as the TV has loaded it, one list per filter.
// Pages arrive newest first; only metadata is kept here, never photo bytes.
import {FILTERS} from '../host/protocol';
import {describeError} from './connection';

const emptyList = () => ({items: [], next: null, total: null, loading: false, loaded: false, error: null});

export class Library {
	constructor (connection) {
		this.connection = connection;
		this.listeners = new Set();
		this.generation = 0;
		this.state = {filter: 'all', lists: {}};
		FILTERS.forEach((filter) => {
			this.state.lists[filter] = emptyList();
		});
		connection.onEvent((event) => {
			if (event.type === 'library_changed') this.reset();
		});
	}

	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getState = () => this.state;

	set (patch) {
		this.state = {...this.state, ...patch};
		this.listeners.forEach((listener) => listener());
	}

	setList (filter, patch) {
		this.set({lists: {...this.state.lists, [filter]: {...this.state.lists[filter], ...patch}}});
	}

	current () {
		return this.state.lists[this.state.filter];
	}

	setFilter (filter) {
		if (FILTERS.indexOf(filter) < 0) return;
		this.set({filter});
		if (!this.state.lists[filter].loaded) this.loadMore();
	}

	/** Loads the next page of the current filter, unless one is on its way or the list is complete. */
	async loadMore (filter = this.state.filter) {
		const list = this.state.lists[filter];
		if (list.loading || (list.loaded && !list.next)) return;
		const generation = this.generation;
		this.setList(filter, {loading: true, error: null});
		try {
			const page = await this.connection.request((client) => client.library({filter, cursor: list.next}));
			if (generation !== this.generation) return;
			const known = new Set(list.items.map((item) => item.id));
			const items = list.items.concat(page.items.filter((item) => !known.has(item.id)));
			this.setList(filter, {items, next: page.next, total: page.total, loading: false, loaded: true});
		} catch (error) {
			if (generation !== this.generation) return;
			this.setList(filter, {loading: false, error: describeError(error)});
		}
	}

	/** Forgets every list (the phone's library changed or another phone connected) and reloads. */
	reset () {
		this.generation++;
		const lists = {};
		FILTERS.forEach((filter) => {
			lists[filter] = emptyList();
		});
		this.set({lists});
		this.loadMore();
	}

	find (id) {
		for (const filter of FILTERS) {
			const item = this.state.lists[filter].items.find((candidate) => candidate.id === id);
			if (item) return item;
		}
		return null;
	}
}
