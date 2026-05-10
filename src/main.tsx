import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// Note: intentionally NOT wrapping in <StrictMode> — its dev-only double mount/unmount would boot
// and tear down the engine Web Worker twice on every change, which is noisy and slow during dev.
createRoot(container).render(<App />);
