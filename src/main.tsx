import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root — index.html is out of sync.');

createRoot(root).render(
  <StrictMode>
    <p>signal-desk</p>
  </StrictMode>,
);
