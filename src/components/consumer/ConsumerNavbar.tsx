'use client';

import { GraduationCap, LogOut, Menu, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { getTranslation } from '@/utils/translations';

type MenuPosition = { top: number; right: number };

const ConsumerNavbar = () => {
  const {
    profile,
    logout,
    setPortalMode,
    isCustomerAdmin,
    isSystemOwner,
  } = useAuth();
  const { locale, setLocale } = useLocale();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [avatarMenuPosition, setAvatarMenuPosition] = useState<MenuPosition | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const t = getTranslation(locale);

  const isActive = (path: string) => pathname === path;

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const canSwitchToAdmin = isCustomerAdmin || isSystemOwner;

  const handleSwitchToAdmin = () => {
    setPortalMode('admin');
    router.push('/dashboard');
  };

  const toggleAvatarMenu = () => {
    if (isAvatarMenuOpen) {
      setIsAvatarMenuOpen(false);
      setAvatarMenuPosition(null);
      return;
    }
    const rect = avatarButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAvatarMenuPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    setIsAvatarMenuOpen(true);
  };

  const closeAvatarMenu = () => {
    setIsAvatarMenuOpen(false);
    setAvatarMenuPosition(null);
  };

  const handleLogout = async () => {
    closeAvatarMenu();
    await logout();
  };

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (!isAvatarMenuOpen) return;
      if (avatarButtonRef.current?.contains(event.target as Node)) return;
      const menu = document.getElementById('consumer-user-menu');
      if (menu?.contains(event.target as Node)) return;
      closeAvatarMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAvatarMenu();
    };
    document.addEventListener('mousedown', handleGlobalClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleGlobalClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAvatarMenuOpen]);

  const initials = profile
    ? `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.trim().toUpperCase() || '?'
    : '?';

  const avatarMenu =
    isAvatarMenuOpen && avatarMenuPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            id="consumer-user-menu"
            style={{ top: avatarMenuPosition.top, right: avatarMenuPosition.right }}
            className="fixed z-50 w-60 rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {profile?.firstName} {profile?.lastName}
              </p>
              <p className="text-xs text-slate-500">{profile?.email}</p>
            </div>
            <Link
              href="/profile"
              onClick={closeAvatarMenu}
              className="block w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t.common.myProfile}
            </Link>
            {canSwitchToAdmin && (
              <button
                onClick={() => { handleSwitchToAdmin(); closeAvatarMenu(); }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Adminvisning
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t.common.logout}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {avatarMenu}
      <header className="sticky top-0 z-40 flex min-h-16 items-center border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-8">
            <Link href="/my-courses" className="text-xl font-bold text-slate-900">
              IKontroll
            </Link>
            <nav className="hidden md:flex md:gap-6">
              <Link
                href="/my-courses"
                className={`text-sm font-medium transition ${
                  isActive('/my-courses')
                    ? 'text-slate-900'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.common.myCourses}
              </Link>
              <Link
                href="/profile"
                className={`text-sm font-medium transition ${
                  isActive('/profile')
                    ? 'text-slate-900'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.common.myProfile}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 md:flex">
              <LanguageSwitcher locale={locale} onChange={setLocale} />
              <button
                ref={avatarButtonRef}
                onClick={toggleAvatarMenu}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white transition hover:bg-slate-800"
                aria-haspopup="menu"
                aria-expanded={isAvatarMenuOpen}
              >
                {initials}
              </button>
            </div>

            <button
              className="hidden"
              onClick={toggleMenu}
              aria-label={t.common.menu}
            >
              <Menu size={24} className="text-slate-700" />
            </button>
          </div>
        </div>
      </header>

      {isMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end md:hidden">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setIsMenuOpen(false)}
          />
          <div className="relative h-full w-64 bg-white p-6 shadow-xl flex flex-col justify-between">
            <div>
                <div className="mb-8 flex flex-col items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white">
                    {profile?.firstName?.[0]}
                    {profile?.lastName?.[0]}
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-slate-900">
                      {profile?.firstName} {profile?.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{profile?.email}</p>
                  </div>
                </div>
                    {canSwitchToAdmin && (
                      <button
                        onClick={() => {
                          handleSwitchToAdmin();
                          setIsMenuOpen(false);
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Gå til admin
                      </button>
                    )}
            </div>

            <button
              onClick={logout}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <LogOut size={18} />
              {t.common.logout}
            </button>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white pb-safe md:hidden">
        <div className="grid grid-cols-3 h-16">
          <Link
            href="/my-courses"
            className={`flex flex-col items-center justify-center gap-1 ${
              isActive('/my-courses') ? 'text-slate-900' : 'text-slate-400'
            }`}
          >
            <GraduationCap size={24} strokeWidth={isActive('/my-courses') ? 2.5 : 2} />
            <span className="text-[10px] font-medium">{t.nav.myCourses}</span>
          </Link>
          <Link
            href="/profile"
            className={`flex flex-col items-center justify-center gap-1 ${
              isActive('/profile') ? 'text-slate-900' : 'text-slate-400'
            }`}
          >
            <User size={24} strokeWidth={isActive('/profile') ? 2.5 : 2} />
            <span className="text-[10px] font-medium">{t.common.profile}</span>
          </Link>
          <button
             onClick={toggleMenu}
             className={`flex flex-col items-center justify-center gap-1 ${
               isMenuOpen ? 'text-slate-900' : 'text-slate-400'
             }`}
           >
             <Menu size={24} strokeWidth={isMenuOpen ? 2.5 : 2} />
             <span className="text-[10px] font-medium">{t.common.menu}</span>
           </button>
        </div>
      </nav>
    </>
  );
};

export default ConsumerNavbar;
