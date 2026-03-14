import { Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from '@/components/AuthGuard'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import TransactionsPage from '@/pages/TransactionsPage'
import SubscriptionsPage from '@/pages/SubscriptionsPage'
import GoalsPage from '@/pages/GoalsPage'
import UploadPage from '@/pages/UploadPage'
import ChatPage from '@/pages/ChatPage'
import IncomeSourcesPage from '@/pages/IncomeSourcesPage'
import BudgetPage from '@/pages/BudgetPage'
import SpendingPage from '@/pages/SpendingPage'
import ProjectionsPage from '@/pages/ProjectionsPage'
import RulesPage from '@/pages/RulesPage'
import RecurringExpensesPage from '@/pages/RecurringExpensesPage'
import AccountsPage from '@/pages/AccountsPage'
import CategoriesPage from '@/pages/CategoriesPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <AuthGuard>
            <AppLayout />
          </AuthGuard>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"      element={<DashboardPage />} />
        <Route path="/transactions"   element={<TransactionsPage />} />
        <Route path="/spending"       element={<SpendingPage />} />
        <Route path="/budget"         element={<BudgetPage />} />
        <Route path="/subscriptions"  element={<SubscriptionsPage />} />
        <Route path="/income"         element={<IncomeSourcesPage />} />
        <Route path="/recurring"      element={<RecurringExpensesPage />} />
        <Route path="/rules"          element={<RulesPage />} />
        <Route path="/projections"    element={<ProjectionsPage />} />
        <Route path="/goals"          element={<GoalsPage />} />
        <Route path="/accounts"       element={<AccountsPage />} />
        <Route path="/categories"     element={<CategoriesPage />} />
        <Route path="/upload"         element={<UploadPage />} />
        <Route path="/chat"           element={<ChatPage />} />
      </Route>
    </Routes>
  )
}
