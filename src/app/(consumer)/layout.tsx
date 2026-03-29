'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import ConsumerNavbar from '@/components/consumer/ConsumerNavbar';
import PortalModePrompt from '@/components/PortalModePrompt';
import { useAuth } from '@/context/AuthContext';
import { LocaleProvider } from '@/context/LocaleContext';

export default function ConsumerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    loading,
    firebaseUser,
    portalMode,
    needsRoleChoice,
    isCustomerAdmin,
    isSystemOwner,
    profile,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.push('/login');
    }
  }, [loading, firebaseUser, router]);

  const requiresProfileCompletion =
    portalMode === 'user' &&
    Boolean(firebaseUser) &&
    (!profile?.firstName?.trim() || !profile?.lastName?.trim());

  useEffect(() => {
    if (loading) {
      return;
    }
    const bypassKey =
      typeof window !== 'undefined' && firebaseUser
        ? `profileCompletionBypass_${firebaseUser.uid}`
        : null;
    const bypass = bypassKey
      ? window.sessionStorage.getItem(bypassKey) === 'true'
      : false;
    if (requiresProfileCompletion && !bypass && pathname !== '/complete-profile') {
      router.replace('/complete-profile');
      return;
    }
    if (!requiresProfileCompletion && pathname === '/complete-profile' && portalMode === 'user') {
      if (bypassKey) {
        window.sessionStorage.removeItem(bypassKey);
      }
      router.replace('/my-courses');
    }
  }, [firebaseUser, loading, pathname, portalMode, requiresProfileCompletion, router]);

  useEffect(() => {
    const hasAdminAccess = isSystemOwner || isCustomerAdmin;
    if (!loading && !needsRoleChoice && portalMode === 'admin' && hasAdminAccess) {
      router.replace('/dashboard');
    }
  }, [isCustomerAdmin, isSystemOwner, loading, needsRoleChoice, portalMode, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        Laster ...
      </div>
    );
  }

  if (!firebaseUser) {
    return null;
  }

  return (
    <LocaleProvider>
      <div className="min-h-screen bg-slate-50 pb-20 md:pb-0">
        <PortalModePrompt />
        <ConsumerNavbar />
        <main className="mx-auto max-w-5xl p-4 md:p-8">{children}</main>
      </div>
    </LocaleProvider>
  );
}
