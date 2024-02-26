import { AsyncLocalStorage } from 'async_hooks';
import { AsyncStorageManagerException } from '../exceptions';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AsyncStorageManager<T> {
  private asyncLocalStorage = new AsyncLocalStorage<Map<string, T>>();

  runWithNewContext<R>(fn: () => Promise<R>): Promise<R> {
    return this.asyncLocalStorage.run(new Map<string, T>(), fn);
  }

  set(key: string, value: T) {
    const store = this.asyncLocalStorage.getStore();
    if (!store) {
      throw new AsyncStorageManagerException('No active store found');
    }
    store[key] = value;
  }

  get(key: string): T | undefined {
    const store = this.asyncLocalStorage.getStore();
    if (!store) {
      throw new AsyncStorageManagerException('No active store found');
    }
    return store?.[key];
  }
}
