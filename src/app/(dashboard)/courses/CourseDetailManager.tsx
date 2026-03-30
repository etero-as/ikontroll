'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import { Controller, useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDownloadURL, ref, uploadBytes, deleteObject } from 'firebase/storage';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useCourse } from '@/hooks/useCourse';
import { useCourseModules } from '@/hooks/useCourseModules';
import { useCourses } from '@/hooks/useCourses';
import { useCourseEditBarSetter } from '@/context/AdminBarContext';
import SaveChangesButton from '@/components/SaveChangesButton';
import DuplicateButton from '@/components/DuplicateButton';
import DragHandle from '@/components/DragHandle';
import CourseExpirationFields from '@/components/course/CourseExpirationFields';
import { db, storage } from '@/lib/firebase';
import { getTranslation } from '@/utils/translations';
import {
  Course,
  CourseModule,
  CourseModulePayload,
  CourseQuestion,
  LocaleModuleMediaMap,
  LocaleStringArrayMap,
  LocaleStringMap,
} from '@/types/course';

const DEFAULT_LANGUAGES = ['no', 'en'];
const DEFAULT_EXAM_PASS_PERCENTAGE = 80;
const EXAM_REPRESENTATIVE_SHARE = 0.3;
const EXAM_MAX_QUESTIONS = 30;

type CourseInfoFormValues = {
  title: LocaleStringMap;
  description: LocaleStringMap;
  courseImageUrl?: string | null;
  courseImageFile?: FileList;
  status: 'active' | 'inactive';
  expirationType: 'none' | 'days' | 'months' | 'date';
  expirationAmount?: number;
  expirationDate?: string;
};

type ModuleQuickCreateFormValues = {
  title: string;
  description: string;
  moduleType: 'normal' | 'exam';
  examImportMode: 'all' | 'representative' | 'blank';
  examPassPercentage: number;
};

type DuplicateModuleFormValues = {
  title: string;
  mode: 'same' | 'other';
  targetCourseId?: string;
};

const createEmptyLocaleMap = (languages: string[]): LocaleStringMap =>
  languages.reduce<LocaleStringMap>((acc, lang) => {
    acc[lang] = '';
    return acc;
  }, {});

const getLocaleValue = (map: LocaleStringMap | undefined, lang = 'no') => {
  if (!map) return '';
  if (map[lang]) return map[lang];
  const firstEntry = Object.values(map).find((value) => value?.trim());
  return firstEntry ?? '';
};

const buildDuplicateModuleTitle = (module: CourseModule | null, lang = 'no', copyOfLabel = 'Kopi av') => {
  if (!module) return '';
  const baseTitle = getLocaleValue(module.title, lang).trim();
  return baseTitle ? `${copyOfLabel} ${baseTitle}` : copyOfLabel;
};

const createEmptyLocaleArrayMap = (
  languages: string[],
): LocaleStringArrayMap =>
  languages.reduce<LocaleStringArrayMap>((acc, lang) => {
    acc[lang] = [];
    return acc;
  }, {});

const createEmptyLocaleMediaMap = (languages: string[]): LocaleModuleMediaMap =>
  languages.reduce<LocaleModuleMediaMap>((acc, lang) => {
    acc[lang] = [];
    return acc;
  }, {});

const clampPercentage = (value: number) => Math.min(100, Math.max(0, value));

