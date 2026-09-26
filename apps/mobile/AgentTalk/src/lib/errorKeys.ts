export class LocalizedError extends Error {
  constructor(public readonly errorKey: string, public readonly errorParams?: Record<string, string | number>) {
    super(errorKey);
  }
}
export function errorKey(error: unknown): string {
  if (error instanceof LocalizedError) return error.errorKey;
  if (error instanceof Error && /^errors\.[a-zA-Z]+$/.test(error.message)) return error.message;
  return 'errors.request';
}
