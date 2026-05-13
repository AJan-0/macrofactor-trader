import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Dashboard from './pages/Dashboard'
import { I18nProvider } from './i18n/I18nProvider'
import { ThemeProvider } from './components/providers/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <Dashboard />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
