'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export default function CompleteProfilePage() {
  const { loading, firebaseUser, profile } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile) {
      setFirstName((prev) => (prev ? prev : profile.firstName ?? ''));
      setLastName((prev) => (prev ? prev : profile.lastName ?? ''));
    }
  }, [profile]);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!firebaseUser) {
      router.replace('/login');
      return;
    }
    const hasFirst = Boolean(profile?.firstName?.trim());
    const hasLast = Boolean(profile?.lastName?.trim());
    if (hasFirst && hasLast) {
      router.replace('/my-courses');
    }
  }, [firebaseUser, loading, profile, router]);

  if (loading || !firebaseUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (trimmedFirst.length < 2 || trimmedLast.length < 2) {
      setError(t.profile.nameMinLength);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch('/api/profile/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: trimmedFirst,
          lastName: trimmedLast,
          idToken,
        }),
      });
      if (!response.ok) {
        let payload: { error?: string } | null = null;
        try {
          payload = (await response.json()) as { error?: string } | null;
        } catch {
          payload = null;
        }
        console.error('Profile completion failed', response.status, payload);
        throw new Error(payload?.error ?? t.profile.saveNameError);
      }
      if (typeof window !== 'undefined') {
        const bypassKey = `profileCompletionBypass_${firebaseUser.uid}`;
        window.sessionStorage.setItem(bypassKey, 'true');
      }
      router.replace('/my-courses');
    } catch (err) {
      console.error('Failed to update profile', err);
      setError(
        err instanceof Error
          ? err.message
          : t.profile.saveNameError,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t.profile.completeYourProfile}
          </p>
          <h1 className="text-2xl font-bold text-slate-900">{t.profile.whatIsYourName}</h1>
          <p className="text-sm text-slate-500">
            {t.profile.nameExplanation}
          </p>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t.profile.firstName}
          <input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder={t.profile.firstName}
          />
        </label>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t.profile.lastName}
          <input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder={t.profile.lastName}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
        >
          {submitting ? t.common.saving : t.profile.saveAndContinue}
        </button>
      </form>
    </div>
  );
}
