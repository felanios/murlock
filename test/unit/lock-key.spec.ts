import 'reflect-metadata';
import { MurLock, SetParamNames } from '../../lib/decorators/murlock.decorator';
import { MurLockException } from '../../lib/exceptions';

/**
 * Unit tests for the lock-key construction logic of the @MurLock decorator.
 *
 * These tests assert the ACTUAL lock key value that the decorator passes to
 * MurLockService.runWithLock — the most complex and previously untested code
 * path. They run entirely without Redis by injecting a fake service onto the
 * decorated instance and capturing the key argument.
 */

type FakeService = {
  options: { lockKeyPrefix: 'default' | 'custom' };
  runWithLock: jest.Mock;
};

function makeFakeService(
  lockKeyPrefix: 'default' | 'custom' = 'default'
): FakeService {
  return {
    options: { lockKeyPrefix },
    // Mirror the real 4-arg signature used by the decorator: (key, releaseTime, wait, fn)
    runWithLock: jest.fn((_key: string, _rt: number, _wait: any, fn: () => any) =>
      fn()
    ),
  };
}

/**
 * Attach the fake service to a decorated instance (the decorator reads it from
 * `this.murlockServiceDecorator`) and return the lock key produced for a call.
 */
async function captureLockKey(
  instance: any,
  method: string,
  args: any[],
  service: FakeService
): Promise<string> {
  instance.murlockServiceDecorator = service;
  await instance[method](...args);
  expect(service.runWithLock).toHaveBeenCalledTimes(1);
  return service.runWithLock.mock.calls[0][0] as string;
}

// Simulates a decorator (e.g. @Transactional) that wraps the method so its
// parameter names become unextractable (function becomes `(...args)`).
function WrappingDecorator() {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      return original.apply(this, args);
    };
    return descriptor;
  };
}

