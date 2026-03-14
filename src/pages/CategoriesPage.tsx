import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Category } from '@/types'

const emptyForm = {
  name: '',
  parent_id: '',
  color: '#6366f1',
  icon: '',
}

interface CategoryWithChildren extends Category {
  children: Category[]
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => { loadCategories() }, [])

  async function loadCategories() {
    const { data } = await supabase
      .from('categories')
      .select('*')
      .order('name')
    setCategories((data ?? []) as Category[])
    setLoading(false)
  }

  // Build parent/child tree
  const parents = categories.filter(c => !c.parent_id)
  const childMap = new Map<string, Category[]>()
  for (const c of categories.filter(c => c.parent_id)) {
    const arr = childMap.get(c.parent_id!) ?? []
    arr.push(c)
    childMap.set(c.parent_id!, arr)
  }
  const tree: CategoryWithChildren[] = parents.map(p => ({
    ...p,
    children: (childMap.get(p.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }))

  async function handleSave() {
    if (!form.name.trim()) return

    const record = {
      name: form.name.trim(),
      parent_id: form.parent_id || null,
      color: form.color || null,
      icon: form.icon.trim() || null,
    }

    if (editingId) {
      await supabase.from('categories').update(record).eq('id', editingId)
    } else {
      await supabase.from('categories').insert(record)
    }

    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
    await loadCategories()
  }

  async function handleDelete(id: string) {
    // Check if has children
    const children = childMap.get(id) ?? []
    if (children.length > 0) {
      alert('Cannot delete a category that has subcategories. Delete the subcategories first.')
      return
    }
    await supabase.from('categories').delete().eq('id', id)
    await loadCategories()
  }

  function startEdit(c: Category) {
    setEditingId(c.id)
    setShowAdd(true)
    setForm({
      name: c.name,
      parent_id: c.parent_id ?? '',
      color: c.color ?? '#6366f1',
      icon: c.icon ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Categories</h1>
          <p className="text-sm text-gray-400 mt-1">Organize your transactions into categories</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null) }}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Category
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm">
          <div className="stat-label">Parent Categories</div>
          <div className="stat-value text-white mt-1">{parents.length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Subcategories</div>
          <div className="stat-value text-white mt-1">{categories.length - parents.length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Total</div>
          <div className="stat-value text-white mt-1">{categories.length}</div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAdd && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId ? 'Edit Category' : 'New Category'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Groceries"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Parent Category (optional)</label>
              <select
                value={form.parent_id}
                onChange={e => setForm({ ...form, parent_id: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">None (top-level)</option>
                {parents
                  .filter(p => p.id !== editingId) // can't be own parent
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))
                }
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Color</label>
              <input
                type="color"
                value={form.color}
                onChange={e => setForm({ ...form, color: e.target.value })}
                className="h-10 w-full bg-gray-800 border border-gray-700 rounded-lg cursor-pointer"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Icon (emoji, optional)</label>
              <input
                type="text"
                value={form.icon}
                onChange={e => setForm({ ...form, icon: e.target.value })}
                placeholder="e.g. 🛒"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
            >
              <Check size={14} />
              {editingId ? 'Update' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Category Tree */}
      <div className="card p-0 overflow-hidden">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">No categories yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {tree.map(cat => {
              const hasChildren = cat.children.length > 0
              const isExpanded = expanded.has(cat.id)

              return (
                <div key={cat.id}>
                  {/* Parent row */}
                  <div className="flex items-center hover:bg-gray-800/30 transition-colors">
                    <button
                      className="px-3 py-3 text-gray-500"
                      onClick={() => hasChildren && toggleExpand(cat.id)}
                    >
                      {hasChildren ? (
                        isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                      ) : <div className="w-3.5" />}
                    </button>
                    <div className="flex items-center gap-2.5 flex-1 py-3">
                      {cat.color && (
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                      )}
                      {cat.icon && <span className="text-sm">{cat.icon}</span>}
                      <span className="font-medium text-white text-sm">{cat.name}</span>
                      {hasChildren && (
                        <span className="text-xs text-gray-600">{cat.children.length} sub</span>
                      )}
                      {cat.is_system && (
                        <span className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded">system</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 px-4 py-3">
                      <button
                        onClick={() => startEdit(cat)}
                        className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Children */}
                  {isExpanded && cat.children.map(child => (
                    <div key={child.id} className="flex items-center bg-gray-800/20 hover:bg-gray-800/40 transition-colors">
                      <div className="w-10" />
                      <div className="flex items-center gap-2.5 flex-1 py-2.5 pl-4">
                        {child.color && (
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: child.color }} />
                        )}
                        {child.icon && <span className="text-xs">{child.icon}</span>}
                        <span className="text-gray-300 text-sm">{child.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-4 py-2.5">
                        <button
                          onClick={() => startEdit(child)}
                          className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(child.id)}
                          className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
