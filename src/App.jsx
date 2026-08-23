import React from 'react'
import GachaAnalyzer from './GachaAnalyzer'
import ErrorBoundary from './components/ErrorBoundary'
import AppStartupGate from './components/app/AppStartupGate'
import { ThemeProvider } from './contexts/ThemeContext'

function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppStartupGate>
          <GachaAnalyzer />
        </AppStartupGate>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
