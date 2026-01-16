import { Inject } from '@nestjs/common';
import 'reflect-metadata';
import { MurLockException } from '../exceptions';
import { MurLockService } from '../murlock.service';

/**
 * Metadata key for storing parameter names (legacy array format)
 * This allows decorator composition by preserving parameter names even when methods are wrapped
 */
export const PARAM_NAMES_KEY = Symbol('murlock:param-names');

/**
 * Metadata key for storing parameter name to index mapping (new object format)
 * This provides O(1) lookup and allows partial parameter specification
 */
export const PARAM_INDEX_MAP_KEY = Symbol('murlock:param-index-map');

/**
 * Type for parameter name to index mapping
 */
export type ParamIndexMap = Record<string, number>;

/**
 * Helper decorator to explicitly set parameter names for a method
 * Use this when other decorators wrap the method before @MurLock is applied
 *
 * **Important**: Due to TypeScript's bottom-up decorator execution order,
 * `@SetParamNames` must be placed **below** `@MurLock` in the code.
 *
 * @example
 * ```typescript
 * // Option 1: Object format (recommended) - specify only what you need, order doesn't matter
 * class MyService {
 *   @MurLock(5000, 'userData.id')
 *   @SetParamNames({ userData: 0, context: 2 })  // Only specify needed params with their indices
 *   @Transactional()
 *   async process(userData: { id: string }, options: string[], context: { tenant: string }): Promise<any> {
 *     // ...
 *   }
 * }
 *
 * // Option 2: Array format (legacy) - must specify ALL params in order
 * class MyService {
 *   @MurLock(5000, 'userData.id')
 *   @SetParamNames('userData', 'options', 'context')  // Must be below @MurLock
 *   @Transactional()
 *   async process(userData: { id: string }, options: string[], context: { tenant: string }): Promise<any> {
 *     // ...
 *   }
 * }
 * ```
 *
 * Execution order (bottom-up):
 * 1. @Transactional() wraps the method
 * 2. @SetParamNames stores parameter names in metadata
 * 3. @MurLock reads parameter names from metadata
 *
 * @param {ParamIndexMap | string} mappingOrFirstParam - Object mapping param names to indices, or first param name
 * @param {...string} restParamNames - Remaining parameter names (only for array format)
 * @returns A decorator function
 */
export function SetParamNames(
  mappingOrFirstParam: ParamIndexMap | string,
  ...restParamNames: string[]
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    if (typeof mappingOrFirstParam === 'object') {
      // Object format: { paramName: index }
      Reflect.defineMetadata(
        PARAM_INDEX_MAP_KEY,
        mappingOrFirstParam,
        target,
        propertyKey
      );
    } else {
      // Array format: legacy support
      const paramNames = [mappingOrFirstParam, ...restParamNames];
      Reflect.defineMetadata(PARAM_NAMES_KEY, paramNames, target, propertyKey);
    }
    return descriptor;
  };
}

/**
 * Get all parameter names of a function
 * @param {Function} func the function to get the parameters from
 * @returns {string[]} an array of parameter names
 */
