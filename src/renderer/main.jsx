import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useApp } from './state/store'
import * as controller from './players/controller'
import './styles.css'

// Internal handles for diagnostics/automation (local app; safe to expose).
window.__songseekStore = useApp
window.__songseekCtrl = controller

createRoot(document.getElementById('root')).render(<App />)
