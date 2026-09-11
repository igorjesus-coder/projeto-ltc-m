import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { AuthorizationGuard, RequireCapabilities } from '../auth/authorization.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { parseQualityQuery } from './quality.types.js';
import { QualityService } from './quality.service.js';

interface QualityRequest extends AuthenticatedRequest {
  readonly query: Readonly<Record<string, unknown>>;
}

function actorFromRequest(request: AuthenticatedRequest) {
  const identity = request.auth;
  const profile = request.authorization;
  if (!identity || !profile) throw new Error('P021_AUTHORIZATION_CONTEXT_MISSING');
  return {
    appUserId: profile.user.id,
    authSubject: identity.subject,
    requestId: request.headers['x-request-id'] ?? null,
    source: 'api' as const,
  };
}

@Controller('quality')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('data:read', 'financial:read')
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Get('findings')
  async findings(@Req() request: QualityRequest) {
    return this.quality.list(parseQualityQuery(request.query), actorFromRequest(request));
  }
}
