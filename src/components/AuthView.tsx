import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  MessageSquare,
  Mic,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BLUEPRINT_LIMITS } from '../types';
import { uploadChatMedia } from '../services/media';
import { Avatar } from './Avatar';

type AuthScreenMode = 'welcome' | 'signin' | 'signup' | 'forgot-password';

const PRESET_AVATARS = [
  'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#008069"/><circle cx="60" cy="46" r="20" fill="#D9FDD3"/><path d="M24 104c6-20 22-30 36-30s30 10 36 30" fill="#D9FDD3"/></svg>`
    ),
  'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#0F766E"/><circle cx="60" cy="46" r="20" fill="#CCFBF1"/><path d="M24 104c6-20 22-30 36-30s30 10 36 30" fill="#CCFBF1"/></svg>`
    ),
  'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#0369A1"/><circle cx="60" cy="46" r="20" fill="#E0F2FE"/><path d="M24 104c6-20 22-30 36-30s30 10 36 30" fill="#E0F2FE"/></svg>`
    ),
  'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#4338CA"/><circle cx="60" cy="46" r="20" fill="#E0E7FF"/><path d="M24 104c6-20 22-30 36-30s30 10 36 30" fill="#E0E7FF"/></svg>`
    ),
  'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#B45309"/><circle cx="60" cy="46" r="20" fill="#FEF3C7"/><path d="M24 104c6-20 22-30 36-30s30 10 36 30" fill="#FEF3C7"/></svg>`
    ),
];

