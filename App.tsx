import React, { useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import RolePicker from './components/RolePicker';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import TermsModal from './components/TermsModal';
import { SlideModel, ViewMode } from './types';
import { apiService, Annotation as ApiAnnotation } from './services/apiService';

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.UPLOAD);
  const [slides, setSlides] = useState<SlideModel[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ApiAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'junior' | 'senior' | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    const savedRole = localStorage.getItem('slideforge_role') as 'junior' | 'senior' | null;
    if (savedRole) setUserRole(savedRole);
    const accepted = localStorage.getItem('slideforge_terms_accepted') === 'true';
    setTermsAccepted(accepted);
  }, []);

  const handleAcceptTerms = () => {
    localStorage.setItem('slideforge_terms_accepted', 'true');
    setTermsAccepted(true);
  };

  useEffect(() => {
    const bootstrapApiBase = async () => {
      try {
        if (window.slideforge?.getApiBase) {
          const base = await window.slideforge.getApiBase();
          if (base) {
            apiService.setApiBase(base);
          }
        }
      } catch (err) {
        console.warn('Failed to resolve Electron API base, using default /api', err);
      }
    };

    bootstrapApiBase();
  }, []);

  const handleRoleSelect = (role: 'junior' | 'senior') => {
    localStorage.setItem('slideforge_role', role);
    setUserRole(role);
  };

  const refreshAnalysis = async (targetSessionId?: string) => {
    const effectiveSessionId = targetSessionId || sessionId;
    if (!effectiveSessionId) return;
    try {
      const scorecard = await apiService.getScorecard(effectiveSessionId);
      setAnnotations(scorecard.annotations);
    } catch (err) {
      console.error('Failed to refresh analysis:', err);
    }
  };

  const updateSlideAnalysis = (slideIndex: number, analysis: SlideModel['analysis']) => {
    setSlides((prev) =>
      prev.map((slide, idx) =>
        idx === slideIndex
          ? {
              ...slide,
              analysis,
              status: analysis ? 'complete' : slide.status,
            }
          : slide
      )
    );
  };

  const loadSessionIntoDashboard = async (sessionId: string, sourceFile?: File) => {
    const slidesData = await apiService.getSlides(sessionId);
    const fallbackFile =
      sourceFile ||
      new File([''], 'restored-analysis', {
        type: 'application/octet-stream',
      });

    const newSlides: SlideModel[] = slidesData.slides.map((slideData) => ({
      id: `slide-${slideData.index}`,
      file: fallbackFile,
      previewUrl: slideData.previewUrl || apiService.getSlideImageUrl(sessionId, slideData.index),
      slideData,
      analysis: null,
      status: 'idle'
    }));

    setSlides(newSlides);
    setViewMode(ViewMode.DASHBOARD);

    for (let i = 0; i < newSlides.length; i++) {
      newSlides[i] = {
        ...newSlides[i],
        status: 'analyzing'
      };
      setSlides([...newSlides]);
      setProgress({
        current: 1 + i,
        total: Math.max(1, newSlides.length),
        label: `Loading slide ${i + 1} analysis`,
      });
      const analysis = await apiService.getSlideAnalysis(sessionId, i);
      newSlides[i] = {
        ...newSlides[i],
        analysis,
        status: 'complete'
      };
      setSlides([...newSlides]);
    }
  };

  const handleUpload = async (uploadedFiles: File[]) => {
    setIsProcessing(true);
    setError(null);

    try {
      const providerConfig = await apiService.getLlmProvider();
      const selectedProvider = providerConfig.provider || 'api';
      const localContextWindow = providerConfig.local_context_window || 8192;
      const sessionId = await apiService.createSession();
      setSessionId(sessionId);
      await apiService.setSessionLlmSettings(
        sessionId,
        selectedProvider,
        selectedProvider === 'ollama' || selectedProvider === 'lm_studio'
          ? localContextWindow
          : null
      );

      const file = uploadedFiles[0];
      if (!file) {
        throw new Error('No file selected');
      }

      try {
        await apiService.uploadDeck(sessionId, file);
      } catch (e: any) {
        throw new Error(`Upload Failed: ${e.message || 'Unknown error'}`);
      }

      setProgress({ current: 1, total: 4, label: 'Uploading deck' });
      
      try {
        await apiService.parseDeck(sessionId);
      } catch (e: any) {
        throw new Error(`Parsing/OCR Failed: ${e.message || 'Unknown error'}`);
      }
      
      setProgress({ current: 2, total: 4, label: 'Parsing slides and OCR' });
      
      try {
        const analysisResult = await apiService.runAnalysis(sessionId);
        setAnnotations(analysisResult.scorecard.annotations);
      } catch (e: any) {
        throw new Error(`Agent Analysis Failed: ${e.message || 'Unknown error'}`);
      }
      
      setProgress({ current: 3, total: 4, label: 'Running analysis agents' });

      await loadSessionIntoDashboard(sessionId, uploadedFiles[0]);

    } catch (err) {
      console.error('Error during upload:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const handleOpenHistory = async (fingerprint: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await apiService.openHistory(fingerprint);
      setSessionId(result.session_id);
      await refreshAnalysis(result.session_id);
      await loadSessionIntoDashboard(result.session_id);
    } catch (err) {
      console.error('Error opening history:', err);
      setError(err instanceof Error ? err.message : 'Failed to open analysis history');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  return (
    <ToastProvider>
      <ErrorBoundary>
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
          <TermsModal open={!termsAccepted} accepted={termsAccepted} onAccept={handleAcceptTerms} />
          {!userRole && <RolePicker onSelect={handleRoleSelect} />}
          
          {error && (
            <div className="fixed right-4 top-4 z-50 max-w-md rounded-2xl border border-rose-200 bg-white/95 px-4 py-3 text-rose-700 shadow-[0_20px_60px_rgba(190,24,93,0.14)] backdrop-blur">
              <span className="font-medium">Something needs attention:</span> {error}
              <button 
                onClick={() => setError(null)}
                className="ml-2 text-rose-500 hover:text-rose-700"
              >
                x
              </button>
            </div>
          )}
          {viewMode === ViewMode.UPLOAD && (
            <ErrorBoundary>
              <FileUpload
                onUpload={(files) => {
                  if (!termsAccepted) {
                    setError('Accept Terms and Privacy Notice before uploading.');
                    return;
                  }
                  onUpload(files);
                }}
                isProcessing={isProcessing}
                onError={setError}
                onOpenHistory={(fingerprint) => {
                  if (!termsAccepted) {
                    setError('Accept Terms and Privacy Notice before opening history.');
                    return;
                  }
                  handleOpenHistory(fingerprint);
                }}
              />
            </ErrorBoundary>
          )}
          {viewMode === ViewMode.DASHBOARD && sessionId && (
            <ErrorBoundary>
              <Dashboard 
                sessionId={sessionId}
                slides={slides} 
                progress={progress} 
                annotations={annotations}
                onRefreshAnalysis={refreshAnalysis}
                onUpdateSlideAnalysis={updateSlideAnalysis}
              />
            </ErrorBoundary>
          )}
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
};

export default App;

