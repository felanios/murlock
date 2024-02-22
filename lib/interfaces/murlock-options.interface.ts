import { RedisClientOptions } from 'redis';

export interface MurLockModuleOptions {
  redisOptions: RedisClientOptions;
  wait: number;
  maxAttempts: number;
  logLevel: 'none' | 'error' | 'warn' | 'log' | 'debug';
  ignoreUnlockFail?: boolean;
}

export interface MurLockModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<MurLockModuleOptions> | MurLockModuleOptions;
}
