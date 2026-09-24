import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Type, Undo, Save, X, ArrowRight, Square, Cloud, Loader2, Hand, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { getImageQualityProfile, type ImageQualityKind } from '../utils/imageQualitySettings';

type EditorTool = 'pan' | 'draw' | 'text' | 'arrow' | 'rect' | 'cloud';

interface ImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onSave: (editedFile: File) => void | Promise<void>;
  imageKind?: 'defect' | 'crew';
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  onSave,
  imageKind = 'defect',
}) => {
  const qualityKind: ImageQualityKind = imageKind === 'crew' ? 'crew' : 'defect';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureBaseRef = useRef<ImageData | null>(null);
  const isComposingRef = useRef(false);
  const pointerMapRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    distance: number;
    midpoint: { x: number; y: number };
    zoom: number;
    pan: { x: number; y: number };
  } | null>(null);
  const panStartRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);

  const [activeTool, setActiveTool] = useState<EditorTool>('pan');
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState('#ef4444');
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const getContext = (willReadFrequently = false) => {
    const canvas = canvasRef.current;
    return canvas?.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined) || null;
  };

  const rememberState = () => {
    const canvas = canvasRef.current;
    const ctx = getContext(true);
    if (!canvas || !ctx) return;

    try {
      const next = [...history, ctx.getImageData(0, 0, canvas.width, canvas.height)];
      const pixels = canvas.width * canvas.height;
      const maxStates = pixels > 5_000_000 ? 3 : 5;
      if (next.length > maxStates) next.splice(0, next.length - maxStates);
      setHistory(next);
    } catch (err) {
      console.warn('Image editor history snapshot failed:', err);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setHistory([]);
      setTextPos(null);
      setTextInput('');
      setStartPos(null);
      setIsDrawing(false);
      setIsSaving(false);
      setIsImageLoading(false);
      gestureBaseRef.current = null;
      isComposingRef.current = false;
      pointerMapRef.current.clear();
      pinchRef.current = null;
      panStartRef.current = null;
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    if (!imageUrl || !canvasRef.current) return;

    let cancelled = false;
    setIsImageLoading(true);
    setActiveTool('pan');
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pointerMapRef.current.clear();
    pinchRef.current = null;
    panStartRef.current = null;
    setTextPos(null);
    setTextInput('');
    setHistory([]);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = getContext(true);
      if (!canvas || !ctx) return;

      const profile = getImageQualityProfile(qualityKind);
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      const maxDimension = Math.max(1280, Number(profile.maxDimension || 0));
      const ratio = Math.min(1, maxDimension / Math.max(naturalW, naturalH));
      const w = Math.max(1, Math.round(naturalW * ratio));
      const h = Math.max(1, Math.round(naturalH * ratio));

      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);

      try {
        setHistory([ctx.getImageData(0, 0, w, h)]);
      } catch (err) {
        console.warn('Could not save initial image state:', err);
      } finally {
        setIsImageLoading(false);
      }
    };
    img.onerror = () => {
      if (!cancelled) setIsImageLoading(false);
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [isOpen, imageUrl, qualityKind]);

  const handleUndo = () => {
    if (history.length <= 1) return;
    const ctx = getContext();
    if (!ctx) return;

    const prevHistory = history.slice(0, -1);
    const prevState = prevHistory[prevHistory.length - 1];
    ctx.putImageData(prevState, 0, 0);
    setHistory(prevHistory);
    gestureBaseRef.current = null;
  };

  const selectTool = (tool: EditorTool) => {
    setIsDrawing(false);
    setStartPos(null);
    gestureBaseRef.current = null;
    if (tool !== 'text') {
      setTextPos(null);
      setTextInput('');
    }
    setActiveTool(tool);
  };

  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const getStrokeWidth = () => {
    const canvas = canvasRef.current;
    if (!canvas) return 4;
    return Math.max(3, Math.min(10, Math.max(canvas.width, canvas.height) / 450));
  };

  const clampZoom = (value: number) => Math.max(0.5, Math.min(5, value));

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pinchRef.current = null;
    panStartRef.current = null;
  };

  const zoomBy = (factor: number) => {
    setZoom((current) => clampZoom(current * factor));
  };

  const updatePinchState = () => {
    const touches = Array.from(pointerMapRef.current.values()) as Array<{ x: number; y: number }>;
    if (touches.length < 2) {
      pinchRef.current = null;
      return;
    }
    const [a, b] = touches;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    if (!pinchRef.current) {
      pinchRef.current = { distance, midpoint, zoom, pan };
      setIsDrawing(false);
      setStartPos(null);
      gestureBaseRef.current = null;
      panStartRef.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const canvas = canvasRef.current;
    const ctx = getContext(true);
    if (!canvas || !ctx || isImageLoading || isSaving) return;

    pointerMapRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}

    if (e.pointerType === 'touch' && pointerMapRef.current.size >= 2) {
      // PINCH_GESTURE_ROLLBACK: if the first finger started a drawing tool before
      // the second finger arrived, restore the pre-gesture canvas so pinch/pan can
      // never leave an accidental stroke/shape behind.
      if (isDrawing && gestureBaseRef.current) {
        ctx.putImageData(gestureBaseRef.current, 0, 0);
      }
      setIsDrawing(false);
      setStartPos(null);
      gestureBaseRef.current = null;
      updatePinchState();
      e.preventDefault();
      return;
    }

    if (activeTool === 'pan' || (e.pointerType === 'mouse' && e.button === 1)) {
      panStartRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
      return;
    }

    const { x, y } = getCoordinates(e);
    if (activeTool === 'text') {
      setTextPos({ x, y });
      setTextInput('');
      return;
    }

    if (!['draw', 'arrow', 'rect', 'cloud'].includes(activeTool)) return;

    try {
      gestureBaseRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      gestureBaseRef.current = history[history.length - 1] || null;
    }

    setStartPos({ x, y });
    setIsDrawing(true);
    ctx.strokeStyle = color;
    ctx.lineWidth = getStrokeWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (activeTool === 'draw') {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => {
    const headLength = Math.max(14, getStrokeWidth() * 4);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6),
    );
    ctx.stroke();
  };

  const drawCloud = (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => {
    const w = endX - startX;
    const h = endY - startY;
    const numBumpsX = Math.max(3, Math.floor(Math.abs(w) / 30));
    const numBumpsY = Math.max(3, Math.floor(Math.abs(h) / 30));
    const stepX = w / numBumpsX;
    const stepY = h / numBumpsY;

    ctx.beginPath();
    ctx.moveTo(startX, startY);

    for (let i = 0; i < numBumpsX; i++) {
      const x0 = startX + i * stepX;
      const x1 = startX + (i + 1) * stepX;
      ctx.quadraticCurveTo(x0 + stepX / 2, startY - Math.abs(stepX) * 0.5, x1, startY);
    }
    for (let i = 0; i < numBumpsY; i++) {
      const y0 = startY + i * stepY;
      const y1 = startY + (i + 1) * stepY;
      ctx.quadraticCurveTo(endX + Math.abs(stepY) * 0.5, y0 + stepY / 2, endX, y1);
    }
    for (let i = 0; i < numBumpsX; i++) {
      const x0 = endX - i * stepX;
      const x1 = endX - (i + 1) * stepX;
      ctx.quadraticCurveTo(x0 - stepX / 2, endY + Math.abs(stepX) * 0.5, x1, endY);
    }
    for (let i = 0; i < numBumpsY; i++) {
      const y0 = endY - i * stepY;
      const y1 = endY - (i + 1) * stepY;
      ctx.quadraticCurveTo(startX - Math.abs(stepY) * 0.5, y0 - stepY / 2, startX, y1);
    }
    ctx.stroke();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerMapRef.current.has(e.pointerId)) {
      pointerMapRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (e.pointerType === 'touch' && pointerMapRef.current.size >= 2) {
      updatePinchState();
      const pinch = pinchRef.current;
      if (pinch) {
        const touches = Array.from(pointerMapRef.current.values()) as Array<{ x: number; y: number }>;
        const [a, b] = touches;
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        setZoom(clampZoom(pinch.zoom * (distance / pinch.distance)));
        setPan({
          x: pinch.pan.x + (midpoint.x - pinch.midpoint.x),
          y: pinch.pan.y + (midpoint.y - pinch.midpoint.y),
        });
      }
      e.preventDefault();
      return;
    }

    const panStart = panStartRef.current;
    if (panStart && panStart.pointerId === e.pointerId) {
      setPan({
        x: panStart.panX + (e.clientX - panStart.x),
        y: panStart.panY + (e.clientY - panStart.y),
      });
      e.preventDefault();
      return;
    }

    if (!isDrawing) return;
    const ctx = getContext();
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = getStrokeWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (activeTool === 'draw') {
      ctx.lineTo(x, y);
      ctx.stroke();
      return;
    }

    if (!startPos || !gestureBaseRef.current) return;
    ctx.putImageData(gestureBaseRef.current, 0, 0);

    if (activeTool === 'arrow') {
      drawArrow(ctx, startPos.x, startPos.y, x, y);
    } else if (activeTool === 'rect') {
      ctx.beginPath();
      ctx.rect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
      ctx.stroke();
    } else if (activeTool === 'cloud') {
      drawCloud(ctx, startPos.x, startPos.y, x, y);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerMapRef.current.delete(e.pointerId);
    if (pointerMapRef.current.size < 2) pinchRef.current = null;
    if (panStartRef.current?.pointerId === e.pointerId) panStartRef.current = null;

    if (isDrawing) {
      setIsDrawing(false);
      setStartPos(null);
      const ctx = getContext();
      if (ctx) ctx.closePath();
      rememberState();
      gestureBaseRef.current = null;
    }

    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (isSaving || isImageLoading) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom((current) => clampZoom(current * factor));
  };

  const addTextToCanvas = () => {
    const text = textInput.trim();
    if (!text || !textPos || isComposingRef.current) return;

    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    const fontSize = Math.max(22, Math.min(64, Math.max(canvas.width, canvas.height) / 40));
    ctx.font = `700 ${fontSize}px Arial, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = Math.max(2, fontSize / 8);
    ctx.fillText(text, textPos.x, textPos.y);
    ctx.shadowBlur = 0;

    rememberState();
    setTextInput('');
    setTextPos(null);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || isSaving || isImageLoading) return;

    setIsSaving(true);
    try {
      const profile = getImageQualityProfile(qualityKind);
      // The source has already gone through the user's import quality profile. Re-encoding
      // annotations below that quality causes visible cumulative blur, so edited output
      // uses a high-quality single encode and downstream storage must preserve it.
      const outputQuality = Math.max(0.92, Math.min(0.98, Number(profile.quality || 0.92) + 0.04));
      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob(resolve, 'image/jpeg', outputQuality);
        } catch {
          resolve(null);
        }
      });
      if (!blob) throw new Error('Không thể tạo ảnh đã chỉnh sửa.');

      const file = new File([blob], `Edited_Photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
      await onSave(file);
    } catch (err) {
      console.error('Image editor save failed:', err);
      alert('Không thể lưu ảnh đã chỉnh sửa.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const toolButtonClass = (tool: EditorTool) =>
    `p-2 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
      activeTool === tool ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
    }`;

  const editorModal = (
    <div className="fixed inset-0 h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden bg-slate-900/90 z-[200] flex flex-col animate-in fade-in" role="dialog" aria-modal="true">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 sm:px-4 sm:py-2.5 bg-slate-950 text-white">
        <h3 className="font-bold text-sm">Chỉnh sửa ảnh</h3>
        <button type="button" onClick={onClose} className="p-1 hover:bg-slate-800 rounded-full transition-colors" aria-label="Đóng">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-1.5 sm:p-2 overflow-hidden relative w-full">
        <div className="relative w-full h-full min-h-0 overflow-hidden flex items-center justify-center bg-slate-900/40 rounded-xl">
          <div
            className="relative max-w-full max-h-full shadow-2xl rounded-xl bg-slate-800 will-change-transform"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            className={`block touch-none max-w-full max-h-full w-auto h-auto object-contain ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
          />

          {isImageLoading && (
            <div className="absolute inset-0 bg-slate-900/60 text-white flex items-center justify-center gap-2 text-sm font-bold">
              <Loader2 className="w-5 h-5 animate-spin" />
              Đang mở ảnh...
            </div>
          )}

          {activeTool === 'text' && textPos && (
            <div
              className="absolute z-10 flex gap-2 max-w-[90%]"
              style={{
                left: `${Math.min(92, Math.max(1, (textPos.x / (canvasRef.current?.width || 1)) * 100))}%`,
                top: `${Math.min(92, Math.max(1, (textPos.y / (canvasRef.current?.height || 1)) * 100))}%`,
                transform: 'translateY(-50%)',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                type="text"
                lang="vi"
                inputMode="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false;
                  setTextInput(e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  const nativeEvent = e.nativeEvent as KeyboardEvent;
                  if (e.key === 'Enter' && !isComposingRef.current && !nativeEvent.isComposing) {
                    e.preventDefault();
                    addTextToCanvas();
                  }
                }}
                placeholder="Nhập chữ tiếng Việt..."
                className="min-w-44 max-w-[60vw] px-2 py-1 bg-white text-slate-900 text-sm font-semibold border-2 rounded outline-none shadow-xl"
                style={{ borderColor: color }}
              />
              <button
                type="button"
                onClick={addTextToCanvas}
                className="bg-emerald-600 text-white px-2 py-1 rounded shadow text-xs font-bold whitespace-nowrap"
              >
                Xong
              </button>
            </div>
          )}
          </div>

          <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-xl bg-slate-950/85 p-1 text-white shadow-lg">
            <button type="button" onClick={() => zoomBy(1 / 1.2)} disabled={isSaving || isImageLoading} className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50" title="Thu nhỏ" aria-label="Thu nhỏ ảnh">
              <ZoomOut className="w-4 h-4" />
            </button>
            <button type="button" onClick={resetView} disabled={isSaving || isImageLoading} className="min-w-14 px-1.5 py-1 text-[10px] font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50" title="Vừa ảnh" aria-label="Đưa ảnh về vừa khung">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => zoomBy(1.2)} disabled={isSaving || isImageLoading} className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50" title="Phóng to" aria-label="Phóng to ảnh">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button type="button" onClick={resetView} disabled={isSaving || isImageLoading} className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50" title="Vừa ảnh" aria-label="Vừa ảnh">
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 bg-slate-950 p-2 pb-safe border-t border-slate-800" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
          <div className="min-w-0 flex-1 flex items-center justify-between overflow-x-auto no-scrollbar gap-2">
            <div className="flex gap-1 shrink-0">
              <button type="button" disabled={isSaving || isImageLoading} onClick={() => selectTool('pan')} className={toolButtonClass('pan')} title="Di chuyển / Zoom" aria-label="Di chuyển / Zoom" aria-pressed={activeTool === 'pan'}>
                <Hand className="w-5 h-5" />
              </button>
              <button type="button" disabled={isSaving || isImageLoading} onClick={() => selectTool('draw')} className={toolButtonClass('draw')} title="Vẽ tự do" aria-label="Vẽ tự do" aria-pressed={activeTool === 'draw'}>
                <Pencil className="w-5 h-5" />
              </button>
              <button type="button" disabled={isSaving || isImageLoading} onClick={() => selectTool('arrow')} className={toolButtonClass('arrow')} title="Mũi tên" aria-label="Mũi tên" aria-pressed={activeTool === 'arrow'}>
                <ArrowRight className="w-5 h-5" />
              </button>
              <button type="button" disabled={isSaving || isImageLoading} onClick={() => selectTool('rect')} className={toolButtonClass('rect')} title="Khung chữ nhật" aria-label="Khung chữ nhật" aria-pressed={activeTool === 'rect'}>
                <Square className="w-5 h-5" />
              </button>
              <button type="button" disabled={isSaving || isImageLoading} onClick={() => selectTool('cloud')} className={toolButtonClass('cloud')} title="Cloud đánh dấu" aria-label="Cloud đánh dấu" aria-pressed={activeTool === 'cloud'}>
                <Cloud className="w-5 h-5" />
              </button>
              <button type="button" disabled={isSaving || isImageLoading} onClick={() => selectTool('text')} className={toolButtonClass('text')} title="Chèn chữ" aria-label="Chèn chữ" aria-pressed={activeTool === 'text'}>
                <Type className="w-5 h-5" />
              </button>
            </div>

            <div className="h-6 w-px bg-slate-700 shrink-0" />

            <div className="flex gap-1.5 shrink-0">
              {['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ffffff'].map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 shadow-sm transition-transform ${
                    color === c ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Chọn màu ${c}`}
                />
              ))}
            </div>

            <div className="h-6 w-px bg-slate-700 shrink-0" />

            <button
              type="button"
              onClick={handleUndo}
              disabled={history.length <= 1 || isSaving}
              className="p-2 bg-slate-800 text-slate-200 disabled:opacity-50 rounded-lg flex items-center justify-center shrink-0"
              title="Hoàn tác"
              aria-label="Hoàn tác"
            >
              <Undo className="w-5 h-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isImageLoading}
            className="w-full md:w-auto md:min-w-48 md:shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {isSaving ? 'Đang lưu...' : 'Lưu ảnh đã chỉnh sửa'}
          </button>
        </div>
      </div>
    </div>
  );

  // Portaled to body so a Crew/Defect parent modal with overflow/transform cannot
  // clip the editor or place it behind the 84px desktop/EXE navigation rail.
  return typeof document !== 'undefined' ? createPortal(editorModal, document.body) : editorModal;
};
