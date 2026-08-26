import type { ReactNode } from 'react';

import { HomePage } from '../routes/HomePage';
import { NotFoundPage } from '../routes/NotFoundPage';

export type AppRoute = 'home' | 'not-found';

export interface ResolvedRoute {
  readonly id: AppRoute;
  readonly content: ReactNode;
}

function normalizePathname(pathname: string) {
  const path = pathname.trim().split(/[?#]/u, 1)[0] ?? '/';
  if (path === '/') return path;
  return path.replace(/\/+$/u, '') || '/';
}

export function resolveRoute(pathname: string): ResolvedRoute {
  if (normalizePathname(pathname) === '/') {
    return { id: 'home', content: <HomePage /> };
  }

  return { id: 'not-found', content: <NotFoundPage /> };
}
