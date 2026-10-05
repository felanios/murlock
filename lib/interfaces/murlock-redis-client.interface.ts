/**
 * The whole Redis surface MurLock needs.
 *
 * MurLock runs every lock operation through a Lua script, so the only data path
 * is a raw command call. That makes the dependency on any particular client
 * library incidental rather than fundamental — which is what `client` in
 * `MurLockModuleOptions` exists to exploit.
 *
 * Why it matters: `redisOptions` ultimately describes a single endpoint, so
 * topologies that resolve their endpoint at runtime — Sentinel above all —
 * cannot be expressed through it. Supplying a ready client moves that concern
 * to the application, which already knows its own topology.
 */
export interface MurLockRedisClient {
  /*
   * Parameter and return types are deliberately loose.
   *
   * This interface is a structural gate, not a contract: its job is to accept
   * both libraries, whose signatures genuinely differ — ioredis' `sendCommand`
   * returns `unknown` and takes an internal Command, node-redis' returns a
   * promise and takes an array. Describing either precisely rejects the other.
   * MurLock awaits whatever comes back, so nothing here needs to be narrower.
   *
   * `client-compat.spec.ts` assigns real ioredis and node-redis instances to
   * this type, which is what keeps the looseness honest.
   */
  /**
   * ioredis: a raw command with spread arguments. Checked FIRST.
   *
   * ioredis also has a `sendCommand`, but it takes an internal `Command` object
   * rather than an argument array — handing it one fails. Preferring `call` is
   * what keeps the two libraries apart, since node-redis has no `call`.
   */
  call?(...args: any[]): any;
  /**
   * node-redis: a raw command as a single array. Used only when `call` is
   * absent, for the reason above.
   */
  sendCommand?(args: any, options?: any): any;

  connect?(): Promise<unknown>;
  quit?(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;

  /** node-redis reports connection state here; ioredis uses `status`. */
  isOpen?: boolean;
  status?: string;
}