function getParameterNames(func: Function): string[] {
  const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;

  const fnStr = func.toString().replace(STRIP_COMMENTS, '');
  const paramsStr = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')'));

  if (!paramsStr.trim()) {
    return [];
  }

  // Split by comma, but handle nested parentheses and brackets
  const params: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && paramsStr[i - 1] !== '\\') {
      inString = false;
    } else if (!inString) {
      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      } else if (char === ',' && depth === 0) {
        // Extract parameter name (before = sign if present)
        const paramName = current.split('=')[0].trim().split(':')[0].trim();
        if (paramName) {
          params.push(paramName);
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  // Handle last parameter
  if (current.trim()) {
    const paramName = current.split('=')[0].trim().split(':')[0].trim();
    if (paramName) {
      params.push(paramName);
    }
  }

  return params;
}

/**
 * Get parameter names from function, with fallback to metadata
 * This handles cases where the function has been wrapped by other decorators
 * @param {Function} func the function to get the parameters from
 * @param {any} target the target class
 * @param {string} propertyKey the property key
 * @returns {string[]} an array of parameter names
 */
function getParameterNamesWithFallback(
  func: Function,
  target: any,
  propertyKey: string
): string[] {
  // First, try to get parameter names from the function itself
  const paramNames = getParameterNames(func);

  // If we got valid parameter names (not empty and not just '...args'), use them
  if (paramNames.length > 0 && !paramNames.includes('...args')) {
    return paramNames;
  }

  // If function is wrapped (e.g., by @Transactional), try to get from metadata
  // This is the reliable way to get parameter names when decorators wrap methods
  const metadataParamNames = Reflect.getMetadata(
    PARAM_NAMES_KEY,
    target,
    propertyKey
  ) as string[] | undefined;

  if (metadataParamNames && metadataParamNames.length > 0) {
    return metadataParamNames;
  }

  // Fallback: return empty array (will cause error if name-based key is used)
  return paramNames;
}

/**
 * Create a MurLock to control access to shared resources.
 *
 * @param {number} releaseTime - The time in milliseconds when the lock should be released.
 * @param {number | ((retries: number) => number)} wait - The time in milliseconds to wait before retrying the lock, or a function that calculates the wait time based on retries.
 * @param {string[]} keyParams - An array of key parameters to use for the lock.
 */
export function MurLock(
  releaseTime: number,
  wait: number | ((retries: number) => number),
  ...keyParams: string[]
);

/**
 * Create a MurLock to control access to shared resources without specifying a wait time.
 *
 * @param {number} releaseTime - The time in milliseconds when the lock should be released.
 * @param {string[]} keyParams - An array of key parameters to use for the lock.
 */
export function MurLock(releaseTime: number, ...keyParams: string[]);

// Implementation signature
export function MurLock(
  releaseTime: number,
  waitOrKeyParam?: number | ((retries: number) => number) | string,
  ...keyParams: string[]
) {
  let wait: number | ((retries: number) => number) | undefined;
  if (
    typeof waitOrKeyParam === 'number' ||
    typeof waitOrKeyParam === 'function'
  ) {
    wait = waitOrKeyParam;
  } else {
    keyParams = [
      ...(waitOrKeyParam === undefined ? [] : [waitOrKeyParam]),
      ...keyParams,
    ];
  }

  const injectMurlockService = Inject(MurLockService);

  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    injectMurlockService(target, 'murlockServiceDecorator');

    const originalMethod = descriptor.value;

    // Try to get parameter names with fallback to metadata
    // This handles cases where other decorators have already wrapped the method
    const methodParameterNames = getParameterNamesWithFallback(
      originalMethod,
      target,
      propertyKey
    );

    // Check for object-format param index map (new format, O(1) lookup)
    const paramIndexMap = Reflect.getMetadata(
      PARAM_INDEX_MAP_KEY,
      target,
      propertyKey
    ) as ParamIndexMap | undefined;

    // If we successfully extracted parameter names and they're not already in metadata,
    // store them for future decorators that might wrap this method
    if (
      methodParameterNames.length > 0 &&
      !methodParameterNames.includes('...args')
    ) {
      const existingMetadata = Reflect.getMetadata(
        PARAM_NAMES_KEY,
        target,
        propertyKey
      );
      if (!existingMetadata) {
        Reflect.defineMetadata(
          PARAM_NAMES_KEY,
          methodParameterNames,
          target,
          propertyKey
        );
      }
    }

    /**
     * Resolve parameter index from source name
     * Priority: 1) numeric index, 2) object map (O(1)), 3) array indexOf (O(n))
     */
    function resolveParameterIndex(source: string): number {
      // 1. Direct numeric index (e.g., '0', '1', '2')
      if (isNumber(source)) {
        return Number(source);
      }

      // 2. Object-format map lookup (O(1)) - new recommended format
      if (paramIndexMap && source in paramIndexMap) {
        return paramIndexMap[source];
      }

      // 3. Array-based lookup (O(n)) - legacy format
      return methodParameterNames.indexOf(source);
    }

    function constructLockKey(args: any[], lockKeyPrefix = 'default'): string {
      const lockKeyElements: string[] = [];
      if (lockKeyPrefix != 'custom') {
        lockKeyElements.push(target.constructor.name);
        lockKeyElements.push(propertyKey);
      }

      lockKeyElements.push(
        ...keyParams.map((keyParam) => {
          const [source, path] = keyParam.split('.');
          const parameterIndex = resolveParameterIndex(source);

          if (parameterIndex >= 0) {
            const parameterValue = findParameterValue({
              args,
              source,
              parameterIndex,
              path,
            });
            if (
              typeof parameterValue === 'undefined' ||
              parameterValue === null
            ) {
              throw new MurLockException(
                `Parameter ${source} is undefined or null.`
              );
            }
            if (
              path &&
              typeof parameterValue === 'object' &&
              parameterValue !== null &&
              path in parameterValue
            ) {
              return parameterValue[path];
            }
            return parameterValue instanceof Object
              ? parameterValue.toString()
              : parameterValue;
          }

          if (lockKeyPrefix == 'custom') {
            return source;
          }

          throw new MurLockException(
            `Parameter ${source} not found in method arguments.`
          );
        })
      );
      return lockKeyElements.join(':');
    }

    const wrapped = async function (...args: any[]) {
      const murLockService: MurLockService = this.murlockServiceDecorator;

      const lockKey = constructLockKey(
        args,
        murLockService.options.lockKeyPrefix
      );

      if (!murLockService) {
        throw new MurLockException('MurLockService is not available.');
      }

      return murLockService.runWithLock(
        lockKey,
        releaseTime,
        wait,
        async () => {
          return originalMethod.apply(this, args);
        }
      );
    };

    const metadataKeys =
      typeof (Reflect as any).getMetadataKeys === 'function'
        ? (Reflect as any).getMetadataKeys(originalMethod)
        : [];
    for (const key of metadataKeys) {
      const value = (Reflect as any).getMetadata(key, originalMethod);
      (Reflect as any).defineMetadata(key, value, wrapped);
    }

    descriptor.value = wrapped;

    return descriptor;
  };
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
    return args[source][path];
  }
  if (args.length == 1 && isObject(args[0]) && !path) {
    return args[0][source];
  }
  return args[parameterIndex];
}
