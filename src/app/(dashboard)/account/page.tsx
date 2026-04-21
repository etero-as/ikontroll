'use client';

import { FormEvent, useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import type { CompanyUserRole, CustomerMembership } from '@/types/companyUser';

export default function AccountPage() {
  const {
    firebaseUser,
    profile,
    isSystemOwner,
    isCustomerAdmin,
    hasConsumerAccess,
    customerMemberships,
  } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const ta = t.admin.account;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName ?? '');
      setLastName(profile.lastName ?? '');
    }
  }, [profile]);

  const initials =
    `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.trim().toUpperCase() || '?';

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const nameChanged =
    trimmedFirst !== (profile?.firstName ?? '') ||
    trimmedLast !== (profile?.lastName ?? '');
  const nameValid = trimmedFirst.length >= 2 && trimmedLast.length >= 2;
  const canSave = nameChanged && nameValid && !submitting;

  const allCustomerMemberships = profile?.customerMemberships ?? [];
  const customersToShow =
    customerMemberships.length > 0 ? customerMemberships : allCustomerMemberships;

  const roleBadges: string[] = [];
  if (isSystemOwner) roleBadges.push(ta.roleSystemOwner);
  if (isCustomerAdmin) roleBadges.push(ta.roleCustomerAdmin);
  if (hasConsumerAccess) roleBadges.push(ta.roleConsumer);

  const customerRoleLabel = (role: CompanyUserRole) =>
    role === 'admin' ? ta.roleAdmin : ta.roleUser;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!firebaseUser || !canSave) return;

    setSubmitting(true);
    setError(null);
    setSavedAt(null);

    try {
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
        throw new Error(payload?.error ?? t.profile.saveNameError);
      }
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to update profile', err);
      setError(err instanceof Error ? err.message : t.profile.saveNameError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ta.eyebrow}
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{ta.title}</h1>
        <p className="text-sm text-slate-500">{ta.subtitle}</p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white">
            {initials}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {trimmedFirst} {trimmedLast}
            </p>
            <p className="text-sm text-slate-500">{profile?.email}</p>
          </div>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ta.profileTitle}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            {ta.firstName}
            <input
              value={firstName}
              onChange={(event) => {
                setFirstName(event.target.value);
                setSavedAt(null);
              }}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder={ta.firstName}
              autoComplete="given-name"
            />
          </label>

          <label className="block space-y-2 text-sm font-medium text-slate-700">
            {ta.lastName}
            <input
              value={lastName}
              onChange={(event) => {
                setLastName(event.target.value);
                setSavedAt(null);
              }}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder={ta.lastName}
              autoComplete="family-name"
            />
          </label>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {ta.email}
          <input
            value={profile?.email ?? ''}
            readOnly
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500"
            autoComplete="email"
          />
          <span className="block text-xs font-normal text-slate-500">
            {ta.emailCannotChange}
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {savedAt && !error && (
          <p className="text-sm text-emerald-600">{ta.saved}</p>
        )}
        {!nameValid && nameChanged && (
          <p className="text-sm text-amber-600">{t.profile.nameMinLength}</p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t.common.saving : ta.saveChanges}
          </button>
        </div>
      </form>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ta.rolesTitle}
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {roleBadges.map((label) => (
            <li
              key={label}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
            >
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ta.customersTitle}
        </h2>
        {customersToShow.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{ta.noCustomers}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {customersToShow.map((membership: CustomerMembership) => (
              <li
                key={membership.customerId}
                className="flex items-center justify-between py-3 text-sm"
              >
                <span className="font-medium text-slate-900">
                  {membership.customerName ?? membership.customerId}
                </span>
                <span className="flex flex-wrap gap-1">
                  {membership.roles.map((role) => (
                    <span
                      key={role}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"
                    >
                      {customerRoleLabel(role)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
