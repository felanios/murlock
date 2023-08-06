# NestJS MurLock

MurLock is a distributed lock solution designed for the NestJS framework. It provides a decorator `@MurLock()` that allows for critical sections of your application to be locked to prevent race conditions. MurLock uses Redis to ensure locks are respected across multiple instances of your application, making it perfect for microservices.

## Features

- **Redis-Based**: Implements a fast and effective lock mechanism using Redis.
- **Parameter-Based Locking**: Creates locks based on request parameters or bodies.
- **Highly Customizable**: Customize many parameters, such as lock duration.
- **Retry Mechanism**: Implements an exponential back-off strategy if the lock is not obtained.
- **Logging: Provides**: logging options for debugging and monitoring.
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
      logLevel: 'log',
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
        logLevel: configService.get('LOG_LEVEL')
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

### MurLock(releaseTime: number, ...keyParams: string[])

A method decorator to indicate that a particular method should be locked.

- `releaseTime`: Time in milliseconds after which the lock should be automatically released.
- `...keyParams`: Method parameters based on which the lock should be made. The format is `paramName.attribute`. If just `paramName` is provided, it will use the `toString` method of that parameter.

### Configuration Options

- **redisOptions:** Configuration options for the Redis client.
- **wait:** Time (in milliseconds) to wait before retrying if a lock isn't obtained.
- **maxAttempts:** Maximum number of attempts to obtain a lock.
- **logLevel:** Logging level. Can be one of 'none', 'error', 'warn', 'log', or 'debug'.

### MurLockService

A NestJS injectable service to interact with the locking mechanism directly.

## Best Practices

- **Short-lived Locks:** Ensure that locks are short-lived to prevent deadlocks and increase the efficiency of your application.
- **Error Handling:** Always handle errors gracefully. If a lock isn't obtained, it's often better to return a failure or retry after some time.
- **Logging:** Adjust the `logLevel` based on your environment. Use 'debug' for development and 'error' or 'warn' for production.

## Limitations

- **Redis Persistence:** Ensure that your Redis instance has RDB persistence enabled. This ensures that in case of a crash, locks are not lost.
- **Single Redis Instance:** MurLock is not designed to work with Redis cluster mode. It's essential to ensure that locks are always set to a single instance.

## Contributions & Support

We welcome contributions! Please see our contributing guide for more information. For support, raise an issue on our GitHub repository.

## License

This project is licensed under the [MIT License](LICENSE_FILE_URL).

## Contact

If you have any questions or feedback, feel free to contact me at ozmen.eyupfurkan@gmail.com.

---

We hope you find MurLock useful in your projects. Don't forget to star our repo if you find it helpful!

Happy coding! 🚀