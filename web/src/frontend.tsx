import { createRoot } from 'react-dom/client'
import './analytics'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('app')!).render(<App />)
