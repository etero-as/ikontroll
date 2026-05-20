'use server';

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

type CompanyMembership = {
  companyId: string;
  roles: string[];
  displayName?: string;
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

const normalizeCompanies = (value: unknown): CompanyMembership[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: CompanyMembership[] = [];
  value.forEach((entry) => {
    if (typeof entry === 'string') {
      normalized.push({ companyId: entry, roles: [] });
      return;
    }
    if (typeof entry !== 'object' || entry === null) {
      return;
    }
    const record = entry as {
      companyId?: unknown;
      roles?: unknown;
      displayName?: unknown;
    };
    if (typeof record.companyId !== 'string') {
      return;
    }
    const roles = Array.isArray(record.roles)
      ? record.roles.filter((role): role is string => typeof role === 'string')
      : [];
    normalized.push({
      companyId: record.companyId,
      roles,
      displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
    });
  });
  return normalized;
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
    | { idToken?: unknown; companyId?: unknown; template?: unknown }
    | null;

  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const templateInput =
    body?.template && typeof body.template === 'object' ? (body.template as Record<string, unknown>) : {};

  if (!idToken) {
    return NextResponse.json({ error: 'Mangler idToken' }, { status: 401 });
  }
  if (!companyId) {
    return NextResponse.json({ error: 'Mangler companyId' }, { status: 400 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const userSnap = await adminDb.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Fant ikke brukeren.' }, { status: 404 });
    }
    const userData = userSnap.data() ?? {};
    const companies = normalizeCompanies(userData.companyIds);
    const isAdmin = companies.some(
      (company) => company.companyId === companyId && company.roles.includes('admin'),
    );
    if (!isAdmin) {
      return NextResponse.json({ error: 'Ingen tilgang.' }, { status: 403 });
    }

    const template = {
      title: resolveText(templateInput.title, DEFAULT_TEMPLATE.title),
      body: resolveText(templateInput.body, DEFAULT_TEMPLATE.body),
      footer: resolveText(templateInput.footer, DEFAULT_TEMPLATE.footer),
      issuerName: resolveText(templateInput.issuerName, DEFAULT_TEMPLATE.issuerName),
      signatureName: resolveText(templateInput.signatureName, ''),
      signatureTitle: resolveText(templateInput.signatureTitle, ''),
      signatureUrl: typeof templateInput.signatureUrl === 'string' ? templateInput.signatureUrl : '',
      accentColor: parseColor(templateInput.accentColor, DEFAULT_TEMPLATE.accentColor),
      logoUrl: typeof templateInput.logoUrl === 'string' ? templateInput.logoUrl : '',
    };

    const formattedDate = new Date().toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const replacements = {
      participantName: 'Ola Nordmann',
      customerName: 'Eksempel AS',
      courseName: 'HMS Grunnkurs',
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
    drawCenteredText(replacements.participantName, cursorY, 26, boldFont);
    cursorY -= 38;
    drawCenteredText(replacements.courseName, cursorY, 18, boldFont);
    cursorY -= 30;

    const bodyLines = wrapText(bodyText, regularFont, 14, innerWidth);
    bodyLines.forEach((line) => {
      const textWidth = regularFont.widthOfTextAtSize(line, 14);
      const x = (width - textWidth) / 2;
      page.drawText(line, { x, y: cursorY, size: 14, font: regularFont });
      cursorY -= 20;
    });

    cursorY -= 8;
    const summary = `Kunde: ${replacements.customerName} · Dato: ${formattedDate}`;
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
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="diplom-preview.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to generate diploma preview', error);
    return NextResponse.json(
      { error: 'Kunne ikke generere forhåndsvisning.' },
      { status: 500 },
    );
  }
}
