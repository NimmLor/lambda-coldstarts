/**
 * What build.ts bundles for Bun to render index.html's dashboard with: the placeholder layout, as
 * of `now`, which frontend.tsx then hydrates.
 */
import { renderToString } from 'react-dom/server'
import { App } from './App'

export const prerender = (now: number) => renderToString(<App now={now} />)
