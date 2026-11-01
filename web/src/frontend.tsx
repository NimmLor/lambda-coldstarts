import { createRoot, hydrateRoot } from 'react-dom/client'
import './analytics'
import { App } from './App'
import './index.css'

const root = document.getElementById('app')!
// build.ts prerenders the dashboard into index.html as of data-now; dev.ts serves it empty.
const built = root.dataset.now
if (built) hydrateRoot(root, <App now={Number(built)} />)
else createRoot(root).render(<App now={Date.now()} />)
