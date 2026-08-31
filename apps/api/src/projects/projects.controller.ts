import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthorizationGuard, RequireCapabilities } from '../auth/authorization.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { parseProjectCreatePayload, parseProjectPatchPayload } from './projects-write.types.js';
import { parseProjectId, parseProjectPortfolioQuery } from './projects.types.js';
import { ProjectsService } from './projects.service.js';

interface ProjectRequest extends AuthenticatedRequest {
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

@Controller('projects')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('data:read', 'financial:read')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('options')
  @RequireCapabilities('data:read')
  async options(@Req() request: ProjectRequest) {
    return this.projects.options(actorFromRequest(request));
  }

  @Get()
  async list(@Req() request: ProjectRequest) {
    return this.projects.list(parseProjectPortfolioQuery(request.query), actorFromRequest(request));
  }

  @Get(':projectId')
  async getById(@Req() request: ProjectRequest, @Param('projectId') projectId: string) {
    return this.projects.getById(parseProjectId(projectId), actorFromRequest(request));
  }

  @Get(':projectId/edit')
  async editData(@Req() request: ProjectRequest, @Param('projectId') projectId: string) {
    return this.projects.getEditData(parseProjectId(projectId), actorFromRequest(request));
  }

  @Post()
  @HttpCode(201)
  @RequireCapabilities('record:create')
  async create(@Req() request: ProjectRequest, @Body() body: unknown) {
    return this.projects.create(
      parseProjectCreatePayload(body),
      actorFromRequest(request),
      request.authorization?.role ?? 'viewer',
    );
  }

  @Patch(':projectId')
  @RequireCapabilities('record:edit_draft')
  async update(
    @Req() request: ProjectRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.update(
      parseProjectId(projectId),
      parseProjectPatchPayload(body),
      actorFromRequest(request),
      request.authorization?.role ?? 'viewer',
    );
  }
}
