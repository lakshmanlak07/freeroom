import { lazy, Suspense } from 'react';
import { Navigate, createBrowserRouter } from 'react-router';
import { Skeleton } from './components/EmptyState';
import { DemoPage } from './pages/DemoPage';
import { LandingPage } from './pages/LandingPage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { NotificationsPage } from './pages/NotificationsPage';

// MapLibre is large: load the map page only when visited.
const MapPage = lazy(() => import('./pages/MapPage'));
// Group invites: public page (works signed out), loaded only when someone opens a link.
const InvitePage = lazy(() => import('./pages/InvitePage'));
import { RequireAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { RouteError } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RoomPage } from './pages/RoomPage';
import { SearchPage } from './pages/SearchPage';
import { NotFoundPage } from './pages/SimplePages';

export const router = createBrowserRouter([
  { path: '/welcome', element: <LandingPage />, errorElement: <RouteError /> },
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/register', element: <RegisterPage />, errorElement: <RouteError /> },
  {
    path: '/i/:token',
    element: (
      <Suspense fallback={<Skeleton className="m-6 h-96" />}>
        <InvitePage />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
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
      {
        path: 'map',
        element: (
          <Suspense fallback={<Skeleton className="m-6 h-96" />}>
            <MapPage />
          </Suspense>
        ),
      },
      { path: 'me', element: <MyReservationsPage /> },
      { path: 'me/reservations', element: <Navigate to="/me" replace /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'demo', element: <DemoPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
