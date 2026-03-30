'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as fabric from 'fabric';

import {
  MousePointer2, Pencil, MoveUpRight, Circle as CircleIcon, Square, Type,
  Undo2, Redo2, Trash2, X,
} from 'lucide-react';

import type { AnnotationShape } from '@/types/course';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#000000', '#ffffff'];
const STROKE_OPTIONS = [
  { label: 'S', value: 2 },
  { label: 'M', value: 4 },
  { label: 'L', value: 8 },
];

type Tool = 'select' | 'freehand' | 'arrow' | 'circle' | 'rect' | 'text';
type LoadState = 'loading' | 'ready' | 'error';

/** Fabric objects may carry custom metadata we attach at draw time. */
type FabricMeta = fabric.FabricObject & {
  __shapeType?: string;
  __shapeId?: string;
  excludeFromExport?: boolean;
};
type FabricSerializedObject = Record<string, unknown> & { type: string };

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/* ------------------------------------------------------------------ */
/*  Coordinate helpers                                                */
/* ------------------------------------------------------------------ */

interface ImageLayout {
  x: number; y: number; w: number; h: number;
}

function toNorm(cx: number, cy: number, L: ImageLayout) {
  return { nx: Math.max(0, Math.min(1, (cx - L.x) / L.w)), ny: Math.max(0, Math.min(1, (cy - L.y) / L.h)) };
}
function toCanvas(nx: number, ny: number, L: ImageLayout) {
  return { x: L.x + nx * L.w, y: L.y + ny * L.h };
}

/* ------------------------------------------------------------------ */
/*  AnnotationShape[] → fabric objects (for initial load only)        */
/* ------------------------------------------------------------------ */

function loadShapes(shapes: AnnotationShape[], L: ImageLayout, fc: fabric.Canvas) {
  for (const s of shapes) {
    const { x: x1, y: y1 } = toCanvas(s.x1, s.y1, L);
    const { x: x2, y: y2 } = toCanvas(s.x2, s.y2, L);
    const sw = s.strokeWidth * Math.min(L.w, L.h);
    let obj: fabric.FabricObject;

    switch (s.type) {
      case 'arrow':
        obj = new fabric.Line([x1, y1, x2, y2], {
          stroke: s.color, strokeWidth: sw, strokeLineCap: 'round', fill: '',
        });
        break;
      case 'circle': {
        const r = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        obj = new fabric.Circle({
          left: x1 - r, top: y1 - r, radius: r,
          stroke: s.color, strokeWidth: sw, fill: s.fill || '',
        });
        break;
      }
      case 'rect':
        obj = new fabric.Rect({
          left: Math.min(x1, x2), top: Math.min(y1, y2),
          width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
          stroke: s.color, strokeWidth: sw, fill: s.fill || '',
        });
        break;
      case 'freehand':
        if (s.path) {
          const scaled = s.path.replace(/(-?\d+\.?\d*)/g, (_, num, off, str) => {
            const cnt = (str.substring(0, off).match(/\d+\.?\d*/g) || []).length;
            const v = parseFloat(num);
            return String(cnt % 2 === 0 ? L.x + v * L.w : L.y + v * L.h);
          });
          obj = new fabric.Path(scaled, {
            stroke: s.color, strokeWidth: sw, fill: '',
            strokeLineCap: 'round', strokeLineJoin: 'round',
          });
        } else continue;
        break;
      case 'text': {
        const fs = (s.fontSize ?? 0.03) * Math.min(L.w, L.h);
        obj = new fabric.IText(s.text || 'Text', {
          left: x1, top: y1, fill: s.fill || s.color, fontSize: fs, fontFamily: 'Inter, sans-serif',
        });
        break;
      }
      default: continue;
    }
    (obj as FabricMeta).__shapeType = s.type;
    (obj as FabricMeta).__shapeId = s.id;
    fc.add(obj);
  }
}

