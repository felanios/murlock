import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { AsyncStorageManagerModule } from './als/als.module';
import { MurLockModuleAsyncOptions, MurLockModuleOptions } from './interfaces';
import { MurLockService } from './murlock.service';

@Global()
@Module({})
export class MurLockModule {
  static forRoot(options: MurLockModuleOptions): DynamicModule {
    return {
      module: MurLockModule,
      imports: [AsyncStorageManagerModule],
      providers: [
        {
          provide: 'MURLOCK_OPTIONS',
          useValue: options,
        },
        MurLockService,
      ],
      exports: [MurLockService],
    };
  }

  static forRootAsync(options: MurLockModuleAsyncOptions): DynamicModule {
    return {
      module: MurLockModule,
      imports: [
        AsyncStorageManagerModule,
        ...(options.imports || [])
      ],
      providers: [
        this.createAsyncOptionsProvider(options),
        MurLockService,
      ],
      exports: [MurLockService],
    };
  }

  private static createAsyncOptionsProvider(
    options: MurLockModuleAsyncOptions
  ): Provider {
    return {
      provide: 'MURLOCK_OPTIONS',
      useFactory: options.useFactory,
      inject: options.inject || [],
    };
  }
}
