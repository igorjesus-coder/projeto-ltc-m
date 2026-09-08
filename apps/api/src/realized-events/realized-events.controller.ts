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
import { parseProjectId } from '../projects/projects.types.js';
import { RealizedEventsService } from './realized-events.service.js';
import {
  parseRealizedEventCancelPayload,
  parseRealizedEventCreatePayload,
  parseRealizedEventId,
  parseRealizedEventPatchPayload,
  parseRealizedEventPublishPayload,
} from './realized-events.types.js';

interface RealizedEventsRequest extends AuthenticatedRequest {
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

@Controller('projects/:projectId/realized-events')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('data:read', 'financial:read')
export class RealizedEventsController {
  constructor(private readonly realizedEvents: RealizedEventsService) {}

  @Get()
  list(@Req() request: RealizedEventsRequest, @Param('projectId') projectId: string) {
    return this.realizedEvents.list(parseProjectId(projectId), actorFromRequest(request));
  }

  @Post()
  @HttpCode(201)
  @RequireCapabilities('record:create')
  create(
    @Req() request: RealizedEventsRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.realizedEvents.create(
      parseProjectId(projectId),
      parseRealizedEventCreatePayload(body),
      actorFromRequest(request),
    );
  }

  @Patch(':eventId')
  @RequireCapabilities('record:edit_draft')
  update(
    @Req() request: RealizedEventsRequest,
    @Param('projectId') projectId: string,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.realizedEvents.update(
      parseProjectId(projectId),
      parseRealizedEventId(eventId),
      parseRealizedEventPatchPayload(body),
      actorFromRequest(request),
    );
  }

  @Post(':eventId/publish')
  @RequireCapabilities('record:edit_draft')
  publish(
    @Req() request: RealizedEventsRequest,
    @Param('projectId') projectId: string,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    const payload = parseRealizedEventPublishPayload(body);
    return this.realizedEvents.publish(
      parseProjectId(projectId),
      parseRealizedEventId(eventId),
      payload.expectedVersion,
      actorFromRequest(request),
    );
  }

  @Post(':eventId/cancel')
  @RequireCapabilities('record:edit_draft')
  cancel(
    @Req() request: RealizedEventsRequest,
    @Param('projectId') projectId: string,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.realizedEvents.cancel(
      parseProjectId(projectId),
      parseRealizedEventId(eventId),
      parseRealizedEventCancelPayload(body),
      actorFromRequest(request),
    );
  }
}
