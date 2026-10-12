import {useSyncExternalStore} from 'react';

/** Subscribes a component to a store with `subscribe` and `getState` (Connection, Library). */
export default function useStore (store) {
	return useSyncExternalStore(store.subscribe, store.getState);
}
