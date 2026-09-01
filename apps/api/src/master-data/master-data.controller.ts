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

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthorizationGuard, RequireCapabilities } from '../auth/authorization.js';
import type { ActorContext } from '../database/transaction.js';
import {
  parseClientCreatePayload,
  parseClientPatchPayload,
  parseCurrencyCode,
  parseMasterDataListQuery,
  parseStatusPayload,
  parseUnitCreatePayload,
  parseUnitPatchPayload,
} from './master-data.types.js';
import { MasterDataService } from './master-data.service.js';

interface MasterDataRequest extends AuthenticatedRequest {
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

function actorFromRequest(request: AuthenticatedRequest, justification?: string): ActorContext {
  const identity = request.auth;
  const profile = request.authorization;
  if (!identity || !profile) throw new Error('P021_AUTHORIZATION_CONTEXT_MISSING');
  return {
    appUserId: profile.user.id,
    authSubject: identity.subject,
    requestId: request.headers['x-request-id'] ?? null,
    ...(justification !== undefined ? { justification } : {}),
    source: 'api',
  };
}

@Controller('admin')
@UseGuards(AuthorizationGuard)
@RequireCapabilities('catalog:manage')
export class MasterDataController {
  constructor(private readonly masterData: MasterDataService) {}

  @Get('clients')
  async clients(@Req() request: MasterDataRequest) {
    return this.masterData.listClients(
      parseMasterDataListQuery(request.query),
      actorFromRequest(request),
    );
  }

  @Post('clients')
  @HttpCode(201)
  async createClient(@Req() request: MasterDataRequest, @Body() body: unknown) {
    return this.masterData.createClient(parseClientCreatePayload(body), actorFromRequest(request));
  }

  @Patch('clients/:clientId')
  async updateClient(
    @Req() request: MasterDataRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    return this.masterData.updateClient(
      clientId,
      parseClientPatchPayload(body),
      actorFromRequest(request),
    );
  }

  @Patch('clients/:clientId/status')
  async setClientStatus(
    @Req() request: MasterDataRequest,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ) {
    const payload = parseStatusPayload(body);
    return this.masterData.setClientStatus(
      clientId,
      payload,
      actorFromRequest(request, payload.justification),
    );
  }

  @Get('currencies')
  async currencies(@Req() request: MasterDataRequest) {
    return this.masterData.listCurrencies(
      parseMasterDataListQuery(request.query),
      actorFromRequest(request),
    );
  }

  @Patch('currencies/:code/status')
  async setCurrencyStatus(
    @Req() request: MasterDataRequest,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const payload = parseStatusPayload(body);
    return this.masterData.setCurrencyStatus(
      parseCurrencyCode(code),
      payload,
      actorFromRequest(request, payload.justification),
    );
  }

  @Get('units')
  async units(@Req() request: MasterDataRequest) {
    return this.masterData.listUnits(
      parseMasterDataListQuery(request.query),
      actorFromRequest(request),
    );
  }

  @Post('units')
  @HttpCode(201)
  async createUnit(@Req() request: MasterDataRequest, @Body() body: unknown) {
    return this.masterData.createUnit(parseUnitCreatePayload(body), actorFromRequest(request));
  }

  @Patch('units/:code')
  async updateUnit(
    @Req() request: MasterDataRequest,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    return this.masterData.updateUnit(code, parseUnitPatchPayload(body), actorFromRequest(request));
  }

  @Patch('units/:code/status')
  async setUnitStatus(
    @Req() request: MasterDataRequest,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const payload = parseStatusPayload(body);
    return this.masterData.setUnitStatus(
      code,
      payload,
      actorFromRequest(request, payload.justification),
    );
  }
}
