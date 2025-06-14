import { Injectable } from '@nestjs/common';
import { AsyncStorageManager } from './als-manager';

@Injectable()
export class AsyncStorageService {
  constructor(private readonly asyncStorageManager: AsyncStorageManager<string>) {}

  runWithNewContext<R, TArgs extends any[]>(fn: (...args: TArgs) => R, ...args: TArgs): R {
    return this.asyncStorageManager.runWithNewContext(fn, ...args);
  }

  registerContext(): void {
    this.asyncStorageManager.register();
  }

  get(key: string): string {
    return this.asyncStorageManager.get(key);
  }

  setClientID(key: string, value: string): void {
    this.asyncStorageManager.set(key, value);
  }
}
