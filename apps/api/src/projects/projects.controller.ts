import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AuthorizationGuard, RequireCapabilities } from '../auth/authorization.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { parseProjectId, parseProjectPortfolioQuery } from './projects.types.js';
import { ProjectsService } from './projects.service.js';

interface ProjectRequest extends AuthenticatedRequest {
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

@Controller('projects')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('data:read', 'financial:read')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@Req() request: ProjectRequest) {
    return this.projects.list(parseProjectPortfolioQuery(request.query), actorFromRequest(request));
  }

  @Get(':projectId')
  async getById(@Req() request: ProjectRequest, @Param('projectId') projectId: string) {
    return this.projects.getById(parseProjectId(projectId), actorFromRequest(request));
  }
}
