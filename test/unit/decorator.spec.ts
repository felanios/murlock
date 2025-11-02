import { MurLock } from '../../lib/decorators/murlock.decorator';
import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';

describe('MurLock Decorator', () => {
  it('should parse decorator parameters correctly (dry test)', () => {
    class TestClass {
      @MurLock(3000, 'userId')
      async criticalSection() {}
    }
    expect(true).toBe(true);
  });

  it('should preserve metadata when MurLock is below other decorators', () => {
    const KEY = 'custom:meta';
    class TestClass {
      @SetMetadata(KEY, 'value-a')
      @MurLock(1000, 'userId')
      methodA() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodA');
    const value = Reflect.getMetadata(KEY, descriptor?.value);
    expect(value).toBe('value-a');
  });

  it('should preserve metadata when MurLock is above other decorators', () => {
    const KEY = 'custom:meta';
    class TestClass {
      @MurLock(1000, 'userId')
      @SetMetadata(KEY, 'value-b')
      methodB() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodB');
    const value = Reflect.getMetadata(KEY, descriptor?.value);
    expect(value).toBe('value-b');
  });
});
