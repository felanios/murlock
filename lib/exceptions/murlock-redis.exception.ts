export class MurLockRedisException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MurLockRedisException";
  }
}