import { MURLOCK_KEY_METADATA, MURLOCK_SERVICE_METADATA_KEY } from '../constants';
import { MurLockException } from '../exceptions';
import { MurLockService } from '../murlock.service';

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
  return (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    const originalMethod = descriptor.value;
    const methodParameterNames = getParameterNames(originalMethod);

    function constructLockKey(args: any[]): string {
      const lockKeyElements = [
        target.constructor.name,
        propertyKey,
        ...keyParams.map((keyParam) => {
          const [source, path] = keyParam.split('.');
          const parameterIndex = methodParameterNames.indexOf(source);
          if (parameterIndex >= 0) {
            const parameterValue = args[parameterIndex];
            if (typeof parameterValue === 'undefined' || parameterValue === null) {
              throw new Error(`Parameter ${source} is undefined or null.`);
            }
            if (path && typeof parameterValue === 'object' && parameterValue !== null && path in parameterValue) {
              return parameterValue[path];
            }
            return parameterValue instanceof Object ? parameterValue.toString() : parameterValue;
          }
          throw new Error(`Parameter ${source} not found in method arguments.`);
        }),
      ];
      return lockKeyElements.join(':');
    }

    descriptor.value = async function (...args: any[]) {
      const lockKey = constructLockKey(args);

      const murLockService: MurLockService = Reflect.getMetadata(MURLOCK_SERVICE_METADATA_KEY, MurLockService);
      if (!murLockService) {
        throw new Error('MurLockService is not available.');
      }

      await acquireLock(lockKey, murLockService, releaseTime);
      try {
        return await originalMethod.apply(this, args);
      } finally {
        await releaseLock(lockKey, murLockService);
      }
    };

    Reflect.defineMetadata(
      MURLOCK_KEY_METADATA,
      {releaseTime, keyParams},
      descriptor.value
      );
      
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