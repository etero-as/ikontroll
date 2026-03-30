'use client';

import { createContext, useContext, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

export type ModuleNavItem = {
  id: string;
  title: Record<string, string>;
  questionCount: number;
  isExam: boolean;
  status?: 'active' | 'inactive';
};

export type CourseEditBarInfo = {
  type: 'course' | 'module';
  backHref: string;
  languages: string[];
  activeLanguage: string;
  status?: 'active' | 'inactive';
  moduleNavItems?: ModuleNavItem[];
  currentModuleId?: string;
};

export type CourseEditBarHandlers = {
  setActiveLanguage: (lang: string) => void;
  addLanguage: (lang: string) => void;
  handleRemoveActiveLanguage: () => void;
  handleStatusChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  openAddModule?: () => void;
  duplicateModule?: (moduleId: string) => void;
  deleteModule?: (moduleId: string) => void;
  toggleModuleStatus?: (moduleId: string) => void;
};

type CourseEditBarSetterValue = {
  setInfo: (info: CourseEditBarInfo | null) => void;
  handlersRef: React.MutableRefObject<CourseEditBarHandlers | null>;
};

const CourseEditBarStateContext = createContext<CourseEditBarInfo | null>(null);
const CourseEditBarSetterContext = createContext<CourseEditBarSetterValue | null>(null);

export function CourseEditBarProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<CourseEditBarInfo | null>(null);
  const handlersRef = useRef<CourseEditBarHandlers | null>(null);
  const setterValue = useMemo<CourseEditBarSetterValue>(() => ({ setInfo, handlersRef }), []);

  return (
    <CourseEditBarSetterContext.Provider value={setterValue}>
      <CourseEditBarStateContext.Provider value={info}>
        {children}
      </CourseEditBarStateContext.Provider>
    </CourseEditBarSetterContext.Provider>
  );
}

export function useCourseEditBarInfo() {
  return useContext(CourseEditBarStateContext);
}

export function useCourseEditBarSetter() {
  return useContext(CourseEditBarSetterContext);
}
