import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import StatsApp from './components/StatsApp'
import './assets/main.css'

const isStats = window.location.hash === '#stats'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStats ? <StatsApp /> : <App />}
  </StrictMode>
)
