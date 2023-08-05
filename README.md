# NestJS MurLock

MurLock is a distributed lock solution designed for the NestJS framework. It provides a decorator `@MurLock()` that allows for critical sections of your application to be locked to prevent race conditions. MurLock uses Redis to ensure locks are respected across multiple instances of your application, making it perfect for microservices.

## Features

- **Redis-Based**: Implements a fast and effective lock mechanism using Redis.
- **Parameter-Based Locking**: Creates locks based on request parameters or bodies.
- **Highly Customizable**: Customize many parameters, such as lock duration.
- **Logging Support**: Detailed logging with internal nestjs-logger.
- **OOP and Generic Structure**: Easily integratable and expandable due to its OOP and generic design.

## Installation

MurLock has a peer dependency on `@nestjs/common` and `reflect-metadata`. These should already be installed in your NestJS project. In addition, you'll also need to install the `redis` package.

```bash
npm install --save murlock redis reflect-metadata
```

## Basic Usage

MurLock is primarily used through the `@MurLock()` decorator.

First, you need to import and register the `MurLockModule` in your module:

```typescript
import { MurLockModule } from 'murlock';

@Module({
  imports: [
    MurLockModule.registerSync({
      redisOptions: { host: 'localhost', port: 6379 },
      wait: 1000,
      maxAttempts: 3,
    }),
  ],
})
export class AppModule {}
```

Then, you can use `@MurLock()` in your services:

```typescript
import { MurLock } from 'murlock';

@Injectable()
export class AppService {
  @MurLock(5000, 'user.id')
  async someFunction(user: User): Promise<void> {
    // Some critical section that only one request should be able to execute at a time
  }
}
```

In the example above, the `@MurLock()` decorator will prevent `someFunction()` from being executed concurrently for the same user. If another request comes in for the same user before `someFunction()` has finished executing, it will wait up to 5000 milliseconds (5 seconds) for the lock to be released. If the lock is not released within this time, an `MurLockException` will be thrown.

The parameters to `@MurLock()` are a release time (in milliseconds), followed by any number of key parameters. The key parameters are used to create a unique key for each lock. They should be properties of the parameters of the method. In the example above, 'user.id' is used, which means the lock key will be different for each user ID.

## Advanced Usage

MurLock also supports async configuration. This can be useful if your Redis configuration is not known at compile time.

```typescript
import { MurLockModule } from 'murlock';

@Module({
  imports: [
    MurLockModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redisOptions: configService.get('REDIS_OPTIONS'),
        wait: configService.get('MURLOCK_WAIT'),
        maxAttempts: configService.get('MURLOCK_MAX_ATTEMPTS'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

In the example above, the `ConfigModule` and `ConfigService` are used to provide the configuration for MurLock asynchronously.

For more details on usage and configuration, please refer to the API documentation below.

## API Documentation

For more detailed API documentation, please see the source code, which is thoroughly commented and should provide enough information for most use cases. The key classes and interfaces to be aware of are:

- `MurLockService`: A service that provides methods for locking and unlocking. Normally you would not use this directly, but it is provided for more complex use cases.

- `MurLockModuleOptions`: An interface for the options that can be passed to `MurLockModule.registerSync()`.

- `MurLockModuleAsyncOptions`: An interface for the options that can be passed to `MurLockModule.registerAsync()`.

- `MurLock()`: A decorator that provides distributed locking functionality.

- `MurLockMetadata`: An interface for the metadata associated with a `@MurLock()` method.

## License

This project is licensed under the [MIT License](LICENSE_FILE_URL).

## Contact

If you have any questions or feedback, feel free to contact me at ozmen.eyupfurkan@gmail.com.