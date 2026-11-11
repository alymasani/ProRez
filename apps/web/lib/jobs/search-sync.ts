/**
 * Keeps the debounced job search input in sync with the URL.
 *
 * The input is locally controlled so typing stays responsive, and its value is
 * pushed to the URL after a pause. When the URL's query changes, we must tell
 * apart our own push echoing back from an external change (browser back /
 * forward, a link). Only external changes should overwrite what the user sees
 * and cancel any pending push, otherwise a stale debounce would undo the
 * navigation.
 */
export interface SearchSyncState {
  /** Value shown in the search input. */
  input: string;
  /** Last query this component wrote to the URL (or adopted from it). */
  lastPushed: string;
}

export interface SearchSyncResult {
  state: SearchSyncState;
  /** True when the URL changed for a reason other than our own push. */
  external: boolean;
}

export function initialSearchSync(urlQuery: string): SearchSyncState {
  return { input: urlQuery, lastPushed: urlQuery };
}

/** Record that we are about to push `query` to the URL. */
export function markPushed(state: SearchSyncState, query: string): SearchSyncState {
  return { ...state, lastPushed: query };
}

/** Reconcile local state with the query currently in the URL. */
export function reconcileWithUrl(state: SearchSyncState, urlQuery: string): SearchSyncResult {
  if (urlQuery === state.lastPushed) return { state, external: false };
  return { state: { input: urlQuery, lastPushed: urlQuery }, external: true };
}
