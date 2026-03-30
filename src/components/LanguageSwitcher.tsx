'use client';

import { saveLocale } from '@/utils/localization';

interface LangOption {
  code: string;
  label: string;
}

interface LanguageSwitcherProps {
  locale: string;
  onChange: (locale: string) => void;
  locales?: LangOption[];
  savePreference?: boolean;
}

const DEFAULT_LOCALES: LangOption[] = [
  { code: 'no', label: 'Norsk' },
  { code: 'en', label: 'English' },
];

export default function LanguageSwitcher({
  locale,
  onChange,
  locales,
  savePreference = true,
}: LanguageSwitcherProps) {
  const options = locales ?? DEFAULT_LOCALES;

  const handleChange = (code: string) => {
    if (savePreference) saveLocale(code);
    onChange(code);
  };

  return (
    <div className="flex items-center justify-center gap-1">
      {options.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => handleChange(code)}
          className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition ${
            locale === code
              ? 'bg-slate-900 text-white'
              : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
