'use client';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export const PortalModePrompt = () => {
  const { needsRoleChoice, setPortalMode } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  if (!needsRoleChoice) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 text-center shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.portalMode.selectMode}
        </p>
        <h2 className="text-2xl font-semibold text-slate-900">
          {t.portalMode.howToUse}
        </h2>
        <p className="text-sm text-slate-600">
          {t.portalMode.description}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setPortalMode('admin')}
            className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {t.portalMode.admin}
          </button>
          <button
            onClick={() => setPortalMode('user')}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {t.portalMode.user}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortalModePrompt;


