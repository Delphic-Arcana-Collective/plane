import { z } from "zod";

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
  CACHE_POLL_INTERVAL_MS: z.coerce.number().optional(),
  CACHE_INITIAL_FETCH: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const linearApiKey = process.env.LINEAR_API_KEY || process.env.LINEAR_DELPHIC_ISSUE_WORKER_API_KEY || undefined;

  const result = envSchema.safeParse({
    ...process.env,
    LINEAR_API_KEY: linearApiKey,
  });

  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}
