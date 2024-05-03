import { Injectable, OnModuleInit } from "@nestjs/common";
import { AsyncStorageManager } from "./als-manager";
import { AsyncLocalStorage } from "async_hooks";

@Injectable()
export class AsyncStorageService implements OnModuleInit {
  constructor(private asyncStorageManager: AsyncStorageManager<string>) { }

  onModuleInit() {
    this.asyncStorageManager = new AsyncStorageManager(new AsyncLocalStorage<any>());
  }

  async runWithNewContext<R, TArgs extends any[]>(fn: (...args: TArgs) => R, ...args: TArgs): Promise<R> {
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