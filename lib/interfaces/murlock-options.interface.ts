import { RedisClientOptions } from 'redis';

export interface MurLockModuleOptions {
  redisOptions: RedisClientOptions;
  wait: number;
  maxAttempts: number;
  logLevel: 'none' | 'error' | 'warn' | 'log' | 'debug';
  ignoreUnlockFail?: boolean;
  lockKeyPrefix?: 'default' | 'custom'
  failFastOnRedisError?: boolean;
  blocking?: boolean;
  /**
   * When true, MurLock keeps the lock alive while the wrapped operation is still
   * running by periodically extending its TTL (a "watchdog"). This prevents the
   * lock from expiring mid-execution when the operation takes longer than
   * `releaseTime`, which would otherwise allow another instance to acquire the
   * same lock and break mutual exclusion.
   *
   * Defaults to `false` (no behavior change for existing users).
   */
  autoExtend?: boolean;
  /**
   * Interval in milliseconds between watchdog TTL extensions. Only used when
   * `autoExtend` is true. If omitted, defaults to one third of the lock's
   * `releaseTime` (`Math.floor(releaseTime / 3)`), guaranteeing at least two
   * refresh attempts before the TTL would expire.
   */
  extendInterval?: number;
  /**
   * Optional callback invoked when the Redis client emits a runtime `error`
   * event. Use this to plug in custom alerting or fail-fast behavior. Note that
   * `failFastOnRedisError` only applies to the initial connection attempt and no
   * longer terminates the process on transient runtime errors.
   */
  onRedisError?: (error: Error) => void;
  /**
   * When true, locks become reentrant within the same async context: nested
   * calls to a method locking the same key (directly or transitively) reuse the
   * outer lock instead of deadlocking. Implemented via AsyncLocalStorage and a
   * per-key hold counter; the underlying Redis lock is acquired once (outermost
   * entry) and released when the outermost call completes.
   *
   * Defaults to `false` (no behavior change for existing users).
   */
  reentrant?: boolean;
  /**
   * When true, each lock-key part derived from method arguments is escaped so
   * that values containing the `:` separator cannot collide (e.g. `a:b` + `c`
   * vs `a` + `b:c`). Changes the generated key format, so it is opt-in to avoid
   * breaking existing keys across a rolling deploy.
   *
   * Defaults to `false`.
   */
  encodeKeyParts?: boolean;
  /**
   * When true, retry back-off delays use equal jitter
   * (`delay/2 + random*delay/2`) to avoid a thundering herd when many workers
   * wait on the same lock. Applies to both attempt-based and blocking modes.
   *
   * Defaults to `false` (deterministic timing preserved).
   */
  jitter?: boolean;
}

export interface MurLockModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<MurLockModuleOptions> | MurLockModuleOptions;
}
