import { z } from 'zod';

export const envSchema = z.object({
  CINODE_ACCESS_ID: z.string().min(1).optional(),
  CINODE_ACCESS_SECRET: z.string().min(1).optional(),
  CINODE_COMPANY_ID: z.string().min(1).optional(),
  CINODE_MARKET_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  THEIRSTACK_API_KEY: z.string().min(1).optional(),
  JOBTECH_QUERIES: z.string().optional(),
  JOBTECH_MUNICIPALITY_CODE: z.string().default('1480'),
  GREENHOUSE_BOARDS: z.string().optional(),
  LEVER_BOARDS: z.string().optional(),
  DATABASE_PATH: z.string().default('./data/jobs.db'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * A blank line in `.env` (`THEIRSTACK_API_KEY=`) reaches us as an empty string,
 * which `.optional()` does not treat as absent. Drop blanks so a commented-out
 * key and an empty one both mean "unset" and defaults still apply.
 */
function withoutBlanks(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const entries = Object.entries(source).filter(
    ([, value]) => value === undefined || value.trim() !== '',
  );
  return Object.fromEntries(entries);
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(withoutBlanks(source));
}

export const configSchema = envSchema;
export type Config = Env;
