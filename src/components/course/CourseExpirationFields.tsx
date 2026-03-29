import SelectWithToggleIcon from '@/components/SelectWithToggleIcon';
 import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

type ExpirationType = 'none' | 'days' | 'months' | 'date';

type ExpirationFormFields = {
  expirationType: ExpirationType;
  expirationAmount?: number;
  expirationDate?: string;
};

type CourseExpirationFieldsProps<T extends FieldValues & ExpirationFormFields> = {
  form: UseFormReturn<T>;
  expirationType: ExpirationType;
  className?: string;
};

export default function CourseExpirationFields<
  T extends FieldValues & ExpirationFormFields,
>({
  form,
  expirationType,
  className,
}: CourseExpirationFieldsProps<T>) {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const td = t.admin.courseDetail;
  const expirationAmountMessage = form.formState.errors.expirationAmount?.message;
  const expirationDateMessage = form.formState.errors.expirationDate?.message;

  return (
    <div
      className={
        className ?? 'rounded-xl border border-slate-200 bg-slate-50 p-4'
      }
    >
      <p className="text-sm font-semibold text-slate-700">{td.expirationSectionLabel}</p>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {td.expirationTypeLabel}
          <SelectWithToggleIcon
            {...form.register('expirationType' as Path<T>)}
            wrapperClassName="w-fit min-w-48"
            className="cursor-pointer w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-sans text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            <option value="none">{td.expirationNoneOption}</option>
            <option value="days">{td.expirationDaysOption}</option>
            <option value="months">{td.expirationMonthsOption}</option>
            <option value="date">{td.expirationDateOption}</option>
          </SelectWithToggleIcon>
        </label>

        {(expirationType === 'days' || expirationType === 'months') && (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {expirationType === 'days' ? td.expirationDaysLabel : td.expirationMonthsLabel}
            <input
              type="number"
              min={1}
              step={1}
              {...form.register('expirationAmount' as Path<T>, {
                valueAsNumber: true,
                validate: (value) =>
                  expirationType === 'days' || expirationType === 'months'
                    ? typeof value === 'number' && Number.isFinite(value) && value > 0
                      ? true
                      : td.expirationAmountError
                    : true,
              })}
              className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-sans text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            {typeof expirationAmountMessage === 'string' && (
              <span className="text-xs font-semibold text-red-600">
                {expirationAmountMessage}
              </span>
            )}
          </label>
        )}

        {expirationType === 'date' && (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {td.expirationDateLabel}
            <input
              type="date"
              {...form.register('expirationDate' as Path<T>, {
                validate: (value) =>
                  expirationType === 'date'
                    ? value?.trim()
                      ? true
                      : td.expirationDateError
                    : true,
              })}
              className="w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm font-sans text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            {typeof expirationDateMessage === 'string' && (
              <span className="text-xs font-semibold text-red-600">
                {expirationDateMessage}
              </span>
            )}
          </label>
        )}
      </div>
    </div>
  );
}
