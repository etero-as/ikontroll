'use client';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useCustomer } from '@/hooks/useCustomer';
import { getTranslation } from '@/utils/translations';
import CompanyUsersManager from '../customers/[customerId]/CompanyUsersManager';

export default function CustomerUsersPage() {
  const { isCustomerAdmin, activeCustomerId, customerMemberships, loading } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const router = useRouter();

  if (!loading && (!isCustomerAdmin || !activeCustomerId)) {
    router.replace('/dashboard');
  }

  const membership = customerMemberships.find(
    (entry) => entry.customerId === activeCustomerId,
  );
  const { customer, loading: customerLoading } = useCustomer(null, activeCustomerId ?? null);

  if (!activeCustomerId || !membership) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {t.admin.dashboard.selectCustomer}
      </section>
    );
  }

  if (customerLoading || !customer?.createdByCompanyId) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {t.admin.subunits.loadingCustomer}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.admin.customerDetail.users.title}
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">
          {customer?.companyName ?? membership.customerName ?? membership.customerId}
        </h1>
        <p className="text-sm text-slate-500">{t.admin.customerUsers.manageAccessSubtitle}</p>
      </div>
      <CompanyUsersManager
        ownerCompanyId={customer.createdByCompanyId}
        customerId={activeCustomerId}
        customerName={membership.customerName ?? membership.customerId}
      />
    </section>
  );
}

