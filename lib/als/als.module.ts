import { AsyncLocalStorage } from 'async_hooks'
import { DynamicModule } from '@nestjs/common'
import { AsyncStorageManager } from './als-manager';

export class AsyncStorageManagerModule {
  static forRoot(): DynamicModule {
    return {
      module: AsyncStorageManagerModule,
      providers: [{ provide: AsyncStorageManager, useValue: new AsyncStorageManager(new AsyncLocalStorage<any>()) }],
      exports: [AsyncStorageManager]
    }
  }
}