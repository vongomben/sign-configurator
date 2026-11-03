import { describe, expect, it } from 'vitest';
import { signSlug, stlFileName } from '../src/ui/signSlug';

describe('slug del file STL', () => {
  it('mette in minuscolo, in ASCII e con i trattini', () => {
    expect(signSlug('Ciao Torino')).toBe('ciao-torino');
    expect(signSlug('Città!')).toBe('citta');
    expect(signSlug('  foo---BAR  ')).toBe('foo-bar');
  });

  it('resta entro 40 caratteri e, se è vuoto, usa insegna', () => {
    expect(signSlug('a'.repeat(50))).toBe('a'.repeat(40));
    expect(signSlug(`${'a'.repeat(39)}-b`)).toBe('a'.repeat(39));
    expect(signSlug('   !!!  ')).toBe('insegna');
    expect(signSlug('')).toBe('insegna');
  });

  it('compone il nome di housing e diffusore', () => {
    expect(stlFileName('Ciao Torino', 120, 'housing')).toBe('ciao-torino-120mm-housing.stl');
    expect(stlFileName('Ciao Torino', 120, 'diffuser')).toBe('ciao-torino-120mm-diffuser.stl');
  });
});
