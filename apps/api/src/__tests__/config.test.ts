import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import {
  getTargetRoles,
  setTargetRoles,
  recompileTargetTitlePatterns,
  matchesTargetTitle,
  getLocationSynonyms,
  setLocationSynonyms,
  getCategoryPatternSources,
  setCategoryPatterns,
  getTitleLevelPatternSources,
  setTitleLevelPatterns,
} from '@job-fetcher/domain';
import { getCiCdTokenPattern, setCiCdTokenPattern } from '../skill-taxonomy';
import { getSkillRelationSeeds, setSkillRelationSeeds } from '../skill-relations-seed';
import { configRoutes } from '../routes/config';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;
const originalRoles = [...getTargetRoles()];
const originalLocationSynonyms = { ...getLocationSynonyms() };
const originalCategoryPatterns = getCategoryPatternSources().map((row) => [...row] as typeof row);
const originalTitleLevelPatterns = getTitleLevelPatternSources().map((row) => [...row] as typeof row);
const originalCiCdPattern = getCiCdTokenPattern();
const originalSkillRelationSeeds = getSkillRelationSeeds().map((s) => ({ ...s }));

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

afterEach(() => {
  setTargetRoles(originalRoles);
  recompileTargetTitlePatterns();
  setLocationSynonyms(originalLocationSynonyms);
  setCategoryPatterns(originalCategoryPatterns);
  setTitleLevelPatterns(originalTitleLevelPatterns);
  setCiCdTokenPattern(originalCiCdPattern);
  setSkillRelationSeeds(originalSkillRelationSeeds);
});

function testApp() {
  const app = configRoutes(db);
  return app;
}

describe('GET /', () => {
  it('lists every registered config field with its live value and default', async () => {
    const res = await testApp().request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = body.data.map((f: { key: string }) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'target_roles',
        'generic_title_suffixes',
        'os_skill_exclusions',
        'non_emea_location_pattern',
      ]),
    );
    const targetRoles = body.data.find((f: { key: string }) => f.key === 'target_roles');
    expect(targetRoles.isDefault).toBe(true);
    expect(Array.isArray(targetRoles.value)).toBe(true);
  });
});

describe('PUT /:key', () => {
  it('persists a new value and applies it in-process immediately', async () => {
    const res = await testApp().request('/target_roles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: ['Chief Widget Officer'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.value).toEqual(['Chief Widget Officer']);
    expect(body.data.isDefault).toBe(false);

    expect(matchesTargetTitle('Chief Widget Officer')).toBe(true);
    expect(matchesTargetTitle('Software Engineer')).toBe(false);
  });

  it('rejects an empty list', async () => {
    const res = await testApp().request('/target_roles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid regex pattern', async () => {
    const res = await testApp().request('/non_emea_location_pattern', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '(unclosed' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s on an unknown key', async () => {
    const res = await testApp().request('/not_a_real_key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: ['x'] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /:key/reset', () => {
  it('restores the built-in default', async () => {
    await testApp().request('/target_roles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: ['Chief Widget Officer'] }),
    });

    const res = await testApp().request('/target_roles/reset', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isDefault).toBe(true);
    expect(body.data.value).toEqual(originalRoles);
    expect(matchesTargetTitle('Software Engineer')).toBe(true);
  });
});

describe('location_synonyms (kv_map)', () => {
  it('saves a new synonym map and applies it in-process', async () => {
    const res = await testApp().request('/location_synonyms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { gbg: 'gothenburg' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.value).toEqual({ gbg: 'gothenburg' });
    expect(getLocationSynonyms()).toEqual({ gbg: 'gothenburg' });
  });

  it('rejects a non-object value', async () => {
    const res = await testApp().request('/location_synonyms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: ['not', 'an', 'object'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('role_category_patterns (ordered_pattern_list)', () => {
  it('saves a reordered/edited pattern list covering every category exactly once', async () => {
    const current = getCategoryPatternSources().map((row) => [...row] as [string, string]);
    const edited = current.map(([category, pattern]) =>
      category === 'design' ? [category, '\\b(designer|ux|ui)\\b'] : [category, pattern],
    );

    const res = await testApp().request('/role_category_patterns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: edited }),
    });
    expect(res.status).toBe(200);
    expect(
      getCategoryPatternSources().find(([c]) => c === 'design')?.[1],
    ).toBe('\\b(designer|ux|ui)\\b');
  });

  it('rejects a list missing a required category', async () => {
    const current = getCategoryPatternSources().map((row) => [...row] as [string, string]);
    const missingOne = current.filter(([category]) => category !== 'design');

    const res = await testApp().request('/role_category_patterns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: missingOne }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid regex in one row', async () => {
    const current = getCategoryPatternSources().map((row) => [...row] as [string, string]);
    const broken = current.map(([category, pattern]) =>
      category === 'design' ? [category, '(unclosed'] : [category, pattern],
    );

    const res = await testApp().request('/role_category_patterns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: broken }),
    });
    expect(res.status).toBe(400);
  });
});

describe('seniority_patterns (ordered_pattern_list)', () => {
  it('saves an edited pattern list covering every level exactly once', async () => {
    const current = getTitleLevelPatternSources().map((row) => [...row] as [string, string]);
    const edited = current.map(([level, pattern]) =>
      level === 'junior' ? [level, '\\b(junior|jr|graduate)\\b'] : [level, pattern],
    );

    const res = await testApp().request('/seniority_patterns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: edited }),
    });
    expect(res.status).toBe(200);
    expect(
      getTitleLevelPatternSources().find(([l]) => l === 'junior')?.[1],
    ).toBe('\\b(junior|jr|graduate)\\b');
  });
});

describe('ci_cd_token_pattern (regex)', () => {
  it('saves a new pattern and applies it in-process', async () => {
    const res = await testApp().request('/ci_cd_token_pattern', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '(?:^|\\s)cicd(?:\\s|$)' }),
    });
    expect(res.status).toBe(200);
    expect(getCiCdTokenPattern()).toBe('(?:^|\\s)cicd(?:\\s|$)');
  });
});

describe('skill_relation_seeds (relation_list)', () => {
  it('saves an edited relation list in-process (DB apply skipped without vector/embed context)', async () => {
    const res = await testApp().request('/skill_relation_seeds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{ a: 'Foo', b: 'Bar', type: 'equivalent', weight: 0.9 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.value).toEqual([{ a: 'Foo', b: 'Bar', type: 'equivalent', weight: 0.9 }]);
    expect(getSkillRelationSeeds()).toEqual([{ a: 'Foo', b: 'Bar', type: 'equivalent', weight: 0.9 }]);
  });

  it('rejects an out-of-range weight', async () => {
    const res = await testApp().request('/skill_relation_seeds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{ a: 'Foo', b: 'Bar', type: 'equivalent', weight: 1.5 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid relation type', async () => {
    const res = await testApp().request('/skill_relation_seeds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{ a: 'Foo', b: 'Bar', type: 'synonym', weight: 0.5 }],
      }),
    });
    expect(res.status).toBe(400);
  });
});
