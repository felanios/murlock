import { EventEmitter } from 'events';
import { AsyncLocalStorage } from 'async_hooks';
import { MurLockService } from '../../lib/murlock.service';
import { AsyncStorageService, MurLockContext } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { MurLockModuleOptions } from '../../lib/interfaces';

/**
 * Redis-free unit tests for the watchdog (auto-extend) and the safe Redis
 * error-handling behavior. We bypass onModuleInit (no real connection) and
 * inject fake scripts + a fake redis client directly.
 */

function buildService(options: Partial<MurLockModuleOptions>): {
  service: MurLockService;
  sendCommand: jest.Mock;
} {
  const fullOptions: MurLockModuleOptions = {
    redisOptions: {},
    wait: 10,
    maxAttempts: 1,
    logLevel: 'none',
    ...options,
  };
  const als = new AsyncStorageService(
    new AsyncStorageManager<MurLockContext>(new AsyncLocalStorage())
  );
  const service = new MurLockService(fullOptions, als);

  const sendCommand = jest.fn().mockResolvedValue(1);
  (service as any).lockScript = 'LOCK';
  (service as any).unlockScript = 'UNLOCK';
  (service as any).extendScript = 'EXTEND';
  (service as any).redisClient = { sendCommand };

  return { service, sendCommand };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MurLock watchdog (autoExtend)', () => {
  it('extends the lock TTL periodically while the operation runs', async () => {
    const { service, sendCommand } = buildService({
      autoExtend: true,
      extendInterval: 20,
    });

    await service.runWithLock('wd:key', 3000, async () => {
      await sleep(100); // ~5 watchdog ticks at 20ms
    });

    const extendCalls = sendCommand.mock.calls.filter(
      (c) => c[0]?.[1] === 'EXTEND'
    );
    expect(extendCalls.length).toBeGreaterThanOrEqual(2);
    // Extend uses the same key and the owning clientId + releaseTime.
    expect(extendCalls[0][0]).toEqual([
      'EVAL',
      'EXTEND',
      '1',
      'wd:key',
      expect.any(String),
      '3000',
    ]);
  });

  it('does NOT extend when autoExtend is disabled (default behavior)', async () => {
    const { service, sendCommand } = buildService({ autoExtend: false });

    await service.runWithLock('wd:key', 3000, async () => {
      await sleep(80);
    });

    const extendCalls = sendCommand.mock.calls.filter(
      (c) => c[0]?.[1] === 'EXTEND'
    );
    expect(extendCalls.length).toBe(0);
  });

  it('stops extending once ownership is lost (extend returns 0)', async () => {
    const { service, sendCommand } = buildService({
      autoExtend: true,
      extendInterval: 20,
    });
    // lock -> 1, then every EXTEND -> 0 (ownership lost), unlock -> 1
    sendCommand.mockImplementation((args: any[]) => {
      if (args[1] === 'EXTEND') return Promise.resolve(0);
      return Promise.resolve(1);
    });

    await service.runWithLock('wd:key', 3000, async () => {
      await sleep(100);
    });

    const extendCalls = sendCommand.mock.calls.filter(
      (c) => c[0]?.[1] === 'EXTEND'
    );
    // Watchdog should clear itself after the first failed extension.
    expect(extendCalls.length).toBe(1);
  });
});

describe('MurLock safe Redis error handling', () => {
  it('does not call process.exit on a runtime error event, even with failFastOnRedisError', () => {
    const onRedisError = jest.fn();
    const { service } = buildService({
      failFastOnRedisError: true,
      onRedisError,
    });

    const fakeClient = new EventEmitter();
    (service as any).redisClient = fakeClient;
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    (service as any).registerRedisErrorHandlers();
    fakeClient.emit('error', new Error('boom'));

    expect(exitSpy).not.toHaveBeenCalled();
    expect(onRedisError).toHaveBeenCalledWith(expect.any(Error));

    exitSpy.mockRestore();
  });

  it('survives an onRedisError callback that throws', () => {
    const { service } = buildService({
      onRedisError: () => {
        throw new Error('callback failed');
      },
    });
    const fakeClient = new EventEmitter();
    (service as any).redisClient = fakeClient;

    (service as any).registerRedisErrorHandlers();
    expect(() => fakeClient.emit('error', new Error('boom'))).not.toThrow();
  });
});
