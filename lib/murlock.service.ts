import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Logger } from '@nestjs/common';
import { RedisClient } from 'redis';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MurLockModuleOptions } from './interfaces';
import { ClsService } from 'nestjs-cls';

/**
 * A service for MurLock to manage locks
 */
@Injectable()
export class MurLockService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MurLockService.name);
  private redisClient: RedisClient;
  private readonly lockScript = readFileSync(join(__dirname, './lua/lock.lua')).toString();
  private readonly unlockScript = readFileSync(join(__dirname, './lua/unlock.lua')).toString();
  private runScriptAsync: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<number>;

  constructor(
    @Inject('MURLOCK_OPTIONS') protected readonly options: MurLockModuleOptions,
    private readonly clsService: ClsService,
  ) {}
  
  onModuleInit() {
    this.redisClient = new RedisClient(this.options.redisOptions);
    this.runScriptAsync = promisify(this.redisClient.eval).bind(this.redisClient);

    this.redisClient.on('error', (err) => this.log('error','MurLock Redis Client Error', err));
  }

  onApplicationShutdown(signal?: string) {
    this.log('log','MurLock Redis Disconnected.');
    this.redisClient.quit();
  }

  private generateUuid(): string {
    let d = Date.now();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      (c: string) => {
        const r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }
    );
  }

  private getClientId(): string {
    let clientId = this.clsService.get('clientId');
    if (!clientId) {
      clientId = this.generateUuid();
      this.clsService.set('clientId', clientId);
    }
    return clientId;
  }

  private sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(level: MurLockModuleOptions['logLevel'], message: any, context?: string): void {
    const levels: MurLockModuleOptions['logLevel'][] = ['debug', 'log', 'warn', 'error'];
    if (levels.indexOf(level) >= levels.indexOf(this.options.logLevel)) {
      this.logger[level](message, context);
    }
  }

    /**
   * Attempt to lock a key
   * @param {string} lockKey the key to lock
   * @param {number} releaseTime the time in milliseconds when the lock should be released
   * @returns {Promise<boolean>} a promise that resolves to true if the lock is successful, false otherwise
   */
  async lock(lockKey: string, releaseTime: number, attemptsRemaining = this.options.maxAttempts): Promise<boolean> {
    const clientId = this.getClientId();
    this.log('debug',`MurLock Client ID is ${clientId}`);

    const attemptLock = async (attemptsRemaining: number): Promise<boolean> => {
      if (attemptsRemaining === 0) {
        throw new Error(`Failed to obtain lock for key ${lockKey} after ${this.options.maxAttempts} attempts.`);
      }
      try {
        const isLockSuccessful = await this.runScriptAsync(this.lockScript, 1, lockKey, clientId, releaseTime);
        if (isLockSuccessful === 1) {
          this.log('log',`Successfully obtained lock for key ${lockKey}`);
          return true;
        } else {
          this.log('warn',`Failed to obtain lock for key ${lockKey}, retrying in ${this.options.wait} ms...`);
          await this.sleep(this.options.wait * (this.options.maxAttempts - attemptsRemaining + 1)); // Back-off Strategy
          return attemptLock(attemptsRemaining - 1);
        }
      } catch (error) {
        this.log('error',`Unexpected error when trying to obtain lock for key ${lockKey}:`, error);
        return false;
      }
    };

    return attemptLock(this.options.maxAttempts);
  }

    /**
   * Release a lock
   * @param {string} lockKey the key to release the lock from
   * @returns {Promise<void>} a promise that resolves when the lock is released
   */
    async unlock(lockKey: string): Promise<void> {
      const clientId = this.getClientId();
      const result = await this.runScriptAsync(this.unlockScript, 1, lockKey, clientId);
  
      if (result === 0) {
        throw new Error(`Failed to release lock for key ${lockKey}`);
      }
  }
}
