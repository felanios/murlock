import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { MurLockService } from './murlock.service';
import 'reflect-metadata';
import { MurLockModuleAsyncOptions, MurLockModuleOptions } from './interfaces';

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
        MurLockService,
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
