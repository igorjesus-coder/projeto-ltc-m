import { Module } from '@nestjs/common';

import { loadApiConfig } from '../config/api-config.js';
import { AUTH_CONFIG, AUTH_TOKEN_VERIFIER } from './auth.tokens.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthTokenVerifier } from './token-verifier.js';
import { AuthorizationGuard, AuthorizationService } from './authorization.js';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => loadApiConfig(process.env).auth,
    },
    {
      provide: AUTH_TOKEN_VERIFIER,
      useFactory: (config: ConstructorParameters<typeof AuthTokenVerifier>[0]) =>
        new AuthTokenVerifier(config),
      inject: [AUTH_CONFIG],
    },
    {
      provide: AuthTokenVerifier,
      useExisting: AUTH_TOKEN_VERIFIER,
    },
    AuthGuard,
    AuthorizationService,
    AuthorizationGuard,
  ],
  exports: [AuthGuard, AuthTokenVerifier, AuthorizationGuard, AuthorizationService],
})
export class AuthModule {}
