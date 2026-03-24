import SelectWithToggleIcon from '@/components/SelectWithToggleIcon';
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
  const expirationAmountMessage = form.formState.errors.expirationAmount?.message;
  const expirationDateMessage = form.formState.errors.expirationDate?.message;

  return (
    <div
      className={
        className ?? 'rounded-xl border border-slate-200 bg-slate-50 p-4'
      }
    >
      <p className="text-sm font-semibold text-slate-700">Utløp</p>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Type
          <SelectWithToggleIcon
            {...form.register('expirationType' as Path<T>)}
            wrapperClassName="w-fit min-w-48"
            className="cursor-pointer w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-sans text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            <option value="none">Ingen utløp</option>
            <option value="days">Antall dager</option>
            <option value="months">Antall måneder</option>
            <option value="date">Dato</option>
          </SelectWithToggleIcon>
        </label>

        {(expirationType === 'days' || expirationType === 'months') && (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {expirationType === 'days' ? 'Dager' : 'Måneder'}
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
                      : 'Angi et gyldig antall.'
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
            Dato
            <input
              type="date"
              {...form.register('expirationDate' as Path<T>, {
                validate: (value) =>
                  expirationType === 'date'
                    ? value?.trim()
                      ? true
                      : 'Velg en dato.'
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


