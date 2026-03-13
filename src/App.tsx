import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import TransactionsPage from '@/pages/TransactionsPage'
import SubscriptionsPage from '@/pages/SubscriptionsPage'
import GoalsPage from '@/pages/GoalsPage'
import UploadPage from '@/pages/UploadPage'
import ChatPage from '@/pages/ChatPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"      element={<DashboardPage />} />
        <Route path="/transactions"   element={<TransactionsPage />} />
        <Route path="/subscriptions"  element={<SubscriptionsPage />} />
        <Route path="/goals"          element={<GoalsPage />} />
        <Route path="/upload"         element={<UploadPage />} />
        <Route path="/chat"           element={<ChatPage />} />
      </Route>
    </Routes>
  )
}
