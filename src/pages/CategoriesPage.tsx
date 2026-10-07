import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderTree, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiRequest } from '../lib/api'
import { followSlug } from '../lib/catalog'
import type { Category } from '../types/admin'

const emptyForm = { name: '', slug: '', parentId: '' }

export function CategoriesPage() {
  const client = useQueryClient()
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Category | null>(null)
  const [image, setImage] = useState<File | null>(null)
  const uploadImage = (id: string, file: File) => { const body = new FormData(); body.append('image', file); return apiRequest<{ data: Category }>(`/api/v1/admin/categories/${id}/image`, { method: 'POST', body }) }
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => (await apiRequest<{ data: Category[] }>('/api/v1/admin/categories')).data,
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['admin-categories'] })
  const create = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<{ data: Category }>('/api/v1/admin/categories', { method: 'POST', body: JSON.stringify({ ...form, parentId: form.parentId || null }) })
      if (image) await uploadImage(created.data.id, image)
      return created
    },
    onSuccess: () => { refresh(); setForm(emptyForm); setImage(null); toast.success('Category created') },
    onError: (error) => toast.error(error.message),
  })
  const update = useMutation({
    mutationFn: () => apiRequest(`/api/v1/admin/categories/${editing?.id}`, { method: 'PATCH', body: JSON.stringify({ name: editing?.name, slug: editing?.slug, parentId: editing?.parentId }) }),
    onSuccess: () => { refresh(); setEditing(null); toast.success('Category updated') },
    onError: (error) => toast.error(error.message),
  })
  const changeImage = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadImage(id, file),
    onSuccess: ({ data }) => { refresh(); setEditing((current) => current && current.id === data.id ? { ...current, imageUrl: data.imageUrl } : current); toast.success('Category image updated') },
    onError: (error) => toast.error(error.message),
  })
  const removeImage = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/v1/admin/categories/${id}/image`, { method: 'DELETE' }),
    onSuccess: (_, id) => { refresh(); setEditing((current) => current && current.id === id ? { ...current, imageUrl: null } : current); toast.success('Category image removed') },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/v1/admin/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); toast.success('Category deleted') },
    onError: (error) => toast.error(error.message),
  })
  const flat = categories.data?.flatMap((category) => [category, ...category.children]) ?? []
  return <main className="admin-page"><header className="admin-page-head"><div><p>CATALOGUE STRUCTURE</p><h1>CATEGORIES</h1><span>Organize storefront navigation into parent and child collections.</span></div></header><div className="admin-two-column categories-layout"><section className="admin-panel"><header><h2>Create category</h2><span>Slug is used in storefront URLs.</span></header><form className="admin-form single" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><label><span>Name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value, slug: followSlug(form.name, form.slug, event.target.value) })}/></label><label><span>Slug (web address, fills in by itself)</span><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })}/></label><label><span>Parent category</span><select value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}><option value="">Top-level category</option>{categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>Category image (optional)</span><input key={image ? 'chosen' : 'empty'} type="file" accept="image/png,.png" onChange={(event) => setImage(event.target.files?.[0] ?? null)}/><small>A model wearing this category, upright (4:5). PNG only, up to 8 MB. Shown on the storefront homepage.</small></label><button className="admin-primary" disabled={create.isPending}><Plus/>{create.isPending ? 'Creating…' : 'Create category'}</button></form></section><section className="admin-panel"><header><h2>Category tree</h2><span>{flat.length} total categories</span></header>{categories.isPending ? <div className="admin-loading">Loading categories…</div> : categories.data?.length ? <div className="category-tree">{categories.data.map((category) => <article key={category.id}><CategoryRow category={category} onEdit={setEditing} onDelete={(id) => remove.mutate(id)}/>{category.children.map((child) => <div className="category-child" key={child.id}><CategoryRow category={child} onEdit={setEditing} onDelete={(id) => remove.mutate(id)}/></div>)}</article>)}</div> : <div className="admin-empty compact"><FolderTree/><h2>NO CATEGORIES</h2></div>}</section></div>{editing && <div className="admin-modal-backdrop"><section className="admin-modal small"><header><div><p>EDIT CATEGORY</p><h2>{editing.name}</h2></div><button onClick={() => setEditing(null)}><X/></button></header><form className="admin-form single" onSubmit={(event) => { event.preventDefault(); update.mutate() }}><label><span>Name</span><input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })}/></label><label><span>Slug</span><input required value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })}/></label><label><span>Parent</span><select value={editing.parentId ?? ''} onChange={(event) => setEditing({ ...editing, parentId: event.target.value || null })}><option value="">Top-level category</option>{categories.data?.filter((category) => category.id !== editing.id).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><div className="category-image-field"><span>Category image</span><div>{editing.imageUrl ? <img src={editing.imageUrl} alt={`${editing.name} category`}/> : <div className="category-image-empty"><ImagePlus/>No image</div>}<p><label className="admin-secondary category-image-pick"><input type="file" accept="image/png,.png" disabled={changeImage.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) changeImage.mutate({ id: editing.id, file }); event.target.value = '' }}/>{changeImage.isPending ? 'Uploading…' : editing.imageUrl ? 'Replace image' : 'Upload image'}</label>{editing.imageUrl && <button type="button" className="admin-danger" disabled={removeImage.isPending} onClick={() => removeImage.mutate(editing.id)}>Remove</button>}<small>Upright photo (4:5) of a model wearing this category. Saved immediately.</small></p></div></div><footer><button type="button" className="admin-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="admin-primary" disabled={update.isPending}>Save changes</button></footer></form></section></div>}</main>
}

function CategoryRow({ category, onEdit, onDelete }: { category: Category; onEdit: (category: Category) => void; onDelete: (id: string) => void }) {
  return <div className="category-row"><div className="category-row-main">{category.imageUrl ? <img src={category.imageUrl} alt=""/> : <span className="category-thumb-empty" title="No image"><ImagePlus/></span>}<p><strong>{category.name}</strong><small>/{category.slug}</small></p></div><span>{category.children.length} children</span><button aria-label={`Edit ${category.name}`} onClick={() => onEdit(category)}><Pencil/></button><button className="danger-icon" aria-label={`Delete ${category.name}`} onClick={() => onDelete(category.id)}><Trash2/></button></div>
}
