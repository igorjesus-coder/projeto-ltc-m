import { describe, expect, it } from 'vitest';

import { getSafeReturnTo } from './navigation';

describe('retorno seguro do login', () => {
  it('preserva somente caminho interno da origem atual', () => {
    expect(getSafeReturnTo('/projetos?status=active#first', 'https://web.example')).toBe(
      '/projetos?status=active#first',
    );
    expect(getSafeReturnTo('https://evil.example/phishing', 'https://web.example')).toBe('/');
    expect(getSafeReturnTo('//evil.example/phishing', 'https://web.example')).toBe('/');
  });
});