describe('MurLock lock-key construction', () => {
  describe('default prefix', () => {
    class DefaultService {
      @MurLock(3000, 'userId')
      async single(userId: string) {
        return userId;
      }

      @MurLock(3000, 'userId', 'orderId')
      async multi(userId: string, orderId: string) {
        return `${userId}:${orderId}`;
      }

      @MurLock(3000, '0')
      async byIndex(userId: string) {
        return userId;
      }

      @MurLock(3000, 'user.id')
      async nested(user: { id: string }) {
        return user.id;
      }

      @MurLock(3000, '0.id')
      async indexedNested(user: { id: string }) {
        return user.id;
      }
    }

    let instance: DefaultService;
    let service: FakeService;

    beforeEach(() => {
      instance = new DefaultService();
      service = makeFakeService('default');
    });

    it('builds Class:method:value for a single primitive param', async () => {
      const key = await captureLockKey(instance, 'single', ['abc'], service);
      expect(key).toBe('DefaultService:single:abc');
    });

    it('builds Class:method:v1:v2 for multiple params', async () => {
      const key = await captureLockKey(instance, 'multi', ['u1', 'o1'], service);
      expect(key).toBe('DefaultService:multi:u1:o1');
    });

    it('resolves a numeric index source', async () => {
      const key = await captureLockKey(instance, 'byIndex', ['abc'], service);
      expect(key).toBe('DefaultService:byIndex:abc');
    });

    it('resolves a nested property path (name.path)', async () => {
      const key = await captureLockKey(
        instance,
        'nested',
        [{ id: 'x42' }],
        service
      );
      expect(key).toBe('DefaultService:nested:x42');
    });

    it('resolves a nested property path with numeric index (index.path)', async () => {
      const key = await captureLockKey(
        instance,
        'indexedNested',
        [{ id: 'x42' }],
        service
      );
      expect(key).toBe('DefaultService:indexedNested:x42');
    });
  });

  describe('object-format @SetParamNames with a wrapping decorator', () => {
    class WrappedService {
      // @ts-ignore - decorator type checking quirks in the test environment
      @MurLock(3000, 'ctx.tenant')
      // @ts-ignore
      @SetParamNames({ ctx: 2 })
      // @ts-ignore
      @WrappingDecorator()
      async process(
        _userData: { id: string },
        _options: string[],
        ctx: { tenant: string }
      ) {
        return ctx.tenant;
      }
    }

    it('resolves the param value (not just metadata) via the index map', async () => {
      const instance = new WrappedService();
      const service = makeFakeService('default');
      const key = await captureLockKey(
        instance,
        'process',
        [{ id: 'u1' }, ['a'], { tenant: 'acme' }],
        service
      );
      expect(key).toBe('WrappedService:process:acme');
    });
  });

  describe('array-format @SetParamNames with a wrapping decorator (Issue #67)', () => {
    class WrappedArrayService {
      // @ts-ignore
      @MurLock(3000, 'userData.id')
      // @ts-ignore
      @SetParamNames('userData', 'options')
      // @ts-ignore
      @WrappingDecorator()
      async process(userData: { id: string }, _options: string[] = []) {
        return userData.id;
      }
    }

    it('resolves the nested param value through array metadata', async () => {
      const instance = new WrappedArrayService();
      const service = makeFakeService('default');
      const key = await captureLockKey(
        instance,
        'process',
        [{ id: 'abc' }, []],
        service
      );
      expect(key).toBe('WrappedArrayService:process:abc');
    });
  });

  describe('custom prefix', () => {
    class CustomService {
      // A literal key that is NOT a method parameter name.
      @MurLock(3000, 'globalSingleton')
      async run(_userId: string) {
        return 'ok';
      }

      // A real parameter name still resolves to its value under custom prefix.
      @MurLock(3000, 'userId')
      async runWithParam(userId: string) {
        return userId;
      }
    }

    let instance: CustomService;
    let service: FakeService;

    beforeEach(() => {
      instance = new CustomService();
      service = makeFakeService('custom');
    });

    it('uses the literal source (no Class:method prefix) when it is not a param', async () => {
      const key = await captureLockKey(instance, 'run', ['abc'], service);
      expect(key).toBe('globalSingleton');
    });

    it('still resolves param values under custom prefix without the prefix', async () => {
      const key = await captureLockKey(
        instance,
        'runWithParam',
        ['abc'],
        service
      );
      expect(key).toBe('abc');
    });
  });

  describe('error paths', () => {
    class ErrService {
      @MurLock(3000, 'userId')
      async needsParam(userId?: string) {
        return userId;
      }

      @MurLock(3000, 'missingParam')
      async unknownParam(userId: string) {
        return userId;
      }
    }

    it('throws MurLockException when the param is undefined/null', async () => {
      const instance = new ErrService();
      (instance as any).murlockServiceDecorator = makeFakeService('default');
      await expect(instance.needsParam(undefined)).rejects.toBeInstanceOf(
        MurLockException
      );
    });

    it('throws MurLockException when the param name is not found (default prefix)', async () => {
      const instance = new ErrService();
      (instance as any).murlockServiceDecorator = makeFakeService('default');
      await expect(instance.unknownParam('abc')).rejects.toBeInstanceOf(
        MurLockException
      );
    });
  });

  describe('wrong @SetParamNames order (above @MurLock) fails to resolve', () => {
    // Bottom-up execution: Wrapping wraps -> MurLock runs (no metadata yet) ->
    // SetParamNames sets metadata too late. MurLock cannot resolve 'userData'.
    class WrongOrderService {
      // @ts-ignore
      @SetParamNames('userData', 'options')
      // @ts-ignore
      @MurLock(3000, 'userData.id')
      // @ts-ignore
      @WrappingDecorator()
      async process(userData: { id: string }, _options: string[] = []) {
        return userData.id;
      }
    }

    it('throws MurLockException at call time (param not found)', async () => {
      const instance = new WrongOrderService();
      (instance as any).murlockServiceDecorator = makeFakeService('default');
      await expect(
        instance.process({ id: 'abc' }, [])
      ).rejects.toBeInstanceOf(MurLockException);
    });
  });
});
