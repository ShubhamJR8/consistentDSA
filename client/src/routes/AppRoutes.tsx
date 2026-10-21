import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { PublicLayout } from '../layouts/PublicLayout';
import { ChallengesPage } from '../pages/ChallengesPage';
import { CommitmentNewPage } from '../pages/CommitmentNewPage';
import { DashboardPage } from '../pages/DashboardPage';
import { EditorPage } from '../pages/EditorPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { LandingPage } from '../pages/LandingPage';
import { LedgerPage } from '../pages/LedgerPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlanPage } from '../pages/PlanPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TodayPage } from '../pages/TodayPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { GuestRoute } from './GuestRoute';
import { ProtectedRoute } from './ProtectedRoute';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route element={<GuestRoute />}>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
      </Route>

      {/* Reachable whether logged in or not — the link is emailed and may be opened on either
          device/session, and a logged-in user should be able to confirm a pending change too. */}
      <Route element={<AuthLayout />}>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/commitment/new" element={<CommitmentNewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/commitment/:id/today" element={<TodayPage />} />
          <Route path="/commitment/:id/plan" element={<PlanPage />} />
          <Route path="/commitment/:id/ledger" element={<LedgerPage />} />
          <Route path="/commitment/:id/today/problems/:problemId/editor" element={<EditorPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
