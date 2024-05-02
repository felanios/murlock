import { DynamicModule, Global, Module } from '@nestjs/common'
import { AsyncStorageManager } from './als-manager';
import { AsyncStorageService } from './als.service';

@Global()
@Module({})
export class AsyncStorageManagerModule {
  static forRoot(): DynamicModule {
    return {
      module: AsyncStorageManagerModule,
      providers: [AsyncStorageService, AsyncStorageManager],
      exports: [AsyncStorageService]
    }
  }
}