import { z } from 'zod';

export const envSchema = z.object({
  CINODE_API_KEY: z.string().min(1).optional(),
  THEIRSTACK_API_KEY: z.string().min(1).optional(),
  JOBTECH_QUERIES: z.string().optional(),
  JOBTECH_MUNICIPALITY_CODE: z.string().default('1480'),
  GREENHOUSE_BOARDS: z.string().optional(),
  LEVER_BOARDS: z.string().optional(),
  DATABASE_PATH: z.string().default('./data/jobs.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(source);
}

export const configSchema = envSchema;
export type Config = Env;
