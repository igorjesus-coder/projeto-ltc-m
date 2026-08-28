import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

import type { AuthConfig } from '../config/api-config.js';

export interface AuthenticatedIdentity {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: string | readonly string[];
}

export interface TokenVerifier {
  verifyAuthorizationHeader(header: string | undefined): Promise<AuthenticatedIdentity>;
}

function bearerToken(header: string | undefined): string {
  if (!header) throw new Error('P020_AUTHORIZATION_MISSING');
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  if (!match?.[1]) throw new Error('P020_AUTHORIZATION_INVALID');
  return match[1];
}

function readIdentity(payload: JWTPayload): AuthenticatedIdentity {
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('P020_JWT_SUBJECT_MISSING');
  }
  if (typeof payload.iss !== 'string' || !payload.iss.trim()) {
    throw new Error('P020_JWT_ISSUER_MISSING');
  }
  if (
    typeof payload.aud !== 'string' &&
    !(Array.isArray(payload.aud) && payload.aud.every((item) => typeof item === 'string'))
  ) {
    throw new Error('P020_JWT_AUDIENCE_MISSING');
  }
  return Object.freeze({ subject: payload.sub, issuer: payload.iss, audience: payload.aud });
}

export class AuthTokenVerifier implements TokenVerifier {
  constructor(
    private readonly config: AuthConfig,
    private readonly keySet: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUri)),
  ) {}

  async verifyAuthorizationHeader(header: string | undefined): Promise<AuthenticatedIdentity> {
    const token = bearerToken(header);
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        algorithms: [...this.config.allowedAlgorithms],
        issuer: this.config.issuerBaseUrl,
        audience: this.config.audience,
      });
      return readIdentity(payload);
    } catch {
      throw new Error('P020_JWT_INVALID');
    }
  }
}
