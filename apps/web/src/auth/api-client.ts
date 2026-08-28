export class AuthenticationRequiredError extends Error {
  constructor() {
    super('P020_AUTHENTICATION_REQUIRED');
    this.name = 'AuthenticationRequiredError';
  }
}

interface AuthenticatedApiClientOptions {
  readonly baseUrl: string;
  readonly audience: string;
  readonly getAccessToken: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
}

export function createAuthenticatedApiClient({
  baseUrl,
  audience,
  getAccessToken,
  fetchImpl = fetch,
}: AuthenticatedApiClientOptions) {
  return {
    async get(path: string): Promise<Response> {
      const token = await getAccessToken();
      if (!token.trim()) throw new AuthenticationRequiredError();

      const headers = new Headers({ Authorization: `Bearer ${token}` });
      const response = await fetchImpl(new URL(path, `${baseUrl}/`), { headers });
      if (response.status === 401) throw new AuthenticationRequiredError();
      return response;
    },
    audience,
  };
}
