import { AsyncLocalStorage } from 'async_hooks';
import { AsyncStorageManagerException } from '../exceptions';

export class AsyncStorageManager<T> implements Map<string, T> {
  constructor(private readonly asyncLocalStorage: AsyncLocalStorage<Map<string, T>>) { }

  private getStore(): Map<string, T> {
    const store = this.asyncLocalStorage.getStore();

    if (!store) {
      throw new AsyncStorageManagerException('No active store found');
    }

    return store;
  }

  register(): void {
    this.asyncLocalStorage.enterWith(new Map());
  }

  runWithNewContext<R, TArgs extends any[]>(fn: (...args: TArgs) => R, ...args: TArgs): R {
    return this.asyncLocalStorage.run<R, TArgs>(new Map<string, T>(), fn, ...args);
  }

  set(key: string, value: T): this {
    this.getStore().set(key, value);
    return this;
  }

  get(key: string): T | undefined {
    return this.getStore().get(key);
  }

  clear(): void {
    return this.getStore().clear();
  }

  delete(key: string): boolean {
    return this.getStore().delete(key);
  }

  forEach(callbackfn: (value: T, key: string, map: Map<string, T>) => void, thisArg?: any): void {
    return this.getStore().forEach(callbackfn, thisArg);
  }
  has(key: string): boolean {
    return this.getStore().has(key);
  }

  get size(): number {
    return this.getStore().size;
  }

  entries(): IterableIterator<[string, T]> {
    return this.getStore().entries();
  }

  keys(): IterableIterator<string> {
    return this.getStore().keys();
  }

  values(): IterableIterator<T> {
    return this.getStore().values();
  }

  [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.getStore()[Symbol.iterator]()
  }

  [Symbol.toStringTag]: string = '[object AsyncContext]';
}
