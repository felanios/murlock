import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Thin wrapper around Node's AsyncLocalStorage providing context-scoped
 * storage. Uses `run()` (never `enterWith()`) so a context is confined to the
 * async execution it wraps and never leaks into sibling or parent flows.
 */
@Injectable()
export class AsyncStorageManager<T> {
  constructor(
    private readonly asyncLocalStorage = new AsyncLocalStorage<T>()
  ) {}

  /** Run `fn` with `store` as the active context for its entire async chain. */
  run<R>(store: T, fn: () => R): R {
    return this.asyncLocalStorage.run(store, fn);
  }

  /** The active context, or undefined when called outside any `run()`. */
  getStore(): T | undefined {
    return this.asyncLocalStorage.getStore();
  }
}
