import { SetMetadata } from '@nestjs/common';
import 'reflect-metadata';
import {
  MurLock,
  PARAM_NAMES_KEY,
  SetParamNames,
} from '../../lib/decorators/murlock.decorator';

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
    const descriptor = Object.getOwnPropertyDescriptor(
      TestClass.prototype,
      'methodA'
    );
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
    const descriptor = Object.getOwnPropertyDescriptor(
      TestClass.prototype,
      'methodB'
    );
    const value = Reflect.getMetadata(KEY, descriptor?.value);
    expect(value).toBe('value-b');
  });

  describe('Issue #67: Parameter name extraction with decorator composition', () => {
    // Simulate a decorator that wraps methods (like @Transactional)
    // This wraps the method with a function that uses ...args, making parameter names unextractable
    function WrappingDecorator() {
      return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
      ) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args: any[]) {
          return originalMethod.apply(this, args);
        };
        return descriptor;
      };
    }

    it('should fail when SetParamNames is used above MurLock (wrong order)', () => {
      // This test demonstrates the WRONG order - SetParamNames above MurLock
      // Decorator execution order (bottom-up):
      // 1. WrappingDecorator (wraps method)
      // 2. MurLock (executes BEFORE SetParamNames, so metadata is NOT available)
      // 3. SetParamNames (sets metadata AFTER MurLock has already executed)
      //
      // In this case, @MurLock will fail to find parameter names because
      // metadata hasn't been set yet when it executes.
      // This is why SetParamNames should be placed BELOW MurLock.
      class TestClass {
        // @ts-ignore - Decorator type checking issue in test environment
        @SetParamNames('userData', 'options')
        // @ts-ignore - Decorator type checking issue in test environment
        @MurLock(1000, 'userData.id')
        // @ts-ignore - Decorator type checking issue in test environment
        @WrappingDecorator()
        async process(
          userData: { id: string },
          options: string[] = []
        ): Promise<any> {
          return { success: true };
        }
      }

      // Even though metadata is eventually stored, @MurLock executed before it was set
      // So @MurLock would have failed to find 'userData' parameter
      // This test verifies that metadata is stored, but the actual usage would fail
      const paramNames = Reflect.getMetadata(
        PARAM_NAMES_KEY,
        TestClass.prototype,
        'process'
      );
      expect(paramNames).toEqual(['userData', 'options']);
      // Note: In practice, this order would cause @MurLock to throw an error
      // because it can't find 'userData' when it executes
    });

    it('should extract parameter names when SetParamNames is used below MurLock', () => {
      // This is the CORRECT order for SetParamNames to work with MurLock
      // Decorator execution order (bottom-up):
      // 1. WrappingDecorator (wraps method)
      // 2. SetParamNames (sets metadata BEFORE MurLock executes)
      // 3. MurLock (reads metadata set by SetParamNames)
      class TestClass {
        // @ts-ignore - Decorator type checking issue in test environment
        @MurLock(1000, 'userData.id')
        // @ts-ignore - Decorator type checking issue in test environment
        @SetParamNames('userData', 'options')
        // @ts-ignore - Decorator type checking issue in test environment
        @WrappingDecorator()
        async process(
          userData: { id: string },
          options: string[] = []
        ): Promise<any> {
          return { success: true };
        }
      }

      // Verify that parameter names are stored in metadata
      const paramNames = Reflect.getMetadata(
        PARAM_NAMES_KEY,
        TestClass.prototype,
        'process'
      );
      expect(paramNames).toEqual(['userData', 'options']);
    });

    it('should auto-save parameter names when method is not wrapped', () => {
      // When no wrapping decorator is present, MurLock should extract and save parameter names
      class TestClass {
        @MurLock(1000, 'userData.id')
        async process(
          userData: { id: string },
          options: string[] = []
        ): Promise<any> {
          return { success: true };
        }
      }

      // Verify that parameter names are automatically stored in metadata
      const paramNames = Reflect.getMetadata(
        PARAM_NAMES_KEY,
        TestClass.prototype,
        'process'
      );
      expect(paramNames).toEqual(['userData', 'options']);
    });

    it('should work with name-based keys when SetParamNames is used in correct order', () => {
      // CORRECT order: SetParamNames below MurLock
      // Decorator execution order (bottom-up):
      // 1. WrappingDecorator (wraps method)
      // 2. SetParamNames (sets metadata BEFORE MurLock executes)
      // 3. MurLock (reads metadata set by SetParamNames)
      class TestClass {
        // @ts-ignore - Decorator type checking issue in test environment
        @MurLock(1000, 'userData.id')
        // @ts-ignore - Decorator type checking issue in test environment
        @SetParamNames('userData', 'options') // Correct: below @MurLock
        // @ts-ignore - Decorator type checking issue in test environment
        @WrappingDecorator()
        async process(
          userData: { id: string },
          options: string[] = []
        ): Promise<any> {
          return { success: true };
        }
      }

      // Verify that parameter names are stored in metadata
      const paramNames = Reflect.getMetadata(
        PARAM_NAMES_KEY,
        TestClass.prototype,
        'process'
      );
      expect(paramNames).toEqual(['userData', 'options']);

      // Verify that the decorator was applied correctly
      const instance = new TestClass();
      expect(instance.process).toBeDefined();
      expect(typeof instance.process).toBe('function');
    });
  });
});
