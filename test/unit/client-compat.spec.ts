import IORedis from 'ioredis';
import { createClient } from 'redis';
import { MurLockModuleOptions, MurLockRedisClient } from '../../lib/interfaces';

/**
 * Compile-time compatibility with the real client libraries.
 *
 * This file exists because describing a foreign library's signature from memory
 * got `client` wrong twice: first by preferring ioredis' `sendCommand` (which
 * takes an internal Command object, not an argument array), then by insisting
 * on a `Promise` return that ioredis does not declare. Both shipped. Both were
 * caught only when a real application compiled against the published package.
 *
 * The assertions below are type assignments. They carry no runtime weight — if
 * `MurLockRedisClient` drifts away from either library again, this file stops
 * compiling, which is the point.
 */

describe('client compatibility (compile-time)', () => {
  it('accepts a real ioredis instance', () => {
    const ioredis = new IORedis({ lazyConnect: true });

    const asClient: MurLockRedisClient = ioredis;
    const asOption: MurLockModuleOptions['client'] = ioredis;

    expect(asClient).toBeDefined();
    expect(asOption).toBeDefined();
    ioredis.disconnect();
  });

  it('accepts a real node-redis instance', () => {
    const nodeRedis = createClient();

    const asClient: MurLockRedisClient = nodeRedis;
    const asOption: MurLockModuleOptions['client'] = nodeRedis;

    expect(asClient).toBeDefined();
    expect(asOption).toBeDefined();
  });

  it('accepts a factory returning either', () => {
    const fromIoredis: MurLockModuleOptions['client'] = () =>
      new IORedis({ lazyConnect: true });
    const fromNodeRedis: MurLockModuleOptions['client'] = () => createClient();

    expect(fromIoredis).toBeInstanceOf(Function);
    expect(fromNodeRedis).toBeInstanceOf(Function);
  });

  it('keeps ioredis on `call`, which is the distinction that matters', () => {
    // Both libraries have `sendCommand`; only ioredis has `call`. That is how
    // MurLock tells them apart, so it is worth asserting the premise still
    // holds rather than assuming it.
    const ioredis = new IORedis({ lazyConnect: true });
    const nodeRedis = createClient();

    expect(typeof (ioredis as any).call).toBe('function');
    expect(typeof (ioredis as any).sendCommand).toBe('function');
    expect(typeof (nodeRedis as any).call).toBe('undefined');
    expect(typeof (nodeRedis as any).sendCommand).toBe('function');

    ioredis.disconnect();
  });
});
