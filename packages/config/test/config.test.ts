import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/schema';

describe('env schema', () => {
  it('parses a fully specified env object', () => {
    const env = loadEnv({
      THEIRSTACK_API_KEY: 'key456',
      JOBTECH_QUERIES: 'software engineer,data',
      DATABASE_PATH: './data/test.db',
      PORT: '8080',
      NODE_ENV: 'production',
    });
    expect(env).toEqual({
      CINODE_MARKET_ENABLED: true,
      THEIRSTACK_API_KEY: 'key456',
      JOBTECH_QUERIES: 'software engineer,data',
      JOBTECH_MUNICIPALITY_CODE: '1480',
      DATABASE_PATH: './data/test.db',
      PORT: 8080,
      NODE_ENV: 'production',
      OLLAMA_HOST: 'http://localhost:11434',
      OLLAMA_CHAT_MODEL: 'qwen2.5:7b',
      OLLAMA_EMBED_MODEL: 'nomic-embed-text',
      CHROMA_HOST: 'localhost',
      CHROMA_PORT: 8000,
      MATCH_MIN_SIMILARITY: 0.65,
      ROLE_MATCH_MIN_SIMILARITY: 0.85,
      SKILL_MATCH_MIN_SIMILARITY: 0.82,
      SKILL_OVERLAP_WEIGHT: 0.6,
      ROLE_MISMATCH_PENALTY: 0.5,
      NO_REQUIRED_SKILLS_PENALTY: 0.75,
      OLLAMA_NUM_CTX: 8192,
      OLLAMA_NUM_PREDICT: -1,
    });
  });

  it('applies defaults and allows a keyless run', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_PATH).toBe('./data/jobs.db');
    expect(env.JOBTECH_MUNICIPALITY_CODE).toBe('1480');
    expect(env.THEIRSTACK_API_KEY).toBeUndefined();
    expect(env.MATCH_TOP_K).toBeUndefined();
  });

  it('enables the public Cinode Market source unless switched off', () => {
    expect(loadEnv({}).CINODE_MARKET_ENABLED).toBe(true);
    expect(
      loadEnv({ CINODE_MARKET_ENABLED: 'false' }).CINODE_MARKET_ENABLED,
    ).toBe(false);
  });

  it('treats blank values as unset so optional keys stay optional', () => {
    const env = loadEnv({
      THEIRSTACK_API_KEY: '',
      PORT: '',
      JOBTECH_MUNICIPALITY_CODE: '',
    });
    expect(env.THEIRSTACK_API_KEY).toBeUndefined();
    expect(env.PORT).toBe(4000);
    expect(env.JOBTECH_MUNICIPALITY_CODE).toBe('1480');
  });

  it('parses board lists from comma-separated env vars', () => {
    const env = loadEnv({
      GREENHOUSE_BOARDS: 'wolt,truecaller',
      LEVER_BOARDS: 'spotify,tomtom',
    });
    expect(env.GREENHOUSE_BOARDS).toBe('wolt,truecaller');
    expect(env.LEVER_BOARDS).toBe('spotify,tomtom');
  });
});
