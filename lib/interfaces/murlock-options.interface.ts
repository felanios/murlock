import { ClientOpts } from 'redis';

export interface MurLockModuleOptions {
  redisOptions: ClientOpts;
  wait: number;
  maxAttempts: number;
}

export interface MurLockModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
      ...args: any[]
  ) => Promise<MurLockModuleOptions> | MurLockModuleOptions;
}
