import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import test from 'node:test';

import type { AuthConfig } from '../src/config/api-config.js';
import { AuthTokenVerifier } from '../src/auth/token-verifier.js';

const config: AuthConfig = Object.freeze({
  issuerBaseUrl: 'https://tenant.example.auth0.com/',
  jwksUri: 'https://tenant.example.auth0.com/.well-known/jwks.json',
  audience: 'https://api.example.invalid',
  allowedAlgorithms: ['RS256'] as const,
});

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'p020-test-key';
  const keySet = createLocalJWKSet({ keys: [{ ...jwk, kid: jwk.kid, alg: 'RS256', use: 'sig' }] });
  const token = await new SignJWT({ scope: 'read:session' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
    .setSubject('auth0|p020-user')
    .setIssuer(config.issuerBaseUrl)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { keySet, privateKey, token };
}

test('valida bearer JWT com JWKS, issuer, audience, RS256 e subject', async () => {
  const { keySet, token } = await fixture();
  const identity = await new AuthTokenVerifier(config, keySet).verifyAuthorizationHeader(
    `Bearer ${token}`,
  );
  assert.deepEqual(identity, {
    subject: 'auth0|p020-user',
    issuer: config.issuerBaseUrl,
    audience: config.audience,
  });
});

test('rejeita ausência, token malformado, token expirado, issuer e audience inválidos', async () => {
  const { keySet, privateKey } = await fixture();
  const verifier = new AuthTokenVerifier(config, keySet);
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(undefined),
    /P020_AUTHORIZATION_MISSING/u,
  );
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader('Bearer malformed'),
    /P020_JWT_INVALID/u,
  );

  const { privateKey: foreignPrivateKey } = await generateKeyPair('RS256');
  const invalidSignature = await new SignJWT()
    .setProtectedHeader({ alg: 'RS256', kid: 'p020-test-key' })
    .setSubject('auth0|p020-user')
    .setIssuer(config.issuerBaseUrl)
    .setAudience(config.audience)
    .setExpirationTime('5m')
    .sign(foreignPrivateKey);
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${invalidSignature}`),
    /P020_JWT_INVALID/u,
  );

  const { privateKey: invalidAlgorithmKey } = await generateKeyPair('RS384');
  const invalidAlgorithm = await new SignJWT()
    .setProtectedHeader({ alg: 'RS384', kid: 'p020-test-key' })
    .setSubject('auth0|p020-user')
    .setIssuer(config.issuerBaseUrl)
    .setAudience(config.audience)
    .setExpirationTime('5m')
    .sign(invalidAlgorithmKey);
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${invalidAlgorithm}`),
    /P020_JWT_INVALID/u,
  );

  const expired = await new SignJWT()
    .setProtectedHeader({ alg: 'RS256', kid: 'p020-test-key' })
    .setSubject('auth0|p020-user')
    .setIssuer(config.issuerBaseUrl)
    .setAudience(config.audience)
    .setExpirationTime(946684800)
    .sign(privateKey);
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${expired}`),
    /P020_JWT_INVALID/u,
  );

  const wrongIssuer = await new SignJWT()
    .setProtectedHeader({ alg: 'RS256', kid: 'p020-test-key' })
    .setSubject('auth0|p020-user')
    .setIssuer('https://other.example.auth0.com/')
    .setAudience(config.audience)
    .setExpirationTime('5m')
    .sign(privateKey);
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${wrongIssuer}`),
    /P020_JWT_INVALID/u,
  );

  const wrongAudience = await new SignJWT()
    .setProtectedHeader({ alg: 'RS256', kid: 'p020-test-key' })
    .setSubject('auth0|p020-user')
    .setIssuer(config.issuerBaseUrl)
    .setAudience('https://other-api.example.invalid')
    .setExpirationTime('5m')
    .sign(privateKey);
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${wrongAudience}`),
    /P020_JWT_INVALID/u,
  );
});
