'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useCustomer } from '@/hooks/useCustomer';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export const Sidebar = () => {
  const pathname = usePathname();
  const { isSystemOwner, isCustomerAdmin, activeCustomerId } = useAuth();
  const shouldLoadCustomer = isCustomerAdmin ? activeCustomerId ?? null : null;
  const { customer: activeCustomer } = useCustomer(null, shouldLoadCustomer);
  const { locale } = useLocale();
  const t = getTranslation(locale);

  const ownerNavItems = useMemo(
    () => [
      { href: '/dashboard', label: t.admin.sidebar.nav.dashboard },
      { href: '/customers', label: t.admin.sidebar.nav.customers },
      { href: '/courses', label: t.admin.sidebar.nav.courses },
      { href: '/templates', label: t.admin.sidebar.nav.templates },
      { href: '/media', label: t.admin.sidebar.nav.mediaLibrary },
    ],
    [t]
  );

  const baseCustomerNavItems = useMemo(
    () => [
      { href: '/dashboard', label: t.admin.sidebar.nav.dashboard },
      { href: '/customer-courses', label: t.admin.sidebar.nav.courses },
      { href: '/customer-users', label: t.admin.sidebar.nav.users },
    ],
    [t]
  );

  const subunitNavItem = useMemo(
    () => ({
      href: '/customer-subunits',
      label: t.admin.sidebar.nav.subunits,
    }),
    [t]
  );

  const customerNavItems = useMemo(
    () => {
      if (!isCustomerAdmin) return [];
      if (activeCustomer?.allowSubunits) {
        return [baseCustomerNavItems[0], subunitNavItem, ...baseCustomerNavItems.slice(1)];
      }
      return baseCustomerNavItems;
    },
    [isCustomerAdmin, activeCustomer?.allowSubunits, baseCustomerNavItems, subunitNavItem]
  );

  const navItems = isSystemOwner ? ownerNavItems : customerNavItems;

  return (
    <aside className="w-64 border-r border-slate-200 bg-white">
      <nav className="space-y-1 p-4">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {!navItems.length && (
          <p className="text-sm text-slate-500">{t.admin.sidebar.noNavAvailable}</p>
        )}
      </nav>
    </aside>
  );
};
