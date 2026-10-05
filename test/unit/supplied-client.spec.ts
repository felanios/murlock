import { AsyncLocalStorage } from 'async_hooks';
import { MurLockService } from '../../lib/murlock.service';
import { AsyncStorageService } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { MurLockModuleOptions } from '../../lib/interfaces';

/**
 * Redis-free tests for `options.client` — handing MurLock a ready client.
 *
 * Why the option exists: `redisOptions` ends up describing a single endpoint,
 * so a topology that resolves its endpoint at runtime (Sentinel above all)
 * cannot be expressed through it. Supplying a client moves that decision to the
 * application, which already knows its own topology.
 */

function buildOptions(overrides: Partial<MurLockModuleOptions>): MurLockModuleOptions {
  return {
    wait: 10,
    maxAttempts: 1,
    logLevel: 'none',
    ...overrides,
  } as MurLockModuleOptions;
}

function buildService(options: MurLockModuleOptions): MurLockService {
  const als = new AsyncStorageService(
    new AsyncStorageManager<string>(new AsyncLocalStorage())
  );
  const service = new MurLockService(options, als);
  (service as any).lockScript = 'LOCK';
  (service as any).unlockScript = 'UNLOCK';
  (service as any).extendScript = 'EXTEND';
  return service;
}

/** node-redis shape: raw commands go through `sendCommand`. */
function nodeRedisLike() {
  return {
    sendCommand: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    isOpen: true,
  };
}

/**
 * ioredis shape.
 *
 * It has BOTH `call` and `sendCommand` — and that is the whole trap. ioredis'
 * `sendCommand` takes an internal Command object, not an argument array, so
 * picking it would fail on the first command. An earlier version of this stub
 * only had `call`, which let exactly that bug through.
 */
function ioredisLike() {
  return {
    call: jest.fn().mockResolvedValue(1),
    sendCommand: jest.fn(() => {
      throw new Error('ioredis sendCommand expects a Command object, not an array');
    }),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    status: 'ready',
  };
}

describe('supplied client — command normalisation', () => {
  it('drives a node-redis style client through sendCommand', async () => {
    const client = nodeRedisLike();
    const service = buildService(buildOptions({ client }));
    (service as any).redisClient = client;

    await service.runWithLock('k', 1000, async () => undefined);

    expect(client.sendCommand).toHaveBeenCalled();
    // Arguments arrive as a single array.
    expect(Array.isArray(client.sendCommand.mock.calls[0][0])).toBe(true);
  });

  it('drives an ioredis style client through call', async () => {
    // The whole point: ioredis names it `call` and takes spread arguments.
    // Without normalisation MurLock would throw "sendCommand is not a function"
    // and the client would look broken rather than merely different.
    const client = ioredisLike();
    const service = buildService(buildOptions({ client }));
    (service as any).redisClient = client;

    await service.runWithLock('k', 1000, async () => undefined);

    expect(client.call).toHaveBeenCalled();
    // Spread, not a single array.
    expect(Array.isArray(client.call.mock.calls[0][0])).toBe(false);
    expect(typeof client.call.mock.calls[0][0]).toBe('string');
    // And emphatically not through ioredis' own sendCommand.
    expect(client.sendCommand).not.toHaveBeenCalled();
  });

  it('reports a client that can do neither', async () => {
    const service = buildService(buildOptions({ client: { on: jest.fn() } as any }));
    (service as any).redisClient = { on: jest.fn() };

    await expect(service.runWithLock('k', 1000, async () => undefined)).rejects.toThrow(
      /neither `sendCommand` nor `call`/
    );
  });
});

describe('supplied client — ownership', () => {
  it('leaves a supplied client open on shutdown', async () => {
    // MurLock borrows it. Closing a client the application still uses would
    // take the rest of that application down with the lock service.
    const client = nodeRedisLike();
    const service = buildService(buildOptions({ client }));
    (service as any).redisClient = client;
    (service as any).ownsClient = false;

    await service.onApplicationShutdown('SIGTERM');

    expect(client.quit).not.toHaveBeenCalled();
  });

  it('closes a client it built itself', async () => {
    const client = nodeRedisLike();
    const service = buildService(buildOptions({ redisOptions: {} }));
    (service as any).redisClient = client;
    (service as any).ownsClient = true;

    await service.onApplicationShutdown('SIGTERM');

    expect(client.quit).toHaveBeenCalled();
  });

  it('does not connect a supplied client during init', async () => {
    // It may already be connected, and connecting twice is an error in both
    // libraries. This goes through the real onModuleInit so the assertion is
    // about MurLock's behaviour rather than about the test's own setup.
    const client = nodeRedisLike();
    const service = buildService(buildOptions({ client }));

    await service.onModuleInit();

    expect(client.connect).not.toHaveBeenCalled();
    // It is still used: the scripts get preloaded through it.
    expect(client.sendCommand).toHaveBeenCalledWith(
      expect.arrayContaining(['SCRIPT', 'LOAD'])
    );
  });

  // NOTE: there is deliberately no "connects a client it built itself" test
  // here. Pointing onModuleInit at a dead port hangs rather than failing: the
  // reconnectStrategy returns a delay forever and never gives up, so connect()
  // never settles. Worth knowing about MurLock's own behaviour; not something
  // to encode as a test that would hang the suite.
});

describe('supplied client — configuration', () => {
  it('rejects having neither redisOptions nor client', () => {
    const service = buildService(buildOptions({}));

    expect(() => (service as any).validateOptions()).toThrow(
      /either 'redisOptions' or 'client'/
    );
  });

  it('rejects having both', () => {
    // Silently preferring one would make the ignored setting look effective.
    const service = buildService(
      buildOptions({ redisOptions: {}, client: nodeRedisLike() })
    );

    expect(() => (service as any).validateOptions()).toThrow(/not both/);
  });

  it('accepts a factory that returns the client', async () => {
    const client = nodeRedisLike();
    const service = buildService(buildOptions({ client: () => client }));
    (service as any).redisClient = client;

    await service.runWithLock('k', 1000, async () => undefined);

    expect(client.sendCommand).toHaveBeenCalled();
  });
});
