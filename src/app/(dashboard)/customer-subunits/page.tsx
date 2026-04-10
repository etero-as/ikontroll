'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useCustomer } from '@/hooks/useCustomer';
import { useCustomerSubunits } from '@/hooks/useCustomerSubunits';
import { useCourses } from '@/hooks/useCourses';
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

const optionalPhone = z
  .union([z.string().trim().min(4, 'Telefon må være minst 4 tegn'), z.literal('')])
  .optional();

const customerSchema = z.object({
  companyName: z.string().min(2, 'Firmanavn må være minst 2 tegn'),
  address: z.string().min(2, 'Adresse må fylles ut'),
  zipno: z.string().min(4, 'Postnr må være minst 4 tegn'),
  place: z.string().min(2, 'Poststed må fylles ut'),
  vatNumber: z.string().min(1, 'Org.nr/VAT må fylles ut'),
  status: z.enum(['active', 'inactive']),
  allowSubunits: z.boolean().default(false),
  contactPerson: z.string().min(2, 'Kontaktperson må fylles ut'),
  contactPhone: optionalPhone,
  contactEmail: z.string().email('Ugyldig e-postadresse'),
  contactPassword: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.trim() : undefined),
      passwordSchema,
    )
    .optional(),
  courseIds: z
    .array(z.string())
    .min(1, 'Velg minst ett kurs')
    .default([]),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

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
  courseIds: [],
};

const statusBadges: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-slate-100 text-slate-600',
};

const ensureNorwegianPhone = (input?: string) => {
  const trimmed = input?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('+')) {
    return trimmed;
  }
  const digits = trimmed.replace(/\s+/g, '');
  if (digits.startsWith('0047')) {
    return `+47${digits.slice(4)}`;
  }
  if (digits.startsWith('47')) {
    return `+${digits}`;
  }
  if (digits.startsWith('0')) {
    return `+47${digits.slice(1)}`;
  }
  return `+47${digits}`;
};

export default function CustomerSubunitsPage() {
  const { activeCustomerId, isCustomerAdmin, customerMemberships, loading } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!isCustomerAdmin || !activeCustomerId)) {
      router.replace('/dashboard');
    }
  }, [activeCustomerId, isCustomerAdmin, loading, router]);

  const membership = customerMemberships.find(
    (entry) => entry.customerId === activeCustomerId,
  );
  const {
    customer,
    loading: customerLoading,
    error,
  } = useCustomer(null, activeCustomerId ?? null);

  const customerName =
    customer?.companyName ?? membership?.customerName ?? activeCustomerId ?? '';

  const isReadyForManager =
    isCustomerAdmin &&
    !!activeCustomerId &&
    !customerLoading &&
    !error &&
    customer?.allowSubunits;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.admin.sidebar.nav.subunits}
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">
          {t.admin.subunits.pageTitle}
        </h1>
        <p className="text-sm text-slate-500">
          {customerLoading
            ? t.admin.subunits.loadingCustomer
            : t.admin.subunits.activeCustomer(customerName)}
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {!error && !customerLoading && !customer?.allowSubunits && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          {t.admin.subunits.subunitsNotEnabled}
        </div>
      )}

      {isReadyForManager && customer && (
        <SubunitManager customer={customer} />
      )}
    </section>
  );
}

