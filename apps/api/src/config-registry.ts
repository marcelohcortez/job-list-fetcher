import type { Kysely } from 'kysely';
import {
  DEFAULT_TARGET_ROLES,
  getTargetRoles,
  setTargetRoles,
  DEFAULT_GENERIC_TITLE_SUFFIXES,
  getGenericTitleSuffixes,
  setGenericTitleSuffixes,
  DEFAULT_NON_EMEA_LOCATION_PATTERN,
  getNonEmeaLocationPattern,
  setNonEmeaLocationPattern,
  recompileTargetTitlePatterns,
  DEFAULT_LOCATION_SYNONYMS,
  getLocationSynonyms,
  setLocationSynonyms,
  ROLE_CATEGORIES,
  DEFAULT_CATEGORY_PATTERN_SOURCES,
  getCategoryPatternSources,
  setCategoryPatterns,
  SENIORITY_LEVELS,
  DEFAULT_TITLE_LEVEL_PATTERN_SOURCES,
  getTitleLevelPatternSources,
  setTitleLevelPatterns,
} from '@job-fetcher/domain';
import { deleteAppConfig, listAppConfig, setAppConfig, type JobDb } from '@job-fetcher/database';
import type { VectorStore } from '@job-fetcher/semantic-match';
import {
  DEFAULT_OS_SKILL_EXCLUSIONS,
  getOsSkillExclusions,
  setOsSkillExclusions,
  DEFAULT_SKILL_RELATION_SEEDS,
  getSkillRelationSeeds,
  setSkillRelationSeeds,
  applySkillRelationSeeds,
  type SkillRelationSeed,
} from './skill-relations-seed';
import { DEFAULT_CI_CD_TOKEN_PATTERN, getCiCdTokenPattern, setCiCdTokenPattern } from './skill-taxonomy';

export type Embed = (text: string) => Promise<number[]>;

export interface ApplyContext {
  vectorStore: VectorStore;
  embed: Embed;
}

export type ConfigFieldType =
  | 'string_list'
  | 'regex'
  | 'kv_map'
  | 'ordered_pattern_list'
  | 'relation_list';

type ConfigValue =
  | string[]
  | string
  | Record<string, string>
  | (readonly [string, string])[]
  | SkillRelationSeed[];

interface ConfigFieldDef {
  key: string;
  label: string;
  description: string;
  type: ConfigFieldType;
  /** For 'ordered_pattern_list' fields: the fixed set of category/level keys the list must cover exactly once. */
  allowedKeys?: readonly string[];
  defaultValue: () => ConfigValue;
  get: () => ConfigValue;
  /** Applies a new value in-process (and, for `relation_list`, to the DB via `ctx`). Throws on an invalid value. */
  set: (value: ConfigValue, db: Kysely<JobDb>, ctx?: ApplyContext) => void | Promise<void>;
}

