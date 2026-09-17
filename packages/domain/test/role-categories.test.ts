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
