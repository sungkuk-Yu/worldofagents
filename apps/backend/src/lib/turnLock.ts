/** 세션별 실행 체인: 실패한 턴 이후에도 다음 턴은 실행한다. */
const locks = new Map<string, Promise<unknown>>();

export function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) || Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(key, next);
  const cleanup = () => { if (locks.get(key) === next) locks.delete(key); };
  void next.then(cleanup, cleanup);
  return next;
}
