import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient, RedisClientType } from 'redis';
import { AsyncStorageService } from './als/als.service';
import { MurLockException, MurLockRedisException } from './exceptions';
import { MurLockModuleOptions } from './interfaces';
import { generateUuid } from './utils';

/**
 * A service for MurLock to manage locks
 */
@Injectable()
export class MurLockService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MurLockService.name);
  private redisClient: RedisClientType;
  private readonly lockScript = readFileSync(
    join(__dirname, './lua/lock.lua')
  ).toString();
  private readonly unlockScript = readFileSync(
    join(__dirname, './lua/unlock.lua')
  ).toString();

  constructor(
    @Inject('MURLOCK_OPTIONS') readonly options: MurLockModuleOptions,
    private readonly asyncStorageService: AsyncStorageService
  ) {}

  async onModuleInit() {
    this.redisClient = createClient(
      this.options.redisOptions
    ) as RedisClientType;

    this.redisClient.on('error', (err) => {
      this.log('error', 'MurLock Redis Client Error', err);
      throw new MurLockRedisException(
        `MurLock Redis Client Error: ${err.message}`
      );
    });

    await this.redisClient.connect();
  }

  async onApplicationShutdown(signal?: string) {
    this.log('log', 'Shutting down MurLock Redis client.');
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(
    level: MurLockModuleOptions['logLevel'],
    message: any,
    context?: string
  ): void {
    const levels: MurLockModuleOptions['logLevel'][] = [
      'debug',
      'log',
      'warn',
      'error',
    ];
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
  private async lock(
    lockKey: string,
    releaseTime: number,
    clientId: string,
    wait?: number | ((retries: number) => number)
  ): Promise<boolean> {
    this.log('debug', `MurLock Client ID is ${clientId}`);

    const attemptLock = async (attemptsRemaining: number): Promise<boolean> => {
      if (attemptsRemaining === 0) {
        throw new MurLockException(
          `Failed to obtain lock for key ${lockKey} after ${this.options.maxAttempts} attempts.`
        );
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
          const delay = wait
            ? typeof wait === 'function'
              ? wait(this.options.maxAttempts - attemptsRemaining + 1)
              : wait
            : this.options.wait *
              (this.options.maxAttempts - attemptsRemaining + 1);
          this.log(
            'warn',
            `Failed to obtain lock for key ${lockKey}, retrying in ${delay} ms...`
          );
          await this.sleep(delay); // Back-off Strategy
          return attemptLock(attemptsRemaining - 1);
        }
      } catch (error) {
        throw new MurLockException(
          `Unexpected error when trying to obtain lock for key ${lockKey}: ${error.message}`
        );
      }
    };

    return attemptLock(this.options.maxAttempts);
  }

  /**
   * Release a lock
   * @param {string} lockKey the key to release the lock from
   * @returns {Promise<void>} a promise that resolves when the lock is released
   */
  private async unlock(lockKey: string, clientId: string): Promise<void> {
    const result = await this.redisClient.sendCommand([
      'EVAL',
      this.unlockScript,
      '1',
      lockKey,
      clientId,
    ]);
    if (result === 0) {
      if (!this.options.ignoreUnlockFail) {
        throw new MurLockException(`Failed to release lock for key ${lockKey}`);
      } else {
        this.log(
          'warn',
          `Failed to release lock for key ${lockKey}, but throwing errors is disabled.`
        );
      }
    }
  }

  private async acquireLock(
    lockKey: string,
    clientId: string,
    releaseTime: number,
    wait?: number | ((retries: number) => number)
  ): Promise<void> {
    let isLockSuccessful = false;
    try {
      isLockSuccessful = await this.lock(lockKey, releaseTime, clientId, wait);
    } catch (error) {
      throw new MurLockException(
        `Failed to acquire lock for key ${lockKey}: ${error.message}`
      );
    }

    if (!isLockSuccessful) {
      throw new MurLockException(`Could not obtain lock for key ${lockKey}`);
    }
  }

  private async releaseLock(lockKey: string, clientId: string): Promise<void> {
    try {
      await this.unlock(lockKey, clientId);
    } catch (error) {
      throw new MurLockException(
        `Failed to release lock for key ${lockKey}: ${error.message}`
      );
    }
  }

  /**
   * Executes a function within the scope of a managed lock.
   */
  async runWithLock<R>(
    lockKey: string,
    releaseTime: number,
    fn: () => Promise<R>
  );
  async runWithLock<R>(
    lockKey: string,
    releaseTime: number,
    wait: number | ((retries: number) => number),
    fn: () => Promise<R>
  );
  async runWithLock<R>(
    lockKey: string,
    releaseTime: number,
    waitOrFn: number | ((retries: number) => number) | (() => Promise<R>),
    fn?: () => Promise<R>
  ): Promise<R> {
    let wait: number | ((retries: number) => number) | undefined;
    let operation: () => Promise<R>;
    if (fn === undefined) {
      operation = waitOrFn as () => Promise<R>;
    } else {
      wait = waitOrFn as number | ((retries: number) => number);
      operation = fn;
    }
    this.asyncStorageService.registerContext();
    this.asyncStorageService.setClientID('clientId', generateUuid());
    const clientId = this.asyncStorageService.get('clientId');
    await this.acquireLock(lockKey, clientId, releaseTime, wait);
    try {
      return await operation();
    } finally {
      await this.releaseLock(lockKey, clientId);
    }
  }
}
