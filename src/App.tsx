import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Lock, LogOut, MessageSquare, ShieldAlert, Wrench } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CallProvider } from './contexts/CallContext';
import { AuthView } from './components/AuthView';
import { ChatWorkspace } from './components/ChatWorkspace';
import { OwnerSetupBanner } from './components/OwnerSetupBanner';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import { AdminDashboard } from './components/AdminDashboard';
import { DESIGNATED_OWNER_EMAIL } from './types';

function isOwnerDashboardPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return clean === '/owner' || clean === '/admin';
}

function AppShell() {
  const {
    firebaseUser,
    publicProfile,
    loading,
    needsRegistration,
    needsEmailVerification,
    verificationSuccessEmail,
    needsPrivacyConsent,
    accountModeration,
    websiteSettings,
    isSuperAdmin,
    signOut,
  } = useAuth();

  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('verdechat_theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = useCallback((nextPath: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('verdechat_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('verdechat_theme', 'light');
    }
  }, [darkMode]);

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#008069] text-white flex items-center justify-center">
          <MessageSquare className="w-6 h-6" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-[#008069] dark:text-[#00A884]" />
      </div>
    );
  }

  // Enforce server moderation lockout for suspended, blocked, or removed accounts
  if (
    firebaseUser &&
    firebaseUser.emailVerified &&
    accountModeration &&
    ['suspended', 'blocked', 'removed'].includes(accountModeration.status)
  ) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF] capitalize">
              Account {accountModeration.status}
            </h1>
            <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
              Access to {websiteSettings.siteName} has been restricted by moderation policy.
            </p>
            {accountModeration.reason && (
              <div className="mt-3 p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#111B21] dark:text-[#E9EDEF]">
                Reason: {accountModeration.reason}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  if (
    !firebaseUser ||
    !firebaseUser.emailVerified ||
    needsEmailVerification ||
    verificationSuccessEmail ||
    needsRegistration ||
    !publicProfile
  ) {
    return <AuthView />;
  }

  // Strict Backend & Route Guard for /owner and /admin paths
  if (isOwnerDashboardPath(pathname)) {
    if (!isSuperAdmin) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl p-6 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
                403 · Owner Access Restricted
              </h1>
              <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
                The Owner Dashboard is strictly restricted to the verified website owner account ({DESIGNATED_OWNER_EMAIL}).
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigateTo('/')}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Chats</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <AdminDashboard onClose={() => navigateTo('/')} />
        <OwnerSetupBanner />
      </>
    );
  }

  // Enforce maintenance mode for regular users (owner keeps access)
  if (websiteSettings.maintenanceMode && !isSuperAdmin) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
              {websiteSettings.siteName} is in Maintenance Mode
            </h1>
            <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
              {websiteSettings.welcomeNotice ||
                'The website owner has temporarily paused messaging during maintenance. Please check back shortly.'}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // Pre-chat Privacy Disclosure & Owner Moderation Consent Gate
  if (needsPrivacyConsent) {
    return <PrivacyConsentModal />;
  }

  return (
    <CallProvider>
      <ChatWorkspace
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        onOpenOwnerConsole={() => navigateTo('/owner')}
      />
      <OwnerSetupBanner />
    </CallProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
