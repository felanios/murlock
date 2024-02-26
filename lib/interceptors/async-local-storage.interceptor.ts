import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AsyncStorageManager } from '../als/als-manager';

@Injectable()
export class AsyncStorageInterceptor implements NestInterceptor {
  constructor(private readonly asyncStorageManager: AsyncStorageManager<string>) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return new Observable((subscriber) => {
      this.asyncStorageManager.runWithNewContext(async () => {
        next.handle().pipe(
          tap({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          })
        ).subscribe();
      });
    });
  }
}
