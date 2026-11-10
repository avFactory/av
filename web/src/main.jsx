import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import InstallApp from './components/InstallApp.jsx';
import { AppErrorBoundary } from './components/ErrorBoundary.jsx';
import { AuthProvider } from './auth.jsx';
import { LiveProvider, ToastProvider } from './ui.jsx';
import 'bootstrap/dist/css/bootstrap.rtl.min.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <LiveProvider>
            <AppErrorBoundary>
              <App />
              <InstallApp />
            </AppErrorBoundary>
          </LiveProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
