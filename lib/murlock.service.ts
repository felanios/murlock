import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MurLockModuleOptions } from './interfaces';
import { MurLockRedisException, MurLockException } from './exceptions';

/**
 * A service for MurLock to manage locks
 */
@Injectable()
export class MurLockService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MurLockService.name);
  private redisClient: RedisClientType;
  private readonly lockScript = readFileSync(join(__dirname, './lua/lock.lua')).toString();
  private readonly unlockScript = readFileSync(join(__dirname, './lua/unlock.lua')).toString();
  private clientId: string | undefined;

  constructor(
    @Inject('MURLOCK_OPTIONS') protected readonly options: MurLockModuleOptions,
  ) { }

  async onModuleInit() {
    this.redisClient = createClient(this.options.redisOptions) as RedisClientType;

    this.redisClient.on('error', (err) => {
      this.log('error', 'MurLock Redis Client Error', err);
      throw new MurLockRedisException(`MurLock Redis Client Error: ${err.message}`);
    });

    await this.redisClient.connect();
  }

  onApplicationShutdown(signal?: string) {
    this.log('log', 'MurLock Redis Disconnected.');
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
    if (this.clientId) {
      return this.clientId;
    }

    return this.clientId = this.generateUuid();
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
    this.log('debug', `MurLock Client ID is ${clientId}`);

    const attemptLock = async (attemptsRemaining: number): Promise<boolean> => {
      if (attemptsRemaining === 0) {
        throw new MurLockException(`Failed to obtain lock for key ${lockKey} after ${this.options.maxAttempts} attempts.`);
      }
      try {
        const isLockSuccessful = await this.redisClient.sendCommand([
          'EVAL',
          this.lockScript,
          '1',
          lockKey,
          clientId,
          releaseTime.toString(),
        ]);
        if (isLockSuccessful === 1) {
          this.log('log', `Successfully obtained lock for key ${lockKey}`);
          return true;
        } else {
          this.log('warn', `Failed to obtain lock for key ${lockKey}, retrying in ${this.options.wait} ms...`);
          await this.sleep(this.options.wait * (this.options.maxAttempts - attemptsRemaining + 1)); // Back-off Strategy
          return attemptLock(attemptsRemaining - 1);
        }
      } catch (error) {
        throw new MurLockException(`Unexpected error when trying to obtain lock for key ${lockKey}: ${error.message}`);
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
    const result = await this.redisClient.sendCommand([
      'EVAL',
      this.unlockScript,
      '1',
      lockKey,
      clientId,
    ]);
    if (result === 0) {
      throw new MurLockException(`Failed to release lock for key ${lockKey}`);
    }
  }
}
