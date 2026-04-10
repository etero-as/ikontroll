'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';

import { auth } from '@/lib/firebase';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export default function CourseSignupPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      setCode(codeParam);
    }
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/course-invite/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          email,
          phone,
          password,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || t.auth.signupError);
      }

      const data = (await response.json().catch(() => ({}))) as { token?: string };
      if (!data.token) {
        throw new Error(t.auth.missingToken);
      }

      await signInWithCustomToken(auth, data.token);
      router.replace('/my-courses');
    } catch (err) {
      console.error('Failed to sign up', err);
      setError(err instanceof Error ? err.message : t.auth.signupError);
    } finally {
      setSubmitting(false);
    }
  };

  const loginHref = code ? `/login?code=${encodeURIComponent(code)}` : '/login';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            IKontroll
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">{t.auth.signupTitle}</h1>
          <p className="text-sm text-slate-500">
            {t.auth.signupSubtitle}
          </p>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t.auth.courseCode}
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.trim().toUpperCase())}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            required
          />
        </label>

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

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t.auth.phone}
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            required
          />
        </label>

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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
        >
          {submitting ? t.auth.signingUp : t.auth.signupButton}
        </button>

        <div className="text-center text-sm">
          {t.auth.alreadyRegistered}{' '}
          <Link href={loginHref} className="text-slate-600 underline transition hover:text-slate-900">
            {t.auth.loginHere}
          </Link>
        </div>
      </form>
    </main>
  );
}
