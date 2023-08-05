import 'reflect-metadata';
import { MurLockService } from '../murlock.service';
import { MURLOCK_SERVICE_METADATA_KEY } from '../constants';
import { MurLockException } from '../exceptions';

function getParameterNames(func) {
  const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
  const ARGUMENT_NAMES = /([^\s,]+)/g;

  const fnStr = func.toString().replace(STRIP_COMMENTS, '');
  const result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
  return result || [];
}

export function MurLock(releaseTime: number, ...keyParams: string[]) {
  return (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    const originalMethod = descriptor.value;
    const methodParameterNames = getParameterNames(originalMethod);

    
    descriptor.value = async function (...args: any[]) {
      const lockKeyElements = [
        target.constructor.name,
        propertyKey,
        ...keyParams.map((keyParam) => {
          const [source, path] = keyParam.split('.');
          const parameterIndex = methodParameterNames.indexOf(source);
          if (parameterIndex >= 0) {
            const parameterValue = args[parameterIndex];
            if (path && typeof parameterValue === 'object' && parameterValue !== null && path in parameterValue) {
              return parameterValue[path];
            }
            return parameterValue instanceof Object ? parameterValue.toString() : parameterValue;
          }
        }),
      ];      
      const lockKey = lockKeyElements.join(':');

      const murLockService: MurLockService = Reflect.getMetadata(MURLOCK_SERVICE_METADATA_KEY, MurLockService);

      const isLockSuccessful = await murLockService.lock(lockKey, releaseTime);
      if (!isLockSuccessful) {
        throw new MurLockException('Could not obtain lock');
      }

      let result;
      try {
        result = await originalMethod.apply(this, args);
      } finally {
        await murLockService.unlock(lockKey);
      }

      return result;
    };

    Reflect.defineMetadata(
      'MURLOCK_KEY_METADATA',
      { releaseTime, keyParams },
      descriptor.value
    );
    
    return descriptor;
  };
}
