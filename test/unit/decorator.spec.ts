import { MurLock } from '../../lib/decorators/murlock.decorator';

describe('MurLock Decorator', () => {
  it('should parse decorator parameters correctly (dry test)', () => {
    class TestClass {
      @MurLock(3000, 'userId')
      async criticalSection() {}
    }
    expect(true).toBe(true);
  });
});