const SubunitManager = ({ customer }: { customer: Customer }) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const ownerCompanyId = customer.createdByCompanyId ?? null;
  const { courses } = useCourses(ownerCompanyId ?? null);
  const {
    subunits,
    loading,
    error,
    createSubunit,
    updateSubunit,
    deleteSubunit,
  } = useCustomerSubunits(customer.id, ownerCompanyId);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
    async (customerId: string, password: string, values: CustomerFormValues) => {
      if (!ownerCompanyId) {
        throw new Error(t.admin.subunits.missingOwner);
      }
      const trimmedPassword = password.trim();
      if (!trimmedPassword) {
        throw new Error(t.admin.subunits.contactPasswordRequired);
      }
      const { firstName, lastName } = splitContactName(values.contactPerson);
      const normalizedPhone = ensureNorwegianPhone(values.contactPhone);
      const response = await fetch('/api/company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: ownerCompanyId,
          customerId,
          customerName: values.companyName,
          user: {
            firstName,
            lastName,
            email: values.contactEmail,
            phone: normalizedPhone,
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
    [ownerCompanyId, t.admin.subunits.missingOwner, t.admin.subunits.contactPasswordRequired, t.admin.customers.cannotCreateContact],
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
        setSuggestionError(t.admin.customers.brrregError);
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
  }, [companyNameValue, isFormOpen, t.admin.customers.brrregError]);

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

  const subunitsSorted = useMemo(
    () => [...subunits].sort((a, b) => a.companyName.localeCompare(b.companyName)),
    [subunits],
  );
  const availableCourses = useMemo(
    () =>
      courses
        .map((course) => ({
          id: course.id,
          title:
            typeof course.title === 'object'
              ? course.title.no ?? course.title.en ?? t.common.untitled
              : course.title ?? t.common.untitled,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [courses, t.common.untitled],
  );

  const openCreate = () => {
    setEditingCustomer(null);
    form.reset({ ...defaultValues, allowSubunits: false });
    setIsFormOpen(true);
    setFormError(null);
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

  const openEdit = (subunit: Customer) => {
    skipLookupRef.current = true;
    setEditingCustomer(subunit);
    form.reset({
      companyName: subunit.companyName,
      address: subunit.address,
      zipno: subunit.zipno,
      place: subunit.place,
      vatNumber: subunit.vatNumber,
      status: subunit.status,
      allowSubunits: subunit.allowSubunits ?? false,
      contactPerson: subunit.contactPerson,
      contactPhone: subunit.contactPhone,
      contactEmail: subunit.contactEmail,
      courseIds: subunit.courseIds ?? [],
    });
    setIsFormOpen(true);
    setFormError(null);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const closeForm = () => {
    if (busy) return;
    setIsFormOpen(false);
    setEditingCustomer(null);
    setFormError(null);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const onSubmit = async (values: CustomerFormValues) => {
    if (!customer.id) return;
    const { contactPassword, ...customerValues } = values;
    try {
      setBusy(true);
      setFormError(null);
      const payload: CustomerPayload = {
        ...customerValues,
        contactPhone: customerValues.contactPhone?.trim() ?? '',
        contactPerson: customerValues.contactPerson.trim(),
        contactEmail: customerValues.contactEmail.trim(),
        allowSubunits: customerValues.allowSubunits ?? false,
        parentCustomerId: customer.id,
        parentCustomerName: customer.companyName,
      };

      if (editingCustomer) {
        await updateSubunit(editingCustomer.id, payload);
      } else {
        if (!ownerCompanyId) {
          setFormError(t.admin.subunits.ownerNotFound);
          setBusy(false);
          return;
        }
        if (!contactPassword?.trim()) {
          setFormError(t.admin.subunits.contactPasswordRequired);
          setBusy(false);
          return;
        }
        let createdCustomerId: string | null = null;
        try {
          createdCustomerId = await createSubunit(payload);
          await createContactAdminUser(createdCustomerId, contactPassword, values);
        } catch (err) {
          if (createdCustomerId) {
            await deleteSubunit(createdCustomerId).catch((deleteErr) =>
              console.error('Kunne ikke rulle tilbake opprettet underenhet', deleteErr),
            );
          }
          throw err;
        }
      }
      setIsFormOpen(false);
      setEditingCustomer(null);
      form.reset({ ...defaultValues, allowSubunits: false });
    } catch (err) {
      console.error('Failed to save subunit', err);
      setFormError(
        err instanceof Error ? err.message : t.admin.subunits.saveError,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (subunit: Customer) => {
    const confirmed = window.confirm(
      t.admin.subunits.deleteConfirm(subunit.companyName),
    );
    if (!confirmed) return;

    try {
      await deleteSubunit(subunit.id);
    } catch (err) {
      console.error('Failed to delete subunit', err);
      alert(t.admin.subunits.deleteError);
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t.admin.subunits.subunitsFor(customer.companyName)}
            </h2>
            <p className="text-sm text-slate-500">
              {t.admin.subunits.subtitle}
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {t.admin.subunits.newSubunit}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            {t.admin.subunits.loading}
          </div>
        ) : subunitsSorted.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            {t.admin.subunits.noSubunits}
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
              <tbody>
                {subunitsSorted.map((subunit) => (
                  <tr
                    key={subunit.id}
                    className="border-b border-slate-100 text-sm last:border-none"
                  >
                    <td className="py-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {subunit.companyName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {subunit.address}, {subunit.zipno} {subunit.place}
                        </p>
                      </div>
                    </td>
                    <td className="py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {subunit.contactPerson}
                        </p>
                        <p className="text-xs text-slate-500">
                          {subunit.contactEmail}
                        </p>
                        <p className="text-xs text-slate-500">
                          {subunit.contactPhone}
                        </p>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-1 text-xs font-medium ${statusBadges[subunit.status]}`}
                        >
                          {subunit.status === 'active' ? t.admin.customers.active : t.admin.customers.inactive}
                        </span>
                        {subunit.allowSubunits && (
                          <span className="text-xs font-semibold text-emerald-600">
                            {t.admin.customers.subunits}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-sm text-slate-600">
                      {subunit.vatNumber}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          onClick={() => openEdit(subunit)}
                          className="flex h-9 items-center justify-center rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          {t.admin.customerDetail.users.editButton}
                        </button>
                        <button
                          onClick={() => handleDelete(subunit)}
                          className="flex h-9 items-center justify-center rounded-full border border-red-200 px-3 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
                        >
                          {t.common.remove}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
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
                  {editingCustomer ? t.admin.subunits.editSubunit : t.admin.subunits.newSubunit}
                </p>
                <h3 className="text-2xl font-semibold text-slate-900">
                  {editingCustomer
                    ? editingCustomer.companyName
                    : t.admin.customers.customerInfo}
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

            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="mt-6 space-y-6"
            >
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
                      onFocus={() => {
                        if (suggestions.length) setShowSuggestions(true);
                      }}
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
                          <p className="px-4 py-3 text-sm text-red-600">
                            {suggestionError}
                          </p>
                        )}
                        {!suggestionLoading &&
                          !suggestionError &&
                          suggestions.map((suggestion) => {
                            const locationText = [
                              suggestion.address?.trim(),
                              `${suggestion.postalCode} ${suggestion.city}`.trim(),
                            ]
                              .filter((part) => part && part !== '')
                              .join(', ');

                            return (
                              <button
                                key={suggestion.orgNumber}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  handleSuggestionSelect(suggestion);
                                }}
                                className="flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-slate-50 last:border-none"
                              >
                                <span className="font-semibold text-slate-900">
                                  {suggestion.companyName}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {t.admin.customers.orgNumber} {suggestion.orgNumber}
                                </span>
                                {locationText && (
                                  <span className="text-xs text-slate-500">
                                    {locationText}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        {!suggestionLoading &&
                          !suggestionError &&
                          !suggestions.length && (
                            <p className="px-4 py-3 text-sm text-slate-500">
                              {t.admin.customers.noResults}
                            </p>
                          )}
                      </div>
                    </div>
                  )}
                </div>
                <Field
                  label={t.admin.customers.orgVat}
                  error={form.formState.errors.vatNumber?.message}
                >
                  <input
                    {...form.register('vatNumber')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </Field>
                <Field label={t.admin.customers.address} error={form.formState.errors.address?.message}>
                  <input
                    {...form.register('address')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t.admin.customers.zipCode} error={form.formState.errors.zipno?.message}>
                    <input
                      {...form.register('zipno')}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </Field>
                  <Field label={t.admin.customers.city} error={form.formState.errors.place?.message}>
                    <input
                      {...form.register('place')}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </Field>
                </div>
                <Field
                  label={t.common.status}
                  error={form.formState.errors.status?.message}
                >
                  <select
                    {...form.register('status')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
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
                      <p className="font-semibold text-slate-900">
                        {t.admin.subunits.allowSubunitsLabel}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t.admin.subunits.allowSubunitsHint}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={t.admin.customers.contactPerson}
                  error={form.formState.errors.contactPerson?.message}
                >
                  <input
                    {...form.register('contactPerson')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </Field>
                <Field
                  label={t.admin.customers.phone}
                  error={form.formState.errors.contactPhone?.message}
                >
                  <input
                    {...form.register('contactPhone')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </Field>
                <Field
                  label={t.admin.customers.email}
                  error={form.formState.errors.contactEmail?.message}
                >
                  <input
                    type="email"
                    {...form.register('contactEmail')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </Field>
                {!editingCustomer && (
                  <Field
                    label={t.admin.customers.password}
                    error={form.formState.errors.contactPassword?.message}
                  >
                    <input
                      type="text"
                      {...form.register('contactPassword')}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </Field>
                )}

                <div className="md:col-span-2">
                  <Field
                    label={t.admin.subunits.availableCourses}
                    hint={t.admin.subunits.selectCoursesHint}
                    error={form.formState.errors.courseIds?.message}
                  >
                    <div className="flex flex-wrap gap-2">
                      {availableCourses.length === 0 && (
                        <p className="text-sm text-slate-500">
                          {t.admin.subunits.noCoursesAvailable}
                        </p>
                      )}
                      {availableCourses.map((course) => (
                        <label
                          key={course.id}
                          className="flex items-center gap-2 rounded-full border border-slate-200 px-4 py-1 text-sm text-slate-700 transition hover:border-slate-300"
                        >
                          <input
                            type="checkbox"
                            value={course.id}
                            {...form.register('courseIds')}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                          />
                          {course.title}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  disabled={busy}
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
                >
                  {busy
                    ? t.admin.subunits.saving
                    : editingCustomer
                      ? t.admin.subunits.updateSubunit
                      : t.admin.subunits.createSubunit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

const Field = ({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
    <span>{label}</span>
    {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
    {children}
    {error && <span className="text-xs text-red-600">{error}</span>}
  </label>
);

