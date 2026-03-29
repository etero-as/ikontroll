'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { sendPasswordResetEmail } from 'firebase/auth';

import { useAuth } from '@/context/AuthContext';
import { useCustomers } from '@/hooks/useCustomers';
import { auth } from '@/lib/firebase';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import type { Customer, CustomerPayload } from '@/types/customer';

type BrregSuggestion = {
  orgNumber: string;
  companyName: string;
  address: string;
  postalCode: string;
  city: string;
};

const splitContactName = (fullName: string) => {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: 'Kontakt', lastName: 'Person' };
  }
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.length ? rest.join(' ') : firstName,
  };
};

const extractApiErrorMessage = async (response: Response) => {
  const text = await response.text();
  try {
    const data = text ? (JSON.parse(text) as { error?: string }) : null;
    if (data?.error) {
      return data.error;
    }
  } catch {
    // ignore JSON parse errors
  }
  return text || `Serverfeil (${response.status})`;
};

const passwordSchema = z
  .string()
  .min(8, 'Passord må være minst 8 tegn')
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Passord må inneholde både bokstaver og tall');

const customerSchema = z.object({
  companyName: z.string().min(2, 'Firmanavn må være minst 2 tegn'),
  address: z.string().min(2, 'Adresse må fylles ut'),
  zipno: z.string().min(4, 'Postnr må være minst 4 tegn'),
  place: z.string().min(2, 'Poststed må fylles ut'),
  vatNumber: z.string().min(1, 'Org.nr/VAT må fylles ut'),
  status: z.enum(['active', 'inactive']),
  allowSubunits: z.boolean().default(false),
  contactPerson: z.string().min(2, 'Kontaktperson må fylles ut'),
  contactPhone: z.string().min(4, 'Telefon må fylles ut'),
  contactEmail: z.string().email('Ugyldig e-postadresse'),
  contactPassword: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.trim() : undefined),
      passwordSchema,
    )
    .optional(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

type ResetStatus = {
  type: 'success' | 'error';
  message: string;
};

const defaultValues: CustomerFormValues = {
  companyName: '',
  address: '',
  zipno: '',
  place: '',
  vatNumber: '',
  status: 'active',
  allowSubunits: false,
  contactPerson: '',
  contactPhone: '',
  contactEmail: '',
  contactPassword: '',
};

const statusBadges: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-slate-100 text-slate-600',
};

