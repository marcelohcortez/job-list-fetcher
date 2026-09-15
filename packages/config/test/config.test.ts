import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/schema';

describe('env schema', () => {
  it('parses a fully specified env object', () => {
    const env = loadEnv({
      CINODE_ACCESS_ID: 'access123',
      CINODE_ACCESS_SECRET: 'secret123',
      CINODE_COMPANY_ID: '99',
      THEIRSTACK_API_KEY: 'key456',
      JOBTECH_QUERIES: 'software engineer,data',
      DATABASE_PATH: './data/test.db',
      PORT: '8080',
      NODE_ENV: 'production',
    });
    expect(env).toEqual({
      CINODE_ACCESS_ID: 'access123',
      CINODE_ACCESS_SECRET: 'secret123',
      CINODE_COMPANY_ID: '99',
      CINODE_MARKET_ENABLED: true,
      THEIRSTACK_API_KEY: 'key456',
      JOBTECH_QUERIES: 'software engineer,data',
      JOBTECH_MUNICIPALITY_CODE: '1480',
      DATABASE_PATH: './data/test.db',
      PORT: 8080,
      NODE_ENV: 'production',
    });
  });

  it('applies defaults and allows a keyless run', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_PATH).toBe('./data/jobs.db');
    expect(env.JOBTECH_MUNICIPALITY_CODE).toBe('1480');
    expect(env.THEIRSTACK_API_KEY).toBeUndefined();
    expect(env.CINODE_ACCESS_ID).toBeUndefined();
    expect(env.CINODE_ACCESS_SECRET).toBeUndefined();
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
      CINODE_ACCESS_ID: '   ',
      PORT: '',
      JOBTECH_MUNICIPALITY_CODE: '',
    });
    expect(env.THEIRSTACK_API_KEY).toBeUndefined();
    expect(env.CINODE_ACCESS_ID).toBeUndefined();
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
