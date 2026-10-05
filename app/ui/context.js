// The store and actions every component needs, provided once by the root.
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { useStore } from './state.js';

/** @type {import('preact').Context<{ store: import('./state.js').Store,
 *   actions: import('./actions.js').Actions } | null>} */
export const AppContext = createContext(null);

export function useActions() {
  return useContext(AppContext).actions;
}

/**
 * @template T
 * @param {(state: import('./state.js').State) => T} select
 * @returns {T}
 */
export function useAppState(select) {
  return useStore(useContext(AppContext).store, select);
}
