import { Module, Global } from '@nestjs/common';
import { AsyncStorageManager } from './als-manager';
import { AsyncStorageService, MurLockContext } from './als.service';
import { AsyncLocalStorage } from 'async_hooks';

@Global()
@Module({
  providers: [
    {
      provide: AsyncStorageManager,
      useFactory: () =>
        new AsyncStorageManager<MurLockContext>(
          new AsyncLocalStorage<MurLockContext>()
        ),
    },
    AsyncStorageService,
  ],
  exports: [AsyncStorageService],
})
export class AsyncStorageManagerModule {}
