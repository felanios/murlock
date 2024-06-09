import { Inject } from '@nestjs/common';
import { MurLockException } from '../exceptions';
import { MurLockService } from '../murlock.service';
import { generateUuid } from '../utils';
import { AsyncStorageService } from '../als/als.service';

/**
 * Get all parameter names of a function
 * @param {Function} func the function to get the parameters from
 * @returns {string[]} an array of parameter names
 */
function getParameterNames(func: Function): string[] {
  const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
  const ARGUMENT_NAMES = /([^\s,]+)/g;

  const fnStr = func.toString().replace(STRIP_COMMENTS, '');
  const result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
  return result || [];
}

/**
 * Create a MurLock to control access to shared resources
 * @param {number} releaseTime the time in milliseconds when the lock should be released
 * @param {string[]} keyParams an array of key parameters to use for the lock
 * @returns {PropertyDescriptor} a descriptor for the MurLock
 */
export function MurLock(releaseTime: number, ...keyParams: string[]) {
  const injectMurlockService = Inject(MurLockService);
  const injectAsyncStorageService = Inject(AsyncStorageService);

  return (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    injectMurlockService(target, 'murlockServiceDecorator');
    injectAsyncStorageService(target, 'asyncStorageService');

    const originalMethod = descriptor.value;
    const methodParameterNames = getParameterNames(originalMethod);

    function constructLockKey(args: any[], lockKeyPrefix = 'default'): string {

      let lockKeyElements = [];
      if(lockKeyPrefix != 'custom')
        {
          lockKeyElements.push(target.constructor.name);
          lockKeyElements.push(propertyKey);
        }
      
        lockKeyElements.push(...keyParams.map((keyParam) => {
          const [source, path] = keyParam.split('.');
          const parameterIndex = isNumber(source) ? Number(source) : methodParameterNames.indexOf(source);
          if (parameterIndex >= 0) {
            const parameterValue = findParameterValue({ args, source, parameterIndex, path })
            if (typeof parameterValue === 'undefined' || parameterValue === null) {
              throw new MurLockException(`Parameter ${source} is undefined or null.`);
            }
            if (path && typeof parameterValue === 'object' && parameterValue !== null && path in parameterValue) {
              return parameterValue[path];
            }
            return parameterValue instanceof Object ? parameterValue.toString() : parameterValue;
          }
          
          if(lockKeyPrefix == 'custom'){
            return source;
        }

          throw new MurLockException(`Parameter ${source} not found in method arguments.`);
        }),
      );
      return lockKeyElements.join(':');
    }

    descriptor.value = async function (...args: any[]) {

      const murLockService: MurLockService = this.murlockServiceDecorator;
      const asyncStorageService: AsyncStorageService = this.asyncStorageService;

      const lockKey = constructLockKey(args, murLockService.options.lockKeyPrefix);

      if (!murLockService) {
        throw new MurLockException('MurLockService is not available.');
      }
      return asyncStorageService.runWithNewContext(async () => {

        asyncStorageService.registerContext();

        asyncStorageService.setClientID('clientId', generateUuid());

        await acquireLock(lockKey, murLockService, releaseTime);
        try {
          return await originalMethod.apply(this, args);
        } finally {
          await releaseLock(lockKey, murLockService);
        }
      });
    };

    return descriptor;
  };
}

async function acquireLock(lockKey: string, murLockService: MurLockService, releaseTime: number): Promise<void> {
  let isLockSuccessful = false;
  try {
    isLockSuccessful = await murLockService.lock(lockKey, releaseTime);
  } catch (error) {
    throw new MurLockException(`Failed to acquire lock for key ${lockKey}: ${error.message}`);
  }

  if (!isLockSuccessful) {
    throw new MurLockException(`Could not obtain lock for key ${lockKey}`);
  }
}

async function releaseLock(lockKey: string, murLockService: MurLockService): Promise<void> {
  try {
    await murLockService.unlock(lockKey);
  } catch (error) {
    throw new MurLockException(`Failed to release lock for key ${lockKey}: ${error.message}`);
  }
}

function isNumber(value) {
  const parsedValue = parseFloat(value);
  if (!isNaN(parsedValue)) {
    return true;
  }
  return false;
}

function isObject(value: any): boolean {
  return value !== null && value instanceof Object && !Array.isArray(value);
}

function findParameterValue({ args, source, parameterIndex, path }) {
  if (isNumber(source) && path) {
    return args[source][path]
  }
  if (args.length == 1 && isObject(args[0]) && !path) {
    return args[0][source]
  }
  return args[parameterIndex];
}
