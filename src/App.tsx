import { Route, Routes } from 'react-router';
import './App.css';
import { AccountBar } from './components/AccountBar';
import { ChatWidget } from './components/ChatWidget';
import { Notice } from './components/Notice';
import { RequireAdmin } from './components/RequireAdmin';
import { RequireSalesTeam } from './components/RequireRole';
import { RequireSignedIn } from './components/RequireSignedIn';
import { ContactPage } from './pages/ContactPage';
import { DashboardPage } from './pages/DashboardPage';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { LeadsPage } from './pages/LeadsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { PasswordPage } from './pages/PasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { InventoryPage } from './pages/InventoryPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { VehicleFormPage } from './pages/VehicleFormPage';

export default function App() {
  return (
    <div className="app">
      <AccountBar />
      <Notice />
      <Routes>
        <Route path="/" element={<InventoryPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/dashboard" element={<RequireSignedIn><DashboardPage /></RequireSignedIn>} />
        <Route path="/leads" element={<RequireSalesTeam><LeadsPage /></RequireSalesTeam>} />
        <Route path="/leads/:id" element={<RequireSalesTeam><LeadDetailPage /></RequireSalesTeam>} />
        <Route path="/account/password" element={<RequireAdmin><PasswordPage /></RequireAdmin>} />
        <Route path="/vehicles/new" element={<RequireAdmin><VehicleFormPage /></RequireAdmin>} />
        <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
        <Route path="/vehicles/:id/edit" element={<RequireAdmin><VehicleFormPage /></RequireAdmin>} />
        <Route path="*" element={<VehicleDetailPage />} />
      </Routes>
      <ChatWidget />
    </div>
  );
}
