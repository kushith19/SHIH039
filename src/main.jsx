import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { applyCityModelOverlay } from '@shared/cityContext.js'
import '@shared/tgnnCore.js'
import { loadCityModelClient } from './cityModel/loadCityModel.client.js'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.jsx'

applyCityModelOverlay(loadCityModelClient())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
