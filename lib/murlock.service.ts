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
import { AsyncStorageService, MurLockContext } from './als/als.service';
import { MurLockException, MurLockRedisException } from './exceptions';
import { MurLockModuleOptions, MurLockRedisClient } from './interfaces';
import { generateUuid } from './utils';

type ScriptName = 'lock' | 'unlock' | 'extend';

/**
 * A service for MurLock to manage locks
 */
@Injectable()
export class MurLockService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MurLockService.name);
  private redisClient: RedisClientType;
  /**
   * Whether MurLock built the client. A client handed in through `options.client`
   * belongs to the application: closing it on our shutdown would pull it out from
   * under whatever else is using it.
   */
  private ownsClient = true;

  private lockScript: string;
  private unlockScript: string;
  private extendScript: string;
  private readonly scriptShas: Partial<Record<ScriptName, string>> = {};

  constructor(
    @Inject('MURLOCK_OPTIONS') readonly options: MurLockModuleOptions,
    private readonly asyncStorageService: AsyncStorageService
  ) {}

  async onModuleInit() {
    this.validateOptions();

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

    if (this.options.client) {
      // Supplied by the application — typically because its topology (Sentinel,
      // Cluster) cannot be described by a single endpoint. We borrow it.
      const supplied =
        typeof this.options.client === 'function'
          ? await this.options.client()
          : this.options.client;
      this.redisClient = supplied as unknown as RedisClientType;
      this.ownsClient = false;
    } else {
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
      this.ownsClient = true;
    }

    this.registerRedisErrorHandlers();

    try {
      // Only connect what we built. A supplied client may already be connected,
      // and connecting it twice is an error in both libraries.
      if (this.ownsClient) {
        await this.redisClient.connect();
      }
      await this.loadScripts();
    } catch (error) {
      this.log('error', `Failed to connect to Redis: ${error.message}`);
      if (this.options.failFastOnRedisError) {
        throw new MurLockException(`Redis connection failed: ${error.message}`);
      }
    }
  }

  /**
   * node-redis calls it `sendCommand`, ioredis calls it `call`. MurLock issues
   * nothing else, so bridging this one method is all it takes to accept either.
   *
   * Resolved per call rather than cached at init: the client can be replaced
   * after construction (tests do exactly this), and a cached binding would
   * then point at the wrong one.
   */
  private sendCommand(args: string[]): Promise<unknown> {
    const client = this.redisClient as unknown as MurLockRedisClient;
    // `call` first: ioredis has BOTH, but its `sendCommand` takes an internal
    // Command object rather than an argument array. Checking `sendCommand`
    // first picks the wrong one for every ioredis client — it does not type
    // check, and it fails on the first command at runtime.
    if (typeof client?.call === 'function') {
      return client.call(...args);
    }
    if (typeof client?.sendCommand === 'function') {
      return client.sendCommand(args);
    }
    throw new MurLockException(
      'The supplied Redis client exposes neither `sendCommand` nor `call`; MurLock cannot issue commands through it.'
    );
  }

  async onApplicationShutdown(signal?: string) {
    this.log('log', 'Shutting down MurLock Redis client.');
    if (!this.ownsClient) {
      // Borrowed client: the application closes it on its own terms.
      return;
    }
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }

  /**
   * Validate the configured options early so misconfiguration surfaces at
   * startup instead of as confusing runtime behavior.
   */
  private validateOptions(): void {
    const { maxAttempts, wait, extendInterval, redisOptions, client } = this.options;
    // Exactly one source of a connection. Neither leaves nothing to connect to;
    // both is ambiguous, and silently preferring one would make the ignored
    // setting look effective.
    if (!redisOptions && !client) {
      throw new MurLockException(
        "MurLock needs either 'redisOptions' or 'client'. Supply 'client' for topologies a single endpoint cannot describe, such as Sentinel."
      );
    }
    if (redisOptions && client) {
      throw new MurLockException(
        "MurLock accepts 'redisOptions' or 'client', not both. With 'client' supplied, 'redisOptions' would be ignored."
      );
    }
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
      throw new MurLockException(
        `Invalid MurLock option 'maxAttempts': ${maxAttempts} (must be an integer >= 1).`
      );
    }
    if (!Number.isFinite(wait) || wait < 0) {
      throw new MurLockException(
        `Invalid MurLock option 'wait': ${wait} (must be a number >= 0).`
      );
    }
    if (
      extendInterval !== undefined &&
      (!Number.isFinite(extendInterval) || extendInterval <= 0)
    ) {
      throw new MurLockException(
        `Invalid MurLock option 'extendInterval': ${extendInterval} (must be a number > 0).`
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Apply equal jitter (`delay/2 + random*delay/2`) when enabled, to avoid a
   * thundering herd of workers retrying in lockstep.
   */
  private withJitter(delay: number): number {
    if (!this.options.jitter) {
      return delay;
    }
    return Math.floor(delay / 2 + Math.random() * (delay / 2));
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
   * Preload the Lua scripts into Redis' script cache so subsequent calls can
   * use EVALSHA (sending only the 40-char SHA) instead of shipping the full
   * script body each time. Best-effort: on failure we fall back to EVAL.
   */
  private async loadScripts(): Promise<void> {
    try {
      this.scriptShas.lock = (await this.sendCommand([
        'SCRIPT',
        'LOAD',
        this.lockScript,
      ])) as string;
      this.scriptShas.unlock = (await this.sendCommand([
        'SCRIPT',
        'LOAD',
        this.unlockScript,
      ])) as string;
      this.scriptShas.extend = (await this.sendCommand([
        'SCRIPT',
        'LOAD',
        this.extendScript,
      ])) as string;
    } catch (error) {
      this.log(
        'warn',
        `MurLock could not preload Lua scripts (will fall back to EVAL): ${error.message}`
      );
    }
  }

  /**
   * Run a Lua script via EVALSHA when its SHA is cached, falling back to EVAL.
   * Recovers transparently from a NOSCRIPT error (script evicted from Redis'
   * cache) by reloading the SHA and retrying once.
   */
  private async evalScript(
    name: ScriptName,
    script: string,
    keys: string[],
    args: string[]
  ): Promise<unknown> {
    const numkeys = keys.length.toString();
    const sha = this.scriptShas[name];
    if (sha) {
      try {
        return await this.sendCommand([
          'EVALSHA',
          sha,
          numkeys,
          ...keys,
          ...args,
        ]);
      } catch (error) {
        if (!/NOSCRIPT/i.test(String(error?.message))) {
          throw error;
        }
        // Script was evicted from Redis' cache: reload and retry once.
        try {
          const fresh = (await this.sendCommand([
            'SCRIPT',
            'LOAD',
            script,
          ])) as string;
          this.scriptShas[name] = fresh;
          return await this.sendCommand([
            'EVALSHA',
            fresh,
            numkeys,
            ...keys,
            ...args,
          ]);
        } catch {
          // Fall through to inline EVAL below.
        }
      }
    }
    return await this.sendCommand([
      'EVAL',
      script,
      numkeys,
      ...keys,
      ...args,
    ]);
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
        );
      }
      try {
        const isLockSuccessful = await this.evalScript(
          'lock',
          this.lockScript,
          [lockKey],
          [clientId, releaseTime.toString()]
        );
        if (isLockSuccessful === 1) {
          this.log('log', `Successfully obtained lock for key ${lockKey}`);
          return true;
        } else {
          const baseDelay = wait
            ? typeof wait === 'function'
              ? wait(this.options.maxAttempts - attemptsRemaining + 1)
              : wait
            : this.options.wait *
              (this.options.maxAttempts - attemptsRemaining + 1);
          const delay = this.withJitter(baseDelay);
          this.log(
            'warn',
            `Failed to obtain lock for key ${lockKey}, retrying in ${delay} ms...`
          );
          await this.sleep(delay); // Back-off Strategy
          return attemptLock(attemptsRemaining - 1);
        }
      } catch (error) {
        if (error instanceof MurLockException) {
          throw error;
        }
        throw new MurLockRedisException(
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
    const result = await this.evalScript(
      'unlock',
      this.unlockScript,
      [lockKey],
      [clientId]
    );
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
    const result = await this.evalScript(
      'extend',
      this.extendScript,
      [lockKey],
      [clientId, releaseTime.toString()]
    );
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
      if (error instanceof MurLockException) {
        throw error;
      }
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
      if (error instanceof MurLockException) {
        throw error;
      }
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

    if (!Number.isFinite(releaseTime) || releaseTime <= 0) {
      throw new MurLockException(
        `Invalid releaseTime for key ${lockKey}: ${releaseTime} (must be > 0).`
      );
    }

    if (!this.options.reentrant) {
      // Legacy (non-reentrant) path: a fresh owner token per call, no context.
      const clientId = generateUuid();
      await this.acquireLock(lockKey, clientId, releaseTime, wait);
      const stopWatchdog = this.startWatchdog(lockKey, clientId, releaseTime);
      try {
        return await operation();
      } finally {
        stopWatchdog();
        await this.releaseLock(lockKey, clientId);
      }
    }

    // Reentrant path: reuse the current context if one is active, otherwise
    // establish a new one for this (outermost) call.
    const existing = this.asyncStorageService.getContext();
    if (existing) {
      return this.runReentrant(existing, lockKey, releaseTime, wait, operation);
    }
    const context: MurLockContext = {
      clientId: generateUuid(),
      holds: new Map(),
    };
    return this.asyncStorageService.run(context, () =>
      this.runReentrant(context, lockKey, releaseTime, wait, operation)
    );
  }

  /**
   * Reentrancy-aware execution: if this context already holds `lockKey`, just
   * increment its depth and run (no Redis round-trip). Otherwise acquire the
   * lock, run, and release when the outermost holder completes.
   */
  private async runReentrant<R>(
    context: MurLockContext,
    lockKey: string,
    releaseTime: number,
    wait: number | ((retries: number) => number) | undefined,
    operation: () => Promise<R>
  ): Promise<R> {
    const depth = context.holds.get(lockKey) ?? 0;

    if (depth > 0) {
      // Already held by this context: reentrant entry, skip Redis entirely.
      context.holds.set(lockKey, depth + 1);
      try {
        return await operation();
      } finally {
        const current = context.holds.get(lockKey) ?? 1;
        if (current <= 1) {
          context.holds.delete(lockKey);
        } else {
          context.holds.set(lockKey, current - 1);
        }
      }
    }

    // Outermost acquisition for this key.
    await this.acquireLock(lockKey, context.clientId, releaseTime, wait);
    context.holds.set(lockKey, 1);
    const stopWatchdog = this.startWatchdog(
      lockKey,
      context.clientId,
      releaseTime
    );
    try {
      return await operation();
    } finally {
      const current = context.holds.get(lockKey) ?? 1;
      if (current <= 1) {
        context.holds.delete(lockKey);
        stopWatchdog();
        await this.releaseLock(lockKey, context.clientId);
      } else {
        context.holds.set(lockKey, current - 1);
      }
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
    clientId: string
  ): Promise<boolean> {
    while (true) {
      try {
        const isLockSuccessful = await this.evalScript(
          'lock',
          this.lockScript,
          [lockKey],
          [clientId, releaseTime.toString()]
        );
        if (isLockSuccessful === 1) {
          this.log(
            'log',
            `Successfully obtained lock for key ${lockKey} in blocking mode`
          );
          return true;
        } else {
          const delay = this.withJitter(this.options.wait);
          this.log(
            'warn',
            `Lock busy for key ${lockKey}, waiting ${delay} ms before next attempt (blocking mode)...`
          );
          await this.sleep(delay);
        }
      } catch (error) {
        this.log(
          'error',
          `Unexpected error in blocking lock for key ${lockKey}: ${error.message}`
        );
        await this.sleep(this.withJitter(this.options.wait));
      }
    }
  }
}
