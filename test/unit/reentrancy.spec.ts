import { AsyncLocalStorage } from 'async_hooks';
import { MurLockService } from '../../lib/murlock.service';
import { AsyncStorageService } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { MurLockModuleOptions } from '../../lib/interfaces';
import { MurLockException } from '../../lib/exceptions';

/**
 * Redis-free unit tests for reentrant locking. A fake redis client lets us
 * assert exactly how many times Redis is touched for nested same-key calls.
 */

function build(opts: Partial<MurLockModuleOptions>): {
  service: MurLockService;
  sendCommand: jest.Mock;
} {
  const options: MurLockModuleOptions = {
    redisOptions: {},
    wait: 5,
    maxAttempts: 1,
    logLevel: 'none',
    ...opts,
  };
  const als = new AsyncStorageService(
    new AsyncStorageManager(new AsyncLocalStorage())
  );
  const service = new MurLockService(options, als);

  // Default fake: every command succeeds (lock acquired, unlock ok).
  const sendCommand = jest.fn().mockResolvedValue(1);

  (service as any).lockScript = 'LOCK';
  (service as any).unlockScript = 'UNLOCK';
  (service as any).extendScript = 'EXTEND';
  (service as any).redisClient = { sendCommand };

  return { service, sendCommand };
}

const countEval = (sc: jest.Mock, body: string) =>
  sc.mock.calls.filter((c) => c[0][0] === 'EVAL' && c[0][1] === body).length;

describe('MurLock reentrancy', () => {
  it('reuses the lock for nested same-key calls (one acquire, one release)', async () => {
    const { service, sendCommand } = build({ reentrant: true });
    let innerRan = false;
    let outerRan = false;

    await service.runWithLock('key:A', 3000, async () => {
      outerRan = true;
      await service.runWithLock('key:A', 3000, async () => {
        innerRan = true;
      });
    });

    expect(outerRan).toBe(true);
    expect(innerRan).toBe(true);
    // Nested same-key call must NOT touch Redis again.
    expect(countEval(sendCommand, 'LOCK')).toBe(1);
    expect(countEval(sendCommand, 'UNLOCK')).toBe(1);
  });

  it('acquires independent locks for nested different keys', async () => {
    const { service, sendCommand } = build({ reentrant: true });

    await service.runWithLock('key:A', 3000, async () => {
      await service.runWithLock('key:B', 3000, async () => {
        // both held simultaneously within the same context
      });
    });

    expect(countEval(sendCommand, 'LOCK')).toBe(2);
    expect(countEval(sendCommand, 'UNLOCK')).toBe(2);
  });

  it('without reentrant, a nested same-key call re-hits Redis and fails', async () => {
    const { service, sendCommand } = build({
      reentrant: false,
      ignoreUnlockFail: true,
    });
    // lock succeeds once, then fails (simulating the key already held).
    let lockCalls = 0;
    sendCommand.mockImplementation((args: any[]) => {
      if (args[1] === 'LOCK') {
        lockCalls += 1;
        return Promise.resolve(lockCalls === 1 ? 1 : 0);
      }
      return Promise.resolve(1);
    });

    await expect(
      service.runWithLock('key:A', 3000, async () => {
        // Inner call gets a new clientId and tries Redis again; the second LOCK
        // returns 0, so it exhausts maxAttempts and throws (self-deadlock).
        await service.runWithLock('key:A', 3000, async () => {});
      })
    ).rejects.toBeInstanceOf(MurLockException);

    expect(countEval(sendCommand, 'LOCK')).toBe(2);
  });
});
