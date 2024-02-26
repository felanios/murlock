import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { MurLockService } from './murlock.service';
import { MurLockModuleAsyncOptions, MurLockModuleOptions } from './interfaces';
import { AsyncStorageManager } from './als/als-manager';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AsyncStorageInterceptor } from './interceptors';

@Global()
@Module({})
export class MurLockModule {
  static forRoot(options: MurLockModuleOptions): DynamicModule {
    return {
      module: MurLockModule,
      providers: [
        {
          provide: 'MURLOCK_OPTIONS',
          useValue: options,
        },
        AsyncStorageManager,
        MurLockService,
        {
          provide: APP_INTERCEPTOR,
          useClass: AsyncStorageInterceptor,
        },
      ],
      exports: [MurLockService],
    };
  }

  static forRootAsync(options: MurLockModuleAsyncOptions): DynamicModule {
    return {
      module: MurLockModule,
      imports: options.imports || [],
      providers: [
        this.createAsyncOptionsProvider(options),
        MurLockService,
        AsyncStorageManager,
        {
          provide: APP_INTERCEPTOR,
          useClass: AsyncStorageInterceptor,
        },
      ],
      exports: [MurLockService],
    };
  }

  private static createAsyncOptionsProvider(options: MurLockModuleAsyncOptions): Provider {
    return {
      provide: 'MURLOCK_OPTIONS',
      useFactory: options.useFactory,
      inject: options.inject || [],
    };
  }
}
