import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';

import { AuthorizationGuard, hasCapabilities, RequireCapabilities } from '../auth/authorization.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import {
  parsePlanningBatchPayload,
  parsePlanningMonthQuery,
  parsePlanningProjectId,
  parsePlanningVersionId,
  parsePlanningWorkflowPayload,
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

function canOverrideBalance(request: AuthenticatedRequest): boolean {
  const profile = request.authorization;
  if (!profile) throw new Error('P021_AUTHORIZATION_CONTEXT_MISSING');
  return hasCapabilities(profile, ['forecast:override_balance']);
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
      canOverrideBalance(request),
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
      canOverrideBalance(request),
    );
  }

  @Post('projects/:projectId/versions/:versionId/submit')
  @RequireCapabilities('workflow:submit')
  async submit(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow(request, projectId, versionId, 'submit', body);
  }

  @Post('projects/:projectId/versions/:versionId/return')
  @RequireCapabilities('workflow:return_to_draft')
  async returnToDraft(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow(request, projectId, versionId, 'return', body);
  }

  @Post('projects/:projectId/versions/:versionId/approve')
  @RequireCapabilities('workflow:approve')
  async approve(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow(request, projectId, versionId, 'approve', body);
  }

  @Post('projects/:projectId/versions/:versionId/lock')
  @RequireCapabilities('workflow:lock')
  async lock(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow(request, projectId, versionId, 'lock', body);
  }

  @Post('projects/:projectId/versions/:versionId/archive')
  @RequireCapabilities('workflow:archive')
  async archive(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow(request, projectId, versionId, 'archive', body);
  }

  @Post('projects/:projectId/versions/:versionId/reopen')
  @RequireCapabilities('workflow:reopen')
  async reopen(
    @Req() request: PlanningRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow(request, projectId, versionId, 'reopen', body);
  }

  private workflow(
    request: PlanningRequest,
    projectId: string,
    versionId: string,
    action: 'submit' | 'return' | 'approve' | 'lock' | 'archive' | 'reopen',
    body: unknown,
  ) {
    return this.planning.workflow(
      parsePlanningProjectId(projectId),
      parsePlanningVersionId(versionId),
      action,
      parsePlanningWorkflowPayload(body, action),
      actorFromRequest(request),
      canOverrideBalance(request),
    );
  }
}
