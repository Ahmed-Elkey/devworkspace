import React from 'react'
import { createRoot } from 'react-dom/client'
import AppRouter from './Router.jsx'

// One bootstrap for every page document. Each frontend/<path>.html still owns
// its <head> (title, meta, icon); what changes is that they all mount the same
// SPA router, so navigation inside the app no longer reloads the document.
createRoot(document.getElementById('root')).render(<AppRouter />)
