import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, QrCode, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { apiRequest } from '../lib/api'

type QrConfiguration = { id: string; publicUrl: string; providerName: string | null; accountName: string | null; accountIdentifier: string | null; instructions: string | null; active: boolean; createdAt: string }

export function PaymentSettingsPage() {
  const client = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<File | null>(null)
  const [form, setForm] = useState({ providerName: '', accountName: '', accountIdentifier: '', instructions: '' })
  const configurations = useQuery({ queryKey: ['payment-qr-configurations'], queryFn: async () => (await apiRequest<{ data: QrConfiguration[] }>('/api/v1/admin/payment-settings/qr-configurations')).data })
  const upload = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Choose a QR image first')
      const body = new FormData()
      body.append('qr', selected)
      Object.entries(form).forEach(([key, value]) => body.append(key, value))
      return apiRequest('/api/v1/admin/payment-settings/qr-configurations', { method: 'POST', body })
    },
    onSuccess: () => { toast.success('New QR configuration activated'); setSelected(null); if (file.current) file.current.value = ''; client.invalidateQueries({ queryKey: ['payment-qr-configurations'] }) },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save QR configuration'),
  })
  const activate = useMutation({ mutationFn: (id: string) => apiRequest(`/api/v1/admin/payment-settings/qr-configurations/${id}/activate`, { method: 'POST' }), onSuccess: () => { toast.success('QR configuration activated'); client.invalidateQueries({ queryKey: ['payment-qr-configurations'] }) }, onError: (error) => toast.error(error.message) })

  return <main className="admin-page"><header className="admin-page-head"><div><p>PAYMENT CONTROL</p><h1>QR CONFIGURATION</h1><span>New website checkouts use the single active QR configuration. Existing orders retain their original instructions.</span></div></header><div className="admin-two-column"><section className="admin-panel"><header><h2>Activate a new QR</h2><QrCode /></header><form className="admin-form" onSubmit={(event) => { event.preventDefault(); upload.mutate() }}><label className="wide"><span>QR image</span><input ref={file} required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSelected(event.target.files?.[0] ?? null)} />{selected && <small>{selected.name}</small>}</label><label><span>Provider</span><input required value={form.providerName} onChange={(event) => setForm({ ...form, providerName: event.target.value })} placeholder="eSewa" /></label><label><span>Account name</span><input required value={form.accountName} onChange={(event) => setForm({ ...form, accountName: event.target.value })} /></label><label className="wide"><span>Account identifier</span><input required value={form.accountIdentifier} onChange={(event) => setForm({ ...form, accountIdentifier: event.target.value })} /></label><label className="wide"><span>Customer instructions</span><textarea required rows={4} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label><footer><button className="admin-primary" disabled={!selected || upload.isPending}><Upload />{upload.isPending ? 'Uploading…' : 'Upload and activate'}</button></footer></form></section><section className="admin-panel"><header><h2>Configuration history</h2></header>{configurations.isPending ? <p>Loading configurations…</p> : configurations.data?.length ? <div className="payment-review">{configurations.data.map((configuration) => <article key={configuration.id}><img src={configuration.publicUrl} alt={`${configuration.providerName ?? 'Payment'} QR`} /><p><strong>{configuration.providerName ?? 'QR payment'}</strong><span>{configuration.accountName} · {configuration.accountIdentifier}</span><small>{new Date(configuration.createdAt).toLocaleString()}</small></p>{configuration.active ? <em className="admin-status active">Active</em> : <button className="admin-secondary" disabled={activate.isPending} onClick={() => activate.mutate(configuration.id)}><Check />Activate</button>}</article>)}</div> : <div className="admin-empty"><QrCode /><h2>NO QR CONFIGURED</h2><p>Upload the first QR image to enable website checkout.</p></div>}</section></div></main>
}
