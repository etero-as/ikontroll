'use server';

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

type CustomerMembershipRecord = {
  customerId: string;
  customerName?: string;
  assignedCourseIds: string[];
};

const DEFAULT_TEMPLATE = {
  title: 'Kursbevis',
  body:
    'Dette bekrefter at {{participantName}} har fullført kurset {{courseName}} for {{customerName}} den {{completedDate}}.',
  footer: 'Utstedt av {{issuerName}}.',
  issuerName: 'Skillo',
  signatureName: '',
  signatureTitle: '',
  accentColor: '#0f172a',
};

const normalizeMemberships = (value: unknown): CustomerMembershipRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: CustomerMembershipRecord[] = [];
  value.forEach((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return;
    }
    const record = entry as {
      customerId?: unknown;
      customerName?: unknown;
      assignedCourseIds?: unknown;
    };
    if (typeof record.customerId !== 'string') {
      return;
    }
    const assignedCourseIds = Array.isArray(record.assignedCourseIds)
      ? record.assignedCourseIds.filter((id): id is string => typeof id === 'string')
      : [];
    normalized.push({
      customerId: record.customerId,
      customerName: typeof record.customerName === 'string' ? record.customerName : undefined,
      assignedCourseIds,
    });
  });
  return normalized;
};

const pickCourseTitle = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const map = value as Record<string, string>;
    if (typeof map.no === 'string' && map.no.trim()) return map.no;
    const fallback = Object.values(map).find((entry) => typeof entry === 'string' && entry.trim());
    return fallback ?? '';
  }
  return String(value);
};

const resolveText = (value: unknown, fallback: string) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
  }
  return fallback;
};

const parseColor = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }
  return fallback;
};

const toRgb = (hex: string) => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
};

const applyPlaceholders = (text: string, replacements: Record<string, string>) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => replacements[key] ?? '');

