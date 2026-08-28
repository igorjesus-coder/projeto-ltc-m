import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  AuthorizationContext,
  PermissionGate,
  type AuthorizationContextValue,
} from './authorization';

const approverContext: AuthorizationContextValue = {
  status: 'ready',
  profile: {
    authenticated: true,
    user: { id: 'p021-approver', displayName: 'P021 Approver' },
    role: 'approver',
    capabilities: ['data:read', 'financial:read', 'workflow:approve', 'workflow:return_to_draft'],
  },
  can: (capability) =>
    ['data:read', 'financial:read', 'workflow:approve', 'workflow:return_to_draft'].includes(
      capability,
    ),
  refresh: () => undefined,
};

function render(context: AuthorizationContextValue, children: ReactNode) {
  return renderToStaticMarkup(
    <AuthorizationContext.Provider value={context}>{children}</AuthorizationContext.Provider>,
  );
}

describe('authorization UI', () => {
  it('renderiza a ação autorizada e remove a ação não autorizada', () => {
    const html = render(
      approverContext,
      <>
        <PermissionGate capability="workflow:approve">
          <button type="button">Aprovar</button>
        </PermissionGate>
        <PermissionGate capability="record:edit_draft">
          <button type="button">Editar</button>
        </PermissionGate>
      </>,
    );
    expect(html).toContain('Aprovar');
    expect(html).not.toContain('Editar');
  });

  it('não concede capability por estado ausente', () => {
    const html = render(
      { ...approverContext, status: 'denied', profile: null, can: () => false },
      <PermissionGate capability="workflow:approve">
        <button type="button">Aprovar</button>
      </PermissionGate>,
    );
    expect(html).not.toContain('Aprovar');
  });
});
