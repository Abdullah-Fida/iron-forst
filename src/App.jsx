import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import React, { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: '#fee2e2', color: '#b91c1c', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>🚨 App Crash detected</h2>
          <p style={{ fontSize: 14 }}>{this.state.error?.message}</p>
          <pre style={{ fontSize: 10, marginTop: 20, whiteSpace: 'pre-wrap' }}>{this.state.error?.stack}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '10px 20px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: 4 }}>Hard Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

import GymLayout from './components/layout/GymLayout';
import AdminLayout from './components/layout/AdminLayout';
import LoginPage from './features/auth/LoginPage';
import ForgotPasswordPage from './features/auth/ForgotPasswordPage';
import ResetPasswordPage from './features/auth/ResetPasswordPage';
import DashboardPage from './features/dashboard/DashboardPage';
import MembersListPage from './features/members/MembersListPage';
import AddMemberPage from './features/members/AddMemberPage';
import EditMemberPage from './features/members/EditMemberPage';
import MemberDetailPage from './features/members/MemberDetailPage';
import NewMembersReportPage from './features/members/NewMembersReportPage';
import PaymentsListPage from './features/payments/PaymentsListPage';
import AddPaymentPage from './features/payments/AddPaymentPage';
import PendingFeesPage from './features/payments/PendingFeesPage';
import RevenuePage from './features/payments/RevenuePage';
import ExpensesListPage from './features/expenses/ExpensesListPage';
import AddExpensePage from './features/expenses/AddExpensePage';
import EditExpensePage from './features/expenses/EditExpensePage';
import ExpenseSummaryPage from './features/expenses/ExpenseSummaryPage';
import StaffListPage from './features/staff/StaffListPage';
import AddStaffPage from './features/staff/AddStaffPage';
import EditStaffPage from './features/staff/EditStaffPage';
import StaffDetailPage from './features/staff/StaffDetailPage';
import ActionCenterPage from './features/collections/ActionCenterPage';
import SettingsPage from './features/settings/SettingsPage';
import AttendancePage from './features/attendance/AttendancePage';
import AttendanceScanner from './features/attendance/AttendanceScanner';
import AdminDashboardPage from './features/admin/AdminDashboardPage';
import AdminGymsPage from './features/admin/AdminGymsPage';
import AdminGymDetailPage from './features/admin/AdminGymDetailPage';
import AdminPaymentsPage from './features/admin/AdminPaymentsPage';
import AdminAlertsPage from './features/admin/AdminAlertsPage';
import AdminSubscriptionsPage from './features/admin/AdminSubscriptionsPage';

// Protected Route Components
function GymRoute({ children }) {
  const { isAuthenticated, isGymOwner } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isGymOwner) return <Navigate to="/admin/dashboard" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, isAdmin } = useAuth();
  if (isAuthenticated) {
    return <Navigate to={isAdmin ? '/admin/dashboard' : '/dashboard'} replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<GymRoute><GymLayout /></GymRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="members" element={<MembersListPage />} />
        <Route path="members/add" element={<AddMemberPage />} />
        <Route path="members/report" element={<NewMembersReportPage />} />
        <Route path="members/:id" element={<MemberDetailPage />} />
        <Route path="members/:id/edit" element={<EditMemberPage />} />
        <Route path="payments" element={<PaymentsListPage />} />
        <Route path="payments/add" element={<AddPaymentPage />} />
        <Route path="payments/pending" element={<Navigate to="/action-center" replace />} />
        <Route path="payments/revenue" element={<RevenuePage />} />
        <Route path="expenses" element={<ExpensesListPage />} />
        <Route path="expenses/add" element={<AddExpensePage />} />
        <Route path="expenses/:id/edit" element={<EditExpensePage />} />
        <Route path="expenses/summary" element={<ExpenseSummaryPage />} />
        <Route path="staff" element={<StaffListPage />} />
        <Route path="staff/add" element={<AddStaffPage />} />
        <Route path="staff/:id" element={<StaffDetailPage />} />
        <Route path="staff/:id/edit" element={<EditStaffPage />} />
        <Route path="action-center" element={<ActionCenterPage />} />
        <Route path="notifications" element={<Navigate to="/action-center" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="attendance/scanner" element={<AttendanceScanner />} />
      </Route>
      <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="gyms" element={<AdminGymsPage />} />
        <Route path="gyms/:id" element={<AdminGymDetailPage />} />
        <Route path="payments" element={<AdminPaymentsPage />} />
        <Route path="alerts" element={<AdminAlertsPage />} />
        <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <NavigationProvider>
              <ConfirmProvider>
                <AppRoutes />
              </ConfirmProvider>
            </NavigationProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
