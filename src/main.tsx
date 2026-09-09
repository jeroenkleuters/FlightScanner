import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// MapLibre's stylesheet must come before ./index.css so project styles win on
// any conflict. It is imported here, once, and nowhere else.
import 'maplibre-gl/dist/maplibre-gl.css'
// Imported for its side effect: configuration is validated once at startup, so
// a misconfigured environment fails immediately instead of deep inside a
// feature. See src/config.ts.
import './config'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
