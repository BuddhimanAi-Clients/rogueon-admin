/* oxlint-disable no-unused-expressions -- Compact query-string setters use conditional expressions. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, ScanLine, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import type { AdminPosSale, Paginated } from '../types/admin'

export function PosSalesPage() {
  const [params, setParams] = useSearchParams()
  const [saleNumber, setSaleNumber] = useState(params.get('saleNumber') ?? '')
  const query = new URLSearchParams({ page: '1', limit: '40', ...Object.fromEntries(params) })
  const sales = useQuery({ queryKey: ['admin-pos-sales', params.toString()], queryFn: () => apiRequest<Paginated<AdminPosSale>>(`/api/v1/admin/pos-sales?${query}`) })
  function filter(key: string, value: string) { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next) }
  return <main className="admin-page"><header className="admin-page-head"><div><p>IN-STORE AUDIT</p><h1>POS SALES</h1><span>Read every live and synchronized counter sale, including review flags.</span></div><button className="admin-secondary" onClick={() => filter('needsReview', params.get('needsReview') === 'true' ? '' : 'true')}><AlertTriangle/>{params.get('needsReview') === 'true' ? 'View all sales' : 'Needs review'}</button></header><section className="admin-toolbar"><form onSubmit={(event) => { event.preventDefault(); filter('saleNumber', saleNumber.trim()) }}><Search/><input value={saleNumber} onChange={(event) => setSaleNumber(event.target.value)} placeholder="Search sale number"/><button>Search</button></form><select value={params.get('paymentMethod') ?? ''} onChange={(event) => filter('paymentMethod', event.target.value)}><option value="">All payments</option><option value="cash">Cash</option><option value="qr">QR</option></select></section>{sales.isPending ? <div className="admin-loading">Loading POS ledger…</div> : sales.data?.data.length ? <div className="admin-data-table pos-sales-table"><div className="admin-table-head"><span>Sale</span><span>Cashier</span><span>Payment</span><span>Items</span><span>Total</span><span>Review</span><span/></div>{sales.data.data.map((sale) => <Link to={`/pos-sales/${sale.id}`} key={sale.id}><div><strong>{sale.saleNumber}</strong><small>{new Date(sale.createdAt).toLocaleString()}{sale.membershipDiscountWaived ? ' · member discount removed' : ''}</small></div><div><strong>{sale.cashierName}</strong><small>{sale.staff.email}</small></div><em className="admin-status neutral">{sale.paymentMethod}</em><span>{sale._count?.items ?? 0}</span><strong>Rs. {Number(sale.total).toLocaleString()}</strong>{sale.needsReview ? <em className="admin-status warning">review</em> : <em className="admin-status active">clear</em>}<ArrowRight/></Link>)}</div> : <div className="admin-empty"><ScanLine/><h2>NO POS SALES FOUND</h2></div>}</main>
}