export default function CustomerManager() {
  const { companyId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const {
    customers,
    loading,
    error,
    createCustomer,
    updateCustomer,
    deleteCustomer,
  } = useCustomers(companyId ?? null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetStatus, setResetStatus] = useState<ResetStatus | null>(null);
  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [suggestions, setSuggestions] = useState<BrregSuggestion[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);
  const companyNameInputRef = useRef<HTMLInputElement>(null);
  const skipLookupRef = useRef(false);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema) as Resolver<CustomerFormValues>,
    defaultValues,
    shouldUnregister: true,
  });
  const {
    ref: companyNameFieldRef,
    ...companyNameFieldProps
  } = form.register('companyName');
  const companyNameValue = form.watch('companyName');

  const createContactAdminUser = useCallback(
    async (
      customerId: string,
      password: string,
      values: CustomerFormValues,
    ) => {
      if (!companyId) {
        throw new Error(t.admin.customers.noCompanySelected);
      }
      const trimmedPassword = password.trim();
      if (!trimmedPassword) {
        throw new Error(t.admin.customers.contactPasswordRequired);
      }
      const { firstName, lastName } = splitContactName(values.contactPerson);
      const response = await fetch('/api/company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          customerId,
          customerName: values.companyName,
          user: {
            firstName,
            lastName,
            email: values.contactEmail,
            phone: values.contactPhone,
            roles: ['admin'],
            status: 'active',
          },
          password: trimmedPassword,
        }),
      });
      if (!response.ok) {
        const message = await extractApiErrorMessage(response);
        throw new Error(message ?? t.admin.customers.cannotCreateContact);
      }
    },
    [companyId, t],
  );

  useEffect(() => {
    if (!isFormOpen) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (skipLookupRef.current) {
      skipLookupRef.current = false;
      return;
    }

    const value = companyNameValue?.trim() ?? '';

    if (!value) {
      setShowSuggestions(false);
      setSuggestions([]);
      setSuggestionError(null);
      return;
    }
    if (value.length < 3) {
      setSuggestions([]);
      setSuggestionError(null);
      setShowSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setSuggestionLoading(true);
        setSuggestionError(null);
        const response = await fetch(
          `/api/brreg/search?q=${encodeURIComponent(value)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error('Ikke-ok respons');
        }
        const data = (await response.json()) as BrregSuggestion[];
        setSuggestions(data);
        setShowSuggestions(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Brreg lookup failed', err);
        setSuggestionError('Kunne ikke hente data fra Brreg');
        setSuggestions([]);
        setShowSuggestions(true);
      } finally {
        if (!controller.signal.aborted) setSuggestionLoading(false);
      }
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [companyNameValue, isFormOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionRef.current &&
        !suggestionRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openCreate = () => {
    setEditingCustomer(null);
    form.reset(defaultValues);
    setIsFormOpen(true);
    setFormError(null);
    setResetStatus(null);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSuggestionSelect = (suggestion: BrregSuggestion) => {
    skipLookupRef.current = true;
    form.setValue('companyName', suggestion.companyName, {
      shouldValidate: true,
    });
    if (suggestion.orgNumber) {
      form.setValue('vatNumber', suggestion.orgNumber, { shouldValidate: true });
    }
    if (suggestion.address) {
      form.setValue('address', suggestion.address, { shouldValidate: true });
    }
    if (suggestion.postalCode) {
      form.setValue('zipno', suggestion.postalCode, { shouldValidate: true });
    }
    if (suggestion.city) {
      form.setValue('place', suggestion.city, { shouldValidate: true });
    }

    setSuggestionError(null);
    setShowSuggestions(false);
    setSuggestions([]);
    requestAnimationFrame(() => {
      companyNameInputRef.current?.blur();
    });
  };

  const openEdit = useCallback(
    (customer: Customer) => {
      skipLookupRef.current = true;
      setEditingCustomer(customer);
      form.reset({
        companyName: customer.companyName,
        address: customer.address,
        zipno: customer.zipno,
        place: customer.place,
        vatNumber: customer.vatNumber,
        status: customer.status,
        allowSubunits: customer.allowSubunits ?? false,
        contactPerson: customer.contactPerson,
        contactPhone: customer.contactPhone,
        contactEmail: customer.contactEmail,
        contactPassword: '',
      });
      setIsFormOpen(true);
      setFormError(null);
      setResetStatus(null);
      setSuggestions([]);
      setShowSuggestions(false);
    },
    [form],
  );

  const closeForm = () => {
    if (busy) return;
    setIsFormOpen(false);
    setEditingCustomer(null);
    setFormError(null);
    setResetStatus(null);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSendResetPassword = useCallback(async () => {
    const email = form.getValues('contactEmail')?.trim();
    if (!email) {
      setResetStatus({ type: 'error', message: t.admin.customers.contactMissing });
      return;
    }
    try {
      setResetBusy(true);
      setResetStatus(null);
      await sendPasswordResetEmail(auth, email);
      setResetStatus({ type: 'success', message: t.admin.customers.resetSent });
    } catch (err) {
      console.error('Failed to send reset password email', err);
      const code =
        typeof err === 'object' && err && 'code' in err
          ? (err as { code?: string }).code
          : null;
      const message =
        code === 'auth/user-not-found'
          ? t.admin.customers.userNotFound
          : code === 'auth/invalid-email'
            ? t.admin.customers.invalidEmail
            : code === 'auth/too-many-requests'
              ? t.admin.customers.tooManyRequests
              : t.admin.customers.resetError;
      setResetStatus({ type: 'error', message });
    } finally {
      setResetBusy(false);
    }
  }, [form, t]);

  const onSubmit = async (values: CustomerFormValues) => {
    const { contactPassword, ...customerValues } = values;
    try {
      setBusy(true);
      setFormError(null);
      const payload: CustomerPayload = { ...customerValues };

      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, payload);
      } else {
        if (!contactPassword?.trim()) {
          setFormError(t.admin.customers.contactPasswordRequired);
          setBusy(false);
          return;
        }
        let createdCustomerId: string | null = null;
        try {
          createdCustomerId = await createCustomer(payload);
          await createContactAdminUser(createdCustomerId, contactPassword, values);
        } catch (err) {
          if (createdCustomerId) {
            await deleteCustomer(createdCustomerId).catch((deleteErr) =>
              console.error('Kunne ikke rulle tilbake opprettet kunde', deleteErr),
            );
          }
          throw err;
        }
      }
      setIsFormOpen(false);
      setEditingCustomer(null);
      form.reset(defaultValues);
    } catch (err) {
      console.error('Failed to save customer', err);
      setFormError(err instanceof Error ? err.message : t.admin.customers.saveError);
    } finally {
      setBusy(false);
    }
  };

  const toggleExpanded = useCallback((customerId: string) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  }, []);

  const customerChildrenMap = useMemo(() => {
    const map = new Map<string, Customer[]>();
    customers.forEach((customer) => {
      if (!customer.parentCustomerId) return;
      const current = map.get(customer.parentCustomerId) ?? [];
      current.push(customer);
      map.set(customer.parentCustomerId, current);
    });
    map.forEach((list) =>
      list.sort((a, b) => a.companyName.localeCompare(b.companyName)),
    );
    return map;
  }, [customers]);

  const topLevelCustomers = useMemo(() => {
    const ids = new Set(customers.map((customer) => customer.id));
    const roots = customers.filter(
      (customer) => !customer.parentCustomerId || !ids.has(customer.parentCustomerId),
    );
    return [...roots].sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [customers]);

  const expandableCustomerIds = useMemo(
    () => Array.from(customerChildrenMap.keys()),
    [customerChildrenMap],
  );

  const handleExpandAll = useCallback(() => {
    setExpandedCustomerIds(new Set(expandableCustomerIds));
  }, [expandableCustomerIds]);

  const handleCollapseAll = useCallback(() => {
    setExpandedCustomerIds(new Set());
  }, []);

  const handleDelete = useCallback(
    async (customer: Customer) => {
      const confirmed = window.confirm(t.admin.customers.deleteConfirm(customer.companyName));
      if (!confirmed) return;
      try {
        await deleteCustomer(customer.id);
      } catch (err) {
        console.error('Failed to delete customer', err);
        alert(t.admin.customers.deleteError);
      }
    },
    [deleteCustomer, t],
  );

  const tableRows = useMemo(() => {
    if (!customers.length) {
      return (
        <tr>
          <td colSpan={5} className="py-10 text-center text-sm text-slate-500">
            {t.admin.customers.noCustomers}
          </td>
        </tr>
      );
    }

    const renderRows = (customer: Customer, depth: number): React.ReactNode[] => {
      const children = customerChildrenMap.get(customer.id) ?? [];
      const hasChildren = children.length > 0;
      const isExpanded = expandedCustomerIds.has(customer.id);

      const row = (
        <tr key={customer.id} className="border-b border-slate-100 text-sm last:border-none">
          <td className="py-3">
            <div className="flex items-start gap-2" style={{ paddingLeft: depth * 24 }}>
              <div className="flex h-6 w-6 items-center justify-center">
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(customer.id)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    aria-label={
                      isExpanded
                        ? t.admin.customers.hideSubunits(customer.companyName)
                        : t.admin.customers.showSubunits(customer.companyName)
                    }
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="inline-block h-6 w-6" />
                )}
              </div>
              <div>
                <p className="font-semibold text-slate-900">{customer.companyName}</p>
                <p className="text-xs text-slate-500">
                  {customer.address}, {customer.zipno} {customer.place}
                </p>
                {customer.parentCustomerId && (
                  <p className="text-xs font-semibold text-slate-400">
                    {t.admin.customers.subunit}
                  </p>
                )}
              </div>
            </div>
          </td>
          <td className="py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{customer.contactPerson}</p>
              <p className="text-xs text-slate-500">{customer.contactEmail}</p>
              <p className="text-xs text-slate-500">{customer.contactPhone}</p>
            </div>
          </td>
          <td className="py-3">
            <div className="flex flex-col gap-1">
              <span className={`inline-flex w-fit rounded-full px-2 py-1 text-xs font-medium ${statusBadges[customer.status]}`}>
                {customer.status === 'active' ? t.admin.customers.active : t.admin.customers.inactive}
              </span>
              {customer.allowSubunits && (
                <span className="text-xs font-semibold text-emerald-600">
                  {t.admin.customers.subunits}
                </span>
              )}
            </div>
          </td>
          <td className="py-3 text-sm text-slate-600">{customer.vatNumber}</td>
          <td className="py-3 text-right">
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href={`/customers/${customer.id}`}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label={t.admin.customers.manageUsersAria}
              >
                <span className="text-xs font-semibold">🎓</span>
              </Link>
              <button
                onClick={() => openEdit(customer)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label={t.admin.customers.editCustomerAria}
              >
                <span className="text-xs font-semibold">✏️</span>
              </button>
              <button
                onClick={() => handleDelete(customer)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-600 transition hover:border-red-300 hover:bg-red-50"
                aria-label={t.admin.customers.deleteCustomerAria}
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 5 5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      );

      if (!hasChildren || !isExpanded) return [row];
      const childRows = children.flatMap((child) => renderRows(child, depth + 1));
      return [row, ...childRows];
    };

    return topLevelCustomers.flatMap((customer) => renderRows(customer, 0));
  }, [
    customers,
    customerChildrenMap,
    expandedCustomerIds,
    handleDelete,
    openEdit,
    toggleExpanded,
    topLevelCustomers,
    t,
  ]);

  if (!companyId) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        {t.admin.customers.selectCompanyFirst}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t.admin.customers.managerTitle}</h2>
            <p className="text-sm text-slate-500">{t.admin.customers.managerSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleExpandAll}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              disabled={!expandableCustomerIds.length}
            >
              {t.admin.customers.expandAll}
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              disabled={!expandableCustomerIds.length}
            >
              {t.admin.customers.collapseAll}
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t.admin.customers.newCustomer}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            {t.admin.customers.loadingCustomers}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2">{t.admin.customers.company}</th>
                  <th className="pb-2">{t.admin.customers.contact}</th>
                  <th className="pb-2">{t.admin.customers.status}</th>
                  <th className="pb-2">{t.admin.customers.orgNumber}</th>
                  <th className="pb-2 text-right">{t.admin.customers.actions}</th>
                </tr>
              </thead>
              <tbody>{tableRows}</tbody>
            </table>
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {editingCustomer ? t.admin.customers.editCustomerLabel : t.admin.customers.newCustomerLabel}
                </p>
                <h3 className="text-2xl font-semibold text-slate-900">
                  {editingCustomer ? editingCustomer.companyName : t.admin.customers.customerInfo}
                </h3>
              </div>
              <button
                onClick={closeForm}
                className="text-slate-400 transition hover:text-slate-700"
                aria-label={t.admin.customers.closeForm}
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {formError}
              </div>
            )}

            <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2" ref={suggestionRef}>
                  <Field
                    label={t.admin.customers.companyName}
                    error={form.formState.errors.companyName?.message}
                    hint={t.admin.customers.companyNameHint}
                  >
                    <input
                      {...companyNameFieldProps}
                      ref={(element) => {
                        companyNameInputRef.current = element;
                        if (typeof companyNameFieldRef === 'function') {
                          companyNameFieldRef(element);
                        }
                      }}
                      onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </Field>
                  {showSuggestions && (
                    <div className="relative">
                      <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        {suggestionLoading && (
                          <p className="px-4 py-3 text-sm text-slate-500">
                            {t.admin.customers.searchingBrreg}
                          </p>
                        )}
                        {suggestionError && (
                          <p className="px-4 py-3 text-sm text-red-600">{suggestionError}</p>
                        )}
                        {!suggestionLoading && !suggestionError && suggestions.map((suggestion) => {
                          const locationText = [
                            suggestion.address?.trim(),
                            `${suggestion.postalCode} ${suggestion.city}`.trim(),
                          ].filter((part) => part && part !== '').join(', ');
                          return (
                            <button
                              key={suggestion.orgNumber}
                              type="button"
                              onMouseDown={(event) => { event.preventDefault(); handleSuggestionSelect(suggestion); }}
                              className="flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-slate-50 last:border-none"
                            >
                              <span className="font-semibold text-slate-900">{suggestion.companyName}</span>
                              <span className="text-xs text-slate-500">Org.nr {suggestion.orgNumber}</span>
                              {locationText && <span className="text-xs text-slate-500">{locationText}</span>}
                            </button>
                          );
                        })}
                        {!suggestionLoading && !suggestionError && !suggestions.length && (
                          <p className="px-4 py-3 text-sm text-slate-500">{t.admin.customers.noResults}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <Field label={t.admin.customers.orgVat} error={form.formState.errors.vatNumber?.message}>
                  <input {...form.register('vatNumber')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                </Field>
                <Field label={t.admin.customers.address} error={form.formState.errors.address?.message}>
                  <input {...form.register('address')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t.admin.customers.zipCode} error={form.formState.errors.zipno?.message}>
                    <input {...form.register('zipno')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                  </Field>
                  <Field label={t.admin.customers.city} error={form.formState.errors.place?.message}>
                    <input {...form.register('place')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                  </Field>
                </div>
                <Field label={t.admin.customers.status} error={form.formState.errors.status?.message}>
                  <select {...form.register('status')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200">
                    <option value="active">{t.admin.customers.active}</option>
                    <option value="inactive">{t.admin.customers.inactive}</option>
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                    <input
                      type="checkbox"
                      {...form.register('allowSubunits')}
                      className="mt-1 h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                    />
                    <div className="text-sm">
                      <p className="font-semibold text-slate-900">{t.admin.customers.allowSubunitsLabel}</p>
                      <p className="text-xs text-slate-500">{t.admin.customers.allowSubunitsHint}</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.admin.customers.contactPerson} error={form.formState.errors.contactPerson?.message}>
                  <input {...form.register('contactPerson')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                </Field>
                <Field label={t.admin.customers.phone} error={form.formState.errors.contactPhone?.message}>
                  <input {...form.register('contactPhone')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                </Field>
                <Field label={t.admin.customers.email} error={form.formState.errors.contactEmail?.message}>
                  <input type="email" {...form.register('contactEmail')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                </Field>
                {editingCustomer && (
                  <div className="md:col-span-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleSendResetPassword}
                      className="w-fit rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-70"
                      disabled={busy || resetBusy}
                    >
                      {resetBusy ? t.admin.customers.sendingLink : t.admin.customers.sendResetLink}
                    </button>
                    {resetStatus && (
                      <p className={`text-sm ${resetStatus.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {resetStatus.message}
                      </p>
                    )}
                  </div>
                )}
                {!editingCustomer && (
                  <Field label={t.admin.customers.password} error={form.formState.errors.contactPassword?.message}>
                    <input type="text" {...form.register('contactPassword')} className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                  </Field>
                )}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  disabled={busy}
                >
                  {t.admin.customers.cancel}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
                >
                  {busy ? t.admin.customers.saving : editingCustomer ? t.admin.customers.updateCustomer : t.admin.customers.createCustomer}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

type FieldProps = {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
};

const Field = ({ label, error, hint, children }: FieldProps) => (
  <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
    <span>{label}</span>
    {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
    {children}
    {error && <span className="text-xs text-red-600">{error}</span>}
  </label>
);

