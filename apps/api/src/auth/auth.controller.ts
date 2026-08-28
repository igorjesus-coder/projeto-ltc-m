import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';
import { AuthorizationService } from './authorization.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() request: AuthenticatedRequest) {
    const identity = request.auth;
    if (!identity) throw new ForbiddenException('P021_AUTHORIZATION_CONTEXT_MISSING');
    const profile = await this.authorization.resolve(
      identity.subject,
      request.headers['x-request-id'],
    );
    return {
      authenticated: true,
      user: profile.user,
      role: profile.role,
      capabilities: profile.capabilities,
    };
  }
}
