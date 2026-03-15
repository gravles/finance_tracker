import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STARTER_PROMPTS = [
  'How much did I spend on groceries last month vs the month before?',
  'What are my top 5 merchants by total spend this year?',
  'Am I on track with my budget this month? Where am I over?',
  'Which subscriptions cost the most annually? Any I should review?',
  'What\'s my average monthly savings rate over the last 6 months?',
  'Give me a full financial health summary with action items',
  'How much do I spend on dining out vs cooking at home?',
  'What would my mortgage qualification look like right now?',
]

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return

    const userMsg: Message = { role: 'user', content }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const { reply } = await res.json() as { reply: string }
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry, I couldn't connect to the chat API. Error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Ask Claude</h1>
          <p className="text-sm text-gray-400 mt-1">
            Has access to 12 months of transactions, budgets, goals, subscriptions, and accounts
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
            title="Clear conversation"
          >
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-xl">
              <Bot className="text-indigo-400 flex-shrink-0" size={20} />
              <div className="text-sm text-gray-300">
                <p>I have access to your full financial picture:</p>
                <ul className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                  <li>12 months of transactions, spending by category and merchant</li>
                  <li>Income sources, budgets, goals, subscriptions, fixed bills</li>
                  <li>Account breakdowns, monthly trends, savings rate</li>
                </ul>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STARTER_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="text-left text-sm px-3 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white hover:border-gray-700 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}
            >
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1',
                msg.role === 'user' ? 'bg-indigo-600' : 'bg-gray-800',
              )}>
                {msg.role === 'user'
                  ? <User size={14} className="text-white" />
                  : <Bot size={14} className="text-indigo-400" />
                }
              </div>
              <div className={cn(
                'max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white whitespace-pre-wrap'
                  : 'bg-gray-900 border border-gray-800 text-gray-200',
              )}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-invert prose-sm max-w-none
                    prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
                    prose-headings:mt-3 prose-headings:mb-1.5
                    prose-table:text-xs prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5
                    prose-th:border-gray-700 prose-td:border-gray-800
                    prose-strong:text-white prose-code:text-indigo-300
                    prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-indigo-400" />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
          placeholder="Ask about your finances..."
          disabled={loading}
          className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl transition-colors"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
