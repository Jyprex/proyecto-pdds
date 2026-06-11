import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import NumericExperimentDashboard from './experiment/NumericExperimentDashboard.jsx'
import { SelectionBridgeProvider } from './hooks/useSelectionBridge.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SelectionBridgeProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/experiment" element={<NumericExperimentDashboard />} />
        </Routes>
      </SelectionBridgeProvider>
    </BrowserRouter>
  </StrictMode>,
)

