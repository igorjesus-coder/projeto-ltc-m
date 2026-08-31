import type { ReactNode } from 'react';

import { HomePage } from '../routes/HomePage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { ProjectDetailPage } from '../routes/ProjectDetailPage';
import { ProjectsPage } from '../routes/ProjectsPage';
import { ProjectFormPage } from '../routes/ProjectFormPage';

export type AppRoute =
  'home' | 'projects' | 'project-detail' | 'project-new' | 'project-edit' | 'not-found';

export interface NavigationItem {
  readonly route: Exclude<AppRoute, 'not-found' | 'project-detail'>;
  readonly label: string;
  readonly href: string;
}

export const APP_NAVIGATION: readonly NavigationItem[] = Object.freeze([
  { route: 'home', label: 'Início', href: '/' },
  { route: 'projects', label: 'Projetos', href: '/projects' },
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

export function resolveRoute(pathname: string, search = ''): ResolvedRoute {
  const normalized = normalizePathname(pathname);
  const embeddedQuery = pathname.includes('?')
    ? `?${pathname.split('?')[1]?.split('#')[0] ?? ''}`
    : '';
  const routeSearch = search || embeddedQuery;
  if (normalized === '/') {
    return { id: 'home', content: <HomePage />, protected: true };
  }
  if (normalized === '/projects') {
    return { id: 'projects', content: <ProjectsPage search={routeSearch} />, protected: true };
  }
  if (normalized === '/projects/new') {
    return {
      id: 'project-new',
      content: <ProjectFormPage mode="create" search={routeSearch} />,
      protected: true,
    };
  }
  const detailMatch = /^\/projects\/([^/]+)$/u.exec(normalized);
  if (detailMatch?.[1]) {
    return {
      id: 'project-detail',
      content: <ProjectDetailPage projectId={detailMatch[1]} search={routeSearch} />,
      protected: true,
    };
  }
  const editMatch = /^\/projects\/([^/]+)\/edit$/u.exec(normalized);
  if (editMatch?.[1]) {
    return {
      id: 'project-edit',
      content: <ProjectFormPage mode="edit" projectId={editMatch[1]} search={routeSearch} />,
      protected: true,
    };
  }

  return { id: 'not-found', content: <NotFoundPage />, protected: false };
}
