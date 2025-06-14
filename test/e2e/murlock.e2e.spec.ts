import { Test } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { MurLockModule } from '../../lib/murlock.module';
import { MurLockService } from '../../lib/murlock.service';
import { MurLock } from '../../lib/decorators/murlock.decorator';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { AsyncLocalStorage } from 'async_hooks';
import { createClient } from 'redis';

describe('MurLock E2E Tests', () => {
  let murLockService: MurLockService;
  let redisClient: ReturnType<typeof createClient>;

  @Injectable()
  class TestService {
    private counter = 0;

    resetCounter() {
      this.counter = 0;
    }

    @MurLock(5000, 'userId')
    async incrementCounter(userId: string): Promise<number> {
      const currentValue = this.counter;
      await new Promise(resolve => setTimeout(resolve, 50));
      this.counter = currentValue + 1;
      return this.counter;
    }

    @MurLock(5000, 'userId', 'orderId')
    async processOrder(userId: string, orderId: string): Promise<string> {
      await new Promise(resolve => setTimeout(resolve, 50));
      return `Order ${orderId} processed for user ${userId}`;
    }
  }

  let testService: TestService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MurLockModule.forRoot({
          redisOptions: { url: 'redis://localhost:6379' },
          wait: 200,
          maxAttempts: 5,
          logLevel: 'error',
          blocking: true,
          failFastOnRedisError: false,
          ignoreUnlockFail: false,
        }),
      ],
      providers: [TestService],
    })
      .overrideProvider(AsyncStorageManager)
      .useValue(new AsyncStorageManager<string>(new AsyncLocalStorage<Map<string, string>>()))
      .compile();

    murLockService = moduleRef.get(MurLockService);
    testService = moduleRef.get(TestService);
    await murLockService.onModuleInit();

    redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();
  });

  afterAll(async () => {
    await murLockService.onApplicationShutdown();
    await redisClient.quit();
  });

  beforeEach(async () => {
    // Reset counter before each test
    testService.resetCounter();
    
    // Clean up Redis keys
    const keys = await redisClient.keys('*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  });

  it('should handle concurrent increments with lock', async () => {
    const userId = 'user123';
    const promises = Array(5).fill(null).map(() => 
      testService.incrementCounter(userId)
    );

    const results = await Promise.all(promises);
    
    const uniqueValues = new Set(results);
    expect(uniqueValues.size).toBe(5);
    expect(Math.max(...results)).toBe(5);
  });

  it('should process multiple orders concurrently with lock', async () => {
    const userId = 'user123';
    const orderIds = ['order1', 'order2', 'order3'];
    
    const promises = orderIds.map(orderId => 
      testService.processOrder(userId, orderId)
    );

    const results = await Promise.all(promises);
    
    expect(results).toHaveLength(3);
    results.forEach((result, index) => {
      expect(result).toContain(orderIds[index]);
      expect(result).toContain(userId);
    });
  });

  it('should handle lock timeout and retry', async () => {
    const userId = 'user456';
    const longRunningPromise = testService.incrementCounter(userId);
    
    const secondPromise = testService.incrementCounter(userId);
    
    const [firstResult, secondResult] = await Promise.all([
      longRunningPromise,
      secondPromise
    ]);

    expect(firstResult).toBeDefined();
    expect(secondResult).toBeDefined();
    expect(secondResult).toBeGreaterThan(firstResult);
  });

  it('should maintain lock integrity under high concurrency', async () => {
    const userId = 'user789';
    const concurrentOperations = 10;
    
    const promises = Array(concurrentOperations).fill(null).map(() => 
      testService.incrementCounter(userId)
    );

    const results = await Promise.all(promises);
    
    const uniqueValues = new Set(results);
    expect(uniqueValues.size).toBe(concurrentOperations);
    
    const sortedResults = [...results].sort((a, b) => a - b);
    expect(sortedResults).toEqual([...Array(concurrentOperations)].map((_, i) => i + 1));
  });
}); 