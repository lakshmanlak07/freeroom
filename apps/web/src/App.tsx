import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { RouteError } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RoomPage } from './pages/RoomPage';
import { SearchPage } from './pages/SearchPage';
import { ComingSoon, NotFoundPage } from './pages/SimplePages';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/register', element: <RegisterPage />, errorElement: <RouteError /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <SearchPage /> },
      { path: 'rooms/:roomId', element: <RoomPage /> },
      { path: 'map', element: <ComingSoon title="Campus map" /> },
      { path: 'me/reservations', element: <ComingSoon title="My reservations" /> },
      { path: 'notifications', element: <ComingSoon title="Notifications" /> },
      { path: 'demo', element: <ComingSoon title="Demo controls" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
