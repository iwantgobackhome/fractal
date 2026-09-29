import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/source-serif-4';
import './design/tokens.css';
import './styles.css';
import './design/shell.css';
import App from './App';

const root = document.getElementById('root');
if (root === null) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
