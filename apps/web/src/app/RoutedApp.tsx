import { useEffect, useState } from 'react';

import { App } from './App';

export function RoutedApp() {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const updateLocation = () =>
      setLocation({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', updateLocation);
    return () => window.removeEventListener('popstate', updateLocation);
  }, []);

  return <App pathname={location.pathname} search={location.search} />;
}
