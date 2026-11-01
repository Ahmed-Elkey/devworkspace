import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
// Landing page stylesheet ONLY. Do NOT import design-system.css here:
// its generic tokens/rules override the landing's original design
// (slate colors instead of #111/#232323, light pill instead of the dark nav pill).
import './styles/base.css'

createRoot(document.getElementById('root')).render(<App />)
