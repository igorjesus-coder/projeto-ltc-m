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
import { ProjectItemsService } from './project-items.service.js';
import {
  parseProjectItemCreatePayload,
  parseProjectItemDuplicatePayload,
  parseProjectItemId,
  parseProjectItemInactivatePayload,
  parseProjectItemPatchPayload,
} from './project-items.types.js';
import { parseProjectId } from '../projects/projects.types.js';

interface ProjectItemsRequest extends AuthenticatedRequest {
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

function roleFromRequest(request: AuthenticatedRequest) {
  return request.authorization?.role ?? 'viewer';
}

@Controller('projects/:projectId/items')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('data:read', 'financial:read')
export class ProjectItemsController {
  constructor(private readonly projectItems: ProjectItemsService) {}

  @Get()
  async list(@Req() request: ProjectItemsRequest, @Param('projectId') projectId: string) {
    return this.projectItems.list(parseProjectId(projectId), actorFromRequest(request));
  }

  @Post()
  @HttpCode(201)
  @RequireCapabilities('record:create')
  async create(
    @Req() request: ProjectItemsRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projectItems.create(
      parseProjectId(projectId),
      parseProjectItemCreatePayload(body),
      actorFromRequest(request),
      roleFromRequest(request),
    );
  }

  @Patch(':itemId')
  @RequireCapabilities('record:edit_draft')
  async update(
    @Req() request: ProjectItemsRequest,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.projectItems.update(
      parseProjectId(projectId),
      parseProjectItemId(itemId),
      parseProjectItemPatchPayload(body),
      actorFromRequest(request),
      roleFromRequest(request),
    );
  }

  @Post(':itemId/duplicate')
  @HttpCode(201)
  @RequireCapabilities('record:create')
  async duplicate(
    @Req() request: ProjectItemsRequest,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.projectItems.duplicate(
      parseProjectId(projectId),
      parseProjectItemId(itemId),
      parseProjectItemDuplicatePayload(body),
      actorFromRequest(request),
      roleFromRequest(request),
    );
  }

  @Post(':itemId/inactivate')
  @RequireCapabilities('soft_delete:execute')
  async inactivate(
    @Req() request: ProjectItemsRequest,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.projectItems.inactivate(
      parseProjectId(projectId),
      parseProjectItemId(itemId),
      parseProjectItemInactivatePayload(body),
      actorFromRequest(request),
      roleFromRequest(request),
    );
  }
}