const REGISTRY: readonly ConfigFieldDef[] = [
  {
    key: 'target_roles',
    label: 'Target job titles',
    description:
      'Job titles (and title fragments) that put a listing in scope. A listing is only ingested when its title matches one of these.',
    type: 'string_list',
    defaultValue: () => [...DEFAULT_TARGET_ROLES],
    get: () => [...getTargetRoles()],
    set: (value) => {
      setTargetRoles(value as string[]);
      recompileTargetTitlePatterns();
    },
  },
  {
    key: 'generic_title_suffixes',
    label: 'Generic title suffixes',
    description:
      'Suffix words (e.g. "Manager", "Engineer") made optional on a target title, so "Customer Enablement Specialist" also matches a listing titled just "Customer Enablement".',
    type: 'string_list',
    defaultValue: () => [...DEFAULT_GENERIC_TITLE_SUFFIXES],
    get: () => [...getGenericTitleSuffixes()],
    set: (value) => setGenericTitleSuffixes(value as string[]),
  },
  {
    key: 'os_skill_exclusions',
    label: 'Excluded OS skills',
    description:
      'Extracted skills that just name an operating system (e.g. "Windows", "Linux") and are dropped from matching entirely - neither credited nor penalized.',
    type: 'string_list',
    defaultValue: () => [...DEFAULT_OS_SKILL_EXCLUSIONS],
    get: () => [...getOsSkillExclusions()],
    set: (value) => setOsSkillExclusions(value as string[]),
  },
  {
    key: 'non_emea_location_pattern',
    label: 'Non-EMEA location pattern',
    description:
      'Regex tested against a "Remote" listing\'s location text; a match rejects the listing as tied to a non-European country, region or city.',
    type: 'regex',
    defaultValue: () => DEFAULT_NON_EMEA_LOCATION_PATTERN,
    get: () => getNonEmeaLocationPattern(),
    set: (value) => setNonEmeaLocationPattern(value as string),
  },
  {
    key: 'location_synonyms',
    label: 'Location spelling synonyms',
    description:
      'Alternate spellings that should be treated as the same place (e.g. "Goteborg" -> "gothenburg") when comparing a job\'s location to a candidate\'s.',
    type: 'kv_map',
    defaultValue: () => ({ ...DEFAULT_LOCATION_SYNONYMS }),
    get: () => ({ ...getLocationSynonyms() }),
    set: (value) => setLocationSynonyms(value as Record<string, string>),
  },
  {
    key: 'role_category_patterns',
    label: 'Role category patterns',
    description:
      'Regex tested against a title to classify it into a coarse role family (design, engineering, leadership, ...), used to sanity-check a match independently of skill overlap. Order matters: the first matching row wins, so keep the most specific rows first and broad catch-alls last.',
    type: 'ordered_pattern_list',
    allowedKeys: ROLE_CATEGORIES,
    defaultValue: () => DEFAULT_CATEGORY_PATTERN_SOURCES.map(([k, v]) => [k, v] as const),
    get: () => getCategoryPatternSources().map(([k, v]) => [k, v] as const),
    set: (value) =>
      setCategoryPatterns(value as unknown as Parameters<typeof setCategoryPatterns>[0]),
  },
  {
    key: 'seniority_patterns',
    label: 'Seniority level patterns',
    description:
      'Regex tested against a title (then experience text) to classify seniority (junior, mid, senior, lead-principal). Order matters: the first matching row wins, so keep the most specific rows first.',
    type: 'ordered_pattern_list',
    allowedKeys: SENIORITY_LEVELS,
    defaultValue: () => DEFAULT_TITLE_LEVEL_PATTERN_SOURCES.map(([k, v]) => [k, v] as const),
    get: () => getTitleLevelPatternSources().map(([k, v]) => [k, v] as const),
    set: (value) =>
      setTitleLevelPatterns(value as unknown as Parameters<typeof setTitleLevelPatterns>[0]),
  },
  {
    key: 'ci_cd_token_pattern',
    label: 'CI/CD token pattern',
    description:
      'Regex tested against a normalized extracted skill label; a match folds that skill onto the canonical "CI/CD" skill instead of leaving every phrasing ("CI/CD Workflows", "GitLab CI/CD", ...) as its own unmatched skill.',
    type: 'regex',
    defaultValue: () => DEFAULT_CI_CD_TOKEN_PATTERN,
    get: () => getCiCdTokenPattern(),
    set: (value) => setCiCdTokenPattern(value as string),
  },
  {
    key: 'skill_relation_seeds',
    label: 'Curated skill relations',
    description:
      'Hand-curated equivalence/adjacency pairs between skills described under different names (e.g. "Go" = "Golang"). "equivalent" pairs are near-synonyms (weight ~0.85-1.0); "related" pairs are adjacent but distinct (weight ~0.5-0.7). Saving applies changes to already-known skill pairs immediately; removing a row stops it being re-seeded on future startups but does not delete a relation already learned in the database.',
    type: 'relation_list',
    defaultValue: () => DEFAULT_SKILL_RELATION_SEEDS.map((s) => ({ ...s })),
    get: () => getSkillRelationSeeds().map((s) => ({ ...s })),
    set: async (value, db, ctx) => {
      const seeds = value as SkillRelationSeed[];
      setSkillRelationSeeds(seeds);
      if (ctx) await applySkillRelationSeeds(db, ctx.vectorStore, ctx.embed, seeds);
    },
  },
];

export interface ConfigFieldView {
  key: string;
  label: string;
  description: string;
  type: ConfigFieldType;
  allowedKeys?: readonly string[];
  value: ConfigValue;
  defaultValue: ConfigValue;
  isDefault: boolean;
}

function fieldByKey(key: string): ConfigFieldDef | undefined {
  return REGISTRY.find((field) => field.key === key);
}

