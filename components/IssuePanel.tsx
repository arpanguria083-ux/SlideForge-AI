import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, CircleX, X } from 'lucide-react';
import { apiService, Annotation } from '../services/apiService';

interface IssuePanelProps {
  sessionId: string;
  annotations: Annotation[];
  onActionComplete: () => void;
  onJumpToSlide?: (slideIndex: number) => void;
  currentSlideIndex?: number;
  onClose?: () => void;
}

const severityMeta = {
  hard_block: {
    label: 'Needs attention',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    card: 'border-rose-200 bg-rose-50/40',
  },
  warning: {
    label: 'Important',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    card: 'border-amber-200 bg-amber-50/40',
  },
  suggestion: {
    label: 'Polish',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    card: 'border-sky-200 bg-sky-50/40',
  },
} as const;

const dismissReasonLabels: Record<string, string> = {
  false_positive: 'Not an issue',
  client_exception: 'Intentional client exception',
  already_fixed: 'Already fixed elsewhere',
};

const severityOrder: Record<string, number> = {
  hard_block: 0,
  warning: 1,
  suggestion: 2,
};

const formatCategory = (value: string) =>
  value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const IssuePanel: React.FC<IssuePanelProps> = ({
  sessionId,
  annotations,
  onActionComplete,
  onJumpToSlide,
  currentSlideIndex,
  onClose,
}) => {
  const [filter, setFilter] = useState<'all' | 'hard_block' | 'warning' | 'suggestion'>('all');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [dismissMenuForId, setDismissMenuForId] = useState<string | null>(null);

  const filtered = useMemo(
    () => annotations.filter((annotation) => filter === 'all' || annotation.severity === filter),
    [annotations, filter]
  );

  const orderedAnnotations = useMemo(
    () =>
      [...filtered].sort((left, right) => {
        const severityDiff = (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99);
        if (severityDiff !== 0) return severityDiff;
        return left.slide_index - right.slide_index;
      }),
    [filtered]
  );

  const counts = useMemo(() => {
    let hardBlock = 0;
    let warning = 0;
    let suggestion = 0;

    for (const item of annotations) {
      if (item.severity === 'hard_block') hardBlock += 1;
      else if (item.severity === 'warning') warning += 1;
      else if (item.severity === 'suggestion') suggestion += 1;
    }

    return { hardBlock, warning, suggestion };
  }, [annotations]);

  const currentSlideCount = useMemo(() => {
    if (typeof currentSlideIndex !== 'number') return 0;
    return annotations.filter((item) => item.slide_index === currentSlideIndex).length;
  }, [annotations, currentSlideIndex]);

  const handleAccept = async (annotation: Annotation) => {
    const annotationId = annotation.annotation_id || `${annotation.slide_index}:${annotation.message}`;
    const id = `${annotation.slide_index}-${annotationId}`;
    setProcessingId(id);
    setDismissMenuForId(null);

    try {
      await apiService.acceptFix(sessionId, annotationId);
      onActionComplete();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDismiss = async (annotation: Annotation, reason: string) => {
    const annotationId = annotation.annotation_id || `${annotation.slide_index}:${annotation.message}`;
    const id = `${annotation.slide_index}-${annotationId}`;
    setProcessingId(id);
    setDismissMenuForId(null);

    try {
      await apiService.dismissAnnotation(sessionId, annotationId, reason);
      onActionComplete();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="flex h-full w-[25rem] flex-col border-l border-slate-200 bg-white shadow-[-18px_0_40px_rgba(15,23,42,0.06)] z-20">
      <div className="border-b border-slate-200 bg-white px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <AlertCircle className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold">Action queue</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Recommended edits are ordered so the most important items stay at the top.
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
              aria-label="Close action queue"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Open items</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{annotations.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Current slide</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{currentSlideCount}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ['all', `All ${annotations.length}`],
            ['hard_block', `Needs attention ${counts.hardBlock}`],
            ['warning', `Important ${counts.warning}`],
            ['suggestion', `Polish ${counts.suggestion}`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                filter === value
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-5 py-5">
        {orderedAnnotations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="mt-4 text-base font-semibold text-slate-900">Nothing to review in this view</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {filter === 'all'
                ? 'The queue is clear. Upload another deck or reopen a past workspace when you are ready.'
                : 'Try another filter to see remaining recommendations.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {orderedAnnotations.map((annotation) => {
              const annotationId = annotation.annotation_id || `${annotation.slide_index}:${annotation.message}`;
              const id = `${annotation.slide_index}-${annotationId}`;
              const isProcessing = processingId === id;
              const meta =
                severityMeta[annotation.severity as keyof typeof severityMeta] || severityMeta.suggestion;

              return (
                <div key={id} className={`rounded-[1.5rem] border p-4 shadow-sm ${meta.card}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                        Slide {annotation.slide_index + 1}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </div>
                    {annotation.severity === 'hard_block' && <CircleX className="h-4 w-4 text-rose-500" />}
                  </div>

                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {formatCategory(annotation.category)}
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-900">{annotation.message}</p>

                  {annotation.suggestion && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Recommended edit</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{annotation.suggestion}</p>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => onJumpToSlide?.(annotation.slide_index)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Open slide
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      disabled={!!processingId}
                      onClick={() => handleAccept(annotation)}
                      className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50"
                    >
                      {isProcessing ? 'Updating...' : 'Mark resolved'}
                    </button>
                    <div className="relative">
                      <button
                        disabled={!!processingId}
                        onClick={() => setDismissMenuForId((prev) => (prev === id ? null : id))}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        Not applicable
                      </button>
                      {dismissMenuForId === id && (
                        <div className="absolute bottom-full right-0 z-30 mb-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Why remove this item?
                          </div>
                          {(['false_positive', 'client_exception', 'already_fixed'] as const).map((reason) => (
                            <button
                              key={reason}
                              onClick={() => handleDismiss(annotation, reason)}
                              className="w-full border-b border-slate-50 px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 last:border-b-0"
                            >
                              {dismissReasonLabels[reason]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default IssuePanel;
