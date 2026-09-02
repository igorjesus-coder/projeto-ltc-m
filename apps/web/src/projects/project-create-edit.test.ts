import { describe, expect, it } from 'vitest';

import { parseProjectOptions, parseProjectWriteResponse } from './project-create-edit';

describe('contrato P024 no frontend', () => {
  it('aceita opções BRL e somente dados mínimos de cliente', () => {
    expect(
      parseProjectOptions({
        contract: 'ltcm.p024.project-create-edit.v1',
        currencies: [
          { code: 'BRL', name: 'Real brasileiro' },
          { code: 'USD', name: 'Dólar americano' },
        ],
        clients: [{ id: 'client-1', displayName: 'Cliente 1' }],
      }),
    ).toEqual({
      contract: 'ltcm.p024.project-create-edit.v1',
      currencies: [
        { code: 'BRL', name: 'Real brasileiro' },
        { code: 'USD', name: 'Dólar americano' },
      ],
      clients: [{ id: 'client-1', displayName: 'Cliente 1' }],
    });
  });

  it('rejeita resposta mutada e valida resposta factual', () => {
    expect(() =>
      parseProjectOptions({
        contract: 'ltcm.p024.project-create-edit.v1',
        currencies: [{ code: 'EUR', name: 'Euro' }],
        clients: [],
      }),
    ).toThrow('P024_RESPONSE_INVALID');
    expect(() =>
      parseProjectWriteResponse({ contract: 'ltcm.p024.project-create-edit.v1' }),
    ).toThrow('P024_RESPONSE_INVALID');
  });
});
