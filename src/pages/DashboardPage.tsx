import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Boxes, CircleDollarSign, ClipboardList, ScanLine, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import type { DashboardSales, LowStockVariant } from '../types/admin'

const money=new Intl.NumberFormat('en-NP',{style:'currency',currency:'NPR',maximumFractionDigits:0})

export function DashboardPage(){
  const[range,setRange]=useState('today'); const[from,setFrom]=useState(''); const[to,setTo]=useState('')
  const query=from&&to?`from=${from}&to=${to}`:`range=${range}`
  const sales=useQuery({queryKey:['dashboard-sales',query],queryFn:()=>apiRequest<DashboardSales>(`/api/v1/admin/dashboards/sales?${query}`)})
  const stock=useQuery({queryKey:['low-stock',10],queryFn:()=>apiRequest<{threshold:number;count:number;data:LowStockVariant[]}>('/api/v1/admin/dashboards/low-stock?threshold=10')})
  return <main className="admin-page dashboard-page">
    <header className="admin-page-head"><div><p>UNIVERSAL SALES</p><h1>SALES OVERVIEW</h1><span>Overall, website, and POS performance in one place.</span></div><div className="dashboard-filters"><div className="range-switch">{['today','week','month','year'].map(item=><button className={!from&&range===item?'active':''} onClick={()=>{setRange(item);setFrom('');setTo('')}} key={item}>{item}</button>)}</div><div><input aria-label="From date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input aria-label="To date" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></div></header>
    <section className="metric-grid"><article className="metric-primary"><div><CircleDollarSign/><span>Total sales</span></div><strong>{money.format(sales.data?.totalSales??0)}</strong><small>{sales.data?.range??(from&&to?`${from} to ${to}`:range)}</small></article><article><div><ClipboardList/><span>Website</span></div><strong>{money.format(sales.data?.webSales??0)}</strong><small>{sales.data?.orderCount??0} paid orders</small></article><article><div><ScanLine/><span>POS</span></div><strong>{money.format(sales.data?.posSales??0)}</strong><small>{sales.data?.saleCount??0} counter sales</small></article><article><div><Trophy/><span>Units sold</span></div><strong>{sales.data?.unitsSold??0}</strong><small>Paid product units</small></article></section>
    <section className="admin-panel"><header><div><p>PRODUCT PERFORMANCE</p><h2>Best sellers</h2></div><Trophy/></header>{sales.data?.topProducts?.length?<div className="order-item-list">{sales.data.topProducts.map((product,index)=><article key={product.productName}>{product.productImageUrl?<img src={product.productImageUrl} alt=""/>:<span className="item-placeholder">{index+1}</span>}<div><strong>{product.productName}</strong><small>POS {product.posUnits} · Web {product.webUnits} · {product.units} units</small></div><strong>{money.format(product.revenue)}</strong></article>)}</div>:<div className="admin-empty-inline">No paid product sales in this period.</div>}</section>
    <section className="dashboard-grid"><article className="channel-card"><header><div><p>CHANNEL MIX</p><h2>Revenue split</h2></div><Boxes/></header><div className="split-bar"><span style={{width:`${sales.data?.totalSales?Math.max(2,sales.data.webSales/sales.data.totalSales*100):50}%`}}/><i/></div><dl><div><dt>Website</dt><dd>{money.format(sales.data?.webSales??0)}</dd></div><div><dt>POS</dt><dd>{money.format(sales.data?.posSales??0)}</dd></div></dl></article><article className="low-stock-card"><header><div><p>INVENTORY ATTENTION</p><h2>Low-stock variants</h2></div><Link to="/stock">View all <ArrowRight/></Link></header>{stock.data?.data.length?<div>{stock.data.data.slice(0,6).map(item=><Link to={`/products/${item.productId}`} key={item.id}><span><strong>{item.product.name}</strong><small>{item.sku} / {item.size} / {item.color}</small></span><em className={item.stockQty<=0?'empty':''}>{item.stockQty}</em></Link>)}</div>:<div className="admin-empty-inline">No active variants are below the threshold.</div>}</article></section>
  </main>
}