export function AuthView() {
  const {
    firebaseUser,
    needsRegistration,
    needsEmailVerification,
    verificationSuccessEmail,
    googleSigningIn,
    popupBlocked,
    authError,
    signInWithGoogle,
    signInWithGoogleRedirect,
    signUpWithEmail,
    signInWithEmail,
    checkEmailVerification,
    resendVerificationEmail,
    sendPasswordReset,
    clearVerificationSuccess,
    signOut,
    checkUsernameAvailable,
    completeRegistration,
    clearAuthError,
    websiteSettings,
  } = useAuth();

  const [mode, setMode] = useState<AuthScreenMode>('welcome');

  // Sign-In state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Sign-Up state
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>(PRESET_AVATARS[0]);

  // Forgot Password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetSentMessage, setResetSentMessage] = useState<string | null>(null);

  // Verification feedback state
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Google first-time profile completion state
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [about, setAbout] = useState('Available on My Chat');
  const [photoURL, setPhotoURL] = useState('');
  const [isDiscoverable, setIsDiscoverable] = useState(true);
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');

  const [submitting, setSubmitting] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  useEffect(() => {
    if (!firebaseUser || !needsRegistration) return;
    let cancelled = false;

    const defaultName =
      firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';
    setDisplayName(defaultName.slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX));
    setPhotoURL(firebaseUser.photoURL || '');

    const rawHandle = (firebaseUser.email?.split('@')[0] || defaultName)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 18);
    const base =
      rawHandle.length >= 3
        ? rawHandle
        : `user_${firebaseUser.uid.slice(0, 5).toLowerCase()}`;
    setUsername(base);

    void (async () => {
      try {
        const free = await checkUsernameAvailable(base);
        if (!free && !cancelled) {
          for (let attempt = 0; attempt < 4; attempt++) {
            const candidate = `${base.slice(0, 16)}_${Math.floor(100 + Math.random() * 899)}`;
            if (await checkUsernameAvailable(candidate)) {
              if (!cancelled) setUsername(candidate);
              break;
            }
          }
        }
      } catch {
        // Keep base handle; user can customize
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, needsRegistration, checkUsernameAvailable]);

  useEffect(() => {
    if (!needsRegistration) return;
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameStatus('idle');
      return;
    }
    if (!BLUEPRINT_LIMITS.USERNAME_PATTERN.test(clean)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    const timer = window.setTimeout(async () => {
      try {
        const ok = await checkUsernameAvailable(clean);
        setUsernameStatus(ok ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [username, needsRegistration, checkUsernameAvailable]);

  const switchMode = (next: AuthScreenMode) => {
    setFormError(null);
    setVerifyNotice(null);
    setResetSentMessage(null);
    clearAuthError();
    setMode(next);
  };

  const handleSignupAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Please pick a valid image file for your profile picture.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFormError('Avatar image must be smaller than 10 MB.');
      return;
    }
    if (avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    setFormError(null);
  };

  const handleCreateAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearAuthError();

    const cleanName = fullName.trim();
    const cleanEmail = signupEmail.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

    if (!cleanName) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!emailValid) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (signupPassword.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (signupPassword !== confirmPassword) {
      setFormError('Password and Confirm Password do not match.');
      return;
    }
    if (!acceptedPrivacy) {
      setFormError(
        'Please review and accept the Privacy Notice & Owner Moderation Policy before creating your account.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await signUpWithEmail({
        fullName: cleanName,
        email: cleanEmail,
        password: signupPassword,
        avatarFile,
        presetAvatarUrl: avatarFile ? undefined : avatarPreviewUrl,
        acceptedPrivacyConsent: acceptedPrivacy,
      });
      setVerifyNotice('Verification email sent. Please check your inbox.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearAuthError();

    const cleanEmail = loginEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (!loginPassword) {
      setFormError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await signInWithEmail(cleanEmail, loginPassword);
      if (outcome === 'unverified') {
        setVerifyNotice(
          'Your email is not verified yet. Please check your inbox or resend the verification email.'
        );
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckVerificationClick = async () => {
    setFormError(null);
    setVerifyNotice(null);
    setSubmitting(true);
    try {
      const verified = await checkEmailVerification();
      if (!verified) {
        setFormError(
          'Your email is still unverified. Click the verification link sent to your inbox (and check Spam/Promotions), then click Continue After Verification again.'
        );
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to check verification status right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0) return;
    setFormError(null);
    setVerifyNotice(null);
    setSubmitting(true);
    try {
      await resendVerificationEmail();
      setVerifyNotice('Verification email sent. Please check your inbox.');
      setResendCooldown(30);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not resend verification email.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setResetSentMessage(null);
    const clean = resetEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(clean);
      setResetSentMessage(
        `Password reset email sent to ${clean}. Check your inbox to set a new password.`
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not send password reset email.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseUser) return;
    setUploadingAvatar(true);
    setFormError(null);
    try {
      const res = await uploadChatMedia(file, `avatars/${firebaseUser.uid}`, file.name);
      setPhotoURL(res.url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleGoogleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!acceptedPrivacy) {
      setFormError(
        'Please accept the Privacy Notice, Owner Moderation Policy, and Data Retention terms to continue.'
      );
      return;
    }
    setSubmitting(true);
    try {
      await completeRegistration({
        displayName,
        username,
        about,
        photoURL,
        isDiscoverable,
        acceptedPrivacyConsent: acceptedPrivacy,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isStandaloneWindow =
    typeof window !== 'undefined' ? window.self === window.top : true;

  const renderGoogleButton = (
    label = 'Continue with Google',
    variant: 'primary' | 'secondary' = 'secondary'
  ) => (
    <button
      type="button"
      disabled={googleSigningIn || submitting}
      onClick={signInWithGoogle}
      className={
        variant === 'primary'
          ? 'w-full min-h-[50px] px-5 py-3 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-3 shadow-sm transition-colors cursor-pointer'
          : 'w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-white dark:bg-[#202C33] hover:bg-[#F8FAFB] dark:hover:bg-[#2A3942] disabled:opacity-60 border border-[#D1D7DB] dark:border-[#2A3942] text-[#111B21] dark:text-[#E9EDEF] font-semibold text-sm flex items-center justify-center gap-3 transition-colors cursor-pointer'
      }
    >
      {googleSigningIn ? (
        <Loader2 className="w-5 h-5 animate-spin shrink-0" />
      ) : (
        <span
          className={
            variant === 'primary'
              ? 'w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0'
              : 'flex items-center justify-center shrink-0'
          }
        >
          <svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
        </span>
      )}
      <span>{googleSigningIn ? 'Signing in with Google...' : label}</span>
    </button>
  );

  const activeError = formError || authError;

  return (
    <div className="min-h-dvh bg-[#F0F2F5] dark:bg-[#0B141A] flex flex-col">
      {/* Accent Header Band */}
      <div className="h-44 sm:h-52 bg-[#008069] dark:bg-[#111B21] border-b border-transparent dark:border-[#222E35] shrink-0">
        <div className="max-w-5xl mx-auto px-6 pt-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-white">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              {websiteSettings.siteName || 'My Chat'}
            </span>
          </div>
          <span className="text-xs font-medium text-white/85">VerdeChat Web Platform</span>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="flex-1 px-4 sm:px-6 -mt-24 sm:-mt-28 pb-10">
        <div className="max-w-5xl mx-auto bg-white dark:bg-[#111B21] rounded-2xl border border-[#E9EDEF] dark:border-[#222E35] shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12">
            {/* Left Info Column */}
            <div className="lg:col-span-5 p-7 sm:p-10 bg-[#F8FAFB] dark:bg-[#162127] border-b lg:border-b-0 lg:border-r border-[#E9EDEF] dark:border-[#222E35] flex flex-col justify-between gap-8">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-[#111B21] dark:text-[#E9EDEF] tracking-tight text-balance mb-3">
                  Real-time messaging and calls, directly in your browser.
                </h1>
                <p className="text-sm text-[#54656F] dark:text-[#8696A0] leading-relaxed mb-8">
                  Open My Chat in Chrome, Safari, or any mobile or desktop browser. No app store download, no APK, and no SIM card required.
                </p>

                <div className="space-y-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-9 h-9 rounded-lg bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center shrink-0">
                      <PhoneCall className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                        Browser Audio & Video Calling
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-0.5">
                        Peer-to-peer WebRTC internet calls using your device microphone and camera.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="w-9 h-9 rounded-lg bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center shrink-0">
                      <Mic className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                        Voice Notes, Photos & Videos
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-0.5">
                        Record voice messages, customize chat wallpapers, and share media across screens.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="w-9 h-9 rounded-lg bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center shrink-0">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                        Instant Cross-Device Access
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-0.5">
                        Works on Android phones, iPhones, iPads, laptops, and desktop browsers over HTTPS.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-[#667781] dark:text-[#8696A0] pt-4 border-t border-[#E9EDEF] dark:border-[#222E35]">
                <ShieldCheck className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0" />
                <span>Verified Firebase Auth · Real-time Firestore sync</span>
              </div>
            </div>

            {/* Right Auth / Registration / Verification Column */}
            <div className="lg:col-span-7 p-7 sm:p-10 flex flex-col justify-center">
              {/* 1. Verification Success Screen */}
              {verificationSuccessEmail ? (
                <div className="max-w-md mx-auto w-full text-center space-y-5">
                  <div className="w-16 h-16 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                      Your Account Was Created Successfully!
                    </h2>
                    <p className="text-sm text-[#667781] dark:text-[#8696A0] mt-2">
                      Email <strong className="text-[#111B21] dark:text-[#E9EDEF]">{verificationSuccessEmail}</strong> has been verified and your profile is ready.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginEmail(verificationSuccessEmail);
                      setLoginPassword('');
                      clearVerificationSuccess();
                      switchMode('signin');
                    }}
                    className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white font-semibold text-sm transition-colors cursor-pointer"
                  >
                    Continue to Sign In
                  </button>
                </div>
              ) : needsEmailVerification && firebaseUser ? (
                /* 2. Email Verification Pending Screen */
                <div className="max-w-md mx-auto w-full space-y-5">
                  <div className="w-14 h-14 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center">
                    <MailCheck className="w-7 h-7" />
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                      Verify your email address
                    </h2>
                    <p className="text-sm text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
                      {verifyNotice || 'Verification email sent. Please check your inbox.'}{' '}
                      We sent a verification link to{' '}
                      <strong className="text-[#111B21] dark:text-[#E9EDEF]">
                        {firebaseUser.email}
                      </strong>
                      .
                    </p>
                  </div>

                  {activeError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-start justify-between gap-2">
                      <span>{activeError}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFormError(null);
                          clearAuthError();
                        }}
                        aria-label="Dismiss error"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleCheckVerificationClick}
                      className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {submitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Continue After Verification</span>
                    </button>

                    <button
                      type="button"
                      disabled={submitting || resendCooldown > 0}
                      onClick={handleResendVerification}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] disabled:opacity-50 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>
                        {resendCooldown > 0
                          ? `Resend Verification Email (${resendCooldown}s)`
                          : 'Resend Verification Email'}
                      </span>
                    </button>
                  </div>

                  <div className="pt-4 border-t border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between text-xs text-[#667781] dark:text-[#8696A0]">
                    <span>Verified accounts unlock full chat access</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await signOut();
                        switchMode('signin');
                      }}
                      className="font-semibold text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </div>
              ) : needsRegistration && firebaseUser ? (
                /* 3. Google First-Time Handle Completion */
                <form
                  onSubmit={handleGoogleCompleteSubmit}
                  className="max-w-md mx-auto w-full space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                        Complete your profile
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-0.5">
                        Signed in as {firebaseUser.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={signOut}
                      className="text-xs font-medium text-[#667781] hover:text-[#111B21] dark:hover:text-white cursor-pointer"
                    >
                      Switch account
                    </button>
                  </div>

                  {activeError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300">
                      {activeError}
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <Avatar src={photoURL} name={displayName || 'User'} size="lg" />
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] cursor-pointer transition-colors">
                      {uploadingAvatar ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4" />
                      )}
                      <span>{uploadingAvatar ? 'Uploading...' : 'Change photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleGoogleAvatarUpload}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={BLUEPRINT_LIMITS.DISPLAY_NAME_MAX}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                      Unique Handle
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-sm text-[#667781] dark:text-[#8696A0]">
                        @
                      </span>
                      <input
                        type="text"
                        required
                        maxLength={BLUEPRINT_LIMITS.USERNAME_MAX}
                        value={username}
                        onChange={(e) =>
                          setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                        }
                        placeholder="alex_morgan"
                        className="w-full pl-8 pr-9 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                      />
                      <span className="absolute right-3">
                        {usernameStatus === 'checking' && (
                          <Loader2 className="w-4 h-4 animate-spin text-[#667781]" />
                        )}
                        {usernameStatus === 'available' && (
                          <Check className="w-4 h-4 text-[#00A884]" />
                        )}
                        {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                          <X className="w-4 h-4 text-red-500" />
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#667781] dark:text-[#8696A0] mt-1">
                      {usernameStatus === 'taken'
                        ? 'That handle is already taken.'
                        : usernameStatus === 'invalid'
                        ? 'Use 3–24 lowercase letters, numbers, or underscores.'
                        : 'Friends can find and message you with this handle.'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                      About
                    </label>
                    <input
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.ABOUT_MAX}
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      placeholder="Available on My Chat"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-xs text-[#54656F] dark:text-[#8696A0] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isDiscoverable}
                      onChange={(e) => setIsDiscoverable(e.target.checked)}
                      className="rounded accent-[#00A884] w-4 h-4"
                    />
                    <span>List my profile in the directory</span>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-[11px] leading-relaxed text-[#54656F] dark:text-[#8696A0] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptedPrivacy}
                      onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                      className="mt-0.5 rounded accent-[#00A884] w-4 h-4 shrink-0"
                    />
                    <span>
                      I acknowledge the Privacy &amp; Data Retention Policy ({websiteSettings.dataRetentionDays ?? 365} days) and consent that the authorized Website Owner may review conversations for moderation and platform safety with full audit logging.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={
                      submitting || usernameStatus === 'taken' || usernameStatus === 'invalid' || !acceptedPrivacy
                    }
                    className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Enter My Chat</span>
                  </button>
                </form>
              ) : mode === 'welcome' ? (
                /* 4. Welcome / Authentication Landing Screen */
                <div className="max-w-md mx-auto w-full space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                      Welcome to {websiteSettings.siteName || 'VerdeChat'}
                    </h2>
                    <p className="text-sm text-[#667781] dark:text-[#8696A0] mt-1.5">
                      Sign in instantly with your Google account to start messaging, sending voice notes, and making browser calls.
                    </p>
                  </div>

                  {activeError && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="leading-relaxed">{activeError}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFormError(null);
                            clearAuthError();
                          }}
                          aria-label="Dismiss error"
                          className="shrink-0 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {popupBlocked && isStandaloneWindow && (
                        <button
                          type="button"
                          onClick={signInWithGoogleRedirect}
                          className="w-full py-2 px-3 rounded-lg bg-[#008069] hover:bg-[#006B57] text-white font-semibold text-xs transition-colors cursor-pointer"
                        >
                          Continue with Google (Redirect Mode)
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-3">
                    {renderGoogleButton('Continue with Google', 'primary')}

                    <p className="text-[11px] text-center text-[#667781] dark:text-[#8696A0]">
                      Recommended · Instant sign-in with Google Firebase Authentication
                    </p>

                    <div className="relative flex items-center py-2">
                      <div className="flex-1 border-t border-[#E9EDEF] dark:border-[#222E35]" />
                      <span className="px-3 text-xs text-[#667781] dark:text-[#8696A0]">
                        optional email login
                      </span>
                      <div className="flex-1 border-t border-[#E9EDEF] dark:border-[#222E35]" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => switchMode('signin')}
                        className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] bg-white dark:bg-[#202C33] hover:bg-[#F8FAFB] dark:hover:bg-[#2A3942] text-[#111B21] dark:text-[#E9EDEF] font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>Sign In with Email</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] bg-white dark:bg-[#202C33] hover:bg-[#F8FAFB] dark:hover:bg-[#2A3942] text-[#111B21] dark:text-[#E9EDEF] font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>Create Account</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center pt-5 border-t border-[#E9EDEF] dark:border-[#222E35]">
                    <div className="p-2">
                      <MessageSquare className="w-4 h-4 mx-auto text-[#008069] dark:text-[#00A884] mb-1" />
                      <div className="text-xs font-medium text-[#111B21] dark:text-[#E9EDEF]">
                        Text & Media
                      </div>
                    </div>
                    <div className="p-2">
                      <Mic className="w-4 h-4 mx-auto text-[#008069] dark:text-[#00A884] mb-1" />
                      <div className="text-xs font-medium text-[#111B21] dark:text-[#E9EDEF]">
                        Voice Notes
                      </div>
                    </div>
                    <div className="p-2">
                      <Video className="w-4 h-4 mx-auto text-[#008069] dark:text-[#00A884] mb-1" />
                      <div className="text-xs font-medium text-[#111B21] dark:text-[#E9EDEF]">
                        WebRTC Calls
                      </div>
                    </div>
                  </div>
                </div>
              ) : mode === 'signin' ? (
                /* 5. Email & Password Sign In Page */
                <div className="max-w-md mx-auto w-full space-y-5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => switchMode('welcome')}
                      aria-label="Back to welcome"
                      className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                      <h2 className="text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                        Sign In to My Chat
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0]">
                        Enter your verified email and password
                      </p>
                    </div>
                  </div>

                  {activeError && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 space-y-2.5">
                      <p className="leading-relaxed">{activeError}</p>
                      <button
                        type="button"
                        onClick={signInWithGoogle}
                        className="w-full py-2 px-3 rounded-lg bg-[#008069] hover:bg-[#006B57] text-white font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Continue with Google instead
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleEmailSignInSubmit} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                        Email Address
                      </label>
                      <div className="relative flex items-center">
                        <Mail className="w-4 h-4 text-[#667781] absolute left-3.5" />
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-[#54656F] dark:text-[#8696A0]">
                          Password
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setResetEmail(loginEmail);
                            switchMode('forgot-password');
                          }}
                          className="text-xs font-semibold text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                        >
                          Forgot Password?
                        </button>
                      </div>
                      <div className="relative flex items-center">
                        <Lock className="w-4 h-4 text-[#667781] absolute left-3.5" />
                        <input
                          type={showLoginPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword((s) => !s)}
                          aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 text-[#667781] hover:text-[#111B21] dark:hover:text-white cursor-pointer"
                        >
                          {showLoginPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Sign In</span>
                    </button>
                  </form>

                  <div className="relative flex items-center">
                    <div className="flex-1 border-t border-[#E9EDEF] dark:border-[#222E35]" />
                    <span className="px-3 text-xs text-[#667781] dark:text-[#8696A0]">or</span>
                    <div className="flex-1 border-t border-[#E9EDEF] dark:border-[#222E35]" />
                  </div>

                  {renderGoogleButton('Continue with Google')}

                  <div className="text-center text-xs text-[#667781] dark:text-[#8696A0] pt-1">
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      className="font-semibold text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                    >
                      Create an Account
                    </button>
                  </div>
                </div>
              ) : mode === 'signup' ? (
                /* 6. Create an Account Page */
                <div className="max-w-md mx-auto w-full space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => switchMode('welcome')}
                      aria-label="Back to welcome"
                      className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                      <h2 className="text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                        Create an Account
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0]">
                        Register with your email and choose a profile picture
                      </p>
                    </div>
                  </div>

                  {!websiteSettings.allowNewRegistrations && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
                      New public registrations are currently paused by the website administrator. Existing users can still Sign In.
                    </div>
                  )}

                  {activeError && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 space-y-2.5">
                      <p className="leading-relaxed">{activeError}</p>
                      <button
                        type="button"
                        onClick={signInWithGoogle}
                        className="w-full py-2 px-3 rounded-lg bg-[#008069] hover:bg-[#006B57] text-white font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Continue with Google instead
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleCreateAccountSubmit} className="space-y-3.5">
                    {/* Avatar Picker */}
                    <div className="p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Avatar src={avatarPreviewUrl} name={fullName || 'User'} size="md" />
                          <div>
                            <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                              Profile Picture
                            </div>
                            <div className="text-[11px] text-[#667781] dark:text-[#8696A0]">
                              Pick an avatar or upload a photo
                            </div>
                          </div>
                        </div>

                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] cursor-pointer">
                          <Camera className="w-3.5 h-3.5" />
                          <span>Upload</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleSignupAvatarFile}
                            className="hidden"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-2">
                        {PRESET_AVATARS.map((preset, idx) => {
                          const selected = !avatarFile && avatarPreviewUrl === preset;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setAvatarFile(null);
                                setAvatarPreviewUrl(preset);
                              }}
                              aria-label={`Select preset avatar ${idx + 1}`}
                              className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-transform cursor-pointer ${
                                selected
                                  ? 'border-[#00A884] scale-110'
                                  : 'border-transparent opacity-80 hover:opacity-100'
                              }`}
                            >
                              <img src={preset} alt="" className="w-full h-full object-cover" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                        Full Name
                      </label>
                      <div className="relative flex items-center">
                        <UserIcon className="w-4 h-4 text-[#667781] absolute left-3.5" />
                        <input
                          type="text"
                          required
                          maxLength={BLUEPRINT_LIMITS.DISPLAY_NAME_MAX}
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Alex Morgan"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                        Email Address
                      </label>
                      <div className="relative flex items-center">
                        <Mail className="w-4 h-4 text-[#667781] absolute left-3.5" />
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                          Password
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type={showSignupPassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            autoComplete="new-password"
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            placeholder="Min 6 chars"
                            className="w-full pl-3.5 pr-9 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSignupPassword((s) => !s)}
                            aria-label="Toggle password visibility"
                            className="absolute right-2.5 text-[#667781] cursor-pointer"
                          >
                            {showSignupPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                          Confirm Password
                        </label>
                        <input
                          type={showSignupPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Repeat password"
                          className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                        />
                      </div>
                    </div>

                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-[11px] leading-relaxed text-[#54656F] dark:text-[#8696A0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acceptedPrivacy}
                        onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                        className="mt-0.5 rounded accent-[#00A884] w-4 h-4 shrink-0"
                      />
                      <span>
                        I agree to the Privacy &amp; Data Retention Policy ({websiteSettings.dataRetentionDays ?? 365} days) and understand that the authorized Website Owner can audit-logged review messages for safety and moderation.
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={submitting || !acceptedPrivacy}
                      className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Create Account</span>
                    </button>
                  </form>

                  <div className="text-center text-xs text-[#667781] dark:text-[#8696A0]">
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="font-semibold text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </div>
                </div>
              ) : (
                /* 7. Forgot Password Screen */
                <div className="max-w-md mx-auto w-full space-y-5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      aria-label="Back to sign in"
                      className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                      <h2 className="text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                        Reset your password
                      </h2>
                      <p className="text-xs text-[#667781] dark:text-[#8696A0]">
                        We will send a password reset link to your email
                      </p>
                    </div>
                  </div>

                  {activeError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300">
                      {activeError}
                    </div>
                  )}

                  {resetSentMessage && (
                    <div className="p-3.5 rounded-xl bg-[#00A884]/12 border border-[#00A884]/30 text-xs text-[#008069] dark:text-[#00A884]">
                      {resetSentMessage}
                    </div>
                  )}

                  <form onSubmit={handlePasswordResetSubmit} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                        Email Address
                      </label>
                      <div className="relative flex items-center">
                        <Mail className="w-4 h-4 text-[#667781] absolute left-3.5" />
                        <input
                          type="email"
                          required
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] border border-transparent focus:border-[#00A884] outline-none text-sm text-[#111B21] dark:text-[#E9EDEF]"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Send Password Reset Email</span>
                    </button>
                  </form>

                  <div className="text-center text-xs text-[#667781] dark:text-[#8696A0]">
                    Remembered your password?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="font-semibold text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
