'use client';

import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import type { LocaleStringMap } from '@/types/course';

const LocaleEditorHeader = ({ label, activeLanguage }: { label: string; activeLanguage: string }) => (
  <div className="flex items-center justify-between">
    <p className="text-sm font-semibold text-slate-700">{label}</p>
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {activeLanguage.toUpperCase()}
    </span>
  </div>
);

const QuillEditor = ({
  value,
  onChange,
  modules,
  formats,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  modules: Record<string, unknown>;
  formats: string[];
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const lastHtmlRef = useRef<string>(value ?? '');
  const onChangeRef = useRef(onChange);
  const [showTableActions, setShowTableActions] = useState(false);
  const [tableActionsHost, setTableActionsHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  type TableAction =
    | 'insertRowAbove'
    | 'insertRowBelow'
    | 'insertColumnLeft'
    | 'insertColumnRight'
    | 'deleteRow'
    | 'deleteColumn'
    | 'deleteTable';

  const updateTableActions = useCallback((range: { index: number; length: number } | null) => {
    const quill = quillRef.current;
    if (!quill || !range) {
      setShowTableActions(false);
      return;
    }
    const formats = quill.getFormat(range);
    setShowTableActions(Boolean((formats as { table?: unknown }).table));
  }, []);

  useEffect(() => {
    if (!containerRef.current || quillRef.current) {
      return;
    }

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules,
      formats,
    });

    quill.root.style.minHeight = '160px';

    quill.on('text-change', (_delta, _oldDelta, source) => {
      if (source !== 'user') {
        return;
      }
      const html = quill.root.innerHTML;
      if (html !== lastHtmlRef.current) {
        lastHtmlRef.current = html;
        onChangeRef.current(html);
      }
      updateTableActions(quill.getSelection());
    });

    quill.on('selection-change', (range) => {
      updateTableActions(range);
    });

    quillRef.current = quill;

    const toolbarModule = quill.getModule('toolbar') as { container?: HTMLElement } | undefined;
    const toolbarContainer = toolbarModule?.container;
    if (toolbarContainer?.parentElement) {
      let host = toolbarContainer.parentElement.querySelector(
        '.quill-table-actions-host',
      ) as HTMLElement | null;
      if (!host) {
        host = document.createElement('div');
        host.className = 'quill-table-actions-host';
        toolbarContainer.parentElement.insertBefore(host, toolbarContainer.nextSibling);
      }
      setTableActionsHost(host);
    }

    if (value) {
      quill.clipboard.dangerouslyPasteHTML(value, 'silent');
    } else {
      quill.setText('', 'silent');
    }
    lastHtmlRef.current = quill.root.innerHTML;
    updateTableActions(quill.getSelection());
  }, [formats, modules, onChange, updateTableActions, value]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    const nextHtml = value ?? '';
    if (nextHtml === lastHtmlRef.current || nextHtml === quill.root.innerHTML) {
      return;
    }
    const selection = quill.getSelection();
    if (nextHtml) {
      quill.clipboard.dangerouslyPasteHTML(nextHtml, 'silent');
    } else {
      quill.setText('', 'silent');
    }
    lastHtmlRef.current = quill.root.innerHTML;
    if (selection) {
      quill.setSelection(selection);
    }
  }, [value]);

  const handleTableAction = (action: TableAction) => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    const tableModule = quill.getModule('table') as
      | Record<string, (() => void) | undefined>
      | undefined;
    const handler = tableModule?.[action];
    if (typeof handler === 'function') {
      handler.call(tableModule);
      quill.focus();
      updateTableActions(quill.getSelection());
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div ref={containerRef} />
      {showTableActions &&
        tableActionsHost &&
        createPortal(
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span className="mr-2 text-[11px] uppercase tracking-wide text-slate-500">
              {t.admin.moduleDetail.tableLabel}
            </span>
            <button
              type="button"
              onClick={() => handleTableAction('insertRowAbove')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertRowAbove}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertRowBelow')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertRowBelow}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertColumnLeft')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertColumnLeft}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertColumnRight')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertColumnRight}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteRow')}
              className="cursor-pointer rounded-full border border-danger-200 bg-white px-3 py-1 text-xs font-semibold text-danger-600 hover:bg-danger-50"
            >
              {t.admin.moduleDetail.deleteRow}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteColumn')}
              className="cursor-pointer rounded-full border border-danger-200 bg-white px-3 py-1 text-xs font-semibold text-danger-600 hover:bg-danger-50"
            >
              {t.admin.moduleDetail.deleteColumn}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteTable')}
              className="cursor-pointer rounded-full border border-danger-200 bg-white px-3 py-1 text-xs font-semibold text-danger-600 hover:bg-danger-50"
            >
              {t.admin.moduleDetail.deleteTable}
            </button>
          </div>,
          tableActionsHost,
        )}
    </div>
  );
};

const LocaleRichEditor = ({
  label,
  value,
  onChange,
  activeLanguage,
}: {
  label: string;
  value: LocaleStringMap;
  onChange: (next: LocaleStringMap) => void;
  activeLanguage: string;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const currentValue = value?.[activeLanguage] ?? '';
  const updateValue = (nextValue: string) => {
    const next: LocaleStringMap = { ...(value ?? {}) };
    next[activeLanguage] = nextValue;
    onChange(next);
  };

  const modulesConfig = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'clean'],
          ['table'],
        ],
        handlers: {
          table(this: { quill: Quill }) {
            const tableModule = this.quill?.getModule('table') as
              | { insertTable?: (rows: number, columns: number) => void }
              | undefined;
            if (tableModule?.insertTable) {
              tableModule.insertTable(3, 3);
            }
          },
        },
      },
      table: true,
    }),
    [],
  );

  const formats = useMemo(
    () => [
      'header',
      'bold',
      'italic',
      'underline',
      'strike',
      'list',
      'link',
      'table',
      'table-row',
      'table-body',
      'table-container',
    ],
    [],
  );

  const handleChange = (content: string) => {
    updateValue(content);
  };

  return (
    <div className="space-y-2">
      <LocaleEditorHeader label={label} activeLanguage={activeLanguage} />
      <QuillEditor
        value={currentValue}
        onChange={handleChange}
        modules={modulesConfig}
        formats={formats}
      />
      <p className="text-xs text-slate-400">
        {t.admin.moduleDetail.richEditorHint}
      </p>
    </div>
  );
};

export default LocaleRichEditor;
