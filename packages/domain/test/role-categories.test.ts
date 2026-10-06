import { describe, it, expect } from 'vitest';
import { categorizeRoleTitle, areRoleCategoriesCompatible } from '../src/role-categories';

describe('categorizeRoleTitle', () => {
  it('classifies engineering titles', () => {
    expect(categorizeRoleTitle('Full-Stack Developer')).toBe('engineering');
    expect(categorizeRoleTitle('Senior Software Engineer')).toBe('engineering');
  });

  it('classifies devops/cloud titles ahead of the generic engineering fallback', () => {
    expect(categorizeRoleTitle('DevOps Engineer')).toBe('devops-cloud');
    expect(categorizeRoleTitle('Cloud Solutions Architect')).toBe('devops-cloud');
  });

  it('classifies data/AI titles', () => {
    expect(categorizeRoleTitle('Machine Learning Engineer')).toBe('data-ai');
    expect(categorizeRoleTitle('Data Engineer')).toBe('data-ai');
  });

  it('classifies product management titles', () => {
    expect(categorizeRoleTitle('Product Manager - AI')).toBe('product-management');
    expect(categorizeRoleTitle('Technical Product Manager, AI')).toBe('product-management');
  });

  it('classifies product operations and solution/AI analyst titles', () => {
    expect(categorizeRoleTitle('AI Product Operations Lead')).toBe('product-management');
    expect(categorizeRoleTitle('AI Solution Analyst')).toBe('business-analysis');
    expect(categorizeRoleTitle('Generative AI Analyst | Russian (Kazakhstan)')).toBe(
      'business-analysis',
    );
    expect(areRoleCategoriesCompatible('design', categorizeRoleTitle('AI Solution Analyst'))).toBe(
      false,
    );
  });

  it('classifies design titles', () => {
    expect(categorizeRoleTitle('Product Designer')).toBe('design');
    expect(categorizeRoleTitle('UX Designer')).toBe('design');
  });

  it('classifies leadership titles ahead of the generic engineering fallback', () => {
    expect(categorizeRoleTitle('Engineering Manager')).toBe('leadership');
    expect(categorizeRoleTitle('Head of Engineering')).toBe('leadership');
  });

  it('returns null for an empty or unrecognized title', () => {
    expect(categorizeRoleTitle('')).toBeNull();
    expect(categorizeRoleTitle('Chief Happiness Officer Assistant To The')).not.toBeNull();
    expect(categorizeRoleTitle('Xyzzy Plugh')).toBeNull();
  });

  it('classifies embedded/native-mobile titles into their own isolated categories', () => {
    expect(categorizeRoleTitle('Embedded Software Engineer')).toBe('embedded-systems');
    expect(categorizeRoleTitle('Senior C++ Developer Embedded Automotive')).toBe(
      'embedded-systems',
    );
    expect(categorizeRoleTitle('Android Developer')).toBe('mobile-native');
    expect(categorizeRoleTitle('iOS Engineer')).toBe('mobile-native');
    // Ambiguous titles (no unambiguous native-stack keyword) stay in the
    // generic engineering bucket rather than being force-isolated - a real
    // JVM backend posting seen in the wild, not a native Android role.
    expect(categorizeRoleTitle('Senior Developer (Java/Kotlin)')).toBe('engineering');
  });

  it('classifies fused Swedish compound titles by splitting and translating known suffixes/roots', () => {
    // Regression coverage for the 2026-09-26 audit: these titles have no
    // internal `\b` word boundary for the English-only patterns above to
    // match without the Swedish-compound handling in `normalizeTitle`.
    expect(categorizeRoleTitle('Embeddedutvecklare')).toBe('embedded-systems');
    expect(categorizeRoleTitle('Android-utvecklare')).toBe('mobile-native');
    expect(categorizeRoleTitle('Systemutvecklare')).toBe('engineering');
    expect(categorizeRoleTitle('Dataingenjör')).toBe('data-ai');
    expect(categorizeRoleTitle('Molnarkitekt')).toBe('devops-cloud');
    expect(categorizeRoleTitle('Systemkonsult')).toBe('consulting-advisory');
    expect(categorizeRoleTitle('Produktägare')).toBe('product-management');
    expect(categorizeRoleTitle('IT-projektledare')).toBe('delivery-management');
  });
});

describe('areRoleCategoriesCompatible', () => {
  it('treats unknown categories as always compatible', () => {
    expect(areRoleCategoriesCompatible(null, 'design')).toBe(true);
    expect(areRoleCategoriesCompatible('engineering', null)).toBe(true);
    expect(areRoleCategoriesCompatible(null, null)).toBe(true);
  });

  it('treats identical categories as compatible', () => {
    expect(areRoleCategoriesCompatible('engineering', 'engineering')).toBe(true);
  });

  it('treats adjacent categories as compatible', () => {
    expect(areRoleCategoriesCompatible('engineering', 'devops-cloud')).toBe(true);
    expect(areRoleCategoriesCompatible('product-management', 'delivery-management')).toBe(true);
  });

  it('rejects the reported failure mode: design vs product-management', () => {
    expect(areRoleCategoriesCompatible('design', 'product-management')).toBe(false);
    expect(areRoleCategoriesCompatible('product-management', 'design')).toBe(false);
  });

  it('rejects unrelated categories in general', () => {
    expect(areRoleCategoriesCompatible('design', 'engineering')).toBe(false);
  });
});
