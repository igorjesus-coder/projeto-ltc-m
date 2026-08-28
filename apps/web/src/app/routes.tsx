import type { ReactNode } from 'react';

import { HomePage } from '../routes/HomePage';
import { NotFoundPage } from '../routes/NotFoundPage';

export type AppRoute = 'home' | 'not-found';

export interface NavigationItem {
  readonly route: Exclude<AppRoute, 'not-found'>;
  readonly label: string;
  readonly href: string;
}

export const APP_NAVIGATION: readonly NavigationItem[] = Object.freeze([
  { route: 'home', label: 'Início', href: '/' },
]);

export interface ResolvedRoute {
  readonly id: AppRoute;
  readonly content: ReactNode;
  readonly protected: boolean;
}

function normalizePathname(pathname: string) {
  const path = pathname.trim().split(/[?#]/u, 1)[0] ?? '/';
  if (path === '/') return path;
  return path.replace(/\/+$/u, '') || '/';
}

export function resolveRoute(pathname: string): ResolvedRoute {
  if (normalizePathname(pathname) === '/') {
    return { id: 'home', content: <HomePage />, protected: true };
  }

  return { id: 'not-found', content: <NotFoundPage />, protected: false };
}
