import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GuardrailCoverageItem, SlideModel } from '../types';
import CouncilPanel from './CouncilPanel';
import SlideCanvas from './SlideCanvas';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { 
  ChevronRight, Layout, AlertTriangle, CheckCircle2, FileText, 
  Download, Loader2, AlertCircle, FileCheck, ShieldCheck, Settings2, Bot, Scale
} from 'lucide-react';
import IssuePanel from './IssuePanel';
import GuardrailView from './GuardrailView';
import AuditLog from './AuditLog';
import TemplateDiscovery from './TemplateDiscovery';
import EvidencePanel from './EvidencePanel';
import { apiService, Annotation } from '../services/apiService';
import { useAnalysisSettings, useGrammarStatus, useSessionMetrics } from '../services/queries/settings';

interface DashboardProps {
  sessionId: string;
  slides: SlideModel[];
  progress: { current: number; total: number; label: string } | null;
  annotations: Annotation[];
  onRefreshAnalysis: () => Promise<void>;
  onUpdateSlideAnalysis: (slideIndex: number, analysis: SlideModel['analysis']) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ sessionId, slides, progress, annotations, onRefreshAnalysis, onUpdateSlideAnalysis }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isIssuePanelOpen, setIsIssuePanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'evaluation' | 'evidence' | 'guardrails' | 'auditlog' | 'discovery'>('evaluation');
  const [isPreparing, setIsPreparing] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [deliveryChecklist, setDeliveryChecklist] = useState({
    commentsScrubbed: false,
    metadataIncluded: false,
    auditLogIncluded: false,
    signOffPresent: false
  });
  const [signOffName, setSignOffName] = useState('');
  const [isSigningOff, setIsSigningOff] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliverySuccess, setDeliverySuccess] = useState<string | null>(null);
  const [analysisMaxTokens, setAnalysisMaxTokens] = useState(800);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false);
  const [selectedVisualKey, setSelectedVisualKey] = useState<string | null>(null);
  const visualInsightRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [isDeepAnalyzingSlide, setIsDeepAnalyzingSlide] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [isRunningRevisionLoop, setIsRunningRevisionLoop] = useState(false);
  const [revisionMessage, setRevisionMessage] = useState<string | null>(null);

  const isSenior = localStorage.getItem('slideforge_role') === 'senior';
  const metricsQuery = useSessionMetrics(false, isSenior && Boolean(sessionId));
  const analysisSettingsQuery = useAnalysisSettings();
  const grammarStatusQuery = useGrammarStatus();
  const sessionMetrics = metricsQuery.data ?? null;
  const metricsError = metricsQuery.error instanceof Error ? metricsQuery.error.message : null;
  const grammarStatus = grammarStatusQuery.data ?? null;

  const refreshCurrentSlideAnalysis = async () => {
    const refreshed = await apiService.getSlideAnalysis(sessionId, currentIndex);
    onUpdateSlideAnalysis(currentIndex, refreshed);
  };

  const currentSlide = slides[currentIndex];
  const analysis = currentSlide?.analysis;
  const frameworkAnalysis = analysis?.frameworkAnalysis;
  const soWhatResult = analysis?.soWhatResult;
  const benchmarkAnalysis = analysis?.benchmarkAnalysis;
  const slideContext = analysis?.slideContext;

  const scoreData = analysis ? [
    { name: 'Score', value: analysis.overallScore },
    { name: 'Gap', value: 100 - analysis.overallScore },
  ] : [];
  const COLORS = ['#4f46e5', '#e2e8f0'];
  const scoreBreakdown = analysis?.scoreBreakdown ? [
    { label: 'Message', value: analysis.scoreBreakdown.message_clarity },
    { label: 'Evidence', value: analysis.scoreBreakdown.evidence_strength },
    { label: 'Layout', value: analysis.scoreBreakdown.layout_quality },
    { label: 'Visuals', value: analysis.scoreBreakdown.visual_usefulness },
    { label: 'Guardrail', value: analysis.scoreBreakdown.guardrail_fit },
  ] : [];
  const visualCoveragePercent = analysis?.visualCoverage ? Math.round((analysis.visualCoverage.coverage_ratio || 0) * 100) : null;
  const reliabilityTone = analysis?.reliability?.status === 'strong'
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : analysis?.reliability?.status === 'moderate'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-rose-100 text-rose-700 border-rose-200';
  const tableInsights = (analysis?.imageAnalysis || []).filter((item) =>
    item.type === 'table_vision' || (item.type === 'surya_block' && (item.label || '').toLowerCase().includes('table'))
  );
  const chartInsights = (analysis?.imageAnalysis || []).filter((item) => item.type === 'chart');
  const imageInsights = (analysis?.imageAnalysis || []).filter((item) => item.type === 'image' || item.type === 'surya_block');
  const grammarFindings = (analysis?.deepAnalysis?.judge?.findings || []).filter((finding) => finding.category === 'grammar');
  const languageFindings = (analysis?.deepAnalysis?.judge?.findings || []).filter((finding) => finding.category !== 'grammar');
  const issueCounts = useMemo(
    () =>
      annotations.reduce(
        (acc, item) => {
          if (item.severity === 'hard_block') acc.hardBlock += 1;
          else if (item.severity === 'warning') acc.warning += 1;
          else if (item.severity === 'suggestion') acc.suggestion += 1;
          return acc;
        },
        { hardBlock: 0, warning: 0, suggestion: 0 }
      ),
    [annotations]
  );
  const activeIssueCount = issueCounts.hardBlock + issueCounts.warning;
  const currentSlideIssues = useMemo(
    () => annotations.filter((item) => item.slide_index === currentIndex),
    [annotations, currentIndex]
  );
  const currentSlideTopIssue =
    currentSlideIssues.find((item) => item.severity === 'hard_block') ||
    currentSlideIssues.find((item) => item.severity === 'warning') ||
    currentSlideIssues[0];
  const analysisBackends = analysis?.analysisBackends;
  const suryaLabel = analysisBackends?.surya ? 'Surya layout' : 'PPTX layout';
  const visionLabel =
    analysisBackends?.vision === 'lm_studio'
      ? 'Vision model'
      : analysisBackends?.vision === 'fallback'
        ? 'Vision fallback'
        : 'Vision unknown';
  const ocrLabel =
    analysisBackends?.ocr === 'surya'
      ? 'Surya OCR'
      : analysisBackends?.ocr === 'native'
        ? 'Native text'
        : 'OCR unknown';
  const guardrailCoverage = useMemo<GuardrailCoverageItem[]>(() => {
    if (!analysis) return [];

    if (Array.isArray(analysis.guardrailCoverage) && analysis.guardrailCoverage.length > 0) {
      return analysis.guardrailCoverage;
    }

    const generated: GuardrailCoverageItem[] = [];

    const alignmentStatus = analysis.deepAnalysis?.review?.guardrail_alignment?.status;
    if (alignmentStatus) {
      generated.push({
        id: 'alignment-summary',
        rule: 'Guardrail alignment summary',
        source: 'system',
        status: alignmentStatus === 'misaligned' ? 'failed' : 'checked',
        detail:
          analysis.deepAnalysis?.review?.guardrail_alignment?.notes ||
          'Alignment summary generated from deep review.',
      });
    }

    currentSlideIssues.forEach((issue, index) => {
      generated.push({
        id: `issue-${index}`,
        rule: `${issue.category.replace(/_/g, ' ')} rule`,
        source: 'system',
        status: issue.severity === 'suggestion' ? 'checked' : 'failed',
        detail: issue.message,
      });
    });

    if (generated.length === 0) {
      generated.push({
        id: 'fallback-checked',
        rule: 'Basic guardrail checks',
        source: 'system',
        status: 'checked',
        detail: 'No explicit guardrail violations were detected on this slide.',
      });
      generated.push({
        id: 'fallback-skipped',
        rule: 'Source-grounding and lineage checks',
        source: 'system',
        status: 'skipped',
        detail: 'Upload evidence and Excel sources to run full grounding and lineage checks.',
      });
    }

    return generated;
  }, [analysis, currentSlideIssues]);
  const guardrailCoverageCounts = useMemo(
    () =>
      guardrailCoverage.reduce(
        (acc, item) => {
          if (item.status === 'checked') acc.checked += 1;
          else if (item.status === 'failed') acc.failed += 1;
          else acc.skipped += 1;
          return acc;
        },
        { checked: 0, failed: 0, skipped: 0 }
      ),
    [guardrailCoverage]
  );

  const isAnalyzingCurrent = currentSlide?.status === 'analyzing';
  const isIdleCurrent = currentSlide?.status === 'idle';
  const soWhatScore = soWhatResult?.score ?? null;
  const soWhatNavigatorTone = soWhatScore === null
    ? 'bg-slate-300'
    : soWhatScore >= 80
      ? 'bg-emerald-500'
      : soWhatScore >= 40
        ? 'bg-amber-500'
        : 'bg-rose-500';
  const slideHeadline = analysis?.title || `Slide ${currentIndex + 1}`;
  const slideSubheadline = analysis?.consultantSummary || analysis?.summary || 'Review guidance will appear here when analysis is ready.';

  const formatSeconds = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  useEffect(() => {
    if (analysisSettingsQuery.data?.analysis_max_tokens) {
      setAnalysisMaxTokens(analysisSettingsQuery.data.analysis_max_tokens);
    }
  }, [analysisSettingsQuery.data?.analysis_max_tokens]);

  useEffect(() => {
    if (analysisSettingsQuery.error instanceof Error) {
      setSettingsError(analysisSettingsQuery.error.message);
    } else if (grammarStatusQuery.error instanceof Error) {
      setSettingsError(grammarStatusQuery.error.message);
    }
  }, [analysisSettingsQuery.error, grammarStatusQuery.error]);

  useEffect(() => {
    setSelectedVisualKey(null);
  }, [currentIndex]);

  useEffect(() => {
    if (!selectedVisualKey) return;
    const target = visualInsightRefs.current[selectedVisualKey];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedVisualKey]);

  const handlePrepareDelivery = async () => {
    setIsPreparing(true);
    setDeliveryError(null);
    setDeliverySuccess(null);
    try {
      const result = await apiService.prepareDelivery(sessionId);
      setDeliverySuccess('Package prepared for delivery.');
      if (result.download_url) {
        await apiService.downloadPackage(sessionId);
      }
    } catch (err) {
      console.error(err);
      setDeliveryError(err instanceof Error ? err.message : 'Failed to prepare delivery package.');
    } finally {
      setIsPreparing(false);
    }
  };

  const handleSignOff = async () => {
    if (!signOffName.trim()) return;
    setIsSigningOff(true);
    setDeliveryError(null);
    setDeliverySuccess(null);
    try {
      await apiService.signOffSession(sessionId, signOffName.trim());
      setDeliveryChecklist((prev) => ({ ...prev, signOffPresent: true }));
      setDeliverySuccess('Senior sign-off recorded.');
    } catch (err) {
      console.error(err);
      setDeliveryError(err instanceof Error ? err.message : 'Failed to record sign-off.');
    } finally {
      setIsSigningOff(false);
    }
  };

  const openDeliveryModal = async () => {
    setIsDeliveryModalOpen(true);
    setDeliveryError(null);
    setDeliverySuccess(null);
    try {
      const status = await apiService.getDeliveryStatus(sessionId);
      setDeliveryChecklist((prev) => ({ ...prev, signOffPresent: !!status.senior_signed }));
      if (status.senior_name) setSignOffName(status.senior_name);
    } catch (err) {
      console.error(err);
      setDeliveryError(err instanceof Error ? err.message : 'Failed to load delivery status.');
    }
  };

  const handleDownloadAnnotated = async () => {
    setIsDownloading(true);
    try {
      await apiService.downloadAnnotated(sessionId);
    } catch (err) {
      console.error(err);
      alert('Failed to download annotated deck.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveAnalysisSettings = async () => {
    setIsSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const result = await apiService.updateAnalysisSettings(analysisMaxTokens);
      setAnalysisMaxTokens(result.analysis_max_tokens);
      setSettingsMessage(`Analysis token window set to ${result.analysis_max_tokens}. Re-run analysis to apply it.`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save analysis settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeepAnalyzeCurrentSlide = async () => {
    if (!currentSlide || !analysis) return;
    setIsDeepAnalyzingSlide(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      await apiService.rerunSlideDeepAnalysis(sessionId, currentIndex);
      const refreshed = await apiService.getSlideAnalysis(sessionId, currentIndex);
      onUpdateSlideAnalysis(
        currentIndex,
        refreshed ? { ...refreshed, lastDeepAnalyzedAt: new Date().toISOString() } : refreshed
      );
      setShowDeepAnalysis(true);
      setSettingsMessage(`Deep analysis refreshed for slide ${currentIndex + 1} using max tokens ${analysisMaxTokens}.`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to deep analyze this slide');
    } finally {
      setIsDeepAnalyzingSlide(false);
    }
  };

  const handleRunRevisionLoop = async () => {
    setIsRunningRevisionLoop(true);
    setSettingsError(null);
    setSettingsMessage(null);
    setRevisionMessage(null);
    try {
      const result = await apiService.runRevisionLoop(sessionId);
      await onRefreshAnalysis();
      const refreshed = await apiService.getSlideAnalysis(sessionId, currentIndex);
      onUpdateSlideAnalysis(currentIndex, refreshed);
      setRevisionMessage(
        `Revision loop ran ${result.revision_count} pass(es). Score trend: ${result.score_history.join(' -> ')}. Final score: ${result.final_score}.`
      );
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to run revision loop');
    } finally {
      setIsRunningRevisionLoop(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white/90 px-6 py-4 shadow-sm backdrop-blur z-20">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold tracking-[0.2em] text-white shadow-lg shadow-slate-200">SF</div>
              <div>
                <div className="sf-eyebrow">Consulting review workspace</div>
                <h1 className="mt-1 text-lg font-semibold text-slate-950">{slideHeadline}</h1>
              </div>
            </div>

            <div className="hidden h-10 w-px bg-slate-200 xl:block"></div>

            <div className="max-w-xl">
              <div className="text-sm font-medium text-slate-800">{slideSubheadline}</div>
              <div className="mt-1 text-sm text-slate-500">
                {activeIssueCount > 0
                  ? `${activeIssueCount} priority item${activeIssueCount === 1 ? '' : 's'} still need attention.`
                  : 'No priority issues are open right now.'}
              </div>
            </div>

            <nav className="flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
              <button 
                onClick={() => setActiveTab('evaluation')}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'evaluation' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Review
              </button>
              <button 
                onClick={() => setActiveTab('guardrails')}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'guardrails' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Standards
              </button>
              <button
                onClick={() => setActiveTab('evidence')}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'evidence' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Evidence
              </button>
              <button 
                onClick={() => setActiveTab('auditlog')}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'auditlog' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Audit
              </button>
              <button 
                onClick={() => setActiveTab('discovery')}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'discovery' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Templates
              </button>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-3">
              <button 
                onClick={() => setIsIssuePanelOpen(!isIssuePanelOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-bold rounded-xl transition-all ${
                  isIssuePanelOpen 
                   ? 'bg-indigo-600 text-white shadow-lg' 
                   : 'text-slate-600 hover:bg-slate-100 bg-slate-50'
                }`}
              >
                 <AlertCircle className="w-4 h-4" /> 
                  Action Queue {annotations.length > 0 && `(${annotations.length})`}
               </button>
              <button 
                 onClick={handleDownloadAnnotated}
                 disabled={isDownloading}
                 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors disabled:opacity-50"
              >
                 {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                 Download Marked Deck
              </button>
              <button
                 onClick={handleRunRevisionLoop}
                 disabled={isRunningRevisionLoop}
                 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors disabled:opacity-50"
              >
                 {isRunningRevisionLoop ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                 Auto Polish
              </button>
               {isSenior && (
                 <button
                   onClick={openDeliveryModal}
                   className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-slate-900 hover:bg-black rounded-xl shadow-lg transition-all active:scale-95"
                 >
                   <ShieldCheck className="w-4 h-4" /> Finalize Client Package
                 </button>
               )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col z-10">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Slides</h3>
            {progress ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-indigo-600 font-medium animate-pulse">Preparing review...</span>
                        <span className="text-slate-500 font-mono text-xs">{progress.current}/{progress.total}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">{progress.label}</div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div 
                            className="bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        ></div>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>{slides.length} slides ready</span>
                    <span className="text-green-600 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Ready
                    </span>
                </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                onClick={() => setCurrentIndex(idx)}
                className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all text-left group relative
                  ${currentIndex === idx ? 'bg-indigo-50 border border-indigo-200 shadow-sm' : 'hover:bg-slate-50 border border-transparent'}
                  ${slide.status === 'idle' ? 'opacity-60' : 'opacity-100'}
                `}
              >
                <div className="relative w-12 h-8 bg-slate-200 rounded overflow-hidden flex-shrink-0">
                    <img src={slide.previewUrl} className="w-full h-full object-cover opacity-80" alt={`Slide ${idx + 1}`} />
                    
                    {slide.status === 'analyzing' && (
                        <div className="absolute inset-0 bg-indigo-900/40 flex items-center justify-center">
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                        </div>
                    )}
                    
                    {slide.status === 'complete' && slide.analysis?.overallScore && slide.analysis.overallScore < 70 && (
                        <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></div>
                    )}
                    {slide.status === 'complete' && typeof slide.analysis?.soWhatResult?.score === 'number' && (
                        <div
                            className={`absolute bottom-0 left-0 w-3 h-3 rounded-full border-2 border-white ${
                              (slide.analysis?.soWhatResult?.score ?? 0) >= 80
                                ? 'bg-emerald-500'
                                : (slide.analysis?.soWhatResult?.score ?? 0) >= 40
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                            }`}
                            title={`So What score: ${slide.analysis?.soWhatResult?.score}`}
                        ></div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className={`text-xs font-semibold truncate ${currentIndex === idx ? 'text-indigo-700' : 'text-slate-700'}`}>
                        Slide {idx + 1}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                        {slide.status === 'analyzing' ? (
                            <span className="text-indigo-500 italic">Preparing...</span>
                        ) : slide.status === 'idle' ? (
                            <span className="text-slate-400">Waiting</span>
                        ) : (
                            slide.analysis?.title || "Untitled Slide"
                        )}
                    </div>
                </div>
                {currentIndex === idx && <ChevronRight className="w-4 h-4 text-indigo-400" />}
              </button>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
            {activeTab === 'evaluation' ? (
                <>
                    {(isAnalyzingCurrent || isIdleCurrent || !analysis) ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                            {isAnalyzingCurrent ? (
                                <>
                                    <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
                                     <p className="text-lg font-medium text-slate-600">Preparing this slide</p>
                                     <p className="text-sm">Recommendations appear automatically when the review finishes.</p>
                                 </>
                             ) : (
                                 <>
                                     <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center">
                                         <Layout className="w-8 h-8 text-slate-400" />
                                     </div>
                                     <p className="text-base font-medium text-slate-600">Select a slide to open the review summary.</p>
                                     <p className="text-sm text-slate-400">The dashboard keeps guidance, evidence, and slide detail together.</p>
                                 </>
                             )}
                         </div>
                    ) : (
                        <div className="grid grid-cols-12 gap-6 h-full content-start pb-10">
                            {/* Top Row: Metrics & Info */}
                            <div className="col-span-12 grid grid-cols-12 gap-6 h-36">
                                {/* Score Card */}
                                <div className="col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between relative overflow-hidden group hover:shadow-md transition-shadow">
                                    <div className="z-10">
                                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Slide score</div>
                                        <div className="text-5xl font-black text-slate-800 tracking-tight">{analysis.overallScore}</div>
                                        <div className="flex items-center gap-1 mt-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                                            <span className="text-[10px] text-slate-500 font-medium">Overall readiness indicator</span>
                                        </div>
                                        {analysis.reliability && (
                                            <div className={`inline-flex items-center mt-3 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide ${reliabilityTone}`}>
                                                Reliability {analysis.reliability.score}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-20 h-20 relative z-10">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={scoreData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={28}
                                                    outerRadius={38}
                                                    startAngle={90}
                                                    endAngle={-270}
                                                    dataKey="value"
                                                    stroke="none"
                                                >
                                                    {scoreData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                    ))}
                                                </Pie>
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <span className="text-[10px] font-bold text-slate-400">KPI</span>
                                        </div>
                                    </div>
                                    <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-indigo-50 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                                </div>

                                {/* Summary Card */}
                                <div className="col-span-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center">
                                            <FileText className="w-3.5 h-3.5 text-indigo-600" />
                                            </div>
                                            <span className="text-xs font-bold text-slate-700 uppercase tracking-tight">Slide summary</span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 line-clamp-3 leading-relaxed font-medium">
                                        {analysis.consultantSummary || analysis.summary}
                                    </p>
                                </div>

                                {/* Alerts Card */}
                                <div className="col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                                        <span>Focus next</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] ${issueCounts.hardBlock > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                            {issueCounts.hardBlock > 0 ? 'PRIORITY OPEN' : 'CLEAR'}
                                        </span>
                                    </div>
                                    <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1">
                                        {currentSlideTopIssue ? (
                                            <>
                                                <div className={`flex items-start gap-2 text-[11px] p-2 rounded-lg border ${
                                                    currentSlideTopIssue.severity === 'hard_block'
                                                        ? 'text-rose-700 bg-rose-50 border-rose-200'
                                                        : currentSlideTopIssue.severity === 'warning'
                                                            ? 'text-amber-700 bg-amber-50 border-amber-200'
                                                            : 'text-indigo-700 bg-indigo-50 border-indigo-200'
                                                }`}>
                                                    <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                                    <span className="font-medium">{currentSlideTopIssue.message}</span>
                                                </div>
                                                <button
                                                    onClick={() => setIsIssuePanelOpen(true)}
                                                    className="w-full text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-2 transition-colors"
                                                >
                                                    Open action queue
                                                </button>
                                            </>
                                        ) : (
                                            <div className="flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50/50 p-2 rounded-lg border border-emerald-100/50">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                                <span className="font-semibold">No open actions on this slide</span>
                                            </div>
                                         )}
                                         {analysis.density === 'High' && (
                                             <div className="flex items-start gap-2 text-[11px] text-rose-700 bg-rose-50/50 p-2 rounded-lg border border-rose-100/50">
                                                 <Layout className="w-3 h-3 flex-shrink-0 mt-0.5 text-rose-600" />
                                                 <span className="font-medium">High text density may reduce readability</span>
                                             </div>
                                         )}
                                    </div>
                                </div>
                            </div>

                            <div className="col-span-12 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Additional controls</div>
                                        <div className="text-sm font-semibold text-slate-800">Leave these hidden unless you need deeper diagnostics.</div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            onClick={() => setShowAdvancedControls((prev) => !prev)}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                                                showAdvancedControls
                                                    ? 'bg-slate-900 text-white border-slate-900'
                                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            {showAdvancedControls ? 'Hide controls' : 'Show controls'}
                                        </button>
                                        <button
                                            onClick={() => setShowDeepAnalysis((prev) => !prev)}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                                                showDeepAnalysis
                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            {showDeepAnalysis ? 'Hide diagnostics' : 'Show diagnostics'}
                                        </button>
                                    </div>
                                </div>
                                {showAdvancedControls && (
                                    <div className="mt-4 flex flex-wrap items-center gap-3">
                                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">
                                            <Settings2 className="w-4 h-4 text-slate-500" />
                                            <label className="text-xs font-semibold text-slate-600">Max tokens</label>
                                            <input
                                                type="number"
                                                min={128}
                                                max={8192}
                                                step={128}
                                                value={analysisMaxTokens}
                                                onChange={(e) => setAnalysisMaxTokens(Number(e.target.value) || 128)}
                                                className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                            />
                                            <button
                                                onClick={handleSaveAnalysisSettings}
                                                disabled={isSavingSettings}
                                                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
                                            >
                                                {isSavingSettings ? 'Saving...' : 'Save'}
                                            </button>
                                        </div>
                                        <button
                                            onClick={handleDeepAnalyzeCurrentSlide}
                                            disabled={isDeepAnalyzingSlide || !analysis}
                                            className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            {isDeepAnalyzingSlide ? 'Deep analyzing...' : 'Deep analyze this slide'}
                                        </button>
                                    </div>
                                )}
                                {settingsMessage && (
                                    <div className="mt-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">{settingsMessage}</div>
                                )}
                                {settingsError && (
                                    <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{settingsError}</div>
                                )}
                                {revisionMessage && (
                                    <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">{revisionMessage}</div>
                                )}
                                {grammarStatus && (
                                    <div className={`mt-3 text-xs rounded-lg p-3 border ${
                                        grammarStatus.language_tool_available
                                            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                            : 'text-amber-700 bg-amber-50 border-amber-200'
                                    }`}>
                                        <div className="font-bold uppercase tracking-wide text-[10px] mb-1">Grammar Engine</div>
                                        <div>
                                            {grammarStatus.language_tool_available ? 'LanguageTool active' : 'Regex fallback active'}
                                            {` · ${grammarStatus.base_url}`}
                                        </div>
                                        <div className="mt-1">{grammarStatus.notes}</div>
                                        {!grammarStatus.language_tool_available && (
                                            <div className="mt-2 font-medium">
                                                Start full grammar checking with `start-all-with-grammar.bat` or `start-languagetool.ps1`.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="col-span-12 grid grid-cols-12 gap-6">
                                <div className="col-span-8 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Score breakdown</div>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                        {scoreBreakdown.map((item) => (
                                            <div key={item.label} className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">{item.label}</div>
                                                <div className="text-lg font-black text-slate-800">{item.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="col-span-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Visual coverage</div>
                                    <div className="text-2xl font-black text-slate-800 mb-1">
                                        {visualCoveragePercent !== null ? `${visualCoveragePercent}%` : '-'}
                                    </div>
                                    <div className="text-sm text-slate-600 mb-3">
                                        {analysis.visualCoverage?.summary || 'Coverage details unavailable for this slide.'}
                                    </div>
                                    {analysis.visualCoverage && (
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Expected</div>
                                                <div className="font-black text-slate-800">{analysis.visualCoverage.expected_visual_count}</div>
                                            </div>
                                            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Analyzed</div>
                                                <div className="font-black text-slate-800">{analysis.visualCoverage.analyzed_visual_count}</div>
                                            </div>
                                            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Detected</div>
                                                <div className="font-black text-slate-800">{analysis.visualCoverage.detected_visual_count}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {analysis.reliability && (
                                <div className="col-span-12 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="flex items-center justify-between gap-4 mb-3">
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Score reliability</div>
                                            <div className="text-sm text-slate-700">{analysis.reliability.summary}</div>
                                        </div>
                                        <div className={`px-3 py-2 rounded-xl border text-sm font-black ${reliabilityTone}`}>
                                            {analysis.reliability.status.toUpperCase()} · {analysis.reliability.score}
                                        </div>
                                    </div>
                                    {(analysis.reliability.factors || []).length > 0 && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            {(analysis.reliability.factors || []).map((factor, idx) => (
                                                <div key={`rel-${idx}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
                                                    {factor}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {isSenior && (
                                <div className="col-span-12 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Workspace metrics</div>
                                        <div className="text-[10px] text-slate-500">
                                            {sessionMetrics?.timestamp ? `Updated ${new Date(sessionMetrics.timestamp).toLocaleTimeString()}` : 'Waiting for first poll...'}
                                        </div>
                                    </div>
                                    {metricsError ? (
                                        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{metricsError}</div>
                                    ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                                            <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Active</div>
                                                <div className="text-lg font-black text-slate-800">{sessionMetrics?.sessions.active_count ?? '-'}</div>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Expiring &lt;1h</div>
                                                <div className="text-lg font-black text-amber-700">{sessionMetrics?.sessions.expiring_within_1h_count ?? '-'}</div>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Max Idle</div>
                                                <div className="text-lg font-black text-slate-800">
                                                    {sessionMetrics ? formatSeconds(sessionMetrics.sessions.max_idle_seconds) : '-'}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">TTL</div>
                                                <div className="text-lg font-black text-slate-800">
                                                    {sessionMetrics?.limits.session_ttl_hours ?? '-'}h
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Last Cleanup</div>
                                                <div className="text-lg font-black text-slate-800">
                                                    {sessionMetrics?.cleanup.last_expired_count ?? '-'}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                                <div className="text-slate-400 uppercase text-[10px] font-bold">Total Expired</div>
                                                <div className="text-lg font-black text-slate-800">{sessionMetrics?.cleanup.total_expired_count ?? '-'}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Middle Row: Canvas & Council */}
                            <div className="col-span-8 h-[640px] flex flex-col bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden group">
                                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-red-400"></div>
                                        <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                                        <div className="w-2 h-2 rounded-full bg-green-400"></div>
                                        <span className="ml-2 text-xs font-bold text-slate-500 tracking-tight">Slide preview</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {analysis?.lastDeepAnalyzedAt && (
                                            <div className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                                                Deep analyzed {new Date(analysis.lastDeepAnalyzedAt).toLocaleTimeString()}
                                            </div>
                                        )}
                                        <div className="text-[10px] font-bold text-slate-400">Zoom: 100%</div>
                                    </div>
                                </div>
                                <div className="flex-1 p-6 flex flex-col">
                                    <SlideCanvas
                                        imageUrl={currentSlide.previewUrl}
                                        slideData={currentSlide.slideData}
                                        analysis={analysis}
                                        onVisualClick={(visualKey) => setSelectedVisualKey(visualKey || null)}
                                        highlightedVisualKey={selectedVisualKey}
                                        isDeepAnalyzing={isDeepAnalyzingSlide}
                                    />
                                </div>
                            </div>

                            <div className="col-span-4 h-[640px] flex flex-col bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-4 bg-indigo-600 rounded-full"></div>
                                        <h3 className="text-sm font-bold text-slate-800">Review notes</h3>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Discussion log</span>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <CouncilPanel comments={analysis.councilDebate || []} />
                                </div>
                            </div>

                            {/* Bottom Row: Framework Detection */}
                            <div className="col-span-12 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center justify-between group hover:border-indigo-200 transition-colors">
                                <div className="flex items-center gap-5">
                                    <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200 group-hover:scale-105 transition-transform">
                                        <Layout className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Story pattern</div>
                                        <div className="text-xl font-black text-slate-800 tracking-tight">
                                            {analysis.deepAnalysis?.review?.layout_intelligence || analysis.frameworkDetected || "General structure detected"}
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-8 pr-4">
                                    <div className="text-right">
                                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mb-1">Analysis sources</div>
                                        <div className="flex gap-2">
                                            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">LLM</span>
                                            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200">{suryaLabel}</span>
                                            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200">{visionLabel}</span>
                                            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200">{ocrLabel}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="col-span-12 grid grid-cols-12 gap-6">
                                <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Story structure</div>
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <div className="text-sm font-black text-slate-800">
                                            {frameworkAnalysis?.framework || 'No clear structure detected'}
                                        </div>
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                                          frameworkAnalysis?.confidence === 'high'
                                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                            : frameworkAnalysis?.confidence === 'medium'
                                              ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                              : 'bg-rose-100 text-rose-700 border border-rose-200'
                                        }`}>
                                            {(frameworkAnalysis?.confidence || 'low').toUpperCase()}
                                        </span>
                                    </div>
                                    {frameworkAnalysis?.completeness && (
                                        <div className="mb-3">
                                            <div className="text-xs text-slate-600 mb-1">
                                                Completeness {frameworkAnalysis.completeness.score}% ({frameworkAnalysis.completeness.present.length}/{frameworkAnalysis.completeness.expected.length})
                                            </div>
                                            <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                                                <div
                                                    className="h-full bg-indigo-500 rounded-full"
                                                    style={{ width: `${frameworkAnalysis.completeness.score || 0}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                    {(frameworkAnalysis?.completeness?.missing || []).length > 0 && (
                                        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
                                            Missing: {(frameworkAnalysis?.completeness?.missing || []).join(', ')}
                                        </div>
                                    )}
                                    {(frameworkAnalysis?.quality?.suggestions || []).length > 0 && (
                                        <div className="mt-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2">
                                            {frameworkAnalysis?.quality?.suggestions?.[0]}
                                        </div>
                                    )}
                                </div>
                                <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Takeaway strength</div>
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                        <div className="text-sm font-black text-slate-800">
                                            {soWhatResult?.so_what_location ? `Found in ${soWhatResult.so_what_location}` : 'No takeaway analysis yet'}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${soWhatNavigatorTone}`}></span>
                                            <span className="text-sm font-black text-slate-800">{soWhatScore ?? '-'}</span>
                                        </div>
                                    </div>
                                    {soWhatResult?.stated_so_what && (
                                        <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2 mb-2">
                                            {soWhatResult.stated_so_what}
                                        </div>
                                    )}
                                    {soWhatResult?.support_gap && (
                                        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2">
                                            Support gap: {soWhatResult.support_gap}
                                        </div>
                                    )}
                                    {soWhatResult?.suggestion && (
                                        <div className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2">
                                            Recommended improvement: {soWhatResult.suggestion}
                                        </div>
                                    )}
                                </div>
                                <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Leadership readout</div>
                                    <div className="text-sm font-semibold text-slate-800 mb-2">
                                        {slideContext?.executive_summary || 'No partner summary yet.'}
                                    </div>
                                    {slideContext?.core_message && (
                                        <div className="text-xs text-slate-700 mb-2">Core message: {slideContext.core_message}</div>
                                    )}
                                    {slideContext?.audience_impact && (
                                        <div className="text-xs text-slate-700 mb-2">Audience impact: {slideContext.audience_impact}</div>
                                    )}
                                    {slideContext?.narrative_role && (
                                        <span className="inline-flex text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                            {slideContext.narrative_role}
                                        </span>
                                    )}
                                    {(slideContext?.gaps || []).length > 0 && (
                                        <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
                                            {(slideContext?.gaps || []).slice(0, 2).join(' | ')}
                                        </div>
                                    )}
                                </div>
                                <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Benchmark check</div>
                                    {benchmarkAnalysis?.is_benchmark_slide ? (
                                        <>
                                            <div className="text-sm font-semibold text-slate-800 mb-2">
                                                {benchmarkAnalysis.comparison_type || 'peer_group'}
                                            </div>
                                            {(benchmarkAnalysis.entities_compared || []).length > 0 && (
                                                <div className="flex flex-wrap gap-2 mb-2">
                                                    {(benchmarkAnalysis.entities_compared || []).map((entity, idx) => (
                                                        <span key={`entity-${idx}`} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
                                                            {entity}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {(benchmarkAnalysis.fairness_issues || []).length > 0 && (
                                                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-2">
                                                    Fairness: {(benchmarkAnalysis.fairness_issues || []).join(' | ')}
                                                </div>
                                            )}
                                            {(benchmarkAnalysis.completeness_issues || []).length > 0 && (
                                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2">
                                                    Completeness: {(benchmarkAnalysis.completeness_issues || []).join(' | ')}
                                                </div>
                                            )}
                                            {benchmarkAnalysis.conclusion_supported === false && (
                                                <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2">
                                                    Conclusion unsupported: {benchmarkAnalysis.conclusion_gap || 'Gap detected'}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="text-xs text-slate-500">No benchmark comparison detected on this slide.</div>
                                    )}
                                </div>
                                <div className="col-span-12 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Standards coverage</div>
                                        <div className="text-sm text-slate-700">Checks completed for this slide and where follow-up is still needed.</div>
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px] font-bold">
                                            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                Checked {guardrailCoverageCounts.checked}
                                            </span>
                                            <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                                                Failed {guardrailCoverageCounts.failed}
                                            </span>
                                            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                                Skipped {guardrailCoverageCounts.skipped}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {guardrailCoverage.map((item) => (
                                            <div
                                                key={item.id}
                                                className={`rounded-xl border p-3 ${
                                                    item.status === 'failed'
                                                        ? 'border-rose-200 bg-rose-50'
                                                        : item.status === 'skipped'
                                                            ? 'border-slate-200 bg-slate-50'
                                                            : 'border-emerald-200 bg-emerald-50'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2 mb-1">
                                                    <div className="text-sm font-semibold text-slate-800">{item.rule}</div>
                                                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                                                        item.status === 'failed'
                                                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                                            : item.status === 'skipped'
                                                                ? 'bg-slate-200 text-slate-700 border border-slate-300'
                                                                : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                                    }`}>
                                                        {item.status}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-slate-500 mb-1">Source: {item.source.replace('_', ' ')}</div>
                                                <div className="text-xs text-slate-700">{item.detail}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {showDeepAnalysis && (
                                <div className="col-span-12 grid grid-cols-12 gap-6">
                                    <div className="col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">LLM Understanding</div>
                                            <div className="text-sm text-slate-800 mb-3">
                                                {analysis.deepAnalysis?.review?.llm_understanding || 'Understanding summary unavailable for this slide.'}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Guardrail Alignment</div>
                                                    <div className="text-sm font-semibold text-slate-800 mb-1">
                                                        {analysis.deepAnalysis?.review?.guardrail_alignment?.status || 'partial'}
                                                    </div>
                                                    <div className="text-xs text-slate-600">
                                                        {analysis.deepAnalysis?.review?.guardrail_alignment?.notes || 'Alignment notes unavailable.'}
                                                    </div>
                                                </div>
                                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Score Rationale</div>
                                                    <div className="text-xs text-slate-600">
                                                        {analysis.deepAnalysis?.review?.score_rationale || 'Score rationale unavailable.'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        {analysis.deepAnalysis?.review?.debug_reason && (
                                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-4">
                                                <div className="text-[10px] font-bold text-rose-700 uppercase tracking-widest mb-2">Deep Review Debug Reason</div>
                                                <div className="text-sm text-rose-900">
                                                    {analysis.deepAnalysis.review.debug_reason}
                                                </div>
                                            </div>
                                        )}
                                        {analysis.visualCoverage?.gaps && analysis.visualCoverage.gaps.length > 0 && (
                                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4">
                                                <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-2">Why Visual Analysis Is Weak</div>
                                                <div className="space-y-2">
                                                    {analysis.visualCoverage.gaps.map((gap, idx) => (
                                                        <div key={`gap-${idx}`} className="text-sm text-amber-900">
                                                            {gap}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
                                            <div className="flex items-center justify-between gap-3 mb-3">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visual Evidence Readout</div>
                                                <div className="text-xs text-slate-500">
                                                    {analysis.imageAnalysis?.length || 0} visual item(s) interpreted
                                                </div>
                                            </div>
                                            <div className="space-y-3">
                                                {tableInsights.map((item, idx) => (
                                                    <div
                                                        key={`table-insight-${idx}`}
                                                        ref={(node) => {
                                                            if (item.visualKey) {
                                                                visualInsightRefs.current[item.visualKey] = node;
                                                            }
                                                        }}
                                                        onClick={() => setSelectedVisualKey(item.visualKey || null)}
                                                        className={`rounded-lg border bg-white p-3 cursor-pointer transition-colors ${
                                                            selectedVisualKey === item.visualKey
                                                                ? 'border-indigo-400 ring-2 ring-indigo-200'
                                                                : 'border-slate-200 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-3 mb-2">
                                                            <div className="text-sm font-semibold text-slate-800">Table Insight</div>
                                                            <div className="text-[11px] font-bold text-slate-500 uppercase">
                                                                {item.analysis_confidence || 'n/a'}
                                                            </div>
                                                        </div>
                                                        <div className="text-sm text-slate-700 mb-2">
                                                            {item.table_summary || item.vision_description || 'No table summary available.'}
                                                        </div>
                                                        {(item.discrepancies || []).length > 0 && (
                                                            <div className="mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
                                                                Discrepancies: {(item.discrepancies || []).join(' | ')}
                                                            </div>
                                                        )}
                                                        {(item.table_headers || []).length > 0 && (
                                                            <div className="mb-2">
                                                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Headers</div>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {(item.table_headers || []).map((header, headerIdx) => (
                                                                        <span key={`header-${idx}-${headerIdx}`} className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200">
                                                                            {header}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {(item.table_rows || []).length > 0 && (
                                                            <div>
                                                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Key Rows</div>
                                                                <div className="space-y-2">
                                                                    {(item.table_rows || []).slice(0, 3).map((row, rowIdx) => (
                                                                        <div key={`row-${idx}-${rowIdx}`} className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-xs text-slate-700">
                                                                            <span className="font-bold text-slate-800">{row.label || 'Row'}:</span>{' '}
                                                                            {(row.values || []).join(' | ')}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                                {chartInsights.map((item, idx) => (
                                                    <div
                                                        key={`chart-insight-${idx}`}
                                                        ref={(node) => {
                                                            if (item.visualKey) {
                                                                visualInsightRefs.current[item.visualKey] = node;
                                                            }
                                                        }}
                                                        onClick={() => setSelectedVisualKey(item.visualKey || null)}
                                                        className={`rounded-lg border bg-white p-3 cursor-pointer transition-colors ${
                                                            selectedVisualKey === item.visualKey
                                                                ? 'border-indigo-400 ring-2 ring-indigo-200'
                                                                : 'border-slate-200 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        <div className="text-sm font-semibold text-slate-800 mb-1">Chart Insight</div>
                                                        <div className="text-sm text-slate-700">
                                                            {item.vision_summary?.key_insight || item.vision_summary?.trends || item.title || 'No chart insight available.'}
                                                        </div>
                                                    </div>
                                                ))}
                                                {imageInsights
                                                    .filter((item) => item.type === 'image')
                                                    .map((item, idx) => (
                                                        <div
                                                            key={`image-insight-${idx}`}
                                                            ref={(node) => {
                                                                if (item.visualKey) {
                                                                    visualInsightRefs.current[item.visualKey] = node;
                                                                }
                                                            }}
                                                            onClick={() => setSelectedVisualKey(item.visualKey || null)}
                                                            className={`rounded-lg border bg-white p-3 cursor-pointer transition-colors ${
                                                                selectedVisualKey === item.visualKey
                                                                    ? 'border-indigo-400 ring-2 ring-indigo-200'
                                                                    : 'border-slate-200 hover:border-slate-300'
                                                            }`}
                                                        >
                                                            <div className="text-sm font-semibold text-slate-800 mb-1">Image Insight</div>
                                                            <div className="text-sm text-slate-700">
                                                                {item.vision_description || 'No image description available.'}
                                                            </div>
                                                        </div>
                                                    ))}
                                                {imageInsights.length === 0 && (
                                                    <div className="text-xs text-slate-500">No visual evidence details available for this slide.</div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 mb-4">
                                            <Bot className="w-4 h-4 text-indigo-600" />
                                            <h3 className="text-sm font-bold text-slate-800">Agent Breakdown</h3>
                                        </div>
                                        <div className="space-y-3">
                                            {(analysis.deepAnalysis?.agents || []).map((agent) => (
                                                <div key={agent.name} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                                    <div className="flex items-center justify-between gap-3 mb-2">
                                                        <div className="text-sm font-semibold text-slate-800">{agent.name}</div>
                                                        <div className="text-xs font-bold px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-600">
                                                            Score {agent.score ?? '-'}
                                                        </div>
                                                    </div>
                                                    <p className="text-sm text-slate-600 mb-3">{agent.summary}</p>
                                                    {agent.findings.length > 0 ? (
                                                        <div className="space-y-2">
                                                            {agent.findings.map((finding, idx) => (
                                                                <div key={`${agent.name}-${idx}`} className="rounded-lg bg-white border border-slate-200 p-3">
                                                                    <div className="flex items-center justify-between gap-3 mb-1">
                                                                        <span className="text-xs font-bold uppercase text-slate-400">{finding.category}</span>
                                                                        <span className="text-[11px] font-semibold text-slate-500">{finding.severity}</span>
                                                                    </div>
                                                                    <div className="text-sm text-slate-800">{finding.message}</div>
                                                                    {finding.suggestion && (
                                                                        <div className="mt-1 text-xs text-indigo-700">Suggested fix: {finding.suggestion}</div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg p-2">
                                                            No slide-specific issues from this agent.
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                <div className="col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Revision Preview</div>
                        {languageFindings.length > 0 ? (
                            <div className="space-y-2">
                                {languageFindings.slice(0, 2).map((finding, idx) => (
                                    <div key={`preview-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Before</div>
                                        <div className="text-xs text-slate-700 mb-2">{finding.message}</div>
                                        <div className="text-[10px] font-bold text-emerald-700 uppercase mb-1">After</div>
                                        <div className="text-xs text-emerald-800">
                                            {finding.suggestion || 'No direct rewrite suggestion available for this issue.'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-slate-500">No revision preview available for this slide yet.</div>
                        )}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <h3 className="text-sm font-bold text-slate-800">Grammar Findings</h3>
                                                <div className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                                                    grammarStatus?.language_tool_available
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {grammarStatus?.language_tool_available ? 'LanguageTool' : 'Regex Fallback'}
                                                </div>
                                            </div>
                                            {grammarFindings.length > 0 ? (
                                                <div className="space-y-2">
                                                    {grammarFindings.map((finding, idx) => (
                                                        <div key={`grammar-${idx}`} className="rounded-lg bg-white border border-slate-200 p-3">
                                                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">{finding.severity}</div>
                                                            <div className="text-sm text-slate-800">{finding.message}</div>
                                                            {finding.suggestion && (
                                                                <div className="mt-1 text-xs text-indigo-700">Suggested fix: {finding.suggestion}</div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg p-2">
                                                    No grammar issues detected for this slide.
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 mb-4">
                                            <Scale className="w-4 h-4 text-slate-700" />
                                            <h3 className="text-sm font-bold text-slate-800">Judge Output</h3>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                            <div className="text-sm font-semibold text-slate-800 mb-2">
                                                {analysis.deepAnalysis?.judge?.name || 'Language Analysis'}
                                            </div>
                                            <p className="text-sm text-slate-600 mb-3">
                                                {analysis.deepAnalysis?.judge?.summary || 'No judge output available.'}
                                            </p>
                                            {languageFindings.length > 0 ? (
                                                <div className="space-y-2">
                                                    {languageFindings.map((finding, idx) => (
                                                        <div key={`judge-${idx}`} className="rounded-lg bg-white border border-slate-200 p-3">
                                                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">{finding.category}</div>
                                                            <div className="text-sm text-slate-800">{finding.message}</div>
                                                            {finding.suggestion && (
                                                                <div className="mt-1 text-xs text-indigo-700">Suggested fix: {finding.suggestion}</div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg p-2">
                                                    No additional judge comments for this slide.
                                                </div>
                                            )}
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mt-4">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Detailed Recommendations</div>
                                            {(analysis.deepAnalysis?.review?.detailed_recommendations || []).length > 0 ? (
                                                <div className="space-y-2">
                                                    {(analysis.deepAnalysis?.review?.detailed_recommendations || []).map((item, idx) => (
                                                        <div key={`rec-${idx}`} className="rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-700">
                                                            {item}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-slate-500">No detailed recommendations available.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </>
            ) : activeTab === 'evidence' ? (
                <EvidencePanel sessionId={sessionId} />
            ) : activeTab === 'guardrails' ? (
                <GuardrailView sessionId={sessionId} onGuardrailApplied={async () => {
                  await onRefreshAnalysis();
                  await refreshCurrentSlideAnalysis();
                }} />
            ) : activeTab === 'auditlog' ? (
                <AuditLog sessionId={sessionId} />
            ) : (
                <TemplateDiscovery sessionId={sessionId} onGuardrailApplied={async () => {
                  await onRefreshAnalysis();
                  await refreshCurrentSlideAnalysis();
                }} />
            )}
        </main>

        {isIssuePanelOpen && (
          <IssuePanel 
            sessionId={sessionId} 
            annotations={annotations} 
            onActionComplete={onRefreshAnalysis}
            currentSlideIndex={currentIndex}
            onClose={() => setIsIssuePanelOpen(false)}
            onJumpToSlide={(slideIndex) => {
              setActiveTab('evaluation');
              setCurrentIndex(slideIndex);
            }}
          />
        )}
      </div>

      {/* GAP-07: Prepare for Delivery Modal */}
      {isDeliveryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-white">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight">Prepare Delivery Package</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Final Compliance Checklist</p>
                </div>
              </div>
              <button 
                onClick={() => setIsDeliveryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                x
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="space-y-4">
                {[
                  { id: 'commentsScrubbed', label: 'Confirm internal SlideForge comments are scrubbed' },
                  { id: 'metadataIncluded', label: 'Confirm Metadata.json is included' },
                  { id: 'auditLogIncluded', label: 'Confirm Audit_Log.csv is included' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-colors group">
                    <input 
                      type="checkbox" 
                      checked={deliveryChecklist[item.id as keyof typeof deliveryChecklist]}
                      onChange={() => setDeliveryChecklist(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof deliveryChecklist] }))}
                      className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-bold text-slate-700 group-hover:text-slate-900">{item.label}</span>
                  </label>
                ))}
              </div>

              <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">Senior sign-off</span>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    deliveryChecklist.signOffPresent ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {deliveryChecklist.signOffPresent ? 'Recorded' : 'Required'}
                  </span>
                </div>
                {isSenior ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={signOffName}
                      onChange={(e) => setSignOffName(e.target.value)}
                      placeholder="Senior reviewer name"
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button
                      onClick={handleSignOff}
                      disabled={isSigningOff || !signOffName.trim()}
                      className="px-4 py-2 text-sm font-bold text-white bg-slate-900 hover:bg-black rounded-xl disabled:opacity-50"
                    >
                      {isSigningOff ? 'Signing...' : 'Sign Off'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">
                    Switch to the senior role to complete sign-off.
                  </p>
                )}
              </div>

              {deliveryError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
                  {deliveryError}
                </div>
              )}

              {deliverySuccess && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl p-3">
                  {deliverySuccess}
                </div>
              )}

              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium leading-relaxed">
                  <strong>Warning:</strong> Packaging for delivery will finalize the audit log for this session. Ensure all senior evaluators have completed their review.
                </p>
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
              <button 
                onClick={() => setIsDeliveryModalOpen(false)}
                className="flex-1 px-4 py-3 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handlePrepareDelivery}
                disabled={isPreparing || !Object.values(deliveryChecklist).every(v => v)}
                className="flex-1 px-4 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-2xl shadow-lg shadow-indigo-100 disabled:opacity-50 disabled:bg-slate-400 disabled:shadow-none active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {isPreparing ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCheck className="w-5 h-5" />}
                Confirm & Package
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

