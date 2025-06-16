import { Test } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { MurLockModule } from '../../lib/murlock.module';
import { MurLockService } from '../../lib/murlock.service';
import { MurLock } from '../../lib/decorators/murlock.decorator';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { AsyncLocalStorage } from 'async_hooks';
import { createClient } from 'redis';

describe('MurLock Full Integration', () => {
  let murLockService: MurLockService;
  let redisClient: ReturnType<typeof createClient>;

  @Injectable()
  class TestClass {
    @MurLock(3000, 'userId')
    async criticalSection(userId: string) {
      return `executed:${userId}`;
    }

    @MurLock(9999,3000, 'userId')
    async overrideWaitSection(userId: string) {
      return 'override-wait-ok';
    }

    @MurLock(3000, 'userId', 'orderId')
    async multiParamSection(userId: string, orderId: string) {
      return `${userId}:${orderId}`;
    }
  }

  let testInstance: TestClass;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MurLockModule.forRoot({
          redisOptions: { url: 'redis://localhost:6379' },
          wait: 100,
          maxAttempts: 3,
          logLevel: 'error',
          blocking: false,
          failFastOnRedisError: false,
          ignoreUnlockFail: false,
        }),
      ],
      providers: [TestClass],
    })
      .overrideProvider(AsyncStorageManager)
      .useValue(new AsyncStorageManager<string>(new AsyncLocalStorage<Map<string, string>>()))
      .compile();

    murLockService = moduleRef.get(MurLockService);
    testInstance = moduleRef.get(TestClass);
    await murLockService.onModuleInit();

    redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();
  });

  afterAll(async () => {
    await murLockService.onApplicationShutdown();
    await redisClient.quit();
  });

  beforeEach(async () => {
    await redisClient.del(['integration:lock:service', 'integration:lock:conflict', 'integration:blocking:lock', 'key', 'multi:user1:order2']);
  });

  it('should acquire and release lock via service', async () => {
    const key = 'integration:lock:service';
    await murLockService.runWithLock(key, 3000, async () => {
      expect(true).toBe(true);
    });
  });

  it('should run decorator lock end-to-end', async () => {
    const result = await testInstance.criticalSection('abc123');
    expect(result).toBe('executed:abc123');
  });

  it('should handle concurrent lock conflicts', async () => {
    const key = 'integration:lock:conflict';
    await murLockService.runWithLock(key, 5000, async () => {
      await expect(murLockService.runWithLock(key, 5000, async () => {
        expect(false).toBe(true);
      })).rejects.toThrow();
    });
  });

  it('should generate key from multiple params', async () => {
    const result = await testInstance.multiParamSection('user1', 'order2');
    expect(result).toBe('user1:order2');
  });

  it('should override global wait with decorator wait', async () => {
    const result = await testInstance.overrideWaitSection('abc123');
    expect(result).toBe('override-wait-ok');
  });

  it('should retry until lock is acquired in blocking mode', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MurLockModule.forRoot({
          redisOptions: { url: 'redis://localhost:6379' },
          wait: 100,
          maxAttempts: 1,
          logLevel: 'error',
          blocking: true,
        }),
      ],
      providers: [TestClass],
    })
      .overrideProvider(AsyncStorageManager)
      .useValue(new AsyncStorageManager<string>(new AsyncLocalStorage<Map<string, string>>()))
      .compile();
    const blockingService = moduleRef.get(MurLockService);
    await blockingService.onModuleInit();
    (blockingService as any).redisClient = {
      sendCommand: jest.fn().mockResolvedValue(1),
    };
    const key = 'integration:blocking:lock';
    await blockingService.runWithLock(key, 500, async () => {
      const p = blockingService.runWithLock(key, 500, async () => {
        expect(true).toBe(true);
      });
      await p;
    });
    await blockingService.onApplicationShutdown();
  });

  it('should not throw if ignoreUnlockFail is true', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MurLockModule.forRoot({
          redisOptions: { url: 'redis://localhost:6379' },
          wait: 100,
          maxAttempts: 1,
          logLevel: 'error',
          ignoreUnlockFail: true,
        }),
      ],
      providers: [TestClass],
    })
      .overrideProvider(AsyncStorageManager)
      .useValue(new AsyncStorageManager<string>(new AsyncLocalStorage<Map<string, string>>()))
      .compile();
    const unlockFailService = moduleRef.get(MurLockService);
    await unlockFailService.onModuleInit();
    (unlockFailService as any).redisClient = {
      sendCommand: jest.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0),
    };
    await expect(unlockFailService.runWithLock('key', 100, async () => {})).resolves.not.toThrow();
    await unlockFailService.onApplicationShutdown();
  });
});
