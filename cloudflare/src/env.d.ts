interface Env {
  MIRROR_COMPARE_TOKEN: string;
  GOOGLE_DUAL_WRITE_TOKEN: string;
  GOOGLE_DUAL_WRITE_URL: string;
  GOOGLE_API_URL: string;
  DUAL_WRITE_ENABLED: string;
  SYNC_BATCH_SIZE: string;
}

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { duration?: number; changes?: number; [key: string]: unknown };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
interface ScheduledController {}
type ExportedHandler<TEnv> = {
  fetch?(request: Request, env: TEnv, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: TEnv, ctx: ExecutionContext): Promise<void>;
};

