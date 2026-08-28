import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { AuthTokenVerifier } from './token-verifier.js';

export interface AuthenticatedRequest {
  readonly headers: {
    readonly authorization?: string;
    readonly 'x-request-id'?: string;
  };
  auth?: {
    readonly subject: string;
    readonly issuer: string;
    readonly audience: string | readonly string[];
  };
  authorization?: import('./authorization.js').AuthorizationProfile;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly verifier: AuthTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      request.auth = await this.verifier.verifyAuthorizationHeader(request.headers.authorization);
      return true;
    } catch {
      throw new UnauthorizedException('P020_AUTHENTICATION_REQUIRED');
    }
  }
}
