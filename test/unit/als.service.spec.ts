import { AsyncStorageService } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';

describe('AsyncStorageService', () => {
  let als: AsyncStorageService;

  beforeEach(() => {
    als = new AsyncStorageService(new AsyncStorageManager(new (require('async_hooks').AsyncLocalStorage)()));
  });

  it('should store and retrieve values', () => {
    als.runWithNewContext(() => {
      als.setClientID('clientId', 'abc123');
      expect(als.get('clientId')).toBe('abc123');
    });
  });
});
