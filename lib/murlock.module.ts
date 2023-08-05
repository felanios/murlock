import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { MurLockService } from './murlock.service';
import 'reflect-metadata';
import { MurLockModuleAsyncOptions, MurLockModuleOptions } from './interfaces';
import { MURLOCK_SERVICE_METADATA_KEY } from './constants';

@Global()
@Module({
  providers: [MurLockService],
  exports: [MurLockService],
})
export class MurLockModule {
  static registerSync(options: MurLockModuleOptions): DynamicModule {
    return {
      module: MurLockModule,
      providers: [
        {
          provide: 'MURLOCK_OPTIONS',
          useValue: options,
        },
        MurLockService,
        {
          provide: MURLOCK_SERVICE_METADATA_KEY,
          useFactory: (murLockService: MurLockService) => {
            Reflect.defineMetadata(MURLOCK_SERVICE_METADATA_KEY, murLockService, MurLockService);
            return murLockService;
          },
          inject: [MurLockService],
        },
      ],
      exports: [MurLockService],
    };
  }

  static registerAsync(options: MurLockModuleAsyncOptions): DynamicModule {
    return {
      module: MurLockModule,
      imports: options.imports || [],
      providers: [
        this.createAsyncOptionsProvider(options),
        MurLockService,
        {
          provide: MURLOCK_SERVICE_METADATA_KEY,
          useFactory: (murLockService: MurLockService) => {
            Reflect.defineMetadata(MURLOCK_SERVICE_METADATA_KEY, murLockService, MurLockService);
            return murLockService;
          },
          inject: [MurLockService],
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