function validate(field: ConfigFieldDef, value: unknown): ConfigValue {
  if (field.type === 'string_list') {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      throw new Error('expected an array of strings');
    }
    const cleaned = value.map((v) => v.trim()).filter(Boolean);
    if (cleaned.length === 0) throw new Error('list cannot be empty');
    return cleaned;
  }

  if (field.type === 'regex') {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('expected a non-empty regex pattern string');
    }
    void new RegExp(value, 'i'); // throws if `value` isn't a valid pattern
    return value;
  }

  if (field.type === 'kv_map') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('expected an object of string -> string');
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : ''] as const)
      .filter(([k, v]) => k && v);
    if (entries.length === 0) throw new Error('map cannot be empty');
    return Object.fromEntries(entries);
  }

  if (field.type === 'ordered_pattern_list') {
    if (!Array.isArray(value)) throw new Error('expected an array of [key, pattern] pairs');
    const parsed = value.map((row) => {
      if (!Array.isArray(row) || row.length !== 2 || row.some((v) => typeof v !== 'string')) {
        throw new Error('each row must be a [key, pattern] pair of strings');
      }
      const [key, pattern] = row as [string, string];
      void new RegExp(pattern); // throws if `pattern` isn't a valid pattern
      return [key.trim(), pattern] as const;
    });
    const allowed = field.allowedKeys ?? [];
    const seenKeys = parsed.map(([key]) => key);
    const missing = allowed.filter((key) => !seenKeys.includes(key));
    const unknown = seenKeys.filter((key) => !allowed.includes(key));
    const duplicate = seenKeys.filter((key, i) => seenKeys.indexOf(key) !== i);
    if (missing.length > 0) throw new Error(`missing row(s) for: ${missing.join(', ')}`);
    if (unknown.length > 0) throw new Error(`unknown key(s): ${unknown.join(', ')}`);
    if (duplicate.length > 0) throw new Error(`duplicate row(s) for: ${[...new Set(duplicate)].join(', ')}`);
    return parsed;
  }

  // relation_list
  if (!Array.isArray(value)) throw new Error('expected an array of skill relations');
  return value.map((row, i) => {
    if (typeof row !== 'object' || row === null) throw new Error(`row ${i}: expected an object`);
    const { a, b, type, weight } = row as Record<string, unknown>;
    if (typeof a !== 'string' || !a.trim()) throw new Error(`row ${i}: "a" must be a non-empty string`);
    if (typeof b !== 'string' || !b.trim()) throw new Error(`row ${i}: "b" must be a non-empty string`);
    if (type !== 'equivalent' && type !== 'related') {
      throw new Error(`row ${i}: "type" must be "equivalent" or "related"`);
    }
    if (typeof weight !== 'number' || !(weight > 0) || weight > 1) {
      throw new Error(`row ${i}: "weight" must be a number in (0, 1]`);
    }
    return { a: a.trim(), b: b.trim(), type, weight } satisfies SkillRelationSeed;
  });
}

/** Loads every field's current DB-stored override (if any) into the in-process domain state. Safe to call once at startup. */
export async function loadConfigFromDb(db: Kysely<JobDb>, ctx?: ApplyContext): Promise<void> {
  const rows = await listAppConfig(db);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  for (const field of REGISTRY) {
    const raw = byKey.get(field.key);
    if (raw === undefined) continue;
    try {
      const parsed = JSON.parse(raw);
      // Startup load only restores in-process state - the DB already has
      // whatever `relation_list` previously applied, so skip re-applying it.
      await field.set(validate(field, parsed), db, field.type === 'relation_list' ? undefined : ctx);
    } catch (err) {
      console.warn(
        `Ignoring stored config for "${field.key}": ${(err as Error).message}`,
      );
    }
  }
}

export async function listConfigFields(db: Kysely<JobDb>): Promise<ConfigFieldView[]> {
  const rows = await listAppConfig(db);
  const overridden = new Set(rows.map((row) => row.key));
  return REGISTRY.map((field) => {
    const value = field.get();
    const defaultValue = field.defaultValue();
    return {
      key: field.key,
      label: field.label,
      description: field.description,
      type: field.type,
      allowedKeys: field.allowedKeys,
      value,
      defaultValue,
      isDefault: !overridden.has(field.key),
    };
  });
}

/** Validates, persists and applies a new value for one config field. Throws on an invalid value or unknown key. */
export async function updateConfigField(
  db: Kysely<JobDb>,
  key: string,
  rawValue: unknown,
  ctx?: ApplyContext,
): Promise<ConfigFieldView> {
  const field = fieldByKey(key);
  if (!field) throw new Error('unknown_config_key');

  const value = validate(field, rawValue);
  await field.set(value, db, ctx);
  await setAppConfig(db, key, JSON.stringify(value));

  return {
    key: field.key,
    label: field.label,
    description: field.description,
    type: field.type,
    allowedKeys: field.allowedKeys,
    value: field.get(),
    defaultValue: field.defaultValue(),
    isDefault: false,
  };
}

/** Resets one config field back to its built-in default, both in-process and in the DB. */
export async function resetConfigField(
  db: Kysely<JobDb>,
  key: string,
  ctx?: ApplyContext,
): Promise<ConfigFieldView> {
  const field = fieldByKey(key);
  if (!field) throw new Error('unknown_config_key');

  const defaultValue = field.defaultValue();
  await field.set(defaultValue, db, ctx);
  await deleteAppConfig(db, key);

  return {
    key: field.key,
    label: field.label,
    description: field.description,
    type: field.type,
    allowedKeys: field.allowedKeys,
    value: field.get(),
    defaultValue,
    isDefault: true,
  };
}
