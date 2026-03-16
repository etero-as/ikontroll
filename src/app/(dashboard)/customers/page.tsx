'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';

import CustomerManager from './CustomerManager';

export default function CustomersPage() {
  const { isSystemOwner, isCustomerAdmin, activeCustomerId, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirectedRef = useRef(false);
  const redirectPath = activeCustomerId ? `/customers/${activeCustomerId}` : null;

  useEffect(() => {
    const shouldRedirect =
      !loading &&
      !isSystemOwner &&
      isCustomerAdmin &&
      Boolean(redirectPath) &&
      pathname !== redirectPath;

    if (shouldRedirect && redirectPath && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      router.replace(redirectPath);
      return;
    }

    if (!shouldRedirect) {
      hasRedirectedRef.current = false;
    }
  }, [isCustomerAdmin, isSystemOwner, loading, pathname, redirectPath, router]);

  if (!isSystemOwner) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Denne siden er kun tilgjengelig for systemeiere.
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Administrasjon
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">Kunder</h1>
        <p className="text-sm text-slate-500">
          Opprett, rediger og administrer kunder knyttet til valgt selskap.
        </p>
      </div>

      <CustomerManager />
    </section>
  );
}

