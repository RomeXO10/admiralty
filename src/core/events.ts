/**
 * Minimal synchronous event bus.
 *
 * Used to decouple layers (e.g. sim raising "ship struck" without knowing the
 * UI exists). Kept tiny on purpose; we will grow the event vocabulary as later
 * phases need it.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<unknown>);
    return () => set!.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) (fn as Listener<Events[K]>)(payload);
  }
}
