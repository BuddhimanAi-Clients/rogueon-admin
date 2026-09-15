import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAdmin } from './components/AdminLayout'
import { CategoriesPage } from './pages/CategoriesPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { OrdersPage } from './pages/OrdersPage'
import { PosSaleDetailPage } from './pages/PosSaleDetailPage'
import { PosSalesPage } from './pages/PosSalesPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { ProductsPage } from './pages/ProductsPage'
import { StaffPage } from './pages/StaffPage'
import { StockPage } from './pages/StockPage'
import { PaymentSettingsPage } from './pages/PaymentSettingsPage'
import { CustomersPage } from './pages/CustomersPage'
import { CustomerDetailPage } from './pages/CustomerDetailPage'
import { BirthdaysPage } from './pages/BirthdaysPage'
import { MembershipTiersPage } from './pages/MembershipTiersPage'

export default function App() {
  return <Routes><Route path="/login" element={<LoginPage/>}/><Route element={<RequireAdmin/>}><Route index element={<DashboardPage/>}/><Route path="products" element={<ProductsPage/>}/><Route path="products/:id" element={<ProductDetailPage/>}/><Route path="categories" element={<CategoriesPage/>}/><Route path="stock" element={<StockPage/>}/><Route path="orders" element={<OrdersPage/>}/><Route path="orders/:id" element={<OrderDetailPage/>}/><Route path="payment-settings" element={<PaymentSettingsPage/>}/><Route path="pos-sales" element={<PosSalesPage/>}/><Route path="pos-sales/:id" element={<PosSaleDetailPage/>}/><Route path="customers" element={<CustomersPage/>}/><Route path="customers/:id" element={<CustomerDetailPage/>}/><Route path="birthdays" element={<BirthdaysPage/>}/><Route path="membership-tiers" element={<MembershipTiersPage/>}/><Route path="staff" element={<StaffPage/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes>
}
