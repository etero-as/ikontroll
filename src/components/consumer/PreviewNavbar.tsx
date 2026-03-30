'use client';

import { Suspense } from 'react';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';

const getPreviewNavLabels = (locale: string) => {
  switch (locale) {
    case 'en':
      return {
        myCourses: 'My courses',
        myProfile: 'My profile',
        previewBadge: 'Preview',
        navTooltip: 'Not available in preview',
        brandTooltip: 'Not available in preview',
        avatarTooltip: 'Not available in preview',
      };
    default:
      return {
        myCourses: 'Mine kurs',
        myProfile: 'Min profil',
        previewBadge: 'Forhåndsvisning',
        navTooltip: 'Ikke tilgjengelig i forhåndsvisning',
        brandTooltip: 'Ikke tilgjengelig i forhåndsvisning',
        avatarTooltip: 'Ikke tilgjengelig i forhåndsvisning',
      };
  }
};

function PreviewNavbarContent() {
  const { locale, setLocale } = useLocale();
  const { profile } = useAuth();
  const labels = getPreviewNavLabels(locale);

  const initials = profile
    ? `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`
        .trim()
        .toUpperCase() || '?'
    : '?';

  return (
    <header className="sticky top-0 z-40 flex min-h-16 items-center border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-8">
          <div className="group relative">
            <span className="cursor-not-allowed select-none text-xl font-bold text-slate-300">
              IKontroll
            </span>
            <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-max rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg group-hover:block">
              {labels.brandTooltip}
            </div>
          </div>
          <nav className="hidden md:flex md:gap-6">
            <div className="group relative">
              <span className="cursor-not-allowed select-none text-sm font-medium text-slate-300">
                {labels.myCourses}
              </span>
              <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-max rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg group-hover:block">
                {labels.navTooltip}
              </div>
            </div>
            <div className="group relative">
              <span className="cursor-not-allowed select-none text-sm font-medium text-slate-300">
                {labels.myProfile}
              </span>
              <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-max rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg group-hover:block">
                {labels.navTooltip}
              </div>
            </div>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600">
            {labels.previewBadge}
          </span>
          <LanguageSwitcher locale={locale} onChange={setLocale} />
          <div className="group relative">
            <div className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full bg-slate-200 text-sm font-bold select-none text-slate-400">
              {initials}
            </div>
            <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden w-max rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg group-hover:block">
              {labels.avatarTooltip}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function PreviewNavbar() {
  return (
    <Suspense>
      <PreviewNavbarContent />
    </Suspense>
  );
}
