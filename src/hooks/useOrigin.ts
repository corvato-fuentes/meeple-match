import { useSyncExternalStore } from 'react';

const subscribe = () => () => {}; // the origin never changes while the page is open

/**
 * The site's origin (https://…), for building share links. It is only known in the browser: the server render (and
 * the first client render that must match it) gets '', then it switches to the real value — without storing it in
 * state from an effect.
 */
export function useOrigin(): string {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => '');
}
