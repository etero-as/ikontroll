'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { useCourseEditBarInfo, useCourseEditBarSetter } from '@/context/AdminBarContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import SelectWithToggleIcon from '@/components/SelectWithToggleIcon';

const resolveTitle = (title: Record<string, string>, lang: string): string =>
  title[lang] || Object.values(title).find((v) => v?.trim()) || '';

export default function CourseEditBar() {
  const pathname = usePathname();
  const router = useRouter();
  const info = useCourseEditBarInfo();
  const setter = useCourseEditBarSetter();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  const [isAddingLanguage, setIsAddingLanguage] = useState(false);
  const [languageInput, setLanguageInput] = useState('');
  const [languageInputError, setLanguageInputError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [moduleDropdownOpen, setModuleDropdownOpen] = useState(false);
  const moduleDropdownRef = useRef<HTMLDivElement>(null);

  const isCourseAdmin = /^\/courses\/[^/]+$/.test(pathname ?? '');
  const isModuleAdmin = /^\/courses\/[^/]+\/modules\/[^/]+$/.test(pathname ?? '');

  useEffect(() => {
    if (isAddingLanguage) {
      requestAnimationFrame(() => { inputRef.current?.focus(); });
    }
  }, [isAddingLanguage]);

  useEffect(() => {
    setIsAddingLanguage(false);
    setLanguageInput('');
    setLanguageInputError(false);
    setModuleDropdownOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moduleDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (moduleDropdownRef.current && !moduleDropdownRef.current.contains(e.target as Node)) {
        setModuleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [moduleDropdownOpen]);

  if ((!isCourseAdmin && !isModuleAdmin) || !info || !setter) return null;

  const handlers = setter.handlersRef.current;
  if (!handlers) return null;

  const backLabel = info.type === 'course'
    ? t.admin.courses.backToCourseList
    : t.admin.moduleDetail.backToCourseAdmin;

  const pageLabel = info.type === 'course'
    ? t.admin.courses.courseAdmin
    : t.admin.moduleDetail.moduleAdmin;

  const handleSubmitAdd = (e: FormEvent) => {
    e.preventDefault();
    setLanguageInputError(false);
    handlers.addLanguage(languageInput);
    setIsAddingLanguage(false);
    setLanguageInput('');
  };

  const moduleNavItems = info.moduleNavItems ?? [];
  const currentModuleIndex = moduleNavItems.findIndex((m) => m.id === info.currentModuleId);
  const prevModule = currentModuleIndex > 0 ? moduleNavItems[currentModuleIndex - 1] : null;
  const nextModule =
    currentModuleIndex >= 0 && currentModuleIndex < moduleNavItems.length - 1
      ? moduleNavItems[currentModuleIndex + 1]
      : null;

  const courseIdMatch = (pathname ?? '').match(/^\/courses\/([^/]+)/);
  const courseIdFromPath = courseIdMatch ? courseIdMatch[1] : null;

  const handleNavToModule = (moduleId: string) => {
    if (!courseIdFromPath) return;
    router.push(`/courses/${courseIdFromPath}/modules/${moduleId}`);
  };

  const currentModule = currentModuleIndex >= 0 ? moduleNavItems[currentModuleIndex] : null;
  const dropdownButtonLabel = currentModule
    ? resolveTitle(currentModule.title, info.activeLanguage) || t.common.untitled
    : t.modules.allModules;

  return (
    <div className="border-b border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-3 pl-70 pr-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={info.backHref}
            className="cursor-pointer text-sm font-semibold text-slate-600 transition hover:text-slate-900"
          >
            {backLabel}
          </Link>
          <span className="text-slate-300">|</span>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {pageLabel}
          </p>
          {isCourseAdmin && handlers.openAddModule && (
            <>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={handlers.openAddModule}
                className="rounded-xl bg-slate-900 px-2.5 py-1 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {t.admin.moduleDetail.addModule}
              </button>
            </>
          )}
          {moduleNavItems.length > 0 && (
            <>
              <span className="text-slate-300">|</span>
              {isModuleAdmin && (
                <>
                  <button
                    type="button"
                    disabled={!prevModule}
                    onClick={() => prevModule && handleNavToModule(prevModule.id)}
                    className="rounded-xl border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ‹ {t.modules.navPrevious}
                  </button>
                  <button
                    type="button"
                    disabled={!nextModule}
                    onClick={() => nextModule && handleNavToModule(nextModule.id)}
                    className="rounded-xl border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t.modules.navNext} ›
                  </button>
                </>
              )}
              <div className="relative" ref={moduleDropdownRef}>
                <button
                  type="button"
                  onClick={() => setModuleDropdownOpen((p) => !p)}
                  className="flex max-w-55 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <span className="truncate">{dropdownButtonLabel}</span>
                  <ChevronDown size={13} className="shrink-0" />
                </button>
                {moduleDropdownOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-96 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg" style={{ maxHeight: '18rem' }}>
                    {moduleNavItems.map((m, i) => {
                      const isActive = (m.status ?? 'active') === 'active';
                      const isCurrent = m.id === info.currentModuleId;
                      return (
                        <div key={m.id}>
                          {i > 0 && <div className="border-t border-slate-100" />}
                          <div className={`flex items-center gap-2 px-3 py-2 transition hover:bg-slate-50 ${isCurrent ? 'bg-slate-50' : ''} ${!isActive ? 'bg-amber-50/60' : ''}`}>
                            <button
                              type="button"
                              onClick={() => { handleNavToModule(m.id); setModuleDropdownOpen(false); }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className={`block truncate text-sm ${isCurrent ? 'font-semibold text-slate-900' : 'text-slate-600'} ${!isActive ? 'text-slate-500' : ''}`}>
                                {i + 1}. {resolveTitle(m.title, info.activeLanguage) || t.common.untitled}
                              </span>
                              <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                                <span>{m.isExam ? t.common.exam : t.admin.courseDetail.questionCount(m.questionCount)}</span>
                                {!isActive && <span className="rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">{t.admin.moduleDetail.inactiveModule}</span>}
                              </span>
                            </button>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isActive}
                                onClick={() => handlers.toggleModuleStatus?.(m.id)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${isActive ? 'bg-emerald-500' : 'bg-slate-200'}`}
                              >
                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                              </button>
                              <button
                                type="button"
                                onClick={() => { handlers.duplicateModule?.(m.id); setModuleDropdownOpen(false); }}
                                className="cursor-pointer rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                              >
                                {t.common.duplicate}
                              </button>
                              <button
                                type="button"
                                onClick={() => handlers.deleteModule?.(m.id)}
                                className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
                              >
                                {t.common.remove}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {info.languages.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => handlers.setActiveLanguage(lang)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition ${
                info.activeLanguage === lang
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
          {isAddingLanguage ? (
            <form onSubmit={handleSubmitAdd} className="relative flex items-center gap-2">
              <input
                ref={inputRef}
                value={languageInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cleaned = raw.replace(/[^a-zA-Z]/g, '');
                  setLanguageInputError(cleaned !== raw && raw.length > 0);
                  setLanguageInput(cleaned);
                }}
                placeholder={t.common.languageCode}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
              >
                {t.common.add}
              </button>
              <button
                type="button"
                onClick={() => { setIsAddingLanguage(false); setLanguageInput(''); setLanguageInputError(false); }}
                className="cursor-pointer rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                aria-label={t.common.cancel}
              >
                ×
              </button>
              {languageInputError && (
                <p className="pointer-events-none absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-red-500">
                  {t.common.languageCodeOnlyLetters}
                </p>
              )}
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setIsAddingLanguage(true); setLanguageInput(''); }}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-slate-200 p-0 text-sm font-semibold leading-none text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label={t.common.addLanguage}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => handlers.handleRemoveActiveLanguage()}
                disabled={info.languages.length <= 1}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-red-200 p-0 text-sm font-semibold leading-none text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent"
                aria-label={t.common.removeLanguageLabel(info.activeLanguage.toUpperCase())}
                title={t.common.removeLanguageTitle(info.activeLanguage.toUpperCase())}
              >
                -
              </button>
            </>
          )}
          {info.status !== undefined && handlers.handleStatusChange && (
            <>
              <span className="mx-1 text-slate-300">|</span>
              <label
                htmlFor="course-edit-bar-status-select"
                className="flex items-center gap-2 text-sm font-medium text-slate-700"
              >
                <span>{t.common.status}</span>
                <SelectWithToggleIcon
                  id="course-edit-bar-status-select"
                  value={info.status}
                  onChange={handlers.handleStatusChange}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-sans text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="active">{t.admin.courses.activeStatus}</option>
                  <option value="inactive">{t.admin.courses.inactiveStatus}</option>
                </SelectWithToggleIcon>
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
