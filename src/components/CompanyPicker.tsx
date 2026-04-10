'use client';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export const CompanyPicker = () => {
  const { profile, companyId, setCompanyId, isSystemOwner } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  if (!profile || !isSystemOwner) {
    return null;
  }

  const adminCompanies = profile.companyIds.filter((company) =>
    company.roles.includes('admin'),
  );

  if (adminCompanies.length <= 1 || companyId) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{t.admin.companyPicker.title}</h2>
          <p className="text-sm text-slate-500">
            {t.admin.companyPicker.description}
          </p>
        </div>

        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {adminCompanies.map((company) => (
            <button
              key={company.companyId}
              onClick={() => setCompanyId(company.companyId)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-400 hover:bg-slate-50"
            >
              <div className="font-medium text-slate-900">
                {company.displayName ?? company.companyId}
              </div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {company.roles.join(', ')}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

