import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createClient, RedisClientType } from 'redis';
import { AsyncStorageService } from './als/als.service';
import { MurLockException } from './exceptions';
import { MurLockModuleOptions } from './interfaces';
import { generateUuid } from './utils';

/**
 * A service for MurLock to manage locks
 */
@Injectable()
export class MurLockService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MurLockService.name);
  private redisClient: RedisClientType;
  private lockScript: string;
  private unlockScript: string;
  private extendScript: string;

  constructor(
    @Inject('MURLOCK_OPTIONS') readonly options: MurLockModuleOptions,
    private readonly asyncStorageService: AsyncStorageService
  ) {}

  async onModuleInit() {
    try {
      this.lockScript = await readFile(
        join(__dirname, './lua/lock.lua'),
        'utf8'
      );
      this.unlockScript = await readFile(
        join(__dirname, './lua/unlock.lua'),
        'utf8'
      );
      this.extendScript = await readFile(
        join(__dirname, './lua/extend.lua'),
        'utf8'
      );
    } catch (error) {
      throw new MurLockException(
        `Failed to load Lua scripts: ${error.message}`
      );
    }

    this.redisClient = createClient({
      ...this.options.redisOptions,
      socket: {
        ...this.options.redisOptions.socket,
        keepAlive: false,
        reconnectStrategy: (retries) => {
          const delay = Math.min(retries * 500, 5000);
          this.log('warn', `MurLock Redis reconnect attempt ${retries}, waiting ${delay} ms...`);
          return delay;
        },
      },
    }) as RedisClientType;
    
    this.registerRedisErrorHandlers();

    try {
      await this.redisClient.connect();
    } catch (error) {
      this.log('error', `Failed to connect to Redis: ${error.message}`);
      if (this.options.failFastOnRedisError) {
        throw new MurLockException(`Redis connection failed: ${error.message}`);
      }
    }
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
    // 'none' disables all logging. Without this guard, levels.indexOf('none')
    // returns -1 and the threshold check below would pass for every message,
    // causing 'none' to (incorrectly) log everything.
    if (this.options.logLevel === 'none') {
      return;
    }
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
    if (this.options.blocking) {
      return this.blockingLock(lockKey, releaseTime, clientId);
    }

    const attemptLock = async (attemptsRemaining: number): Promise<boolean> => {
      if (attemptsRemaining === 0) {
        throw new MurLockException(
          `Failed to obtain lock for key ${lockKey} after ${this.options.maxAttempts} attempts.`
        );      }
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

  /**
   * Extend the TTL of a lock the given client still owns.
   * @returns {Promise<boolean>} true if the lock was still owned and extended, false otherwise
   */
  private async extendLock(
    lockKey: string,
    clientId: string,
    releaseTime: number
  ): Promise<boolean> {
    const result = await this.redisClient.sendCommand([
      'EVAL',
      this.extendScript,
      '1',
      lockKey,
      clientId,
      releaseTime.toString(),
    ]);
    return result === 1;
  }

  /**
   * Start a watchdog timer that periodically extends the lock TTL while the
   * wrapped operation is still running. Returns a stop function that clears the
   * timer. No-op (returns a no-op stopper) when `autoExtend` is disabled.
   */
  private startWatchdog(
    lockKey: string,
    clientId: string,
    releaseTime: number
  ): () => void {
    if (!this.options.autoExtend) {
      return () => {};
    }

    const interval =
      this.options.extendInterval && this.options.extendInterval > 0
        ? this.options.extendInterval
        : Math.max(1, Math.floor(releaseTime / 3));

    const timer = setInterval(async () => {
      try {
        const extended = await this.extendLock(lockKey, clientId, releaseTime);
        if (extended) {
          this.log('debug', `Watchdog extended lock for key ${lockKey}`);
        } else {
          this.log(
            'warn',
            `Watchdog could not extend lock for key ${lockKey} (ownership lost); stopping watchdog.`
          );
          clearInterval(timer);
        }
      } catch (error) {
        this.log(
          'error',
          `Watchdog error while extending lock for key ${lockKey}: ${error.message}`
        );
      }
    }, interval);

    // Do not keep the event loop / process alive solely for the watchdog.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    return () => clearInterval(timer);
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
  ): Promise<R>;
  async runWithLock<R>(
    lockKey: string,
    releaseTime: number,
    wait: number | ((retries: number) => number),
    fn: () => Promise<R>
  ): Promise<R>;
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
    const stopWatchdog = this.startWatchdog(lockKey, clientId, releaseTime);
    try {
      return await operation();
    } finally {
      stopWatchdog();
      await this.releaseLock(lockKey, clientId);
    }
  }

  private registerRedisErrorHandlers() {
    this.redisClient.on('error', (err) => {
      this.log('error', `MurLock Redis Client Error: ${err.message}`);

      // NOTE: Runtime Redis errors (including transient network blips) no longer
      // terminate the process. `failFastOnRedisError` only governs the initial
      // connection attempt in onModuleInit. Reconnection is handled by the
      // configured reconnectStrategy. Use `onRedisError` for custom alerting or
      // fail-fast behavior.
      if (typeof this.options.onRedisError === 'function') {
        try {
          this.options.onRedisError(err);
        } catch (callbackError) {
          this.log(
            'error',
            `MurLock onRedisError callback threw: ${callbackError.message}`
          );
        }
      }
    });
  
    this.redisClient.on('reconnecting', () => {
      this.log('warn', 'MurLock Redis Client attempting reconnect...');
    });
  
    this.redisClient.on('ready', () => {
      this.log('log', 'MurLock Redis Client connected and ready.');
    });
  
    this.redisClient.on('end', () => {
      this.log('warn', 'MurLock Redis Client connection closed.');
    });
  }

  /**
 * Blocking infinite retry lock strategy
 */
private async blockingLock(
  lockKey: string,
  releaseTime: number,
  clientId: string,
): Promise<boolean> {
  while (true) {
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
        this.log('log', `Successfully obtained lock for key ${lockKey} in blocking mode`);
        return true;
      } else {
        this.log('warn', `Lock busy for key ${lockKey}, waiting ${this.options.wait} ms before next attempt (blocking mode)...`);
        await this.sleep(this.options.wait);
      }
    } catch (error) {
      this.log('error', `Unexpected error in blocking lock for key ${lockKey}: ${error.message}`);
      await this.sleep(this.options.wait);
    }
  }
}
}