const wrapText = (
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  fontSize: number,
  maxWidth: number,
) => {
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i];
      const testLine = `${line} ${word}`;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width <= maxWidth) {
        line = testLine;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  });
  return lines;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { courseId?: unknown; idToken?: unknown }
    | null;

  const courseId = typeof body?.courseId === 'string' ? body.courseId : '';
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';

  if (!idToken) {
    return NextResponse.json({ error: 'Mangler idToken' }, { status: 401 });
  }
  if (!courseId) {
    return NextResponse.json({ error: 'Mangler courseId' }, { status: 400 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const [courseSnap, userSnap, progressSnap] = await Promise.all([
      adminDb.collection('courses').doc(courseId).get(),
      adminDb.collection('users').doc(uid).get(),
      adminDb.collection('users').doc(uid).collection('courseProgress').doc(courseId).get(),
    ]);

    if (!courseSnap.exists) {
      return NextResponse.json({ error: 'Fant ikke kurset.' }, { status: 404 });
    }

    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Fant ikke brukeren.' }, { status: 404 });
    }

    const courseData = courseSnap.data() ?? {};
    const companyId = typeof courseData.companyId === 'string' ? courseData.companyId : '';
    const courseName = pickCourseTitle(courseData.title) || 'Kurs';

    const userData = userSnap.data() ?? {};
    const firstName = typeof userData.firstName === 'string' ? userData.firstName.trim() : '';
    const lastName = typeof userData.lastName === 'string' ? userData.lastName.trim() : '';
    const email = typeof userData.email === 'string' ? userData.email : '';
    const participantName = `${firstName} ${lastName}`.trim() || email || 'Kursdeltaker';

    const memberships = normalizeMemberships(userData.customerMemberships);
    const membership = memberships.find((entry) =>
      entry.assignedCourseIds.includes(courseId),
    );
    if (!membership) {
      return NextResponse.json(
        { error: 'Kurset er ikke tildelt denne brukeren.' },
        { status: 403 },
      );
    }

    const customerId = membership.customerId;
    const customerDoc = await adminDb.collection('customers').doc(customerId).get();
    const customerName =
      membership.customerName ??
      (customerDoc.exists ? (customerDoc.data()?.companyName as string | undefined) : undefined) ??
      '';

    const modulesSnap = await adminDb
      .collection('courses')
      .doc(courseId)
      .collection('modules')
      .get();
    const moduleIds = modulesSnap.docs.map((doc) => doc.id);
    const progressData = progressSnap.data() ?? {};
    const completedModules = Array.isArray(progressData.completedModules)
      ? progressData.completedModules.filter((id): id is string => typeof id === 'string')
      : [];
    const isCompleted =
      moduleIds.length > 0 && moduleIds.every((moduleId) => completedModules.includes(moduleId));
    if (!isCompleted) {
      return NextResponse.json(
        { error: 'Kurset er ikke fullført ennå.' },
        { status: 403 },
      );
    }

    const completionId = `${courseId}_${customerId}`;
    const completionRef = adminDb
      .collection('users')
      .doc(uid)
      .collection('courseCompletions')
      .doc(completionId);
    const completionSnap = await completionRef.get();
    const existingCompletion = completionSnap.exists ? completionSnap.data() : null;
    const existingCompletedAt =
      existingCompletion?.completedAt?.toDate?.() ??
      (existingCompletion?.completedAt instanceof Date
        ? existingCompletion.completedAt
        : null);
    const progressUpdatedAt =
      progressData.updatedAt?.toDate?.() ??
      (progressData.updatedAt instanceof Date ? progressData.updatedAt : null);
    const completedAt = existingCompletedAt ?? progressUpdatedAt ?? new Date();

    if (!completionSnap.exists) {
      await completionRef.set(
        {
          courseId,
          customerId,
          companyId,
          customerName,
          courseTitle: courseName,
          participantName,
          completedAt,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const templateSnap = await adminDb.collection('diplomaTemplates').doc(companyId).get();
    const templateData = templateSnap.exists ? templateSnap.data() ?? {} : {};
    const issuerName = resolveText(templateData.issuerName, DEFAULT_TEMPLATE.issuerName);
    const template = {
      title: resolveText(templateData.title, DEFAULT_TEMPLATE.title),
      body: resolveText(templateData.body, DEFAULT_TEMPLATE.body),
      footer: resolveText(templateData.footer, DEFAULT_TEMPLATE.footer),
      issuerName,
      signatureName: resolveText(templateData.signatureName, ''),
      signatureTitle: resolveText(templateData.signatureTitle, ''),
      signatureUrl: typeof templateData.signatureUrl === 'string' ? templateData.signatureUrl : '',
      accentColor: parseColor(templateData.accentColor, DEFAULT_TEMPLATE.accentColor),
      logoUrl: typeof templateData.logoUrl === 'string' ? templateData.logoUrl : '',
    };

    const formattedDate = completedAt.toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const replacements = {
      participantName,
      customerName: customerName || 'Kunde',
      courseName,
      completedDate: formattedDate,
      issuerName: template.issuerName,
    };
    const bodyText = applyPlaceholders(template.body, replacements);
    const footerText = applyPlaceholders(template.footer, replacements);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
    const { width, height } = page.getSize();
    const accent = toRgb(template.accentColor);
    const borderInset = 24;
    const margin = 60;
    const topPadding = 70;
    const logoTitleGap = 40;
    const innerWidth = width - margin * 2;

    page.drawRectangle({
      x: borderInset,
      y: borderInset,
      width: width - borderInset * 2,
      height: height - borderInset * 2,
      borderColor: accent,
      borderWidth: 2,
    });

    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const drawCenteredText = (
      text: string,
      y: number,
      size: number,
      font = regularFont,
      color = rgb(0.06, 0.09, 0.16),
    ) => {
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = (width - textWidth) / 2;
      page.drawText(text, { x, y, size, font, color });
    };

    let cursorY = height - topPadding;

    if (template.logoUrl) {
      try {
        const logoResponse = await fetch(template.logoUrl);
        if (logoResponse.ok) {
          const logoBytes = await logoResponse.arrayBuffer();
          const contentType = logoResponse.headers.get('content-type') ?? '';
          const logoImage = contentType.includes('png')
            ? await pdfDoc.embedPng(logoBytes)
            : await pdfDoc.embedJpg(logoBytes);
          const maxLogoWidth = 160;
          const maxLogoHeight = 64;
          const widthRatio = maxLogoWidth / logoImage.width;
          const heightRatio = maxLogoHeight / logoImage.height;
          const scale = Math.min(widthRatio, heightRatio, 1);
          const logoWidth = logoImage.width * scale;
          const logoHeight = logoImage.height * scale;
          const logoY = cursorY - logoHeight;
          page.drawImage(logoImage, {
            x: (width - logoWidth) / 2,
            y: logoY,
            width: logoWidth,
            height: logoHeight,
          });
          cursorY = logoY - logoTitleGap;
        }
      } catch (error) {
        console.warn('Failed to load diploma logo', error);
      }
    }

    if (!template.logoUrl) {
      cursorY -= 10;
    }
    drawCenteredText(template.title, cursorY, 30, boldFont, accent);
    cursorY -= 48;
    drawCenteredText(participantName, cursorY, 26, boldFont);
    cursorY -= 38;
    drawCenteredText(courseName, cursorY, 18, boldFont);
    cursorY -= 30;

    const bodyLines = wrapText(bodyText, regularFont, 14, innerWidth);
    bodyLines.forEach((line) => {
      const textWidth = regularFont.widthOfTextAtSize(line, 14);
      const x = (width - textWidth) / 2;
      page.drawText(line, { x, y: cursorY, size: 14, font: regularFont });
      cursorY -= 20;
    });

    cursorY -= 8;
    const summary = `Kunde: ${customerName || 'Kunde'} · Dato: ${formattedDate}`;
    drawCenteredText(summary, cursorY, 11, regularFont, rgb(0.4, 0.45, 0.5));

    const footerLines = wrapText(footerText, regularFont, 10, innerWidth);
    const footerStartY = 90 + (footerLines.length - 1) * 12;
    footerLines.forEach((line, index) => {
      drawCenteredText(line, footerStartY - index * 12, 10, regularFont, rgb(0.45, 0.45, 0.45));
    });
    const issuedLine = `Utstedelsesdato: ${formattedDate}`;
    drawCenteredText(
      issuedLine,
      footerStartY - footerLines.length * 12 - 4,
      10,
      regularFont,
      rgb(0.45, 0.45, 0.45),
    );

    const hasSignatureBlock =
      Boolean(template.signatureUrl) ||
      Boolean(template.signatureName) ||
      Boolean(template.signatureTitle);
    if (hasSignatureBlock) {
      const signatureLineWidth = 180;
      const signatureX = (width - signatureLineWidth) / 2;
      const signatureY = 150;
      if (template.signatureUrl) {
        try {
          const signatureResponse = await fetch(template.signatureUrl);
          if (signatureResponse.ok) {
            const signatureBytes = await signatureResponse.arrayBuffer();
            const contentType = signatureResponse.headers.get('content-type') ?? '';
            const signatureImage = contentType.includes('png')
              ? await pdfDoc.embedPng(signatureBytes)
              : await pdfDoc.embedJpg(signatureBytes);
            const maxSignatureWidth = signatureLineWidth;
            const maxSignatureHeight = 48;
            const widthRatio = maxSignatureWidth / signatureImage.width;
            const heightRatio = maxSignatureHeight / signatureImage.height;
            const scale = Math.min(widthRatio, heightRatio, 1);
            const sigWidth = signatureImage.width * scale;
            const sigHeight = signatureImage.height * scale;
            const sigX = signatureX + (signatureLineWidth - sigWidth) / 2;
            const sigY = signatureY + 32;
            page.drawImage(signatureImage, {
              x: sigX,
              y: sigY,
              width: sigWidth,
              height: sigHeight,
            });
          }
        } catch (error) {
          console.warn('Failed to load diploma signature', error);
        }
      }
      page.drawLine({
        start: { x: signatureX, y: signatureY + 28 },
        end: { x: signatureX + signatureLineWidth, y: signatureY + 28 },
        thickness: 1,
        color: rgb(0.7, 0.7, 0.7),
      });
      if (template.signatureName) {
        const nameWidth = boldFont.widthOfTextAtSize(template.signatureName, 12);
        const nameX = signatureX + (signatureLineWidth - nameWidth) / 2;
        page.drawText(template.signatureName, {
          x: nameX,
          y: signatureY + 8,
          size: 12,
          font: boldFont,
        });
      }
      if (template.signatureTitle) {
        const titleWidth = regularFont.widthOfTextAtSize(template.signatureTitle, 10);
        const titleX = signatureX + (signatureLineWidth - titleWidth) / 2;
        page.drawText(template.signatureTitle, {
          x: titleX,
          y: signatureY - 6,
          size: 10,
          font: regularFont,
          color: rgb(0.45, 0.45, 0.45),
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const filename = `kursbevis-${courseName.replace(/\s+/g, '-').toLowerCase()}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to generate diploma PDF', error);
    return NextResponse.json(
      { error: 'Kunne ikke generere kursbevis.' },
      { status: 500 },
    );
  }
}
