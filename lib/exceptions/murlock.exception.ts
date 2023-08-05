export class MurLockException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MurLockException";
  }
}
