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
  /**
   * node-redis exposes this. ioredis instead exposes `call` with the same
   * meaning; MurLock accepts either and normalises internally.
   */
  sendCommand?(args: string[]): Promise<unknown>;
  /** ioredis equivalent of `sendCommand`. */
  call?(...args: string[]): Promise<unknown>;

  connect?(): Promise<unknown>;
  quit?(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;

  /** node-redis reports connection state here; ioredis uses `status`. */
  isOpen?: boolean;
  status?: string;
}
