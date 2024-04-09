import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AsyncStorageManager } from '../als/als-manager';
import { generateUuid } from '../utils';

@Injectable()
export class AsyncStorageInterceptor implements NestInterceptor {
  constructor(private readonly asyncStorageManager: AsyncStorageManager<string>) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return this.asyncStorageManager.runWithNewContext(() => {
      this.asyncStorageManager.set('clientId', generateUuid());
      return next.handle();
    });
  }
}
