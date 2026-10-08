import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { PrefsProvider } from './shared/prefs';
import { AuthProvider } from './shared/auth';
import { StationApp } from './station/StationApp';
import { PortalApp } from './portal/PortalApp';

/**
 * Routes:
 *  /station/*  student station (kiosk). `?mode=local` = Phase 0 prototype, no backend.
 *  /portal/*   authoring, review, proctor console, reports, admin.
 */
export function App() {
  return (
    <PrefsProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/station/*" element={<StationApp />} />
            <Route path="/portal/*" element={<PortalApp />} />
            <Route path="*" element={<Navigate to="/portal" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </PrefsProvider>
  );
}
