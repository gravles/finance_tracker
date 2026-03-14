import { Outlet, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Repeat,
  Target,
  Upload,
  MessageSquare,
  TrendingUp,
  LogOut,
  DollarSign,
  PieChart,
  BarChart3,
  LineChart,
  Wand2,
  CalendarClock,
  Landmark,
  Tags,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

interface NavItem { to: string; icon: typeof LayoutDashboard; label: string }
interface NavSection { title?: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/transactions',  icon: ArrowLeftRight,  label: 'Transactions' },
      { to: '/spending',      icon: PieChart,        label: 'Spending' },
      { to: '/budget',        icon: BarChart3,       label: 'Budget' },
    ],
  },
  {
    title: 'Planning',
    items: [
      { to: '/income',        icon: DollarSign,      label: 'Income' },
      { to: '/subscriptions', icon: Repeat,          label: 'Subscriptions' },
      { to: '/recurring',     icon: CalendarClock,   label: 'Fixed Bills' },
      { to: '/projections',   icon: LineChart,       label: 'Projections' },
      { to: '/goals',         icon: Target,          label: 'Goals' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { to: '/accounts',      icon: Landmark,        label: 'Accounts' },
      { to: '/categories',    icon: Tags,            label: 'Categories' },
      { to: '/rules',         icon: Wand2,           label: 'Rules' },
      { to: '/upload',        icon: Upload,          label: 'Import' },
      { to: '/chat',          icon: MessageSquare,   label: 'Ask Claude' },
    ],
  },
]

export default function AppLayout() {
  const { signOut, user } = useAuth()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-800 flex items-center gap-2.5">
          <TrendingUp className="text-indigo-400" size={20} />
          <span className="font-semibold text-white">Finance</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si}>
              {section.title && (
                <div className="text-[10px] font-medium text-gray-600 uppercase tracking-wider px-3 pt-4 pb-1">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn('nav-link', isActive && 'nav-link-active')
                    }
                  >
                    <Icon size={17} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-gray-800 space-y-1">
          <div className="text-xs text-gray-600 px-1 truncate">{user?.email}</div>
          <button
            onClick={signOut}
            className="nav-link w-full text-gray-500 hover:text-red-400"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