/* ------------------------------------------------------------------ */
/*  fabric objects → AnnotationShape[] (on save)                      */
/* ------------------------------------------------------------------ */

function saveShapes(fc: fabric.Canvas, L: ImageLayout): AnnotationShape[] {
  const out: AnnotationShape[] = [];
  for (const obj of fc.getObjects()) {
    if ((obj as FabricMeta).excludeFromExport) continue;
    const type: AnnotationShape['type'] = ((obj as FabricMeta).__shapeType as AnnotationShape['type']) || 'rect';
    const id: string = (obj as FabricMeta).__shapeId || generateId();
    const sw = (obj.strokeWidth ?? 2) / Math.min(L.w, L.h);
    const color = String(obj.stroke || obj.fill || '#3b82f6');

    const shape: AnnotationShape = { id, type, x1: 0, y1: 0, x2: 0, y2: 0, color, strokeWidth: sw };

    if (type === 'arrow' && obj instanceof fabric.Line) {
      const p = toNorm(obj.x1!, obj.y1!, L);
      const q = toNorm(obj.x2!, obj.y2!, L);
      shape.x1 = p.nx; shape.y1 = p.ny; shape.x2 = q.nx; shape.y2 = q.ny;
    } else if (type === 'circle' && obj instanceof fabric.Circle) {
      const r = obj.radius! * (obj.scaleX ?? 1);
      const cp = obj.getCenterPoint();
      const c = toNorm(cp.x, cp.y, L);
      const e = toNorm(cp.x + r, cp.y, L);
      shape.x1 = c.nx; shape.y1 = c.ny; shape.x2 = e.nx; shape.y2 = e.ny;
    } else if (type === 'text' && obj instanceof fabric.IText) {
      const p = toNorm(obj.left ?? 0, obj.top ?? 0, L);
      shape.x1 = p.nx; shape.y1 = p.ny; shape.x2 = p.nx; shape.y2 = p.ny;
      shape.text = obj.text || '';
      shape.fill = String(obj.fill || color);
      shape.fontSize = (obj.fontSize || 20) / Math.min(L.w, L.h);
    } else if (type === 'freehand' && obj instanceof fabric.Path) {
      const cp = obj.getCenterPoint();
      const bw = (obj.width ?? 0) * (obj.scaleX ?? 1);
      const bh = (obj.height ?? 0) * (obj.scaleY ?? 1);
      const tl = toNorm(cp.x - bw / 2, cp.y - bh / 2, L);
      const br = toNorm(cp.x + bw / 2, cp.y + bh / 2, L);
      shape.x1 = tl.nx; shape.y1 = tl.ny; shape.x2 = br.nx; shape.y2 = br.ny;
      const svg = obj.toSVG();
      const m = svg.match(/d="([^"]+)"/);
      if (m) {
        shape.path = m[1].replace(/(-?\d+\.?\d*)/g, (_, num, off, str) => {
          const cnt = (str.substring(0, off).match(/\d+\.?\d*/g) || []).length;
          const v = parseFloat(num);
          return String(cnt % 2 === 0 ? (v - L.x) / L.w : (v - L.y) / L.h);
        });
      }
    } else {
      // rect / default — use bounding box via getCenterPoint
      const cp = obj.getCenterPoint();
      const bw = (obj.width ?? 0) * (obj.scaleX ?? 1);
      const bh = (obj.height ?? 0) * (obj.scaleY ?? 1);
      const tl = toNorm(cp.x - bw / 2, cp.y - bh / 2, L);
      const br = toNorm(cp.x + bw / 2, cp.y + bh / 2, L);
      shape.x1 = tl.nx; shape.y1 = tl.ny; shape.x2 = br.nx; shape.y2 = br.ny;
    }

    if (obj.fill && obj.fill !== '' && type !== 'text' && type !== 'freehand' && type !== 'arrow') {
      shape.fill = String(obj.fill);
    }
    out.push(shape);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  imageUrl: string;
  initialAnnotations: AnnotationShape[];
  onSave: (annotations: AnnotationShape[]) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function ImageAnnotationEditor({ imageUrl, initialAnnotations, onSave, onClose }: Props) {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const et = t.admin.imageEditor;

  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fcRef = useRef<fabric.Canvas | null>(null);
  const layoutRef = useRef<ImageLayout | null>(null);
  const bgImgRef = useRef<fabric.FabricImage | null>(null);

  const [tool, setTool] = useState<Tool>('select');
  const toolRef = useRef<Tool>('select');
  const [color, setColor] = useState(COLORS[4]);
  const colorRef = useRef(COLORS[4]);
  const [strokeWidth, setStrokeWidth] = useState(STROKE_OPTIONS[1].value);
  const swRef = useRef(STROKE_OPTIONS[1].value);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Keep refs in sync
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { swRef.current = strokeWidth; }, [strokeWidth]);

  // Undo/redo — store full canvas JSON snapshots
  const historyUndo = useRef<string[]>([]);
  const historyRedo = useRef<string[]>([]);
  const historyProcessing = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /** Serialize only user-created objects (exclude background image). */
  const serializeUserObjects = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return '{"objects":[]}';
    const objs = fc.getObjects().filter(o => !(o as FabricMeta).excludeFromExport);
    return JSON.stringify(objs.map(o => o.toObject()));
  }, []);

  /** Restore user objects from serialized JSON, keeping background image. */
  const restoreUserObjects = useCallback(async (json: string) => {
    const fc = fcRef.current;
    const bg = bgImgRef.current;
    if (!fc) return;
    // Remove all user objects
    fc.getObjects().filter(o => !(o as FabricMeta).excludeFromExport).forEach(o => fc.remove(o));
    // Parse and re-add
    const arr = JSON.parse(json) as FabricSerializedObject[];
    for (const data of arr) {
      const klass = fabric.classRegistry.getClass(data.type as string) as
        | { fromObject: (d: FabricSerializedObject) => Promise<fabric.FabricObject> }
        | undefined;
      if (klass) {
        const obj = await klass.fromObject(data);
        fc.add(obj);
      }
    }
    // Ensure background stays at back
    if (bg && fc.getObjects().includes(bg)) fc.sendObjectToBack(bg);
    fc.renderAll();
  }, []);

  const pushState = useCallback(() => {
    if (!fcRef.current || historyProcessing.current) return;
    historyUndo.current.push(serializeUserObjects());
    if (historyUndo.current.length > 30) historyUndo.current.shift();
    historyRedo.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [serializeUserObjects]);

  const handleUndo = useCallback(() => {
    if (!fcRef.current || !historyUndo.current.length) return;
    historyProcessing.current = true;
    historyRedo.current.push(serializeUserObjects());
    const prev = historyUndo.current.pop()!;
    restoreUserObjects(prev).then(() => {
      historyProcessing.current = false;
      setCanUndo(historyUndo.current.length > 0);
      setCanRedo(true);
    });
  }, [serializeUserObjects, restoreUserObjects]);

  const handleRedo = useCallback(() => {
    if (!fcRef.current || !historyRedo.current.length) return;
    historyProcessing.current = true;
    historyUndo.current.push(serializeUserObjects());
    const next = historyRedo.current.pop()!;
    restoreUserObjects(next).then(() => {
      historyProcessing.current = false;
      setCanUndo(true);
      setCanRedo(historyRedo.current.length > 0);
    });
  }, [serializeUserObjects, restoreUserObjects]);

  // Drawing state
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const previewObj = useRef<fabric.FabricObject | null>(null);

  /* ---- Initialize Fabric canvas ---- */
  useEffect(() => {
    const container = containerRef.current;
    const wrap = wrapRef.current;
    if (!container || !wrap) return;

    setLoadState('loading');
    const { width, height } = container.getBoundingClientRect();

    // Create canvas imperatively to avoid React DOM conflicts
    const canvasEl = document.createElement('canvas');
    canvasEl.width = width;
    canvasEl.height = height;
    wrap.innerHTML = '';
    wrap.appendChild(canvasEl);

    const fc = new fabric.Canvas(canvasEl, { width, height, selection: true, backgroundColor: '#1e293b' });
    fcRef.current = fc;

    const imgEl = new Image();
    imgEl.onload = () => {
      const scale = Math.min(width / imgEl.naturalWidth, height / imgEl.naturalHeight);
      const imgW = imgEl.naturalWidth * scale;
      const imgH = imgEl.naturalHeight * scale;
      const L: ImageLayout = { x: (width - imgW) / 2, y: (height - imgH) / 2, w: imgW, h: imgH };
      layoutRef.current = L;

      const bgImg = new fabric.FabricImage(imgEl, {
        left: L.x, top: L.y, scaleX: scale, scaleY: scale,
        selectable: false, evented: false, excludeFromExport: true,
      });
      bgImgRef.current = bgImg;
      fc.add(bgImg);
      fc.sendObjectToBack(bgImg);

      if (initialAnnotations.length) loadShapes(initialAnnotations, L, fc);
      fc.renderAll();
      pushState();
      setLoadState('ready');
    };
    imgEl.onerror = () => setLoadState('error');
    imgEl.src = imageUrl;

    // Save state on object changes
    fc.on('object:modified', () => pushState());
    fc.on('object:added', () => { if (!historyProcessing.current) { /* state saved after drawing completes */ } });

    // Mouse handlers for shape drawing
    fc.on('mouse:down', (opt) => {
      const currentTool = toolRef.current;
      if (currentTool === 'select' || currentTool === 'freehand') return;
      if (currentTool === 'text') {
        const pointer = fc.getScenePoint(opt.e);
        pushState();
        const text = new fabric.IText(et.defaultText, {
          left: pointer.x, top: pointer.y, fill: colorRef.current,
          fontSize: swRef.current * 5 + 12, fontFamily: 'Inter, sans-serif',
        });
        (text as FabricMeta).__shapeType = 'text';
        (text as FabricMeta).__shapeId = generateId();
        fc.add(text);
        fc.setActiveObject(text);
        text.enterEditing();
        fc.renderAll();
        return;
      }
      // arrow, circle, rect
      if (fc.getActiveObject()) return; // don't draw if clicking on existing object
      const pointer = fc.getScenePoint(opt.e);
      drawStart.current = { x: pointer.x, y: pointer.y };
      fc.selection = false;
    });

    fc.on('mouse:move', (opt) => {
      if (!drawStart.current) return;
      const currentTool = toolRef.current;
      if (currentTool === 'select' || currentTool === 'freehand' || currentTool === 'text') return;
      const p = fc.getScenePoint(opt.e);
      const { x: sx, y: sy } = drawStart.current;

      if (previewObj.current) fc.remove(previewObj.current);

      let prev: fabric.FabricObject;
      const sw = swRef.current;
      const col = colorRef.current;
      if (currentTool === 'arrow') {
        prev = new fabric.Line([sx, sy, p.x, p.y], { stroke: col, strokeWidth: sw, strokeLineCap: 'round', fill: '', selectable: false, evented: false });
      } else if (currentTool === 'circle') {
        const r = Math.sqrt((p.x - sx) ** 2 + (p.y - sy) ** 2);
        prev = new fabric.Circle({ left: sx - r, top: sy - r, radius: r, stroke: col, strokeWidth: sw, fill: '', selectable: false, evented: false });
      } else {
        prev = new fabric.Rect({ left: Math.min(sx, p.x), top: Math.min(sy, p.y), width: Math.abs(p.x - sx), height: Math.abs(p.y - sy), stroke: col, strokeWidth: sw, fill: '', selectable: false, evented: false });
      }
      previewObj.current = prev;
      fc.add(prev);
      fc.renderAll();
    });

    fc.on('mouse:up', (opt) => {
      if (!drawStart.current) return;
      const currentTool = toolRef.current;
      if (currentTool === 'select' || currentTool === 'freehand' || currentTool === 'text') { drawStart.current = null; return; }
      const p = fc.getScenePoint(opt.e);
      const { x: sx, y: sy } = drawStart.current;
      drawStart.current = null;

      if (previewObj.current) { fc.remove(previewObj.current); previewObj.current = null; }

      const dist = Math.sqrt((p.x - sx) ** 2 + (p.y - sy) ** 2);
      if (dist < 5) { fc.selection = true; return; }

      pushState();
      const sw = swRef.current;
      const col = colorRef.current;
      let obj: fabric.FabricObject;
      if (currentTool === 'arrow') {
        obj = new fabric.Line([sx, sy, p.x, p.y], { stroke: col, strokeWidth: sw, strokeLineCap: 'round', fill: '' });
      } else if (currentTool === 'circle') {
        const r = Math.sqrt((p.x - sx) ** 2 + (p.y - sy) ** 2);
        obj = new fabric.Circle({ left: sx - r, top: sy - r, radius: r, stroke: col, strokeWidth: sw, fill: '' });
      } else {
        obj = new fabric.Rect({ left: Math.min(sx, p.x), top: Math.min(sy, p.y), width: Math.abs(p.x - sx), height: Math.abs(p.y - sy), stroke: col, strokeWidth: sw, fill: '' });
      }
      (obj as FabricMeta).__shapeType = currentTool;
      (obj as FabricMeta).__shapeId = generateId();
      fc.add(obj);
      fc.selection = true;
      fc.renderAll();
    });

    // Freehand path created
    fc.on('path:created', () => {
      if (historyProcessing.current) return;
      pushState();
      const objs = fc.getObjects();
      const last = objs[objs.length - 1];
      if (last && !(last as FabricMeta).__shapeType) {
        (last as FabricMeta).__shapeType = 'freehand';
        (last as FabricMeta).__shapeId = generateId();
      }
    });

    // Keyboard
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        const active = fc.getActiveObjects();
        if (active.length) {
          pushState();
          active.forEach(o => fc.remove(o));
          fc.discardActiveObject();
          fc.renderAll();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      fc.dispose();
      fcRef.current = null;
      if (wrap) wrap.innerHTML = '';
    };
  }, [imageUrl, loadAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Tool switching ---- */
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    if (tool === 'freehand') {
      fc.isDrawingMode = true;
      fc.freeDrawingBrush = new fabric.PencilBrush(fc);
      fc.freeDrawingBrush.color = color;
      fc.freeDrawingBrush.width = strokeWidth;
      fc.selection = false;
    } else {
      fc.isDrawingMode = false;
      fc.selection = tool === 'select';
      fc.forEachObject(o => {
        if ((o as FabricMeta).excludeFromExport) return;
        o.selectable = tool === 'select';
        o.evented = tool === 'select' || tool === 'text';
      });
    }
    fc.discardActiveObject();
    fc.renderAll();
  }, [tool, color, strokeWidth]);

  /* ---- Apply color/stroke to selected ---- */
  const applyToSelected = useCallback((prop: string, value: string | number) => {
    const fc = fcRef.current;
    if (!fc) return;
    const active = fc.getActiveObjects();
    if (!active.length) return;
    pushState();
    active.forEach(obj => {
      if (prop === 'stroke') {
        obj.set('stroke', value as string);
        if (obj instanceof fabric.IText) obj.set('fill', value as string);
      } else {
        obj.set(prop as keyof fabric.FabricObject, value);
      }
    });
    fc.renderAll();
  }, [pushState]);

  /* ---- Save ---- */
  const [saving, setSaving] = useState(false);
  const handleSave = useCallback(() => {
    const fc = fcRef.current;
    const L = layoutRef.current;
    setSaving(true);
    if (!fc || !L) { onSave([]); } else { onSave(saveShapes(fc, L)); }
    setTimeout(() => setSaving(false), 900);
  }, [onSave]);

  /* ---- Clear all ---- */
  const handleClearAll = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return;
    pushState();
    fc.getObjects().filter(o => !(o as FabricMeta).excludeFromExport).forEach(o => fc.remove(o));
    fc.renderAll();
  }, [pushState]);

  /* ---- Toolbar ---- */
  const ICON_SIZE = 16;
  const toolButtons: { id: Tool; icon: React.ReactNode; title: string }[] = [
    { id: 'select', icon: <MousePointer2 size={ICON_SIZE} />, title: et.toolSelect },
    { id: 'freehand', icon: <Pencil size={ICON_SIZE} />, title: et.toolFreehand },
    { id: 'arrow', icon: <MoveUpRight size={ICON_SIZE} />, title: et.toolArrow },
    { id: 'circle', icon: <CircleIcon size={ICON_SIZE} />, title: et.toolCircle },
    { id: 'rect', icon: <Square size={ICON_SIZE} />, title: et.toolRect },
    { id: 'text', icon: <Type size={ICON_SIZE} />, title: et.toolText },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700/50 bg-slate-900 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Tool buttons */}
          <div className="flex items-center gap-0.5 rounded-xl border border-slate-700 bg-slate-800/50 p-1">
            {toolButtons.map(({ id, icon, title }) => (
              <button key={id} type="button" title={title} onClick={() => setTool(id)}
                className={`inline-flex items-center justify-center rounded-lg p-2 transition ${tool === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}>
                {icon}
              </button>
            ))}
          </div>
          {/* Colors */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/50 p-1.5">
            {COLORS.map(c => (
              <button key={c} type="button" onClick={() => { setColor(c); applyToSelected('stroke', c); }} title={c}
                style={{ backgroundColor: c }}
                className={`h-5 w-5 shrink-0 rounded-full border-2 transition ${color === c ? 'border-white scale-125 shadow-lg' : 'border-slate-600 hover:scale-110 hover:border-slate-400'}`} />
            ))}
          </div>
          {/* Stroke width */}
          {tool !== 'text' && (
            <div className="flex items-center gap-0.5 rounded-xl border border-slate-700 bg-slate-800/50 p-1">
              {STROKE_OPTIONS.map(({ label, value }) => (
                <button key={value} type="button" onClick={() => { setStrokeWidth(value); applyToSelected('strokeWidth', value); }}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${strokeWidth === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {/* Undo / Redo / Clear */}
          <div className="flex items-center gap-0.5 rounded-xl border border-slate-700 bg-slate-800/50 p-1">
            <button type="button" disabled={!canUndo} onClick={handleUndo} title={et.undo}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
              <Undo2 size={14} /> {et.undo}
            </button>
            <button type="button" disabled={!canRedo} onClick={handleRedo} title={et.redo}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
              <Redo2 size={14} /> {et.redo}
            </button>
            <button type="button" onClick={handleClearAll} title={et.clearAll}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-slate-700">
              <Trash2 size={14} /> {et.clearAll}
            </button>
          </div>
        </div>
        {/* Right: Close + Save */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800">
            <X size={14} /> {et.close}
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? et.saving : et.save}
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <div ref={wrapRef} className="absolute inset-0" />
        {loadState === 'loading' && <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-400 pointer-events-none">{et.loading}</div>}
        {loadState === 'error' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-sm text-slate-300">
            <p>{et.loadError}</p>
            <button type="button" onClick={() => setLoadAttempt(p => p + 1)} className="rounded-xl border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-slate-400 hover:bg-slate-800">{et.retry}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
