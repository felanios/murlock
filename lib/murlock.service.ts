import { Inject, Injectable, OnApplicationShutdown, OnModuleInit,Logger } from '@nestjs/common';
import { RedisClient } from 'redis';
import { MurLockModuleOptions } from './interfaces';


@Injectable()
export class MurLockService implements OnApplicationShutdown, OnModuleInit {
  private readonly logger = new Logger(MurLockService.name);
  private redisClient: RedisClient;
  constructor(
    @Inject('MURLOCK_OPTIONS') protected readonly options: MurLockModuleOptions,
  ) {}
  onModuleInit() {
    this.redisClient = new RedisClient(this.options.redisOptions);

    this.logger.debug('MurLock Redis Connected.');

    this.redisClient.on('error', (err) => this.logger.log('MurLock Redis Client Error', err));
  }
  onApplicationShutdown(signal?: string) {
    this.logger.log('MurLock Redis Connected.');
    this.redisClient.quit();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async lock(lockKey: string, releaseTime: number): Promise<boolean> {
    const attemptLock = async (attemptsRemaining: number): Promise<boolean> => {
      if (attemptsRemaining === 0) return false;

      try {
        const isLockSuccessful = await this.redisClient.set(lockKey, 'LOCKED', 'EX', releaseTime, 'NX');
        if (isLockSuccessful) {
          this.logger.log(`Successfully obtained lock for key ${lockKey}`);
          return true;
        }
        await this.sleep(this.options.wait);
        return attemptLock(attemptsRemaining - 1);
      }
      catch (error) {
        this.logger.error(`Could not obtain lock for key ${lockKey}`, error);
        return false;
      }
    };

    return attemptLock(this.options.maxAttempts);
  }

  async unlock(lockKey: string): Promise<void> {
    await this.redisClient.del(lockKey);
    this.logger.log(`Lock released for key ${lockKey}`);
  }
}
