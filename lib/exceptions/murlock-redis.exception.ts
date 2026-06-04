import { MurLockException } from './murlock.exception';

/**
 * Raised for failures originating from the Redis layer (command/Lua errors).
 * Extends {@link MurLockException} so existing `catch (MurLockException)`
 * handlers keep working, while letting callers distinguish Redis-caused
 * failures via `instanceof MurLockRedisException`.
 */
export class MurLockRedisException extends MurLockException {
  constructor(message: string) {
    super(message);
    this.name = "MurLockRedisException";
  }
}