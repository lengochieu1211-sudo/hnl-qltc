import React, { useState, useRef, useEffect } from 'react';
import { Pencil, Type, Undo, Save, X, Trash2, ArrowRight, Square, Cloud } from 'lucide-react';

interface ImageEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onSave: (editedFile: File) => void;
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  onSave
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [activeTool, setActiveTool] = useState<'draw' | 'text' | 'arrow' | 'rect' | 'cloud'>('draw');
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);
  const [color, setColor] = useState('#ef4444'); // Red by default
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{x: number, y: number} | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setHistory([]);
      setTextPos(null);
      setTextInput('');
      return;
    }

    if (isOpen && imageUrl && canvasRef.current) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (!canvas || !ctx) return;
        
        // Adjust canvas size to fit container but keep aspect ratio
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const maxW = Math.min(window.innerWidth * 0.9, 1280);
        const maxH = Math.min(window.innerHeight * 0.65, 960);
        
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        
        canvas.width = w;
        canvas.height = h;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, w, h);
        
        // Save initial state (keep max 5 states to save memory on mobile)
        try {
          setHistory([ctx.getImageData(0, 0, w, h)]);
        } catch (err) {
          console.warn('Could not save initial image state:', err);
        }
      };
      img.src = imageUrl;
    }
  }, [isOpen, imageUrl]);

  const saveState = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx) return;
    
    try {
      const newHistory = [...history, ctx.getImageData(0, 0, canvas.width, canvas.height)];
      // Keep max 5 states to prevent mobile memory bloat
      if (newHistory.length > 5) newHistory.shift();
      setHistory(newHistory);
    } catch (err) {
      console.warn('saveState failed:', err);
    }
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    
    const prevHistory = history.slice(0, -1);
    const prevState = prevHistory[prevHistory.length - 1];
    
    ctx.putImageData(prevState, 0, 0);
    setHistory(prevHistory);
  };

  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    if (['draw', 'arrow', 'rect', 'cloud'].includes(activeTool)) {
      setStartPos({ x, y });
      setIsDrawing(true);
      if (activeTool === 'draw') {
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch(err){}
    } else if (activeTool === 'text') {
      const { x, y } = getCoordinates(e);
      setTextPos({ x, y });
      // Clear previous text input if they clicked somewhere else
      setTextInput('');
    }
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, fromx: number, fromy: number, tox: number, toy: number) => {
    const headlen = 15;
    const dx = tox - fromx;
    const dy = toy - fromy;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const drawCloud = (ctx: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number) => {
    const w = endX - startX;
    const h = endY - startY;
    
    // Draw a jagged/bumpy rectangle resembling a cloud/revision cloud
    ctx.beginPath();
    const numBumpsX = Math.max(3, Math.floor(Math.abs(w) / 30));
    const numBumpsY = Math.max(3, Math.floor(Math.abs(h) / 30));
    
    const stepX = w / numBumpsX;
    const stepY = h / numBumpsY;
    
    ctx.moveTo(startX, startY);
    
    // Top edge
    for(let i=0; i<numBumpsX; i++) {
        const x0 = startX + i*stepX;
        const x1 = startX + (i+1)*stepX;
        ctx.quadraticCurveTo(x0 + stepX/2, startY - Math.abs(stepX)*0.5, x1, startY);
    }
    // Right edge
    for(let i=0; i<numBumpsY; i++) {
        const y0 = startY + i*stepY;
        const y1 = startY + (i+1)*stepY;
        ctx.quadraticCurveTo(endX + Math.abs(stepY)*0.5, y0 + stepY/2, endX, y1);
    }
    // Bottom edge
    for(let i=0; i<numBumpsX; i++) {
        const x0 = endX - i*stepX;
        const x1 = endX - (i+1)*stepX;
        ctx.quadraticCurveTo(x0 - stepX/2, endY + Math.abs(stepX)*0.5, x1, endY);
    }
    // Left edge
    for(let i=0; i<numBumpsY; i++) {
        const y0 = endY - i*stepY;
        const y1 = endY - (i+1)*stepY;
        ctx.quadraticCurveTo(startX - Math.abs(stepY)*0.5, y0 - stepY/2, startX, y1);
    }
    ctx.stroke();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    
    if (activeTool === 'draw') {
      ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (startPos && ['arrow', 'rect', 'cloud'].includes(activeTool)) {
      // Restore previous state
      if (history.length > 0) {
        ctx.putImageData(history[history.length - 1], 0, 0);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (activeTool === 'arrow') {
        drawArrow(ctx, startPos.x, startPos.y, x, y);
      } else if (activeTool === 'rect') {
        ctx.beginPath();
        ctx.rect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
        ctx.stroke();
      } else if (activeTool === 'cloud') {
        drawCloud(ctx, startPos.x, startPos.y, x, y);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawing) {
      setIsDrawing(false);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) ctx.closePath();
      saveState();
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err){}
    }
  };

  const addTextToCanvas = () => {
    if (!textInput.trim() || !textPos) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = color;
    // Add simple shadow for visibility
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1;
    
    ctx.fillText(textInput, textPos.x, textPos.y);
    ctx.shadowBlur = 0; // reset
    
    saveState();
    setTextInput('');
    setTextPos(null);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `Edited_Defect_${Date.now()}.jpg`, { type: 'image/jpeg' });
      onSave(file);
    }, 'image/jpeg', 0.82);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/90 z-[200] flex flex-col animate-in fade-in">
      <div className="flex items-center justify-between p-4 bg-slate-950 text-white">
        <h3 className="font-bold text-sm">Chỉnh sửa ảnh lỗi</h3>
        <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-full transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden relative">
        <div ref={containerRef} className="relative shadow-2xl rounded-xl overflow-hidden bg-slate-800">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="touch-none cursor-crosshair max-w-full max-h-[70vh] object-contain"
          />
          
          {activeTool === 'text' && textPos && (
            <div 
              className="absolute z-10 flex gap-2"
              style={{ left: `\${(textPos.x / (canvasRef.current?.width || 1)) * 100}%`, top: `\${(textPos.y / (canvasRef.current?.height || 1)) * 100}%` }}
            >
              <input
                autoFocus
                type="text"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTextToCanvas()}
                placeholder="Nhập chữ..."
                className="px-2 py-1 bg-white/90 text-slate-900 text-sm font-bold border-2 rounded outline-none shadow-xl"
                style={{ borderColor: color }}
              />
              <button 
                onClick={addTextToCanvas}
                className="bg-emerald-600 text-white px-2 py-1 rounded shadow text-xs font-bold whitespace-nowrap"
              >
                Xong
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div className="bg-slate-950 p-2 sm:p-3 pb-safe border-t border-slate-800">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between overflow-x-auto no-scrollbar gap-2">
            
            {/* Tools */}
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => { setActiveTool('draw'); setTextPos(null); }}
                className={`p-2 rounded-lg flex items-center justify-center ${activeTool === 'draw' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
              >
                <Pencil className="w-5 h-5" />
              </button>
              <button
                onClick={() => { setActiveTool('arrow'); setTextPos(null); }}
                className={`p-2 rounded-lg flex items-center justify-center ${activeTool === 'arrow' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
              >
                <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => { setActiveTool('rect'); setTextPos(null); }}
                className={`p-2 rounded-lg flex items-center justify-center ${activeTool === 'rect' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
              >
                <Square className="w-5 h-5" />
              </button>
              <button
                onClick={() => { setActiveTool('cloud'); setTextPos(null); }}
                className={`p-2 rounded-lg flex items-center justify-center ${activeTool === 'cloud' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
              >
                <Cloud className="w-5 h-5" />
              </button>
              <button
                onClick={() => setActiveTool('text')}
                className={`p-2 rounded-lg flex items-center justify-center ${activeTool === 'text' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
              >
                <Type className="w-5 h-5" />
              </button>
            </div>

            <div className="h-6 w-px bg-slate-700 shrink-0" />

            {/* Colors */}
            <div className="flex gap-1.5 shrink-0">
              {['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ffffff'].map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 shadow-sm \${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            <div className="h-6 w-px bg-slate-700 shrink-0" />

            {/* Undo */}
            <button
              onClick={handleUndo}
              disabled={history.length <= 1}
              className="p-2 bg-slate-800 text-slate-200 disabled:opacity-50 rounded-lg flex items-center justify-center shrink-0"
            >
              <Undo className="w-5 h-5" />
            </button>
          </div>
          
          <button
            onClick={handleSave}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg"
          >
            <Save className="w-5 h-5" />
            Lưu ảnh đã chỉnh sửa
          </button>
        </div>
      </div>
    </div>
  );
};
