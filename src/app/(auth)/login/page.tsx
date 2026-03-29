'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';

import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { getPreferredLocale, getSavedLocale } from '@/utils/localization';
import { getTranslation } from '@/utils/translations';

export default function LoginPage() {
  const router = useRouter();
  const { firebaseUser, loading, isSystemOwner, isCustomerAdmin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  const [locale, setLocale] = useState('no');
  useEffect(() => {
    setLocale(getPreferredLocale(['no', 'en'], getSavedLocale()));
  }, []);

  const t = getTranslation(locale);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const queryEmail = params.get('email');
    if (queryEmail) {
      setEmail(queryEmail);
    }
    const queryCode = params.get('code');
    if (queryCode) {
      window.sessionStorage.setItem('pendingCourseInviteCode', queryCode);
    }
  }, []);

  useEffect(() => {
    if (loading || !firebaseUser) {
      return;
    }

    // Check for roles to determine redirect
    if (isSystemOwner || isCustomerAdmin) {
      router.replace('/dashboard');
    } else {
      router.replace('/my-courses');
    }
  }, [firebaseUser, loading, isSystemOwner, isCustomerAdmin, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Navigation is handled by the useEffect above
    } catch (err) {
      console.error(err);
      setError(t.auth.errorInvalidCredentials);
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetSubmitting(true);
    setResetMessage('');
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage(t.auth.resetSent);
    } catch (err) {
      console.error(err);
      setResetMessage(t.auth.resetError);
    } finally {
      setResetSubmitting(false);
    }
  };

  if (loading || firebaseUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-xl">
          {t.auth.loggingYouIn}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={showReset ? handlePasswordReset : handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            IKontroll
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {showReset ? t.auth.forgotPasswordLink : t.auth.loginTitle}
          </h1>
          <p className="text-sm text-slate-500">
            {showReset ? t.auth.forgotPasswordDescription : t.auth.loginSubtitle}
          </p>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t.auth.email}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            required
          />
        </label>

        {!showReset && (
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            {t.auth.password}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              required
            />
          </label>
        )}

        {error && !showReset && <p className="text-sm text-red-600">{error}</p>}
        {resetMessage && showReset && (
          <p className="text-sm text-emerald-600">{resetMessage}</p>
        )}

        <button
          type="submit"
          disabled={showReset ? resetSubmitting : submitting}
          className="w-full cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {showReset
            ? resetSubmitting
              ? t.auth.loggingIn
              : t.auth.sendReset
            : submitting
              ? t.auth.loggingIn
              : t.auth.loginButton}
        </button>

        <div className="text-center text-sm">
          {showReset ? (
            <button
              type="button"
              onClick={() => {
                setShowReset(false);
                setResetMessage('');
              }}
              className="cursor-pointer text-slate-600 underline transition hover:text-slate-900"
            >
              {t.auth.backToLogin}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowReset(true);
                setError('');
              }}
              className="cursor-pointer text-slate-600 underline transition hover:text-slate-900"
            >
              {t.auth.forgotPasswordLink}
            </button>
          )}
        </div>

        <LanguageSwitcher locale={locale} onChange={setLocale} />
      </form>
    </main>
  );
}
