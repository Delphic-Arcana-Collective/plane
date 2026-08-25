import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return true;
    if (typeof value === "boolean") return value;
    return value !== "false";
  });

const envSchema = z.object({
  BFF_PORT: z.coerce.number().default(8000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  PLANE_WORKSPACE_SLUG: z.string().default("delphic"),
  PLANE_WORKSPACE_NAME: z.string().default("Delphic Arcana Collective"),
  MOCK_USER_EMAIL: z.string().default("dev@linear.local"),
  MOCK_USER_NAME: z.string().default("Linear Viewer"),
  LINEAR_API_KEY: z.string().optional(),
  LINEAR_WORKSPACE_ID: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  CACHE_POLL_INTERVAL_MS: z.coerce.number().optional(),
  CACHE_INITIAL_FETCH: booleanFromEnv,
  SYNC_DEBOUNCE_MS: z.coerce.number().default(30_000),
  SYNC_MIN_INTERVAL_MS: z.coerce.number().default(30_000),
  SYNC_ON_CACHE_MISS: booleanFromEnv,
  WEB_APP_BASE_URL: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

function resolveLinearApiKey(source: Record<string, unknown>): string | undefined {
  const direct = source.LINEAR_API_KEY;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const fallback = source.LINEAR_DELPHIC_ISSUE_WORKER_API_KEY;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return undefined;
}

export function loadEnvFromBindings(bindings: Record<string, unknown>): Env {
  return envSchema.parse({
    ...bindings,
    LINEAR_API_KEY: resolveLinearApiKey(bindings),
  });
}

export function loadEnv(): Env {
  const result = envSchema.safeParse({
    ...process.env,
    LINEAR_API_KEY: resolveLinearApiKey(process.env),
  });

  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export interface CloudflareEnv extends Record<string, unknown> {
  LINEAR_CACHE: KVNamespace;
  LINEAR_API_KEY?: string;
  LINEAR_WEBHOOK_SECRET?: string;
  LINEAR_WORKSPACE_ID?: string;
  CORS_ORIGIN?: string;
  PLANE_WORKSPACE_SLUG?: string;
  PLANE_WORKSPACE_NAME?: string;
  MOCK_USER_EMAIL?: string;
  MOCK_USER_NAME?: string;
  WEB_APP_BASE_URL?: string;
  SYNC_DEBOUNCE_MS?: string;
  SYNC_MIN_INTERVAL_MS?: string;
  SYNC_ON_CACHE_MISS?: string;
  CACHE_INITIAL_FETCH?: string;
  NODE_ENV?: string;
}
