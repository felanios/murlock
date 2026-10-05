import { AsyncLocalStorage } from 'async_hooks';
import { MurLockService } from '../../lib/murlock.service';
import { AsyncStorageService, MurLockContext } from '../../lib/als/als.service';
import { AsyncStorageManager } from '../../lib/als/als-manager';
import { MurLockModuleOptions } from '../../lib/interfaces';

/**
 * Unit tests for the log-level threshold logic, including the regression where
 * `logLevel: 'none'` used to log everything (because levels.indexOf('none') is -1).
 */

function build(logLevel: MurLockModuleOptions['logLevel']) {
  const options: MurLockModuleOptions = {
    redisOptions: {},
    wait: 10,
    maxAttempts: 1,
    logLevel,
  };
  const als = new AsyncStorageService(
    new AsyncStorageManager<MurLockContext>(new AsyncLocalStorage())
  );
  const service = new MurLockService(options, als);
  const logger = (service as any).logger;
  const spies = {
    debug: jest.spyOn(logger, 'debug').mockImplementation(() => undefined),
    log: jest.spyOn(logger, 'log').mockImplementation(() => undefined),
    warn: jest.spyOn(logger, 'warn').mockImplementation(() => undefined),
    error: jest.spyOn(logger, 'error').mockImplementation(() => undefined),
  };
  const call = (level: 'debug' | 'log' | 'warn' | 'error') =>
    (service as any).log(level, 'msg');
  return { call, spies };
}

describe('MurLock logLevel threshold', () => {
  it("'none' suppresses every level (regression)", () => {
    const { call, spies } = build('none');
    call('debug');
    call('log');
    call('warn');
    call('error');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("'warn' allows warn and error but not debug/log", () => {
    const { call, spies } = build('warn');
    call('debug');
    call('log');
    call('warn');
    call('error');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.error).toHaveBeenCalledTimes(1);
  });

  it("'debug' allows every level", () => {
    const { call, spies } = build('debug');
    call('debug');
    call('log');
    call('warn');
    call('error');
    expect(spies.debug).toHaveBeenCalledTimes(1);
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.error).toHaveBeenCalledTimes(1);
  });
});
