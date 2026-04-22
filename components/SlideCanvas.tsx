import React, { useEffect, useRef, useState } from 'react';
import { SlideAnalysis, BoundingBox, ParsedSlideData } from '../types';
import { Eye, EyeOff, AlertCircle, Info, Monitor, Image as ImageIcon } from 'lucide-react';

interface EnhancedBoundingBox extends BoundingBox {
  severity?: string;
  category?: string;
  suggestion?: string;
}

interface SlideCanvasProps {
  imageUrl: string;
  slideData?: ParsedSlideData;
  analysis: SlideAnalysis | null;
  onFixClick?: (fix: EnhancedBoundingBox, index: number) => void;
  highlightedFixIndex?: number | null;
  onVisualClick?: (visualKey: string | undefined, index: number) => void;
  highlightedVisualKey?: string | null;
  isDeepAnalyzing?: boolean;
}

const severityColors: Record<string, { border: string; bg: string; bgHover: string; text: string }> = {
  hard_block: {
    border: 'border-red-500',
    bg: 'bg-red-500/15',
    bgHover: 'hover:bg-red-500/25',
    text: 'bg-red-600',
  },
  warning: {
    border: 'border-amber-500',
    bg: 'bg-amber-500/12',
    bgHover: 'hover:bg-amber-500/22',
    text: 'bg-amber-600',
  },
  suggestion: {
    border: 'border-blue-400 border-dashed',
    bg: 'bg-blue-400/8',
    bgHover: 'hover:bg-blue-400/18',
    text: 'bg-blue-600',
  },
};

