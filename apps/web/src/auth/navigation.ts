export function getSafeReturnTo(value: string | undefined, origin: string): string {
  if (!value) return '/';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) {
      return '/';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
