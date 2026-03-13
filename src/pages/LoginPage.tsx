import { useState } from 'react'
import { TrendingUp, Mail, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // After clicking the link, redirect back to the app
        emailRedirectTo: window.location.origin + '/dashboard',
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl">
            <TrendingUp className="text-white" size={22} />
          </div>
          <h1 className="text-2xl font-semibold text-white">Finance Dashboard</h1>
          <p className="text-sm text-gray-400">Personal finance tracker · Ottawa</p>
        </div>

        {sent ? (
          <div className="card text-center space-y-3">
            <CheckCircle2 className="text-green-400 mx-auto" size={32} />
            <div>
              <p className="font-medium text-white">Check your email</p>
              <p className="text-sm text-gray-400 mt-1">
                Sent a magic link to <span className="text-white">{email}</span>
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Tap the link in your email to sign in — no password needed.
            </p>
            <button
              onClick={() => setSent(false)}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="card space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-gray-300">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {loading ? 'Sending…' : 'Send magic link'}
            </button>

            <p className="text-xs text-center text-gray-500">
              You'll receive an email with a sign-in link. No password required.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
