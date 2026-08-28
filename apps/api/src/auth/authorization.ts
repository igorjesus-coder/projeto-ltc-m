import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { QueryResultRow } from 'pg';

import { DatabaseService } from '../database/database.service.js';
import { setActorContext } from '../database/transaction.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';

export const AUTHORIZATION_CONTRACT = 'ltcm.p021.authorization-ui.v1' as const;

export const ROLES = ['viewer', 'editor', 'approver', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'data:read',
  'financial:read',
  'audit:read',
  'record:create',
  'record:edit_draft',
  'forecast:create',
  'forecast:edit_draft',
  'workflow:submit',
  'workflow:approve',
  'workflow:return_to_draft',
  'workflow:lock',
  'workflow:reopen',
  'soft_delete:execute',
  'soft_delete:restore',
  'catalog:manage',
  'users:manage',
  'roles:manage',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const UNSUPPORTED_OPERATIONS = ['physical_delete', 'archive', 'unlock_direct'] as const;

export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = Object.freeze({
  viewer: ['data:read', 'financial:read'],
  editor: [
    'data:read',
    'financial:read',
    'record:create',
    'record:edit_draft',
    'forecast:create',
    'forecast:edit_draft',
    'workflow:submit',
  ],
  approver: ['data:read', 'financial:read', 'workflow:approve', 'workflow:return_to_draft'],
  admin: [
    'data:read',
    'financial:read',
    'audit:read',
    'record:create',
    'record:edit_draft',
    'forecast:create',
    'forecast:edit_draft',
    'workflow:submit',
    'workflow:approve',
    'workflow:return_to_draft',
    'workflow:lock',
    'workflow:reopen',
    'soft_delete:execute',
    'soft_delete:restore',
    'catalog:manage',
    'users:manage',
    'roles:manage',
  ],
});

export interface AuthorizationProfile {
  readonly user: { readonly id: string; readonly displayName: string };
  readonly role: Role;
  readonly capabilities: readonly Capability[];
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export function capabilitiesForRole(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export function hasCapabilities(
  profile: Pick<AuthorizationProfile, 'capabilities'>,
  required: readonly Capability[],
): boolean {
  return required.every((capability) => profile.capabilities.includes(capability));
}

interface AuthorizationRow extends QueryResultRow {
  readonly app_user_id: string;
  readonly display_name: string;
  readonly app_role: string;
}

function denied(): never {
  throw new ForbiddenException('P021_AUTHORIZATION_DENIED');
}

@Injectable()
export class AuthorizationService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(subject: string, requestId?: string): Promise<AuthorizationProfile> {
    if (!subject.trim()) denied();

    try {
      return await this.database.transaction(async (client) => {
        const result = await client.query<AuthorizationRow>(
          `select app_user_id, display_name, app_role::text
             from ltc_m.resolve_authorization($1::text)`,
          [subject],
        );
        const row = result.rows[0];
        if (!row || !isRole(row.app_role) || !row.display_name.trim()) denied();

        await setActorContext(client, {
          appUserId: row.app_user_id,
          authSubject: subject,
          requestId: requestId ?? null,
          source: 'api',
        });

        return Object.freeze({
          user: Object.freeze({ id: row.app_user_id, displayName: row.display_name }),
          role: row.app_role,
          capabilities: capabilitiesForRole(row.app_role),
        });
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      denied();
    }
  }
}

export const REQUIRED_CAPABILITIES = Symbol('P021_REQUIRED_CAPABILITIES');

export function RequireCapabilities(...capabilities: Capability[]) {
  return SetMetadata(REQUIRED_CAPABILITIES, capabilities);
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly authGuard: AuthGuard,
    private readonly authorization: AuthorizationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.authGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const identity = request.auth;
    if (!identity) denied();

    const profile = await this.authorization.resolve(
      identity.subject,
      request.headers['x-request-id'],
    );
    request.authorization = profile;

    const required =
      this.reflector.getAllAndOverride<readonly Capability[]>(REQUIRED_CAPABILITIES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!hasCapabilities(profile, required)) denied();
    return true;
  }
}
