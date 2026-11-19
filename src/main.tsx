import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/*
 * Remove account data written by the pre-API build. Those values included
 * password hashes and must not linger in any browser that used the old version.
 */
for (const key of ['envis.session', 'envis.accounts.v1', 'envis.accounts.seed', 'envis.activity.v1']) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage may be disabled */
  }
}

/* Clickjacking stopgap: the host cannot set frame-ancestors on GitHub Pages. */
try {
  if (window.top && window.top !== window.self) {
    window.top.location.href = window.self.location.href;
  }
} catch {
  /* cross-origin parent: nothing else we can do from script */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
