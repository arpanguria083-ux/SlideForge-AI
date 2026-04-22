import React, { useState } from 'react';
import { Sparkles, HelpCircle, Check, X, ArrowRight, Loader2, BookOpen, Layers } from 'lucide-react';
import { apiService } from '../services/apiService';

interface TemplateDiscoveryProps {
  sessionId: string;
  onGuardrailApplied?: () => Promise<void> | void;
}

interface DiscoveryQuestion {
  question: string;
  evidence?: string;
  context?: string;
}

const TemplateDiscovery: React.FC<TemplateDiscoveryProps> = ({ sessionId, onGuardrailApplied }) => {
  const [mode, setMode] = useState<'selection' | 'question' | 'complete'>('selection');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<DiscoveryQuestion | null>(null);
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [discoveryMode, setDiscoveryMode] = useState<'deck' | 'playbook'>('deck');
  const [playbookText, setPlaybookText] = useState('');
  const [playbookFile, setPlaybookFile] = useState<File | null>(null);
  const [playbookSource, setPlaybookSource] = useState<'file' | 'text'>('file');
  const [playbookMeta, setPlaybookMeta] = useState<{ filename: string; extractedCharacters: number } | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [hasAppliedSchema, setHasAppliedSchema] = useState(false);

  const startDiscovery = async () => {
    setIsAnalyzing(true);
    setError(null);
    setApplyMessage(null);
    setHasAppliedSchema(false);
    try {
      if (discoveryMode === 'playbook') {
        if (playbookSource === 'file') {
          if (!playbookFile) {
            throw new Error('Upload a playbook file before starting playbook discovery');
          }
          const resp = await apiService.discoverTemplateFromPlaybookFile(sessionId, playbookFile);
          setSchema(resp.schema as Record<string, unknown>);
          setPlaybookMeta({
            filename: resp.filename,
            extractedCharacters: resp.extracted_characters
          });
          setMode('complete');
        } else {
          if (!playbookText.trim()) {
            throw new Error('Paste playbook text before starting playbook discovery');
          }
          const discoveredSchema = await apiService.discoverTemplateFromPlaybook(playbookText.trim());
          setSchema(discoveredSchema as Record<string, unknown>);
          setPlaybookMeta(null);
          setMode('complete');
        }
      } else {
        const resp = await apiService.startDiscovery(sessionId);
        if (resp.status === 'questioning') {
          setCurrentQuestion(resp.question || null);
          setQuestionCount(1);
          setMode('question');
        } else {
          setSchema((resp.schema || null) as Record<string, unknown> | null);
          setMode('complete');
        }
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to start discovery');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applySchemaToSession = async () => {
    if (!schema) {
      setError('No discovered schema is available to apply');
      return;
    }

    setIsApplying(true);
    setError(null);
    setApplyMessage(null);
    try {
      const resp = await apiService.applySessionGuardrail(sessionId, schema);
      setSchema(resp.guardrail as unknown as Record<string, unknown>);
      setHasAppliedSchema(true);
      if (resp.analysis_invalidated) {
        await apiService.runAnalysis(sessionId);
        await onGuardrailApplied?.();
      }
      setApplyMessage('Guardrails applied and analysis refreshed for this session.');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to apply discovered guardrails');
    } finally {
      setIsApplying(false);
    }
  };

  const handleAnswer = async (answer: boolean) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const resp = await apiService.answerDiscovery(sessionId, answer ? 'yes' : 'no');
      if (resp.status === 'questioning') {
        setCurrentQuestion(resp.question);
        setQuestionCount(prev => prev + 1);
      } else {
        setSchema((resp.schema || null) as unknown as Record<string, unknown> | null);
        setMode('complete');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to answer discovery question');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resetDiscovery = () => {
    setMode('selection');
    setCurrentQuestion(null);
    setSchema(null);
    setQuestionCount(0);
    setError(null);
    setApplyMessage(null);
    setHasAppliedSchema(false);
    setPlaybookMeta(null);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50 items-center justify-center p-8">
      <div className="max-w-xl w-full bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden">
        {mode === 'selection' && (
          <div className="p-10 text-center space-y-8">
             <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-indigo-200 animate-bounce-subtle">
                <Sparkles className="w-10 h-10 text-white" />
             </div>
             <div>
               <h1 className="text-2xl font-black text-slate-800 mb-2">Pattern Discovery</h1>
               <p className="text-sm text-slate-500 font-medium">Use AI to extract new guardrails from this deck's best practices.</p>
             </div>
             
             <div className="grid grid-cols-2 gap-4">
               <button
                 onClick={() => setDiscoveryMode('playbook')}
                 className={`p-6 rounded-2xl border-2 transition-all text-left group ${
                   discoveryMode === 'playbook'
                     ? 'bg-amber-50 border-amber-300'
                     : 'bg-slate-50 border-slate-100 hover:border-slate-200'
                 }`}
               >
                 <BookOpen className="w-6 h-6 text-indigo-500 mb-3 group-hover:scale-110 transition-transform" />
                 <h3 className="text-sm font-bold text-slate-800">Analyze Playbook</h3>
                 <p className="text-[10px] text-slate-400 font-medium mt-1">Upload PDF/DOCX/TXT/MD guidelines or paste the standards directly.</p>
               </button>
               <button
                 onClick={() => setDiscoveryMode('deck')}
                 className={`p-6 rounded-2xl border-2 transition-all text-left group ${
                   discoveryMode === 'deck'
                     ? 'bg-indigo-50 border-indigo-300'
                     : 'bg-slate-50 border-slate-100 hover:border-indigo-400 hover:bg-slate-100'
                 }`}
               >
                 <Layers className="w-6 h-6 text-indigo-500 mb-3 group-hover:scale-110 transition-transform" />
                 <h3 className="text-sm font-bold text-slate-800">Learning From Deck</h3>
                 <p className="text-[10px] text-slate-400 font-medium mt-1">Find structural invariants in current slides.</p>
               </button>
             </div>

             {error && (
               <div className="p-4 rounded-2xl border border-red-200 bg-red-50 text-red-700 text-sm text-left">
                 {error}
               </div>
             )}
             {discoveryMode === 'playbook' && (
               <div className="space-y-3">
                 <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 text-sm text-left">
                   Upload a consulting playbook or paste guideline text to synthesize guardrails from written standards.
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <button
                     onClick={() => setPlaybookSource('file')}
                     className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all ${
                       playbookSource === 'file'
                         ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                         : 'border-slate-200 bg-white text-slate-500'
                     }`}
                   >
                     Upload File
                   </button>
                   <button
                     onClick={() => setPlaybookSource('text')}
                     className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all ${
                       playbookSource === 'text'
                         ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                         : 'border-slate-200 bg-white text-slate-500'
                     }`}
                   >
                     Paste Text
                   </button>
                 </div>
                 {playbookSource === 'file' ? (
                   <div className="space-y-3">
                     <label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-left">
                       <span className="block text-sm font-semibold text-slate-700">Upload playbook file</span>
                       <span className="mt-1 block text-xs text-slate-500">Supported: PDF, DOCX, TXT, MD</span>
                       <input
                         type="file"
                         accept=".pdf,.docx,.txt,.md"
                         className="mt-3 block w-full text-sm text-slate-600"
                         onChange={(e) => setPlaybookFile(e.target.files?.[0] || null)}
                       />
                     </label>
                     {playbookFile && (
                       <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600">
                         Selected file: <span className="font-semibold text-slate-800">{playbookFile.name}</span>
                       </div>
                     )}
                   </div>
                 ) : (
                   <textarea
                     value={playbookText}
                     onChange={(e) => setPlaybookText(e.target.value)}
                     placeholder="Paste consulting playbook, brand rules, legal disclaimers, or formatting guidance here..."
                     className="w-full min-h-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                   />
                 )}
               </div>
             )}

             <button 
               onClick={startDiscovery}
               disabled={
                 isAnalyzing ||
                 (
                   discoveryMode === 'playbook' &&
                   (
                     (playbookSource === 'file' && !playbookFile) ||
                     (playbookSource === 'text' && !playbookText.trim())
                   )
                 )
               }
               className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
             >
               {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
               {discoveryMode === 'deck' ? 'Start Q-Loop Invariant Check' : 'Discover Guardrails From Playbook'}
             </button>
          </div>
        )}

        {mode === 'question' && currentQuestion && (
          <div className="p-10 space-y-8 animate-in fade-in zoom-in-95 duration-300">
             <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-indigo-500 tracking-widest bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                  Question {questionCount}
                </span>
                <HelpCircle className="w-5 h-5 text-slate-300" />
             </div>
             
             <h2 className="text-xl font-bold text-slate-800 leading-tight">
               {currentQuestion.question}
             </h2>

             {currentQuestion.evidence && (
               <div className="p-5 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Evidence from Gold Slides</p>
                  <p className="text-sm font-semibold text-slate-700 italic truncate">
                    {currentQuestion.evidence}
                  </p>
               </div>
             )}

             <div className="flex gap-4">
               <button 
                onClick={() => handleAnswer(false)}
                disabled={isAnalyzing}
                className="flex-1 px-6 py-4 bg-white border-2 border-slate-200 text-slate-500 font-bold rounded-2xl hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-all active:scale-95 flex items-center justify-center gap-2"
               >
                 <X className="w-5 h-5" /> No, ignore
               </button>
               <button 
                onClick={() => handleAnswer(true)}
                disabled={isAnalyzing}
                className="flex-1 px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-2"
               >
                 {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                 Yes, add to rules
               </button>
             </div>
          </div>
        )}

        {mode === 'complete' && (
          <div className="p-10 text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="w-20 h-20 bg-green-500 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-green-100">
                <Check className="w-10 h-10 text-white" />
             </div>
             <div>
               <h1 className="text-2xl font-black text-slate-800 mb-2">Discovery Complete</h1>
               <p className="text-sm text-slate-500 font-medium">New guardrails have been synthesized from your answers.</p>
             </div>

             {playbookMeta && (
               <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-700">
                 Uploaded <span className="font-semibold">{playbookMeta.filename}</span> and extracted {playbookMeta.extractedCharacters.toLocaleString()} characters for discovery.
               </div>
             )}

             {applyMessage && (
               <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-left text-sm text-indigo-700">
                 {applyMessage}
               </div>
             )}

             {error && (
               <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700">
                 {error}
               </div>
             )}

             {schema && (
               <div className="text-left bg-slate-50 p-4 rounded-2xl border border-slate-200 overflow-y-auto max-h-48 custom-scrollbar">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Discovered Pattern Schema</p>
                  <pre className="text-[10px] font-mono text-slate-600">
                    {JSON.stringify(schema, null, 2)}
                  </pre>
               </div>
             )}

             <div className="space-y-3">
               <button
                 onClick={applySchemaToSession}
                 disabled={!schema || isApplying || hasAppliedSchema}
                 className={`w-full font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 ${
                   hasAppliedSchema
                     ? 'bg-emerald-100 text-emerald-700 cursor-default'
                     : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-100 active:scale-95 disabled:opacity-50'
                 }`}
               >
                 {isApplying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                 {hasAppliedSchema ? 'Applied To Active Session' : 'Apply To Active Session'}
               </button>
               <button
                 onClick={resetDiscovery}
                 className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-4 rounded-2xl transition-all"
               >
                 Return to Dashboard
               </button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateDiscovery;
