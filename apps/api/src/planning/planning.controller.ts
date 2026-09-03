import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';

import { AuthorizationGuard, RequireCapabilities } from '../auth/authorization.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import {
  parsePlanningBatchPayload,
  parsePlanningMonthQuery,
  parsePlanningProjectId,
  parsePlanningVersionId,
} from './planning.types.js';
import { PlanningService } from './planning.service.js';

interface PlanningRequest extends AuthenticatedRequest {
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
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

@Controller('planning')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('data:read', 'financial:read')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('projects')
  async projects(@Req() request: PlanningRequest) {
    return this.planning.projects(actorFromRequest(request));
  }

  @Get('projects/:projectId/versions')
  async versions(@Req() request: PlanningRequest, @Param('projectId') projectId: string) {
    return this.planning.versions(parsePlanningProjectId(projectId), actorFromRequest(request));
  }

  @Get('projects/:projectId/editor')
  async editor(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Query('versionId') versionId: string,
  ) {
    return this.planning.editor(
      parsePlanningProjectId(projectId),
      parsePlanningMonthQuery(parsePlanningVersionId(versionId), request.query),
      actorFromRequest(request),
    );
  }

  @Put('projects/:projectId/versions/:versionId/months')
  @RequireCapabilities('forecast:edit_draft')
  async save(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.planning.save(
      parsePlanningProjectId(projectId),
      parsePlanningVersionId(versionId),
      parsePlanningBatchPayload(body),
      actorFromRequest(request),
    );
  }
}
