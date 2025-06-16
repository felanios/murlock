import { MurLockService } from '../../lib/murlock.service';
import { AsyncStorageService } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { MurLockModuleOptions } from '../../lib/interfaces';
import { createClient, RedisClientType } from 'redis';
import { AsyncLocalStorage } from 'async_hooks';
import { MurLockException } from '../../lib/exceptions';

describe('MurLockService (integration)', () => {
  let service: MurLockService;
  let service2: MurLockService;
  let redisClient: RedisClientType;

  beforeAll(async () => {
    redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();

    const options: MurLockModuleOptions = {
      redisOptions: { url: 'redis://localhost:6379' },
      wait: 50,
      maxAttempts: 1,
      logLevel: 'error',
      ignoreUnlockFail: true,
    };

    const asyncStorageManager1 = new AsyncStorageManager<string>(new AsyncLocalStorage());
    const asyncStorageService1 = new AsyncStorageService(asyncStorageManager1);
    service = new MurLockService(options, asyncStorageService1);
    await service['onModuleInit']();

    const asyncStorageManager2 = new AsyncStorageManager<string>(new AsyncLocalStorage());
    const asyncStorageService2 = new AsyncStorageService(asyncStorageManager2);
    service2 = new MurLockService(options, asyncStorageService2);
    await service2['onModuleInit']();
  });

  afterAll(async () => {
    await service['onApplicationShutdown']();
    await service2['onApplicationShutdown']();
    await redisClient.quit();
  });

  beforeEach(async () => {
    const keys = await redisClient.keys('test:lock:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  });

  it('should acquire and release lock successfully', async () => {
    const key = 'test:lock:1';
    await service.runWithLock(key, 3000, async () => {
      expect(true).toBe(true);
    });
  });

  it('should throw on conflicting lock', async () => {
    const key = 'test:lock:conflict';
    let releaseFirstLock: () => void = () => {};
    let secondLockError: any = null;
    let firstLockStarted = false;

    const firstLockPromise = service.runWithLock(key, 10000, async () => {
      firstLockStarted = true;
      await new Promise<void>((resolve) => {
        releaseFirstLock = resolve;
      });
    });

    while (!firstLockStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    try {
      await service2.runWithLock(key, 1000, async () => {
        // Bu satıra hiç gelmemeli
      });
    } catch (err) {
      secondLockError = err;
    }

    releaseFirstLock();
    await firstLockPromise;

    expect(secondLockError).toBeInstanceOf(MurLockException);
    expect(secondLockError.message).toMatch(/Failed to obtain lock|Could not obtain lock/);
  });
});
