import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Elemento raiz não encontrado.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <App pathname={window.location.pathname} />
    </AppErrorBoundary>
  </StrictMode>,
);
