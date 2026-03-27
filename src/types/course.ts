export type CourseStatus = 'active' | 'inactive';
export type CourseExpirationType = 'none' | 'days' | 'months' | 'date';

export type LocaleStringMap = Record<string, string>;
export type LocaleStringArrayMap = Record<string, string[]>;

export type ModuleMediaType = 'image' | 'video' | 'document';
export type CourseModuleType = 'normal' | 'exam';

export interface ModuleMediaItem {
  id: string;
  url: string;
  type: ModuleMediaType;
}

export type LocaleModuleMediaMap = Record<string, ModuleMediaItem[]>;

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
  createdAt?: Date;
  updatedAt?: Date;
}

export type CoursePayload = Omit<Course, 'id' | 'createdAt' | 'updatedAt'>;

export type CourseModulePayload = Omit<CourseModule, 'id' | 'courseId' | 'createdAt' | 'updatedAt'>;

