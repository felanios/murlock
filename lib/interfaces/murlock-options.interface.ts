import { ClientOpts } from 'redis';

export interface MurLockModuleOptions {
  redisOptions: ClientOpts;
  wait: number;
  maxAttempts: number;
  logLevel: 'none' | 'error' | 'warn' | 'log' | 'debug';
}

export interface MurLockModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
      ...args: any[]
  ) => Promise<MurLockModuleOptions> | MurLockModuleOptions;
}
