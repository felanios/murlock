import { Module, Global } from '@nestjs/common';
import { AsyncStorageManager } from './als-manager';
import { AsyncStorageService } from './als.service';
import { AsyncLocalStorage } from 'async_hooks';

@Global()
@Module({
  providers: [
    {
      provide: AsyncStorageManager,
      useFactory: () => {
        return new AsyncStorageManager<string>(new AsyncLocalStorage<Map<string, string>>());
      },
    },
    AsyncStorageService,
  ],
  exports: [AsyncStorageService],
})
export class AsyncStorageManagerModule {}
