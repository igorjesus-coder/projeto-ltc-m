import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('identifica o workspace LTC-M e seu estado inicial', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('LTC-M');
    expect(html).toContain('Base local pronta');
  });
});
