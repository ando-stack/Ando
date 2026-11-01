import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { renderizar } from './canvas/refs';
import { useEditor } from './store';
import './index.css';

// Gancho mínimo para las pruebas automáticas (comparar la reconstrucción con el original)
(window as unknown as { estudio: unknown }).estudio = {
  renderizar: () => renderizar(useEditor.getState().doc).toDataURL('image/png'),
  doc: () => useEditor.getState().doc,
  vista: () => ({ zoom: useEditor.getState().zoom, pan: useEditor.getState().pan }),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
