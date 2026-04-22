import React, { useEffect, useMemo, useState } from 'react';
import { Shield, CheckCircle2, Lock, Edit3, Fingerprint, FileCheck, Columns, AlertCircle, Loader2, Save, Play, RefreshCcw } from 'lucide-react';
import { apiService } from '../services/apiService';
import GuardrailDiff from './GuardrailDiff';

interface GuardrailViewProps {
  sessionId: string;
  onGuardrailApplied?: () => Promise<void> | void;
}

interface RuleRow {
  id: string;
  text: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}

interface TemplateRow {
  id: string;
  template_name: string;
  engagement_type: string;
  client_namespace?: string | null;
  rule_count: number;
  compatible: boolean;
  updated_at: string;
  scope: string;
}

const normalizeRuleText = (rule: unknown): string => {
  if (typeof rule === 'string') return rule;
  if (typeof rule === 'object' && rule !== null) {
    const r = rule as Record<string, unknown>;
    if (typeof r.rule === 'string') return r.rule;
    if (typeof r.text === 'string') return r.text;
    if (typeof r.name === 'string') return r.name;
    return JSON.stringify(r);
  }
  return String(rule ?? '');
};

const GuardrailView: React.FC<GuardrailViewProps> = ({ sessionId, onGuardrailApplied }) => {
  const [userName, setUserName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureAlgorithm, setSignatureAlgorithm] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [guardrail, setGuardrail] = useState<any | null>(null);
  const [loadingGuardrail, setLoadingGuardrail] = useState(true);
  const [guardrailError, setGuardrailError] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [oldRules, setOldRules] = useState<RuleRow[]>([]);
  const [newRules, setNewRules] = useState<RuleRow[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [activatingTemplateId, setActivatingTemplateId] = useState<string | null>(null);

  const isSenior = localStorage.getItem('slideforge_role') === 'senior';

  const fetchGuardrail = async () => {
    setLoadingGuardrail(true);
    setGuardrailError(null);
    try {
      const data = await apiService.getSessionGuardrail(sessionId);
      setGuardrail(data);
      setSignature(data.signature || data.sha256 || null);
      setSignatureAlgorithm(data.signature_algorithm || (data.signature ? 'ed25519' : data.sha256 ? 'sha256' : null));
      if (data.signed_by && !userName) setUserName(data.signed_by);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load guardrail';
      setGuardrailError(message);
    } finally {
      setLoadingGuardrail(false);
    }
  };

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    setTemplateError(null);
    try {
      const data = await apiService.listGuardrailTemplates(sessionId);
      setTemplates(data.templates as TemplateRow[]);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to load guardrail templates');
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    fetchGuardrail();
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const activeRules = useMemo(() => {
    if (!guardrail) return [];
    const allRules = [...(guardrail.playbook_rules || []), ...(guardrail.human_confirmed_rules || [])];
    const unique = Array.from(new Set(allRules.map(normalizeRuleText).filter(Boolean)));
    return unique.map((text, index) => ({
      id: `rule-${index}`,
      text,
      status: 'unchanged' as const,
    }));
  }, [guardrail]);

  const loadDiff = async () => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const list = await apiService.listGuardrails(sessionId);
      const files = [...list.guardrails].sort((a, b) => a.filename.localeCompare(b.filename));
      if (files.length < 2) {
        setOldRules([]);
        setNewRules([]);
        return;
      }

      const oldFile = files[files.length - 2];
      const newFile = files[files.length - 1];
      const diff = await apiService.diffGuardrails(sessionId, oldFile.id, newFile.id);

      const oldRows: RuleRow[] = [];
      const newRows: RuleRow[] = [];

      for (const removed of diff.diff.removed || []) {
        oldRows.push({
          id: `removed-${oldRows.length}`,
          text: normalizeRuleText(removed),
          status: 'removed',
        });
      }

      for (const modified of diff.diff.modified || []) {
        oldRows.push({
          id: `modified-old-${oldRows.length}`,
          text: normalizeRuleText(modified.old),
          status: 'changed',
        });
        newRows.push({
          id: `modified-new-${newRows.length}`,
          text: normalizeRuleText(modified.new),
          status: 'changed',
        });
      }

      for (const added of diff.diff.added || []) {
        newRows.push({
          id: `added-${newRows.length}`,
          text: normalizeRuleText(added),
          status: 'added',
        });
      }

      if (oldRows.length === 0 && newRows.length === 0) {
        const unchanged = activeRules.map((rule, idx) => ({
          id: `unchanged-${idx}`,
          text: rule.text,
          status: 'unchanged' as const,
        }));
        setOldRules(unchanged);
        setNewRules(unchanged);
        return;
      }

      setOldRules(oldRows);
      setNewRules(newRows.length > 0 ? newRows : oldRows.map((r, idx) => ({ ...r, id: `mirror-${idx}`, status: 'unchanged' })));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load guardrail diff';
      setDiffError(message);
      setOldRules([]);
      setNewRules([]);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleToggleDiff = async () => {
    const next = !showDiff;
    setShowDiff(next);
    if (next) await loadDiff();
  };

  const handleSign = async () => {
    if (!userName.trim()) return;
    setIsSigning(true);
    setSignError(null);
    try {
      const result = await apiService.signGuardrail(sessionId, userName.trim());
      setSignature(result.signed_guardrail?.signature || result.signed_guardrail?.sha256 || null);
      setSignatureAlgorithm(result.signed_guardrail?.signature_algorithm || (result.signed_guardrail?.signature ? 'ed25519' : result.signed_guardrail?.sha256 ? 'sha256' : null));
      await fetchGuardrail();
      if (showDiff) await loadDiff();
    } catch (err) {
      console.error(err);
      setSignError(err instanceof Error ? err.message : 'Failed to sign guardrail');
    } finally {
      setIsSigning(false);
    }
  };

  const handleSaveTemplate = async () => {
    const nextName = templateName.trim() || `${guardrail?.engagement_type || 'strategy'} template`;
    setIsSavingTemplate(true);
    setTemplateError(null);
    setTemplateMessage(null);
    try {
      await apiService.saveGuardrailTemplate(sessionId, nextName);
      setTemplateName(nextName);
      setTemplateMessage(`Saved "${nextName}" to the guardrail template library.`);
      await fetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to save guardrail template');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleActivateTemplate = async (templateId: string) => {
    setActivatingTemplateId(templateId);
    setTemplateError(null);
    setTemplateMessage(null);
    try {
      await apiService.activateGuardrailTemplate(sessionId, templateId);
      await apiService.runAnalysis(sessionId);
      await onGuardrailApplied?.();
      setTemplateMessage('Template activated and analysis refreshed for this session.');
      await fetchGuardrail();
      await fetchTemplates();
      if (showDiff) await loadDiff();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to activate guardrail template');
    } finally {
      setActivatingTemplateId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      <div className="p-8 max-w-6xl mx-auto w-full space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">Compliance Guardrails</h1>
              <p className="text-sm text-slate-500 font-medium italic">Engagement-specific rules and audit trail</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleDiff}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                showDiff ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Columns className="w-4 h-4" /> {showDiff ? 'Back to Rules' : 'Compare Signed Versions'}
            </button>
            <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2 ${
              signature ? 'bg-green-50 border-green-200 text-green-600' : 'bg-slate-100 border-slate-200 text-slate-400'
            }`}>
              {signature ? 'Signed & Verified' : 'Pending Sign-off'}
            </div>
          </div>
        </div>

        {showDiff ? (
          <>
            {diffLoading && (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-slate-500 flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading guardrail diff...
              </div>
            )}
            {!diffLoading && diffError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
                {diffError}
              </div>
            )}
            {!diffLoading && !diffError && oldRules.length > 0 && newRules.length > 0 && (
              <GuardrailDiff oldRules={oldRules} newRules={newRules} />
            )}
            {!diffLoading && !diffError && oldRules.length === 0 && newRules.length === 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-8 text-slate-600">
                Need at least two saved signed guardrails to generate a diff.
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <div className="col-span-1 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <FileCheck className="w-4 h-4 text-indigo-500" />
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Rules</h3>
              </div>

              {loadingGuardrail && (
                <div className="text-sm text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading rules...
                </div>
              )}

              {!loadingGuardrail && guardrailError && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
                  {guardrailError}
                </div>
              )}

              {!loadingGuardrail && !guardrailError && activeRules.length === 0 && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-xs">
                  No custom rules discovered yet. Run analysis and template discovery to populate this list.
                </div>
              )}

              {!loadingGuardrail && !guardrailError && activeRules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 group hover:border-indigo-200 transition-colors">
                  <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{rule.text}</span>
                </div>
              ))}
            </div>

            <div className="col-span-1 space-y-6">
              <div className={`p-6 rounded-3xl border shadow-xl transition-all ${
                signature ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center gap-2 mb-6">
                  <Lock className={`w-4 h-4 ${signature ? 'text-indigo-200' : 'text-slate-400'}`} />
                  <h3 className={`text-xs font-bold uppercase tracking-widest ${signature ? 'text-indigo-100' : 'text-slate-400'}`}>Certification</h3>
                </div>

                {!signature ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-slate-600 leading-relaxed">
                      By signing, you confirm that these guardrails accurately reflect clinical/client requirements for this engagement.
                    </p>

                    {isSenior ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          placeholder="Full Legal Name"
                          value={userName}
                          onChange={(e) => setUserName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-shadow outline-none"
                        />
                        <button
                          onClick={handleSign}
                          disabled={!userName.trim() || isSigning}
                          className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isSigning ? 'Hashing...' : (
                            <>
                              <Edit3 className="w-4 h-4" /> Sign Compliance Guardrails
                            </>
                          )}
                        </button>
                        {signError && (
                          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
                            {signError}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                        <p className="text-xs text-amber-700 font-medium">
                          Your account (Consultant) does not have signing authority. A Senior Evaluator must approve these rules.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-indigo-100">Digitally Certified By</p>
                        <p className="text-lg font-black tracking-tight">{guardrail?.signed_by || userName}</p>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-white/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Fingerprint className="w-3.5 h-3.5 text-indigo-200" />
                        <span className="text-[10px] font-bold text-indigo-100 uppercase tracking-widest">
                          Audit Signature ({(signatureAlgorithm || 'sha256').toUpperCase()})
                        </span>
                      </div>
                      <p className="text-[10px] font-mono break-all opacity-80 leading-tight">
                        {signature}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Template Library</h3>
                    <p className="text-xs text-slate-500 mt-1">Save current guardrails as reusable templates and activate them when required.</p>
                  </div>
                  <button
                    onClick={fetchTemplates}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Refresh
                  </button>
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Template name"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-shadow outline-none"
                  />
                  <button
                    onClick={handleSaveTemplate}
                    disabled={loadingGuardrail || !!guardrailError || isSavingTemplate}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSavingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Current As Template
                  </button>
                </div>

                {templateMessage && (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs">
                    {templateMessage}
                  </div>
                )}

                {templateError && (
                  <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
                    {templateError}
                  </div>
                )}

                {loadingTemplates ? (
                  <div className="text-sm text-slate-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading templates...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-xs">
                    No saved templates yet. Save the current guardrail after discovery or refinement.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {templates.map((template) => (
                      <div key={template.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-slate-800">{template.template_name}</div>
                            <div className="text-[11px] text-slate-500 mt-1">
                              {template.engagement_type} • {template.rule_count} rules • {template.scope}
                            </div>
                          </div>
                          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                            template.compatible ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {template.compatible ? 'Compatible' : 'Different Type'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Updated {new Date(template.updated_at).toLocaleString()}
                        </div>
                        <button
                          onClick={() => handleActivateTemplate(template.id)}
                          disabled={activatingTemplateId === template.id}
                          className="w-full bg-white hover:bg-slate-100 text-slate-800 font-semibold py-2.5 rounded-xl border border-slate-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {activatingTemplateId === template.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          Activate In This Session
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-100/50 p-6 rounded-3xl border border-slate-200 border-dashed">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 italic">Policy Note</div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Rules are enforced via LangGraph orchestration and Pydantic validation. Any dismissals are recorded in the engagement audit trail for partner review.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GuardrailView;
