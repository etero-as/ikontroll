'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

import CourseManager from './CourseManager';

export default function CoursesPage() {
  const { isSystemOwner, isCustomerAdmin, activeCustomerId, loading } = useAuth();
  const router = useRouter();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  useEffect(() => {
    if (!loading && !isSystemOwner && isCustomerAdmin && activeCustomerId) {
      router.replace(`/customers/${activeCustomerId}`);
    }
  }, [activeCustomerId, isCustomerAdmin, isSystemOwner, loading, router]);

  if (!isSystemOwner) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {t.admin.courses.ownerOnly}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.admin.courses.pageSectionLabel}
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{t.admin.courses.pageTitle}</h1>
        <p className="text-sm text-slate-500">{t.admin.courses.pageSubtitle}</p>
      </div>
      <CourseManager />
    </section>
  );
}