const SortableModuleItem = ({
  module,
  activeLanguage,
  onOpen,
  onDelete,
  onDuplicate,
  onToggleStatus,
}: {
  module: CourseModule;
  activeLanguage: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (module: CourseModule) => void;
  onToggleStatus: (id: string) => void;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: module.id });
  const isExamModule = module.moduleType === 'exam';
  const isActive = (module.status ?? 'active') === 'active';

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border p-4 ${isActive ? 'border-slate-200 bg-slate-50 hover:bg-slate-100' : 'border-amber-200 bg-amber-50/70 hover:bg-amber-100/70'}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <DragHandle attributes={attributes} listeners={listeners} className="mt-1" />
          <div
            className={`flex-1 cursor-pointer rounded-xl px-2 py-1 ${isActive ? 'hover:bg-slate-100' : 'hover:bg-amber-100/80'}`}
            onClick={() => onOpen(module.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(module.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className={`text-lg font-semibold ${isActive ? 'text-slate-900' : 'text-slate-700'}`}>
                  {getLocaleValue(module.title, activeLanguage) || t.common.untitled}
                </h4>
                {!isActive && (
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {t.admin.moduleDetail.inactiveModule}
                  </span>
                )}
              </div>
              {getLocaleValue(module.summary, activeLanguage) && (
                <p className={`text-sm ${isActive ? 'text-slate-500' : 'text-slate-600'}`}>
                  {getLocaleValue(module.summary, activeLanguage)}
                </p>
              )}
              <p className={`text-xs ${isActive ? 'text-slate-500' : 'text-slate-600'}`}>
                {t.admin.courseDetail.questionCount(module.questions.length)}
              </p>
              {isExamModule && (
                <p className="text-xs font-semibold text-indigo-600">
                  {t.common.exam}
                  {typeof module.examPassPercentage === 'number'
                    ? t.admin.courseDetail.examPassLabel(module.examPassPercentage)
                    : ''}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => onToggleStatus(module.id)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${isActive ? 'bg-emerald-500' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
          <DuplicateButton onClick={() => onDuplicate(module)}>{t.common.duplicate}</DuplicateButton>
          <button
            onClick={() => onDelete(module.id)}
            className="cursor-pointer rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            {t.admin.courseDetail.removeModule}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function CourseDetailManager({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { companyId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const { course } = useCourse(courseId);
  const { courses: allCourses } = useCourses(companyId ?? null);
  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
    createModule,
    deleteModule,
  } = useCourseModules(courseId);

  const [moduleItems, setModuleItems] = useState<CourseModule[]>([]);
  const moduleNavItems = useMemo(
    () =>
      moduleItems.map((m) => ({
        id: m.id,
        title: m.title ?? {},
        questionCount: m.questions?.length ?? 0,
        isExam: m.moduleType === 'exam',
        status: m.status ?? 'active',
      })),
    [moduleItems],
  );
  const [ordering, setOrdering] = useState(false);
  const [orderingError, setOrderingError] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<CourseModule | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const importableModules = useMemo(
    () =>
      modules.filter(
        (module) =>
          (module.moduleType ?? 'normal') !== 'exam' &&
          (module.questions?.length ?? 0) > 0,
      ),
    [modules],
  );
  const importableQuestionCount = useMemo(
    () =>
      importableModules.reduce(
        (sum, module) => sum + (module.questions?.length ?? 0),
        0,
      ),
    [importableModules],
  );
  const importableQuestions = useMemo(
    () => importableModules.flatMap((module) => module.questions ?? []),
    [importableModules],
  );
  const buildRepresentativeQuestions = useCallback((): CourseQuestion[] => {
    if (!importableModules.length) {
      return [];
    }
    const moduleQueues = importableModules.map((module) => [
      ...(module.questions ?? []),
    ]);
    const totalQuestions = moduleQueues.reduce((sum, queue) => sum + queue.length, 0);
    const targetCount = Math.min(
      EXAM_MAX_QUESTIONS,
      Math.max(
        importableModules.length,
        Math.round(totalQuestions * EXAM_REPRESENTATIVE_SHARE),
      ),
    );
    const selected: CourseQuestion[] = [];
    let cursor = 0;
    while (selected.length < targetCount && moduleQueues.some((queue) => queue.length)) {
      const moduleIndex = cursor % moduleQueues.length;
      const queue = moduleQueues[moduleIndex];
      if (queue.length) {
        selected.push(queue.shift()!);
      }
      cursor += 1;
    }
    return selected;
  }, [importableModules]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  useEffect(() => {
    const sorted = [...modules].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    setModuleItems(sorted);
  }, [modules]);

  const persistModuleOrder = useCallback(
    async (items: CourseModule[]) => {
      if (!courseId) return;
      try {
        setOrdering(true);
        setOrderingError(null);
        await Promise.all(
          items.map((module, index) =>
            updateDoc(doc(db, 'courses', courseId, 'modules', module.id), {
              order: index,
              updatedAt: serverTimestamp(),
            }),
          ),
        );
      } catch (err) {
        setOrderingError(
          err instanceof Error
            ? err.message
            : 'Kunne ikke oppdatere rekkefølgen.',
        );
      } finally {
        setOrdering(false);
      }
    },
    [courseId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      setModuleItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          return items;
        }
        const reordered = arrayMove(items, oldIndex, newIndex).map((item, index) => ({
          ...item,
          order: index,
        }));
        void persistModuleOrder(reordered);
        return reordered;
      });
    },
    [persistModuleOrder],
  );

  const handleOpenModule = useCallback(
    (id: string) => {
      router.push(`/courses/${courseId}/modules/${id}`);
    },
    [router, courseId],
  );

  const resolveExpirationDefaults = (source: Course | null | undefined) => {
    const expirationType = source?.expirationType ?? 'none';
    const normalizeAmount = (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const expirationAmount =
      expirationType === 'days'
        ? normalizeAmount(source?.expirationDays)
        : expirationType === 'months'
          ? normalizeAmount(source?.expirationMonths)
          : undefined;
    const expirationDate =
      expirationType === 'date' ? source?.expirationDate ?? '' : '';
    return {
      expirationType,
      expirationAmount,
      expirationDate,
    };
  };

  const form = useForm<CourseInfoFormValues>({
    defaultValues: {
      title: course?.title ?? { no: '' },
      description: course?.description ?? { no: '' },
      courseImageUrl: course?.courseImageUrl ?? null,
      status: course?.status ?? 'inactive',
      ...resolveExpirationDefaults(course),
    },
  });

  useEffect(() => {
    if (!course) return;
    const isFirstLoad = initializedCourseIdRef.current !== course.id;
    if (isFirstLoad) {
      initializedCourseIdRef.current = course.id;
      const nextLangs = course.languages?.length
        ? course.languages
        : Array.from(
            new Set([
              ...DEFAULT_LANGUAGES,
              ...Object.keys(course.title ?? {}),
              ...Object.keys(course.description ?? {}),
            ]),
          );
      setLanguages(nextLangs);
    } else if (course.languages?.length) {
      setLanguages(course.languages);
    }
    form.reset({
      title: course.title,
      description: course.description ?? { no: '' },
      courseImageUrl: course.courseImageUrl ?? null,
      status: course.status,
      ...resolveExpirationDefaults(course),
    });
    setCourseImageUrl(course.courseImageUrl ?? null);
  }, [course, form]);

  const [languages, setLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [activeLanguage, setActiveLanguage] = useState<string>(DEFAULT_LANGUAGES[0]);
  const initializedCourseIdRef = useRef<string | null>(null);
  const hasDiscoveredModuleLanguages = useRef(false);
  const [savingCourseInfo, setSavingCourseInfo] = useState(false);
  const statusValue = form.watch('status') ?? 'inactive';
  const expirationType = form.watch('expirationType') ?? 'none';
  const [courseImageUrl, setCourseImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    setCourseImageUrl(course?.courseImageUrl ?? null);
    if (course?.languages?.length || hasDiscoveredModuleLanguages.current) return;
    const discovered = new Set<string>();
    modules.forEach((module) => {
      Object.keys(module.body ?? {}).forEach((lang) => discovered.add(lang));
      module.questions.forEach((question) => {
        Object.keys(question.title ?? {}).forEach((lang) => discovered.add(lang));
        Object.keys(question.contentText ?? {}).forEach((lang) =>
          discovered.add(lang),
        );
        question.alternatives.forEach((alt) => {
          Object.keys(alt.altText ?? {}).forEach((lang) => discovered.add(lang));
        });
      });
    });
    if (discovered.size) {
      hasDiscoveredModuleLanguages.current = true;
      setLanguages((prev) => Array.from(new Set([...prev, ...discovered])));
    }
  }, [modules, course]);

  useEffect(() => {
    if (!languages.includes(activeLanguage)) {
      setActiveLanguage(languages[0] ?? DEFAULT_LANGUAGES[0]);
    }
  }, [languages, activeLanguage]);


  useEffect(() => {
    form.register('status');
  }, [form]);

  const handleStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as CourseInfoFormValues['status'];
    form.setValue('status', nextStatus, { shouldDirty: true });
  };

  const courseEditBarSetter = useCourseEditBarSetter();

  useEffect(() => {
    if (!courseEditBarSetter) return;
    courseEditBarSetter.setInfo({
      type: 'course',
      backHref: '/courses',
      languages,
      activeLanguage,
      status: statusValue,
      moduleNavItems,
    });
    return () => courseEditBarSetter.setInfo(null);
  }, [courseEditBarSetter, languages, activeLanguage, statusValue, moduleNavItems]);

  const [isQuickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateSaving, setQuickCreateSaving] = useState(false);
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);

  const uploadCourseImage = useCallback(
    async (file: File) => {
      if (!courseId) return null;
      const storageRef = ref(storage, `courses/${courseId}/cover.jpg`);
      await uploadBytes(storageRef, file);
      return getDownloadURL(storageRef);
    },
    [courseId],
  );

  const removeCourseImage = useCallback(
    async () => {
      if (!courseId) return;
      try {
        const storageRef = ref(storage, `courses/${courseId}/cover.jpg`);
        await deleteObject(storageRef);
      } catch (err) {
        console.warn('Failed to delete image from storage', err);
      }
    },
    [courseId],
  );

  const openCreateModule = () => {
    setQuickCreateError(null);
    setQuickCreateOpen(true);
  };

  const closeQuickCreate = () => {
    if (quickCreateSaving) {
      return;
    }
    setQuickCreateOpen(false);
    setQuickCreateError(null);
  };

  const handleQuickCreateModule = async ({
    title,
    description,
    moduleType,
    examImportMode,
    examPassPercentage,
  }: ModuleQuickCreateFormValues): Promise<boolean> => {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle) {
      setQuickCreateError(t.admin.courseDetail.titleRequiredCreate);
      return false;
    }

    try {
      setQuickCreateSaving(true);
      setQuickCreateError(null);
      const isExamModule = moduleType === 'exam';
      const nextOrder =
        moduleItems.length > 0
          ? (moduleItems[moduleItems.length - 1].order ?? moduleItems.length) + 1
          : 0;
      const targetLanguages = languages.includes('no') ? languages : [...languages, 'no'];
      if (!languages.includes('no')) {
        setLanguages(targetLanguages);
      }
      const titleMap = createEmptyLocaleMap(targetLanguages);
      titleMap.no = trimmedTitle;
      const summaryMap = createEmptyLocaleMap(targetLanguages);
      summaryMap.no = trimmedDescription;
      const bodyMap = createEmptyLocaleMap(targetLanguages);
      bodyMap.no = trimmedDescription;
      const videoMap = createEmptyLocaleArrayMap(targetLanguages);
      const imageMap = createEmptyLocaleArrayMap(targetLanguages);
      const mediaMap = createEmptyLocaleMediaMap(targetLanguages);

      let questions: CourseQuestion[] = [];
      if (isExamModule) {
        if (examImportMode === 'all') {
          if (!importableQuestionCount) {
            setQuickCreateError(t.admin.courseDetail.noQuestionsToImport);
            return false;
          }
          questions = importableQuestions;
        } else if (examImportMode === 'representative') {
          if (!importableQuestionCount) {
            setQuickCreateError(t.admin.courseDetail.noQuestionsToImport);
            return false;
          }
          questions = buildRepresentativeQuestions();
        }
      }

      const sanitizedPassPercentage = clampPercentage(
        Number.isFinite(examPassPercentage)
          ? Math.round(examPassPercentage)
          : DEFAULT_EXAM_PASS_PERCENTAGE,
      );

      const payload: CourseModulePayload = {
        title: titleMap,
        summary: summaryMap,
        body: bodyMap,
        media: mediaMap,
        videoUrls: videoMap,
        imageUrls: imageMap,
        order: nextOrder,
        questions,
        languages: targetLanguages,
        moduleType: isExamModule ? 'exam' : 'normal',
        ...(isExamModule ? { examPassPercentage: sanitizedPassPercentage } : {}),
      };

      const newModuleId = await createModule(payload);
      setQuickCreateOpen(false);
      router.push(`/courses/${courseId}/modules/${newModuleId}`);
      return true;
    } catch (err) {
      console.error('Failed to create module', err);
      setQuickCreateError(
        err instanceof Error ? err.message : t.admin.courseDetail.createModuleError,
      );
      return false;
    } finally {
      setQuickCreateSaving(false);
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    const target = modules.find((m) => m.id === moduleId);
    if (!target) return;
    const confirmed = window.confirm(
      t.admin.courseDetail.confirmDeleteModule(getLocaleValue(target.title, activeLanguage)),
    );
    if (!confirmed) return;
    try {
      await deleteModule(moduleId);
    } catch (err) {
      console.error('Failed to delete module', err);
      alert(t.admin.courseDetail.deleteModuleError);
    }
  };

  const handleToggleModuleStatus = useCallback(
    async (moduleId: string) => {
      if (!courseId) return;
      const target = moduleItems.find((m) => m.id === moduleId);
      if (!target) return;
      const nextStatus: 'active' | 'inactive' =
        (target.status ?? 'active') === 'active' ? 'inactive' : 'active';
      setModuleItems((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, status: nextStatus } : m)),
      );
      try {
        await updateDoc(doc(db, 'courses', courseId, 'modules', moduleId), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('Failed to toggle module status', err);
        setModuleItems((prev) =>
          prev.map((m) =>
            m.id === moduleId ? { ...m, status: target.status ?? 'active' } : m,
          ),
        );
        alert(t.admin.moduleDetail.toggleModuleStatusError);
      }
    },
    [courseId, moduleItems, t.admin.moduleDetail.toggleModuleStatusError],
  );

  const handleDuplicateModule = async (values: DuplicateModuleFormValues) => {
    if (!duplicateTarget || !courseId) {
      return;
    }
    try {
      setDuplicating(true);
      setDuplicateError(null);
      const trimmedTitle = values.title.trim();
      if (!trimmedTitle) {
        setDuplicateError(t.admin.courseDetail.titleRequiredCreate);
        return;
      }

      const destinationCourseId =
        values.mode === 'other' ? values.targetCourseId?.trim() : courseId;

      if (!destinationCourseId) {
        setDuplicateError(t.admin.courseDetail.selectTargetCourse);
        return;
      }

      const destinationModules =
        destinationCourseId === courseId
          ? moduleItems
          : (
              await getDocs(collection(db, 'courses', destinationCourseId, 'modules'))
            ).docs.map((docSnap) => docSnap.data());

      const maxOrder = destinationModules.reduce((max, item) => {
        const orderValue =
          typeof item.order === 'number'
            ? item.order
            : typeof item.order === 'string'
              ? Number(item.order)
              : 0;
        if (!Number.isFinite(orderValue)) {
          return max;
        }
        return Math.max(max, orderValue);
      }, -1);

      const nextTitle = { ...(duplicateTarget.title ?? {}) };
      nextTitle.no = trimmedTitle;
      const nextLanguages = Array.isArray(duplicateTarget.languages)
        ? duplicateTarget.languages
        : Object.keys(nextTitle);

      const payload: CourseModulePayload = {
        title: nextTitle,
        summary: duplicateTarget.summary ?? {},
        body: duplicateTarget.body ?? {},
        media: duplicateTarget.media ?? {},
        videoUrls: duplicateTarget.videoUrls ?? {},
        imageUrls: duplicateTarget.imageUrls ?? {},
        order: maxOrder + 1,
        questions: duplicateTarget.questions ?? [],
        languages: nextLanguages,
        moduleType: duplicateTarget.moduleType ?? 'normal',
        ...(duplicateTarget.moduleType === 'exam' &&
        typeof duplicateTarget.examPassPercentage === 'number'
          ? { examPassPercentage: duplicateTarget.examPassPercentage }
          : {}),
      };

      await addDoc(collection(db, 'courses', destinationCourseId, 'modules'), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setDuplicateTarget(null);
    } catch (err) {
      console.error('Failed to duplicate module', err);
      setDuplicateError(
        err instanceof Error ? err.message : t.admin.courseDetail.duplicateModuleError,
      );
    } finally {
      setDuplicating(false);
    }
  };

  const addLanguage = (lang: string) => {
    const trimmed = lang.trim().toLowerCase();
    if (!trimmed) return;
    if (languages.includes(trimmed)) {
      setActiveLanguage(trimmed);
      return;
    }

    const nextLanguages = [...languages, trimmed];
    setLanguages(nextLanguages);
    setActiveLanguage(trimmed);
    const ensureCourseLocales = (map: LocaleStringMap | undefined) => {
      const base = createEmptyLocaleMap(nextLanguages);
      if (!map) return base;
      nextLanguages.forEach((language) => {
        base[language] = map[language] ?? '';
      });
      return base;
    };
    form.setValue('title', ensureCourseLocales(form.getValues('title')), {
      shouldDirty: true,
    });
    form.setValue(
      'description',
      ensureCourseLocales(form.getValues('description')),
      { shouldDirty: true },
    );
    if (courseId) {
      modules.forEach((m) => {
        const moduleLangs = Array.isArray(m.languages) ? m.languages : nextLanguages.filter((l) => l !== trimmed);
        if (!moduleLangs.includes(trimmed)) {
          updateDoc(doc(db, 'courses', courseId, 'modules', m.id), {
            languages: [...moduleLangs, trimmed],
            updatedAt: serverTimestamp(),
          }).catch((err) => console.error('Failed to update module language', err));
        }
      });
    }
  };

  const removeLanguage = (lang: string) => {
    if (languages.length <= 1) return;
    const nextLanguages = languages.filter((l) => l !== lang);
    setLanguages(nextLanguages);
    if (activeLanguage === lang) {
      setActiveLanguage(nextLanguages[0]);
    }
    const stripKey = (map: LocaleStringMap | undefined): LocaleStringMap => {
      const next = { ...(map ?? {}) };
      delete next[lang];
      return next;
    };
    form.setValue('title', stripKey(form.getValues('title')), { shouldDirty: true });
    form.setValue('description', stripKey(form.getValues('description')), { shouldDirty: true });
    if (courseId) {
      modules.forEach((m) => {
        const moduleLangs = Array.isArray(m.languages) ? m.languages : [];
        if (moduleLangs.includes(lang)) {
          const newLangs = moduleLangs.filter((l) => l !== lang);
          if (newLangs.length > 0) {
            updateDoc(doc(db, 'courses', courseId, 'modules', m.id), {
              languages: newLangs,
              updatedAt: serverTimestamp(),
            }).catch((err) => console.error('Failed to remove module language', err));
          }
        }
      });
    }
  };

  const handleRemoveActiveLanguage = () => {
    if (languages.length <= 1) {
      return;
    }
    const confirmed = window.confirm(
      t.admin.courseDetail.confirmRemoveLanguage(activeLanguage.toUpperCase()),
    );
    if (!confirmed) {
      return;
    }
    removeLanguage(activeLanguage);
  };

  if (courseEditBarSetter) {
    courseEditBarSetter.handlersRef.current = {
      setActiveLanguage,
      addLanguage,
      handleRemoveActiveLanguage,
      handleStatusChange,
      openAddModule: openCreateModule,
      duplicateModule: (moduleId) => {
        const target = moduleItems.find((m) => m.id === moduleId);
        if (target) {
          setDuplicateError(null);
          setDuplicateTarget(target);
        }
      },
      deleteModule: handleDeleteModule,
      toggleModuleStatus: handleToggleModuleStatus,
    };
  }

  const handleCourseInfoSave = form.handleSubmit(async (values) => {
    if (!course) return;
    try {
      setSavingCourseInfo(true);
      const normalizeForSave = (map: LocaleStringMap) => {
        const base = createEmptyLocaleMap(languages);
        Object.entries(map ?? {}).forEach(([lang, value]) => {
          base[lang] = value ?? '';
        });
        return base;
      };
      const normalizedTitle = normalizeForSave(values.title ?? {});
      normalizedTitle.no = normalizedTitle.no?.trim() ?? '';
      const normalizedDescription = normalizeForSave(values.description ?? {});
      normalizedDescription.no = normalizedDescription.no?.trim() ?? '';
      const expirationTypeValue = values.expirationType ?? 'none';
      const expirationAmount =
        typeof values.expirationAmount === 'number' && Number.isFinite(values.expirationAmount)
          ? Math.max(1, Math.round(values.expirationAmount))
          : null;
      const expirationDate = values.expirationDate?.trim() || null;
      const expirationPayload =
        expirationTypeValue === 'days'
          ? {
              expirationType: expirationTypeValue,
              expirationDays: expirationAmount,
              expirationMonths: null,
              expirationDate: null,
            }
          : expirationTypeValue === 'months'
            ? {
                expirationType: expirationTypeValue,
                expirationDays: null,
                expirationMonths: expirationAmount,
                expirationDate: null,
              }
            : expirationTypeValue === 'date'
              ? {
                  expirationType: expirationTypeValue,
                  expirationDays: null,
                  expirationMonths: null,
                  expirationDate,
                }
              : {
                  expirationType: 'none',
                  expirationDays: null,
                  expirationMonths: null,
                  expirationDate: null,
                };
      await updateDoc(doc(db, 'courses', course.id), {
        title: normalizedTitle,
        description: normalizedDescription,
        courseImageUrl: courseImageUrl ?? null,
        status: values.status,
        languages,
        ...expirationPayload,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to update course', err);
      alert(t.admin.courseDetail.saveCourseError);
    } finally {
      setSavingCourseInfo(false);
    }
  });

  const handleDeleteCourse = async () => {
    if (!course) return;
    const confirmed = window.confirm(
      t.admin.courseDetail.confirmDeleteCourse(getLocaleValue(course.title)),
    );
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'courses', course.id));
      router.push('/courses');
    } catch (err) {
      console.error('Failed to delete course', err);
      alert(t.admin.courseDetail.deleteCourseError);
    }
  };

  const handlePreviewCourse = useCallback(() => {
     if (!courseId) return;
    const url = `/courses/${courseId}/preview?lang=${activeLanguage}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      router.push(url);
    }
  }, [activeLanguage, courseId, router]);

  const handleCourseImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImage(true);
      setImageError(null);
      if (courseImageUrl) {
        await removeCourseImage();
      }
      const url = await uploadCourseImage(file);
      if (url) {
        setCourseImageUrl(url);
        form.setValue('courseImageUrl', url, { shouldDirty: true });
      }
      event.target.value = '';
    } catch (err) {
      console.error('Failed to upload course image', err);
      setImageError(
        err instanceof Error ? err.message : t.admin.courseDetail.imageUploadError,
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveCourseImage = async () => {
    try {
      setUploadingImage(true);
      setImageError(null);
      await removeCourseImage();
      setCourseImageUrl(null);
      form.setValue('courseImageUrl', null, { shouldDirty: true });
    } catch (err) {
      console.error('Failed to remove course image', err);
      setImageError(
        err instanceof Error ? err.message : t.admin.courseDetail.imageRemoveError,
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const moduleList = moduleItems.length ? (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={moduleItems.map((module) => module.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-4">
          {moduleItems.map((module) => (
            <SortableModuleItem
              key={module.id}
              module={module}
              activeLanguage={activeLanguage}
              onOpen={handleOpenModule}
              onDelete={handleDeleteModule}
              onDuplicate={(target) => {
                setDuplicateError(null);
                setDuplicateTarget(target);
              }}
              onToggleStatus={handleToggleModuleStatus}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  ) : (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {t.admin.courseDetail.noModulesYet}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t.admin.courseDetail.courseInfoLabel}
            </p>
            <h2 className="text-2xl font-semibold text-slate-900">
              {getLocaleValue(course?.title, activeLanguage) || '…'}
            </h2>
            {course?.createdAt && (
              <p className="text-xs text-slate-500">
                {t.admin.courseDetail.createdAt(course.createdAt.toLocaleString(locale === 'en' ? 'en-GB' : 'no-NO'))}
              </p>
            )}
          </div>
          <button
            onClick={handleDeleteCourse}
            className="cursor-pointer rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            {t.admin.courseDetail.deleteCourse}
          </button>
        </div>

        <form onSubmit={handleCourseInfoSave} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span className="flex items-center justify-between">
              <span>{t.common.title}</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {activeLanguage.toUpperCase()}
              </span>
            </span>
            <Controller
              control={form.control}
              name="title"
              render={({ field }) => (
                <input
                  value={field.value?.[activeLanguage] ?? ''}
                  onChange={(e) =>
                    field.onChange({
                      ...(field.value ?? createEmptyLocaleMap(languages)),
                      [activeLanguage]: e.target.value,
                    })
                  }
                  onBlur={field.onBlur}
                  className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              )}
            />
          </label>
          <label className="md:col-span-2 flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span className="flex items-center justify-between">
              <span>{t.common.description}</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {activeLanguage.toUpperCase()}
              </span>
            </span>
            <Controller
              control={form.control}
              name="description"
              render={({ field }) => (
                <textarea
                  value={field.value?.[activeLanguage] ?? ''}
                  onChange={(e) =>
                    field.onChange({
                      ...(field.value ?? createEmptyLocaleMap(languages)),
                      [activeLanguage]: e.target.value,
                    })
                  }
                  onBlur={field.onBlur}
                  rows={3}
                  className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              )}
            />
          </label>

          <CourseExpirationFields
            form={form}
            expirationType={expirationType}
            className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4"
          />

          <div className="md:col-span-2 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">{t.admin.courseDetail.coverImageLabel}</p>
                <p className="text-xs text-slate-500">
                  {t.admin.courseDetail.coverImageHint}
                </p>
              </div>
              {courseImageUrl && !uploadingImage && (
                <button
                  type="button"
                  onClick={handleRemoveCourseImage}
                  className="cursor-pointer rounded-xl border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
                  disabled={uploadingImage}
                >
                  {t.admin.courseDetail.removeImage}
                </button>
              )}
            </div>
            <div className="flex items-center gap-4">
              <label className="cursor-pointer flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:border-slate-400 hover:bg-slate-50">
                <span>{uploadingImage ? t.common.uploading : t.admin.courseDetail.chooseImage}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleCourseImageChange}
                  className="hidden"
                  disabled={uploadingImage}
                />
              </label>
              {courseImageUrl ? (
                <div className="relative h-28 w-48 overflow-hidden rounded-xl border border-slate-200">
                  <Image
                    src={courseImageUrl}
                    alt={t.admin.courseDetail.courseImagePreviewAlt}
                    fill
                    className="object-cover"
                    sizes="192px"
                  />
                </div>
              ) : (
                <div className="flex h-28 w-48 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
                  {t.admin.courseDetail.noImageSelected}
                </div>
              )}
            </div>
            {imageError && (
              <p className="text-xs font-semibold text-red-600">{imageError}</p>
            )}
          </div>

          <div className="md:col-span-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handlePreviewCourse}
              className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t.common.preview}
            </button>
            <SaveChangesButton type="button" onClickAction={handleCourseInfoSave} loading={savingCourseInfo} />
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 rounded-xl border-b border-slate-100 px-2 pb-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t.admin.courseDetail.modulesLabel}
            </p>
            <p className="text-sm text-slate-500">
              {t.admin.courseDetail.modulesSubtitle}
            </p>
          </div>
          <button
            onClick={openCreateModule}
            className="cursor-pointer inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {t.admin.courseDetail.newModule}
          </button>
        </div>

        {modulesError && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {modulesError}
          </div>
        )}

        {modulesLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            {t.admin.courseDetail.loadingModules}
          </div>
        ) : (
          <div className="mt-4">{moduleList}</div>
        )}
        {ordering && (
          <p className="mt-3 text-xs text-slate-400">{t.admin.courseDetail.savingOrder}</p>
        )}
        {orderingError && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {orderingError}
          </div>
        )}
      </div>

      {isQuickCreateOpen && (
        <ModuleQuickCreateModal
          onClose={closeQuickCreate}
          onSubmit={handleQuickCreateModule}
          loading={quickCreateSaving}
          errorMessage={quickCreateError}
          importableQuestionCount={importableQuestionCount}
        />
      )}
      {duplicateTarget && (
        <DuplicateModuleModal
          module={duplicateTarget}
          currentCourseId={courseId}
          courses={allCourses}
          onClose={() => setDuplicateTarget(null)}
          onSubmit={handleDuplicateModule}
          errorMessage={duplicateError}
          loading={duplicating}
          activeLanguage={activeLanguage}
        />
      )}
    </div>
  );
}

const BaseModal = ({
  onClose,
  loading,
  subtitle,
  title,
  children,
}: {
  onClose: () => void;
  loading: boolean;
  subtitle: string;
  title: string;
  children: ReactNode;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{subtitle}</p>
            <h4 className="text-2xl font-semibold text-slate-900">{title}</h4>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={t.common.close}
            disabled={loading}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const ModalFormFooter = ({
  onClose,
  loading,
  errorMessage,
  submitLabel,
}: {
  onClose: () => void;
  loading: boolean;
  errorMessage: string | null;
  submitLabel: string;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  return (
    <>
      {errorMessage && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {errorMessage}
        </p>
      )}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {t.common.cancel}
        </button>
        <button
          type="submit"
          className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
          disabled={loading}
        >
          {submitLabel}
        </button>
      </div>
    </>
  );
};

const ModuleQuickCreateModal = ({
  onClose,
  onSubmit,
  loading,
  errorMessage,
  importableQuestionCount,
}: {
  onClose: () => void;
  onSubmit: (values: ModuleQuickCreateFormValues) => Promise<boolean>;
  loading: boolean;
  errorMessage: string | null;
  importableQuestionCount: number;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const form = useForm<ModuleQuickCreateFormValues>({
    defaultValues: {
      title: '',
      description: '',
      moduleType: 'normal',
      examImportMode: 'representative',
      examPassPercentage: DEFAULT_EXAM_PASS_PERCENTAGE,
    },
  });
  const moduleType = form.watch('moduleType');
  const examImportMode = form.watch('examImportMode');

  useEffect(() => {
    if (
      moduleType === 'exam' &&
      importableQuestionCount === 0 &&
      examImportMode !== 'blank'
    ) {
      form.setValue('examImportMode', 'blank', { shouldDirty: true });
    }
  }, [examImportMode, form, importableQuestionCount, moduleType]);

  const handleSubmit = form.handleSubmit(async (values) => {
    const success = await onSubmit(values);
    if (success) {
      form.reset();
    }
  });

  return (
    <BaseModal
      onClose={onClose}
      loading={loading}
      subtitle={t.admin.courseDetail.newModuleModalLabel}
      title={t.admin.courseDetail.newModuleModalTitle}
    >
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span className="flex items-center justify-between">
            <span>{t.common.title}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              NO
            </span>
          </span>
          <input
            {...form.register('title', { required: t.common.titleRequired })}
            className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder={t.admin.courseDetail.moduleNamePlaceholder}
            autoFocus
            disabled={loading}
          />
          {form.formState.errors.title?.message && (
            <p className="text-xs font-semibold text-red-600">
              {form.formState.errors.title.message}
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span className="flex items-center justify-between">
            <span>{t.common.description}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              NO
            </span>
          </span>
          <textarea
            {...form.register('description')}
            rows={4}
            className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder={t.admin.courseDetail.moduleDescPlaceholder}
            disabled={loading}
          />
        </label>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-700">{t.admin.courseDetail.moduleTypeLabel}</p>
          <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <input
                type="radio"
                value="normal"
                {...form.register('moduleType')}
                disabled={loading}
              />
              {t.admin.courseDetail.normalModule}
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <input
                type="radio"
                value="exam"
                {...form.register('moduleType')}
                disabled={loading}
              />
              {t.common.exam}
            </label>
          </div>
        </div>

        {moduleType === 'exam' && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">{t.admin.courseDetail.examSetupLabel}</p>
              <p className="text-xs text-slate-500">
                {t.admin.courseDetail.availableQuestions(importableQuestionCount)}
              </p>
            </div>
            <div className="grid gap-2 text-sm text-slate-700">
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <input
                  type="radio"
                  value="all"
                  {...form.register('examImportMode')}
                  disabled={loading || importableQuestionCount === 0}
                />
                {t.admin.courseDetail.importAllQuestions}
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <input
                  type="radio"
                  value="representative"
                  {...form.register('examImportMode')}
                  disabled={loading || importableQuestionCount === 0}
                />
                {t.admin.courseDetail.importRepresentative}
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <input
                  type="radio"
                  value="blank"
                  {...form.register('examImportMode')}
                  disabled={loading}
                />
                {t.admin.courseDetail.startBlankExam}
              </label>
            </div>
            {importableQuestionCount === 0 && (
              <p className="text-xs text-amber-600">
                {t.admin.courseDetail.noQuestionsInCourse}
              </p>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              <span>{t.admin.courseDetail.passRequirementPct}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                {...form.register('examPassPercentage', {
                  valueAsNumber: true,
                  min: { value: 0, message: t.admin.courseDetail.passRequirementRange },
                  max: { value: 100, message: t.admin.courseDetail.passRequirementRange },
                })}
                className="w-32 rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                disabled={loading}
              />
              {form.formState.errors.examPassPercentage?.message && (
                <p className="text-xs font-semibold text-red-600">
                  {form.formState.errors.examPassPercentage.message}
                </p>
              )}
            </label>
          </div>
        )}

        <ModalFormFooter
          onClose={onClose}
          loading={loading}
          errorMessage={errorMessage}
          submitLabel={t.admin.courseDetail.createAndManage}
        />
      </form>
    </BaseModal>
  );
};

const DuplicateModuleModal = ({
  module,
  currentCourseId,
  courses,
  onSubmit,
  onClose,
  errorMessage,
  loading,
  activeLanguage,
}: {
  module: CourseModule;
  currentCourseId: string;
  courses: Course[];
  onSubmit: (values: DuplicateModuleFormValues) => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
  loading: boolean;
  activeLanguage: string;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const form = useForm<DuplicateModuleFormValues>({
    defaultValues: { title: '', mode: 'same', targetCourseId: '' },
  });
  const otherCourses = useMemo(
    () => courses.filter((course) => course.id !== currentCourseId),
    [courses, currentCourseId],
  );
  const hasOtherCourses = otherCourses.length > 0;
  const mode = form.watch('mode');

  const lastModuleIdRef = useRef<string | null>(null);

  useEffect(() => {
    const isNewModule = module.id !== lastModuleIdRef.current;
    lastModuleIdRef.current = module.id;
    const currentMode = form.getValues('mode');
    const currentTarget = form.getValues('targetCourseId');
    const fallbackCourseId = otherCourses[0]?.id ?? '';
    form.reset({
      title: buildDuplicateModuleTitle(module, activeLanguage, t.admin.courseDetail.copyOfModule),
      mode: isNewModule ? 'same' : (currentMode ?? 'same'),
      targetCourseId: isNewModule
        ? fallbackCourseId
        : (currentTarget || fallbackCourseId),
    });
  }, [module, activeLanguage, form, otherCourses, t.admin.courseDetail.copyOfModule]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    form.reset();
  });

  return (
    <BaseModal
      onClose={onClose}
      loading={loading}
      subtitle={t.admin.courseDetail.duplicateModuleLabel}
      title={t.admin.courseDetail.nameTheCopy}
    >
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          <span className="flex items-center justify-between">
            <span>{t.common.title}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {activeLanguage.toUpperCase()}
            </span>
          </span>
          <input
            {...form.register('title', { required: t.common.titleRequired })}
            className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder={t.admin.courseDetail.moduleNewNamePlaceholder}
            disabled={loading}
          />
          {form.formState.errors.title?.message && (
            <p className="text-xs font-semibold text-red-600">
              {form.formState.errors.title.message}
            </p>
          )}
        </label>

        <div className="space-y-2 text-sm font-medium text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t.admin.courseDetail.placementLabel}
          </p>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <input
              type="radio"
              value="same"
              {...form.register('mode')}
              disabled={loading}
            />
            {t.admin.courseDetail.duplicateInThisCourse}
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <input
              type="radio"
              value="other"
              {...form.register('mode')}
              disabled={!hasOtherCourses || loading}
            />
            {t.admin.courseDetail.copyToOtherCourse}
          </label>
          {!hasOtherCourses && (
            <p className="text-xs text-slate-500">
              {t.admin.courseDetail.noOtherCourses}
            </p>
          )}
        </div>

        {mode === 'other' && (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t.admin.courseDetail.courseSelectLabel}
            <select
              {...form.register('targetCourseId')}
              className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              disabled={!hasOtherCourses || loading}
            >
              {otherCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {getLocaleValue(course.title) || t.common.untitled}
                </option>
              ))}
            </select>
          </label>
        )}

        <ModalFormFooter
          onClose={onClose}
          loading={loading}
          errorMessage={errorMessage}
          submitLabel={loading ? t.admin.courseDetail.duplicatingModule : t.admin.courseDetail.duplicateModuleButton}
        />
      </form>
    </BaseModal>
  );
};
