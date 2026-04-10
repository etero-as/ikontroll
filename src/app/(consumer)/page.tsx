'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export default function ConsumerRedirectPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  useEffect(() => {
    router.replace('/my-courses');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
      {t.common.loading}
    </div>
  );
}

