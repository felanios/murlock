import { AsyncLocalStorage } from 'async_hooks';
import { AsyncStorageService, MurLockContext } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';

describe('AsyncStorageService', () => {
  let als: AsyncStorageService;

  beforeEach(() => {
    als = new AsyncStorageService(
      new AsyncStorageManager<MurLockContext>(new AsyncLocalStorage())
    );
  });

  it('exposes the active context inside run() and nothing outside', () => {
    const ctx: MurLockContext = { clientId: 'abc123', holds: new Map() };

    expect(als.getContext()).toBeUndefined();

    als.run(ctx, () => {
      expect(als.getContext()).toBe(ctx);
      expect(als.getContext()?.clientId).toBe('abc123');
    });

    expect(als.getContext()).toBeUndefined();
  });

  it('propagates the context across awaits within run()', async () => {
    const ctx: MurLockContext = { clientId: 'cid', holds: new Map() };

    await als.run(ctx, async () => {
      await Promise.resolve();
      expect(als.getContext()).toBe(ctx);
    });
  });
});
