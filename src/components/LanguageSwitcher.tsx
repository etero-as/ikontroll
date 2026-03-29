'use client';

import { saveLocale } from '@/utils/localization';

interface LanguageSwitcherProps {
  locale: string;
  onChange: (locale: string) => void;
}

const LOCALES = [
  { code: 'no', label: 'Norsk' },
  { code: 'en', label: 'English' },
];

export default function LanguageSwitcher({ locale, onChange }: LanguageSwitcherProps) {
  const handleChange = (code: string) => {
    saveLocale(code);
    onChange(code);
  };

  return (
    <div className="flex items-center justify-center gap-1">
      {LOCALES.map(({ code, label }) => (
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
