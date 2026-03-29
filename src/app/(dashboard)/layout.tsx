'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { CompanyPicker } from '@/components/CompanyPicker';
import { CustomerPicker } from '@/components/CustomerPicker';
import PortalModePrompt from '@/components/PortalModePrompt';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const {
    firebaseUser,
    profile,
    loading,
    isSystemOwner,
    isCustomerAdmin,
    hasConsumerAccess,
    portalMode,
    needsRoleChoice,
    activeCustomerId,
    customerMemberships,
    logout,
  } = useAuth();
  const router = useRouter();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace('/login');
    }
  }, [firebaseUser, loading, router]);

  useEffect(() => {
    if (
      !loading &&
      !needsRoleChoice &&
      portalMode === 'user' &&
      hasConsumerAccess
    ) {
      router.replace('/my-courses');
    }
  }, [hasConsumerAccess, loading, needsRoleChoice, portalMode, router]);

  if (loading) {
    return (
      <div className="flex h-screen flex-col bg-slate-50">
        <Topbar />
        <main className="flex flex-1 items-center justify-center bg-slate-50">
          <p className="text-sm font-semibold text-slate-500">{t.admin.layout.preparing}</p>
        </main>
      </div>
    );
  }

  const hasAccess = isSystemOwner || isCustomerAdmin;

  if (firebaseUser && profile && !hasAccess) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 text-center">
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="space-y-2">
            <p className="text-xl font-semibold text-slate-900">
              {t.admin.layout.noAdminAccess}
            </p>
            <p className="max-w-md text-sm text-slate-500">
              {t.admin.layout.noAdminAccessDescription}
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {t.admin.layout.backToLogin}
          </button>
        </div>
      </div>
    );
  }

  if (isCustomerAdmin && customerMemberships.length > 0 && !activeCustomerId) {
    return (
      <div className="flex h-screen flex-col bg-slate-50">
        <Topbar />
        <CustomerPicker />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <PortalModePrompt />
      <Topbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-slate-50 p-6">{children}</main>
      </div>
      {isSystemOwner && <CompanyPicker />}
      {isCustomerAdmin && <CustomerPicker />}
    </div>
  );
}
