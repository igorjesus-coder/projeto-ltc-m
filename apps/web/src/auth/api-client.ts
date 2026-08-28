export class AuthenticationRequiredError extends Error {
  constructor() {
    super('P020_AUTHENTICATION_REQUIRED');
    this.name = 'AuthenticationRequiredError';
  }
}

export class AuthorizationDeniedError extends Error {
  constructor() {
    super('P021_AUTHORIZATION_DENIED');
    this.name = 'AuthorizationDeniedError';
  }
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('P021_API_REQUEST_FAILED');
    this.name = 'ApiRequestError';
    this.status = status;
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
      if (response.status === 403) throw new AuthorizationDeniedError();
      return response;
    },
    async getJson<T>(path: string): Promise<T> {
      const response = await this.get(path);
      if (!response.ok) throw new ApiRequestError(response.status);
      return (await response.json()) as T;
    },
    audience,
  };
}
