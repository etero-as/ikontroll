export type CourseStatus = 'active' | 'inactive';
export type CourseExpirationType = 'none' | 'days' | 'months' | 'date';

export type LocaleStringMap = Record<string, string>;
export type LocaleStringArrayMap = Record<string, string[]>;

export type ModuleMediaType = 'image' | 'video' | 'document';
export type CourseModuleType = 'normal' | 'exam';

export interface AnnotationShape {
  id: string;
  type: 'arrow' | 'circle' | 'rect' | 'freehand' | 'text';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  /** SVG path data for freehand strokes (normalized 0-1 coordinates). */
  path?: string;
  /** Text content for text objects. */
  text?: string;
  /** Fill color for text or filled shapes. */
  fill?: string;
  /** Normalized font size for text objects. */
  fontSize?: number;
}

export interface ModuleMediaItem {
  id: string;
  url: string;
  type: ModuleMediaType;
  caption?: string;
  annotations?: AnnotationShape[];
}

export type LocaleModuleMediaMap = Record<string, ModuleMediaItem[]>;

/** Pool-level asset — shared across all languages. Caption lives in per-language selection. */
export interface ModuleMediaPoolItem {
  id: string;
  url: string;
  type: ModuleMediaType;
  annotations?: AnnotationShape[];
}

/** Per-language reference to a pool asset, with language-specific metadata. */
export interface ModuleMediaSelection {
  assetId: string;
  caption?: string;
}

/** Per-language selections keyed by language code. */
export type ModuleMediaSelections = Record<string, ModuleMediaSelection[]>;

export interface Course {
  id: string;
  companyId: string;
  createdById: string;
  title: LocaleStringMap;
  description: LocaleStringMap;
  courseImageUrl?: string | null;
  status: CourseStatus;
  languages?: string[];
  expirationType?: CourseExpirationType;
  expirationDays?: number | null;
  expirationMonths?: number | null;
  expirationDate?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CourseQuestionAlternative {
  id: string;
  altText: LocaleStringMap;
}

export interface CourseQuestion {
  id: string;
  title: LocaleStringMap;
  contentText: LocaleStringMap;
  alternatives: CourseQuestionAlternative[];
  correctAnswerIds: string[];
  correctAnswerId?: string;
}

export interface CourseModule {
  id: string;
  courseId: string;
  title: LocaleStringMap;
  summary: LocaleStringMap;
  body?: LocaleStringMap;
  media?: LocaleModuleMediaMap;
  videoUrls: LocaleStringArrayMap;
  imageUrls: LocaleStringArrayMap;
  order: number;
  questions: CourseQuestion[];
  languages?: string[];
  moduleType?: CourseModuleType;
  examPassPercentage?: number;
  mediaPool?: ModuleMediaPoolItem[];
  mediaSelections?: ModuleMediaSelections;
  mediaSync?: boolean;
  status?: 'active' | 'inactive';
  createdAt?: Date;
  updatedAt?: Date;
}

export type CoursePayload = Omit<Course, 'id' | 'createdAt' | 'updatedAt'>;

export type CourseModulePayload = Omit<CourseModule, 'id' | 'courseId' | 'createdAt' | 'updatedAt'>;

