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
  readonly code: string | null;

  constructor(status: number, code: string | null = null) {
    super('P021_API_REQUEST_FAILED');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
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
      if (!response.ok) throw await requestError(response);
      return (await response.json()) as T;
    },
    async sendJson<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
      const token = await getAccessToken();
      if (!token.trim()) throw new AuthenticationRequiredError();
      const response = await fetchImpl(new URL(path, `${baseUrl}/`), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (response.status === 401) throw new AuthenticationRequiredError();
      if (response.status === 403) throw new AuthorizationDeniedError();
      if (!response.ok) throw await requestError(response);
      return (await response.json()) as T;
    },
    audience,
  };
}

async function requestError(response: Response): Promise<ApiRequestError> {
  let code: string | null = null;
  try {
    const body = (await response.clone().json()) as { message?: unknown };
    if (typeof body.message === 'string') code = body.message;
  } catch {
    // Error bodies are optional and must never prevent a sanitized status error.
  }
  return new ApiRequestError(response.status, code);
}
