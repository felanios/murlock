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
}

export interface MurLockModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<MurLockModuleOptions> | MurLockModuleOptions;
}
