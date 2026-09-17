import { z } from 'zod';

export const envSchema = z.object({
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
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL: z.string().default('qwen2.5:7b'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().default(-1),
  CHROMA_HOST: z.string().default('localhost'),
  CHROMA_PORT: z.coerce.number().int().positive().default(8000),
  MATCH_TOP_K: z.coerce.number().int().positive().optional(),
  MATCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.65),
  ROLE_MATCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.85),
  SKILL_MATCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.82),
  SKILL_OVERLAP_WEIGHT: z.coerce.number().min(0).max(1).default(0.6),
  ROLE_MISMATCH_PENALTY: z.coerce.number().min(0).max(1).default(0.5),
  NO_REQUIRED_SKILLS_PENALTY: z.coerce.number().min(0).max(1).default(0.75),
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
