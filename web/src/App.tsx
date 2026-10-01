import { Callout } from './components/ui'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { HOME } from './components/shell/nav'
import { PwaUpdater } from './components/Pwa'
import { Splash } from './components/Splash'
import { Toaster } from './components/ui'
import type { Role } from '@core/types'
import * as Dispatcher from './pages/dispatcher'
import * as Driver from './pages/driver'
import * as Loader from './pages/loader'
import { Landing } from './pages/public/Landing'
import { Login } from './pages/public/Login'
import { NotFound } from './pages/shared/NotFound'
import { Profile } from './pages/shared/Profile'
import { SyncCenter } from './pages/shared/SyncCenter'
import * as Store from './pages/store'
import { FRAME, PREVIEW, useRuntimeBindings, useSession, useOps } from './store'

function RequireRole({ role }: { role?: Role }) {
  const user = useSession((s) => s.user)
  const ready = useSession((s) => s.ready)
  const data = useOps((s) => s.data)
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to={HOME[user.role]} replace />
  if (!ready) return <div className="p-8"><Callout title="Connecting to your workspace">Waiting for the server. Check your connection if this takes longer than expected.</Callout></div>
  if (role === 'STORE_MANAGER' && !data.outlets.some((o) => o.id === user.assignedOutlet)) return <Callout title="Outlet assignment required">Ask your administrator to import your outlet and assign it to your account.</Callout>
  return <Outlet />
}

export default function App() {
  useRuntimeBindings()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route element={<RequireRole />}>
          <Route element={<AppShell />}>
            <Route path="/profile" element={<Profile />} />

            <Route element={<RequireRole role="DISPATCHER" />}>
              <Route path="/dispatcher" element={<Dispatcher.Dashboard />} />
              <Route path="/dispatcher/dashboard" element={<Navigate to="/dispatcher" replace />} />
              <Route path="/dispatcher/orders" element={<Dispatcher.Orders />} />
              <Route path="/dispatcher/planning" element={<Dispatcher.Planning />} />
              <Route path="/dispatcher/routes" element={<Dispatcher.RoutesPage />} />
              <Route path="/dispatcher/routes/:tripId" element={<Dispatcher.RouteDetail />} />
              <Route path="/dispatcher/vehicles" element={<Dispatcher.Vehicles />} />
              <Route path="/dispatcher/vehicles/:id" element={<Dispatcher.VehicleDetail />} />
              <Route path="/dispatcher/outlets" element={<Dispatcher.Outlets />} />
              <Route path="/dispatcher/live" element={<Dispatcher.Live />} />
              <Route path="/dispatcher/issues" element={<Dispatcher.Issues />} />
              <Route path="/dispatcher/issues/:id" element={<Dispatcher.IssueDetail />} />
              <Route path="/dispatcher/deferred" element={<Dispatcher.Deferred />} />
              <Route path="/dispatcher/capacity" element={<Dispatcher.Capacity />} />
              <Route path="/dispatcher/simulator" element={<Dispatcher.Simulator />} />
              <Route path="/dispatcher/history" element={<Dispatcher.History />} />
            </Route>

            <Route element={<RequireRole role="LOADER" />}>
              <Route path="/loader" element={<Loader.Dashboard />} />
              <Route path="/loader/trips" element={<Loader.Trips />} />
              <Route path="/loader/load/:tripId" element={<Loader.Load />} />
              <Route path="/loader/issues" element={<Loader.Issues />} />
              <Route path="/loader/history" element={<Loader.History />} />
              <Route path="/loader/sync" element={<SyncCenter />} />
            </Route>

            <Route element={<RequireRole role="DRIVER" />}>
              <Route path="/driver" element={<Driver.Today />} />
              <Route path="/driver/today" element={<Navigate to="/driver" replace />} />
              <Route path="/driver/route" element={<Driver.RouteView />} />
              <Route path="/driver/stop/:orderId" element={<Driver.Stop />} />
              <Route path="/driver/reconcile" element={<Driver.Reconcile />} />
              <Route path="/driver/issues" element={<Driver.Issues />} />
              <Route path="/driver/sync" element={<SyncCenter />} />
              <Route path="/driver/history" element={<Driver.History />} />
            </Route>

            <Route element={<RequireRole role="STORE_MANAGER" />}>
              <Route path="/store" element={<Store.Dashboard />} />
              <Route path="/store/dashboard" element={<Navigate to="/store" replace />} />
              <Route path="/store/orders" element={<Store.Orders />} />
              <Route path="/store/orders/new" element={<Store.NewOrder />} />
              <Route path="/store/orders/:id" element={<Store.OrderDetail />} />
              <Route path="/store/deliveries" element={<Store.Deliveries />} />
              <Route path="/store/issues" element={<Store.Issues />} />
              <Route path="/store/history" element={<Store.History />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
      {!FRAME && <Toaster />}
      {!FRAME && !PREVIEW && <PwaUpdater />}
      {!FRAME && !PREVIEW && <Splash />}
    </BrowserRouter>
  )
}
