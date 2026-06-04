import { Injectable } from '@nestjs/common';
import { AsyncStorageManager } from './als-manager';

/**
 * Per-async-context state used for reentrant locking.
 */
export interface MurLockContext {
  /** Shared owner token for every lock acquired within this context. */
  clientId: string;
  /** Map of lockKey -> current reentry depth held by this context. */
  holds: Map<string, number>;
}

@Injectable()
export class AsyncStorageService {
  constructor(
    private readonly asyncStorageManager: AsyncStorageManager<MurLockContext>
  ) {}

  /** Run `fn` with `store` as the active MurLock context. */
  run<R>(store: MurLockContext, fn: () => R): R {
    return this.asyncStorageManager.run(store, fn);
  }

  /** The active MurLock context, or undefined when outside any locked scope. */
  getContext(): MurLockContext | undefined {
    return this.asyncStorageManager.getStore();
  }
}