const SlideCanvas: React.FC<SlideCanvasProps> = ({
  imageUrl,
  slideData,
  analysis,
  onFixClick,
  highlightedFixIndex,
  onVisualClick,
  highlightedVisualKey,
  isDeepAnalyzing,
}) => {
  const [showVisuals, setShowVisuals] = useState(true);
  const [showFixes, setShowFixes] = useState(true);
  const [hoveredFix, setHoveredFix] = useState<number | null>(null);
  const [hoveredVisual, setHoveredVisual] = useState<number | null>(null);
  const [renderMode, setRenderMode] = useState<'browser' | 'image'>('image');
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const [imageBox, setImageBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const fixes = (analysis?.fixes || []) as EnhancedBoundingBox[];
  const visuals = analysis?.visuals || [];
  const browserRenderable = Boolean(
    slideData &&
    slideData.width > 0 &&
    slideData.height > 0 &&
    (
      (slideData.text_boxes?.length || 0) > 0 ||
      (slideData.images?.length || 0) > 0 ||
      (slideData.tables?.length || 0) > 0 ||
      (slideData.charts?.length || 0) > 0
    )
  );

  useEffect(() => {
    if (browserRenderable) {
      setRenderMode('browser');
    } else {
      setRenderMode('image');
    }
  }, [browserRenderable, slideData?.id]);

  const getVisualBadge = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes('table')) return 'Table';
    if (normalized.includes('chart')) return 'Chart';
    if (normalized.includes('image') || normalized.includes('figure')) return 'Image';
    return 'Visual';
  };

  const toPercent = (value: number, total: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
    return (value / total) * 100;
  };

  const getTextBoxFontSize = (fontSize: number | undefined) => {
    if (!fontSize || !Number.isFinite(fontSize)) return 12;
    return Math.max(10, Math.min(28, Math.round(fontSize * 1.15)));
  };

  const canRenderAsset = (assetUrl?: string | null, contentType?: string | null, extension?: string | null) => {
    if (!assetUrl) return false;
    const loweredExt = (extension || '').toLowerCase();
    const loweredType = (contentType || '').toLowerCase();
    return (
      loweredType.startsWith('image/') &&
      !loweredType.includes('emf') &&
      !loweredType.includes('wmf')
    ) || ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(loweredExt);
  };

  useEffect(() => {
    const updateImageBox = () => {
      const container = imageContainerRef.current;
      const image = imageElementRef.current;
      if (!container || !image) {
        setImageBox(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      if (imageRect.width <= 0 || imageRect.height <= 0) {
        setImageBox(null);
        return;
      }

      setImageBox({
        left: imageRect.left - containerRect.left,
        top: imageRect.top - containerRect.top,
        width: imageRect.width,
        height: imageRect.height,
      });
    };

    updateImageBox();
    window.addEventListener('resize', updateImageBox);
    return () => window.removeEventListener('resize', updateImageBox);
  }, [imageUrl, renderMode, browserRenderable]);

  const overlayStyleForImageMode = (box: BoundingBox) => {
    if (!imageBox || imageBox.width <= 0 || imageBox.height <= 0) {
      return {
        top: `${box.top}%`,
        left: `${box.left}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      };
    }

    const topPx = imageBox.top + (box.top / 100) * imageBox.height;
    const leftPx = imageBox.left + (box.left / 100) * imageBox.width;
    const widthPx = (box.width / 100) * imageBox.width;
    const heightPx = (box.height / 100) * imageBox.height;

    return {
      top: `${topPx}px`,
      left: `${leftPx}px`,
      width: `${widthPx}px`,
      height: `${heightPx}px`,
    };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        {browserRenderable && (
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setRenderMode('browser')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                renderMode === 'browser'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Browser Render
            </button>
            <button
              onClick={() => setRenderMode('image')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                renderMode === 'image'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              PNG Preview
            </button>
          </div>
        )}
        <button 
          onClick={() => setShowVisuals(!showVisuals)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            showVisuals 
              ? 'bg-indigo-100 text-indigo-700 shadow-sm ring-1 ring-indigo-200' 
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {showVisuals ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          Detected Elements ({visuals.length})
        </button>
        <button 
          onClick={() => setShowFixes(!showFixes)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            showFixes 
              ? 'bg-red-100 text-red-700 shadow-sm ring-1 ring-red-200' 
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {showFixes ? <AlertCircle className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          Issues ({fixes.length})
        </button>
        
        {/* Legend */}
        <div className="ml-auto flex items-center gap-2 text-[10px] font-medium text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500/40 border border-red-500" />Block
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500" />Warn
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-400/40 border border-dashed border-blue-400" />Tip
          </span>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="relative flex-1 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 shadow-inner flex items-center justify-center">
        {browserRenderable && renderMode === 'browser' && slideData && (
          <div
            className="relative w-full max-w-4xl shadow-lg rounded-lg overflow-hidden bg-white"
            style={{ aspectRatio: `${slideData.width} / ${slideData.height}` }}
          >
            <div className="absolute inset-0 bg-white">
              {slideData.text_boxes.map((box) => {
                const firstRun = box.runs?.[0];
                return (
                  <div
                    key={box.id}
                    className="absolute overflow-hidden"
                    style={{
                      top: `${toPercent(box.y, slideData.height)}%`,
                      left: `${toPercent(box.x, slideData.width)}%`,
                      width: `${toPercent(box.width, slideData.width)}%`,
                      height: `${toPercent(box.height, slideData.height)}%`,
                      fontSize: `${getTextBoxFontSize(firstRun?.font_size)}px`,
                      fontWeight: firstRun?.font_bold ? 700 : 400,
                      color: '#334155',
                      lineHeight: 1.2,
                      whiteSpace: 'pre-wrap',
                      padding: '2px 4px',
                    }}
                    title={box.text}
                  >
                    {box.text}
                  </div>
                );
              })}

              {slideData.images.map((image) => {
                const assetRenderable = canRenderAsset(image.asset_url, image.content_type, image.extension);
                return (
                  <div
                    key={image.id}
                    className="absolute overflow-hidden rounded-sm border border-slate-200 bg-slate-50"
                    style={{
                      top: `${toPercent(image.y, slideData.height)}%`,
                      left: `${toPercent(image.x, slideData.width)}%`,
                      width: `${toPercent(image.width, slideData.width)}%`,
                      height: `${toPercent(image.height, slideData.height)}%`,
                    }}
                    title={image.id}
                  >
                    {assetRenderable ? (
                      <img
                        src={image.asset_url || ''}
                        alt={image.id}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] font-semibold text-slate-500 bg-slate-100">
                        Image
                      </div>
                    )}
                  </div>
                );
              })}

              {slideData.tables.map((table) => (
                <div
                  key={table.id}
                  className="absolute rounded-sm border border-emerald-200 bg-emerald-50/60 p-1 text-[10px] text-emerald-900 overflow-hidden"
                  style={{
                    top: `${toPercent(table.y, slideData.height)}%`,
                    left: `${toPercent(table.x, slideData.width)}%`,
                    width: `${toPercent(table.width, slideData.width)}%`,
                    height: `${toPercent(table.height, slideData.height)}%`,
                  }}
                >
                  <div className="font-bold uppercase tracking-wide mb-1">Table</div>
                  <div className="line-clamp-4">{table.text || table.title || 'Table content'}</div>
                </div>
              ))}

              {slideData.charts.map((chart) => (
                <div
                  key={chart.id}
                  className="absolute rounded-sm border border-violet-200 bg-violet-50/60 p-1 text-[10px] text-violet-900 overflow-hidden"
                  style={{
                    top: `${toPercent(chart.y, slideData.height)}%`,
                    left: `${toPercent(chart.x, slideData.width)}%`,
                    width: `${toPercent(chart.width, slideData.width)}%`,
                    height: `${toPercent(chart.height, slideData.height)}%`,
                  }}
                >
                  <div className="font-bold uppercase tracking-wide mb-1">Chart</div>
                  <div className="line-clamp-3">{chart.title || chart.type || 'Chart object'}</div>
                </div>
              ))}
            </div>

            {analysis && (
              <div className="absolute inset-0 pointer-events-none">
                {showVisuals && visuals.map((box, idx) => (
                  <div
                    key={`vis-${idx}`}
                    style={{
                      top: `${box.top}%`,
                      left: `${box.left}%`,
                      width: `${box.width}%`,
                      height: `${box.height}%`,
                    }}
                    className={`absolute border-2 border-indigo-400/50 bg-indigo-400/5 transition-all duration-200 pointer-events-auto cursor-pointer ${
                      hoveredVisual === idx || highlightedVisualKey === box.visualKey ? 'bg-indigo-400/20 border-indigo-500 z-20 ring-2 ring-indigo-300' : ''
                    }`}
                    onMouseEnter={() => setHoveredVisual(idx)}
                    onMouseLeave={() => setHoveredVisual(null)}
                    onClick={() => onVisualClick?.(box.visualKey, idx)}
                  >
                    <div className="absolute top-1 left-1 bg-indigo-700/90 text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide shadow-sm">
                      {getVisualBadge(box.label)}
                    </div>
                    {(hoveredVisual === idx || highlightedVisualKey === box.visualKey) && (
                      <div className="absolute -top-7 left-0 bg-indigo-700 text-white text-[10px] px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap z-30 font-medium backdrop-blur-sm">
                        <Info className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />
                        {box.label}
                      </div>
                    )}
                  </div>
                ))}

                {showFixes && fixes.map((box, idx) => {
                  const severity = box.severity || 'warning';
                  const colors = severityColors[severity] || severityColors.warning;
                  const isHighlighted = highlightedFixIndex === idx;
                  const isHovered = hoveredFix === idx;

                  return (
                    <div
                      key={`fix-${idx}`}
                      style={{
                        top: `${box.top}%`,
                        left: `${box.left}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                      }}
                      className={`absolute border-2 ${colors.border} ${colors.bg} ${colors.bgHover} transition-all duration-200 pointer-events-auto cursor-pointer ${
                        severity === 'hard_block' ? 'animate-pulse' : ''
                      } ${isHighlighted ? 'ring-2 ring-offset-1 ring-red-400 z-30' : ''} ${
                        isHovered ? 'z-20' : ''
                      }`}
                      onMouseEnter={() => setHoveredFix(idx)}
                      onMouseLeave={() => setHoveredFix(null)}
                      onClick={() => onFixClick?.(box, idx)}
                    >
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${colors.text} flex items-center justify-center z-10`}>
                        <AlertCircle className="w-2.5 h-2.5 text-white" />
                      </div>
                      {isHovered && (
                        <div className="absolute -bottom-2 left-0 transform translate-y-full bg-slate-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-2xl z-40 max-w-[320px] whitespace-normal pointer-events-none">
                          <div className="font-semibold mb-1 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${colors.text}`} />
                            {severity === 'hard_block' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Suggestion'}
                          </div>
                          <p className="text-slate-200 leading-snug">{box.label}</p>
                          {box.suggestion && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-700">
                              <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wide">Fix: </span>
                              <span className="text-slate-300">{box.suggestion}</span>
                            </div>
                          )}
                          <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-900 rotate-45" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isDeepAnalyzing && (
              <div className="absolute inset-0 bg-white/65 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-40">
                <div className="px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold shadow-xl">
                  Deep analyzing this slide...
                </div>
              </div>
            )}
          </div>
        )}

        {imageUrl && (!browserRenderable || renderMode === 'image') && (
          <div ref={imageContainerRef} className="relative w-full h-full max-w-4xl max-h-[600px] shadow-lg">
            <img 
              ref={imageElementRef}
              src={imageUrl} 
              alt="Slide Preview" 
              onLoad={() => {
                const container = imageContainerRef.current;
                const image = imageElementRef.current;
                if (!container || !image) return;
                const containerRect = container.getBoundingClientRect();
                const imageRect = image.getBoundingClientRect();
                setImageBox({
                  left: imageRect.left - containerRect.left,
                  top: imageRect.top - containerRect.top,
                  width: imageRect.width,
                  height: imageRect.height,
                });
              }}
              className="w-full h-full object-contain bg-white rounded-lg" 
            />
            
            {/* Visual Element Overlays */}
            {analysis && (
              <div className="absolute inset-0 pointer-events-none">
                {showVisuals && visuals.map((box, idx) => (
                  <div
                    key={`vis-${idx}`}
                    style={{
                      ...overlayStyleForImageMode(box),
                    }}
                    className={`absolute border-2 border-indigo-400/50 bg-indigo-400/5 transition-all duration-200 pointer-events-auto cursor-pointer ${
                      hoveredVisual === idx || highlightedVisualKey === box.visualKey ? 'bg-indigo-400/20 border-indigo-500 z-20 ring-2 ring-indigo-300' : ''
                    }`}
                    onMouseEnter={() => setHoveredVisual(idx)}
                    onMouseLeave={() => setHoveredVisual(null)}
                    onClick={() => onVisualClick?.(box.visualKey, idx)}
                  >
                    <div className="absolute top-1 left-1 bg-indigo-700/90 text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide shadow-sm">
                      {getVisualBadge(box.label)}
                    </div>
                    {(hoveredVisual === idx || highlightedVisualKey === box.visualKey) && (
                      <div className="absolute -top-7 left-0 bg-indigo-700 text-white text-[10px] px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap z-30 font-medium backdrop-blur-sm">
                        <Info className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />
                        {box.label}
                      </div>
                    )}
                  </div>
                ))}

                {/* Fix/Issue Overlays with severity-based styling */}
                {showFixes && fixes.map((box, idx) => {
                  const severity = box.severity || 'warning';
                  const colors = severityColors[severity] || severityColors.warning;
                  const isHighlighted = highlightedFixIndex === idx;
                  const isHovered = hoveredFix === idx;
                  
                  return (
                    <div
                      key={`fix-${idx}`}
                      style={{
                        ...overlayStyleForImageMode(box),
                      }}
                      className={`absolute border-2 ${colors.border} ${colors.bg} ${colors.bgHover} transition-all duration-200 pointer-events-auto cursor-pointer ${
                        severity === 'hard_block' ? 'animate-pulse' : ''
                      } ${isHighlighted ? 'ring-2 ring-offset-1 ring-red-400 z-30' : ''} ${
                        isHovered ? 'z-20' : ''
                      }`}
                      onMouseEnter={() => setHoveredFix(idx)}
                      onMouseLeave={() => setHoveredFix(null)}
                      onClick={() => onFixClick?.(box, idx)}
                    >
                      {/* Severity badge */}
                      <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${colors.text} flex items-center justify-center z-10`}>
                        <AlertCircle className="w-2.5 h-2.5 text-white" />
                      </div>
                      
                      {/* Hover tooltip with message + suggestion */}
                      {isHovered && (
                        <div className="absolute -bottom-2 left-0 transform translate-y-full bg-slate-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-2xl z-40 max-w-[320px] whitespace-normal pointer-events-none">
                          <div className="font-semibold mb-1 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${colors.text}`} />
                            {severity === 'hard_block' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Suggestion'}
                          </div>
                          <p className="text-slate-200 leading-snug">{box.label}</p>
                          {box.suggestion && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-700">
                              <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wide">Fix: </span>
                              <span className="text-slate-300">{box.suggestion}</span>
                            </div>
                          )}
                          {/* Pointer arrow */}
                          <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-900 rotate-45" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {isDeepAnalyzing && (
              <div className="absolute inset-0 bg-white/65 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-40">
                <div className="px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold shadow-xl">
                  Deep analyzing this slide...
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Empty state */}
        {!imageUrl && !browserRenderable && (
          <div className="text-center text-slate-400 py-20">
            <div className="w-16 h-16 rounded-2xl bg-slate-200 flex items-center justify-center mx-auto mb-4">
              <Eye className="w-8 h-8 text-slate-300" />
            </div>
            <p className="font-medium">No slide preview available</p>
            <p className="text-xs mt-1">Upload and parse a document to see the preview</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SlideCanvas;
