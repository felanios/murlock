import { Module, DynamicModule, Provider, Global } from '@nestjs/common';
import { MurLockService } from './murlock.service';
import { MurLockModuleAsyncOptions, MurLockModuleOptions } from './interfaces';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AsyncStorageInterceptor } from './interceptors';
import { AsyncStorageManagerModule } from './als/als.module';

@Global()
@Module({})
export class MurLockModule {
  static forRoot(options: MurLockModuleOptions): DynamicModule {
    return {
      module: MurLockModule,
      imports: [AsyncStorageManagerModule.forRoot()],
      providers: [
        {
          provide: 'MURLOCK_OPTIONS',
          useValue: options,
        },
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
      imports: [
        AsyncStorageManagerModule.forRoot(),
        ...options.imports
      ] || [AsyncStorageManagerModule.forRoot()],
      providers: [
        this.createAsyncOptionsProvider(options),
        MurLockService,
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
