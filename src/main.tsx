import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthGate } from './components/AuthGate'
import './styles/global.css'
import { playStartupFanfare } from './lib/startupFanfare'
import { installBuildWatcher } from './lib/buildVersion'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
)

// Subtle startup flourish — first 6 s of Fanfares.mp3, once per open.
// (Module-scope guard inside makes StrictMode's double-invoke safe.)
playStartupFanfare()

// Self-update: compare the server's /version.json with this bundle's hash at start and on every return to the tab;
// on a mismatch update the SW and reload once (loop-guarded). Replaces the manual "Unregister SW + clear cache".
installBuildWatcher(__BUILD_HASH__)
