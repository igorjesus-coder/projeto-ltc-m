import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return { sub: request.auth?.subject };
  }
}
