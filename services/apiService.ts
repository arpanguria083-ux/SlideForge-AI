/// <reference types="vite/client" />
import { ParsedSlideData, SlideAnalysis } from '../types';

const API_BASE = '/api';

const resolveApiBase = (): string => {
  const electronApiBase = window.slideforge?.apiBase;
  if (electronApiBase && typeof electronApiBase === 'string' && electronApiBase.trim()) {
    return `${electronApiBase.replace(/\/+$/, '')}/api`;
  }
  return API_BASE;
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface SessionResponse {
  session_id: string;
}

interface AnalysisResponse {
  session_id: string;
  slide_count: number;
  status: string;
  restored_from_history?: boolean;
}

interface ScorecardResponse {
  session_id: string;
  scorecard: {
    composite_score: number;
    structure_score: number;
    claim_grounding_score: number;
    data_accuracy_score: number;
    visual_compliance_score: number;
    language_score: number;
    framework_score: number;
    so_what_score: number;
    benchmarking_score: number;
    hard_block_count: number;
    warning_count: number;
    failing_slides: number[];
    annotations: Annotation[];
    summary: string;
  };
}

interface Annotation {
  annotation_id?: string;
  slide_index: number;
  text: string;
  category: string;
  severity: string;
  message: string;
  suggestion: string | null;
}

interface SlidesResponse {
  slides: SlideData[];
}

type SlideData = ParsedSlideData;

interface GuardrailResponse {
  schema_version: string;
  engagement_type: string;
  client_namespace?: string;
  discovered_patterns?: Record<string, unknown>;
  playbook_rules: Array<Record<string, any> | string>;
  human_confirmed_rules: Array<Record<string, any> | string>;
  rubric_weights: Record<string, number>;
  language_rules: Record<string, any>;
  pass_threshold: number;
  signed_by?: string;
  signed_at?: string;
  sha256?: string;
  signature?: string;
  public_key?: string;
  signature_algorithm?: string;
}

interface DiscoveryQuestion {
  question: string;
  evidence?: string;
  context?: string;
}

interface DiscoveryResponse {
  status: string;
  question?: DiscoveryQuestion;
  schema?: GuardrailResponse | Record<string, unknown>;
}

interface PlaybookUploadDiscoveryResponse {
  status: string;
  filename: string;
  extracted_characters: number;
  schema: GuardrailResponse | Record<string, unknown>;
}

interface AuditLogEntry {
  timestamp: string;
  user_role: string;
  action: string;
  details: Record<string, unknown>;
}

interface GuardrailListResponse {
  guardrails: Array<{ filename: string; id: string }>;
}

interface GuardrailDiffResponse {
  old_version: string;
  new_version: string;
  diff: {
    added: Array<Record<string, any> | string>;
    modified: Array<{ old: Record<string, any> | string; new: Record<string, any> | string }>;
    removed: Array<Record<string, any> | string>;
  };
}

interface ApplyGuardrailResponse {
  status: string;
  guardrail: GuardrailResponse;
  analysis_invalidated?: boolean;
}

interface GuardrailTemplateSummary {
  id: string;
  filename: string;
  template_name: string;
  engagement_type: string;
  client_namespace?: string | null;
  rule_count: number;
  compatible: boolean;
  updated_at: string;
  scope: string;
}

interface GuardrailTemplateListResponse {
  templates: GuardrailTemplateSummary[];
}

interface DeliveryStatusResponse {
  senior_signed: boolean;
  senior_name?: string;
}

interface SessionMetricsResponse {
  timestamp: string;
  limits: {
    session_ttl_hours: number;
    session_cleanup_interval_minutes: number;
    max_active_sessions: number;
    max_active_sessions_per_namespace: number;
  };
  sessions: {
    active_count: number;
    expiring_within_1h_count: number;
    by_namespace: Record<string, number>;
    max_idle_seconds: number;
    max_age_seconds: number;
  };
  cleanup: {
    last_run_ts: number | null;
    last_expired_count: number;
    last_expired_ids: string[];
    total_expired_count: number;
  };
  session_rows?: Array<{
    session_id: string;
    status: string;
    client_namespace: string | null;
    namespace_key: string;
    idle_seconds: number;
    age_seconds: number;
    ttl_remaining_seconds: number;
    has_deck: boolean;
    slide_count: number;
  }>;
}

interface UploadExcelResponse {
  status: string;
  filename: string;
  sheets: string[];
  total_rows: number;
}

interface SessionEvidenceResponse {
  session_id: string;
  evidence_sources: Array<{
    filename: string;
    documents_indexed: number;
  }>;
  excel_snapshot: {
    filename: string;
    sheets: string[];
    total_rows: number;
  } | null;
  source_namespace: string | null;
}

interface RevisionLoopResponse {
  session_id: string;
  revision_count: number;
  score_history: number[];
  final_score: number;
  auto_fixes_applied: number;
}

interface AnalysisSettingsResponse {
  analysis_max_tokens: number;
}

interface GrammarStatusResponse {
  enabled: boolean;
  engine: string;
  language_tool_available: boolean;
  base_url: string;
  check_url?: string;
  last_error?: string | null;
  notes: string;
}

interface RuntimeProviderStatus {
  api_base_url: string;
  base_url: string;
  model: string;
  configured: boolean;
  requires_api_key: boolean;
  api_key_configured: boolean;
  api_key_preview: string | null;
}

interface LlmProviderResponse {
  enabled: boolean;
  provider: string;
  analysis_max_tokens?: number;
  api_base_url: string;
  model: string;
  local_context_window?: number;
  api_key_configured: boolean;
  api_key_preview: string | null;
  configured: boolean;
  requires_api_key: boolean;
  providers: Record<string, RuntimeProviderStatus>;
}

interface UpdateLlmProviderPayload {
  provider: string;
  api_base_url?: string;
  api_key?: string;
  model?: string;
  local_context_window?: number;
}

interface TestLlmConnectionResponse {
  status: string;
  response: string;
  provider: string;
  model: string;
}

interface HistoryItem {
  fingerprint: string;
  original_filename: string;
  archived_deck_path: string;
  slide_count: number;
  composite_score: number;
  warning_count: number;
  hard_block_count: number;
  updated_at: string;
}

class ApiService {
  private sessionId: string | null = null;

  private apiBase = resolveApiBase();
  private readonly defaultTimeoutMs = 60_000;

  private abortWithTimeout(timeoutMs: number): AbortController {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener('abort', () => window.clearTimeout(timer), {
      once: true,
    });
    return controller;
  }

  private shouldRetry(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async fetchJson<T>(
    input: string,
    init?: RequestInit,
    options?: { retries?: number; timeoutMs?: number }
  ): Promise<T> {
    const retries = options?.retries ?? 1;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timeoutController = this.abortWithTimeout(timeoutMs);
      try {
        const mergedHeaders = {
          ...((init?.headers as Record<string, string>) || {}),
        };
        const response = await fetch(input, {
          ...init,
          headers: mergedHeaders,
          signal: timeoutController.signal,
        });
        if (!response.ok) {
          const message = await this.getErrorMessage(response, 'Request failed');
          if (attempt < retries && this.shouldRetry(response.status)) {
            await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
            continue;
          }
          throw new ApiError(message, response.status);
        }
        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        const canRetry =
          attempt < retries &&
          (!(err instanceof ApiError) || this.shouldRetry(err.status));
        if (canRetry) {
          await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    throw (lastError instanceof Error ? lastError : new Error('Request failed'));
  }

  setApiBase(apiBase: string): void {
    if (apiBase && apiBase.trim()) {
      this.apiBase = `${apiBase.replace(/\/+$/, '')}/api`;
    }
  }

  getApiBase(): string {
    return this.apiBase;
  }

  private async getErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const json = await response.json();
      return json.detail || fallback;
    } catch {
      return fallback;
    }
  }

  async createSession(clientNamespace?: string): Promise<string> {
    const base = this.apiBase;
    const url = clientNamespace 
      ? `${base}/session/create?client_namespace=${encodeURIComponent(clientNamespace)}`
      : `${base}/session/create`;

    const data = await this.fetchJson<SessionResponse>(url, { method: 'POST' }, { retries: 1 });
    this.sessionId = data.session_id;
    return data.session_id;
  }

  async uploadDeck(sessionId: string, file: File): Promise<{document_fingerprint: string; history_available: boolean}> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.apiBase}/session/${sessionId}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await this.getErrorMessage(response, 'Failed to upload deck'));
    }
    return response.json();
  }

  async parseDeck(sessionId: string): Promise<AnalysisResponse> {
    return this.fetchJson<AnalysisResponse>(`${this.apiBase}/session/${sessionId}/analyze`, {
      method: 'POST',
    }, { retries: 1, timeoutMs: 120_000 });
  }

  async runAnalysis(sessionId: string): Promise<ScorecardResponse> {
    return this.fetchJson<ScorecardResponse>(`${this.apiBase}/session/${sessionId}/run-analysis`, {
      method: 'POST',
    }, { retries: 1, timeoutMs: 180_000 });
  }

  async getScorecard(sessionId: string): Promise<ScorecardResponse['scorecard']> {
    return this.fetchJson<ScorecardResponse['scorecard']>(`${this.apiBase}/session/${sessionId}/scorecard`, undefined, { retries: 1 });
  }

  async getSlides(sessionId: string): Promise<SlidesResponse> {
    return this.fetchJson<SlidesResponse>(`${this.apiBase}/session/${sessionId}/slides`, undefined, { retries: 1 });
  }

  async getSlideAnalysis(sessionId: string, slideIndex: number): Promise<SlideAnalysis | null> {
    try {
      const response = await fetch(`${this.apiBase}/session/${sessionId}/slide/${slideIndex}/analysis`, {
        headers: this.getAuthHeaders()
      });
      
      if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to fetch slide analysis'));
      
      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error fetching slide analysis:', err);
      return null;
    }
  }

  async rerunSlideDeepAnalysis(sessionId: string, slideIndex: number): Promise<{status: string; session_id: string; slide_index: number}> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/slide/${slideIndex}/deep-analysis`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to rerun slide deep analysis'));
    return response.json();
  }

  async getLlmProvider(): Promise<LlmProviderResponse> {
    return this.fetchJson<LlmProviderResponse>(`${this.apiBase}/settings/local-llm`, undefined, { retries: 1 });
  }

  async getAnalysisSettings(): Promise<AnalysisSettingsResponse> {
    return this.fetchJson<AnalysisSettingsResponse>(`${this.apiBase}/settings/analysis`, {
      headers: this.getAuthHeaders()
    }, { retries: 1 });
  }

  async updateAnalysisSettings(analysisMaxTokens: number): Promise<AnalysisSettingsResponse & {status: string}> {
    return this.fetchJson<AnalysisSettingsResponse & {status: string}>(
      `${this.apiBase}/settings/analysis?analysis_max_tokens=${encodeURIComponent(String(analysisMaxTokens))}`,
      {
        method: 'POST',
        headers: this.getAuthHeaders()
      },
      { retries: 1 }
    );
  }

  async getGrammarStatus(): Promise<GrammarStatusResponse> {
    return this.fetchJson<GrammarStatusResponse>(`${this.apiBase}/settings/grammar-status`, {
      headers: this.getAuthHeaders()
    }, { retries: 1 });
  }

  async setLlmProvider(payload: UpdateLlmProviderPayload): Promise<LlmProviderResponse & {status: string}> {
    const response = await fetch(`${this.apiBase}/settings/local-llm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to set LLM provider'));
    return response.json();
  }

  async setSessionLlmSettings(sessionId: string, provider: string, contextWindow?: number | null): Promise<any> {
    const params = new URLSearchParams({ provider });
    if (contextWindow) {
      params.set('context_window', String(contextWindow));
    }
    const response = await fetch(`${this.apiBase}/session/${sessionId}/llm-settings?${params.toString()}`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to save session LLM settings'));
    return response.json();
  }

  async testLlmConnection(): Promise<TestLlmConnectionResponse> {
    return this.fetchJson<TestLlmConnectionResponse>(`${this.apiBase}/settings/local-llm/test`, undefined, { retries: 0, timeoutMs: 30_000 });
  }

  getSlideImageUrl(sessionId: string, index: number): string {
    return `${this.apiBase}/session/${sessionId}/slide/${index}/image`;
  }

  async acceptFix(sessionId: string, annotationId: string): Promise<any> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/accept`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({ annotation_id: annotationId }),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to accept fix'));
    return response.json();
  }

  async dismissAnnotation(sessionId: string, annotationId: string, reason: string): Promise<any> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/override`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({ annotation_id: annotationId, reason }),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to dismiss annotation'));
    return response.json();
  }

  async prepareDelivery(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/prepare`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to prepare delivery'));
    return response.json();
  }

  async getDeliveryStatus(sessionId: string): Promise<DeliveryStatusResponse> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/delivery-status`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to fetch delivery status'));
    return response.json();
  }

  async signGuardrail(sessionId: string, userName: string): Promise<any> {
    const response = await fetch(`${this.apiBase}/guardrail/${sessionId}/sign`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({ user_name: userName }),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to sign guardrail'));
    return response.json();
  }

  async getSessionGuardrail(sessionId: string): Promise<GuardrailResponse> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/guardrail`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to fetch guardrail'));
    return response.json();
  }

  async applySessionGuardrail(
    sessionId: string,
    guardrail: GuardrailResponse | Record<string, unknown>
  ): Promise<ApplyGuardrailResponse> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/guardrail/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify(guardrail),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to apply guardrail to session'));
    return response.json();
  }

  async listGuardrails(sessionId: string): Promise<GuardrailListResponse> {
    const response = await fetch(`${this.apiBase}/guardrail/list?session_id=${encodeURIComponent(sessionId)}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to list guardrails'));
    return response.json();
  }

  async diffGuardrails(sessionId: string, oldId: string, newId: string): Promise<GuardrailDiffResponse> {
    const params = new URLSearchParams({ session_id: sessionId, old_id: oldId, new_id: newId });
    const response = await fetch(`${this.apiBase}/guardrail/diff?${params.toString()}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to diff guardrails'));
    return response.json();
  }

  async saveGuardrailTemplate(sessionId: string, templateName: string): Promise<any> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/guardrail/template/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({ template_name: templateName }),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to save guardrail template'));
    return response.json();
  }

  async listGuardrailTemplates(sessionId?: string): Promise<GuardrailTemplateListResponse> {
    const suffix = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    const response = await fetch(`${this.apiBase}/guardrail/template/list${suffix}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to list guardrail templates'));
    return response.json();
  }

  async activateGuardrailTemplate(sessionId: string, templateId: string): Promise<ApplyGuardrailResponse> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/guardrail/template/${encodeURIComponent(templateId)}/activate`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to activate guardrail template'));
    return response.json();
  }

  async getAuditLog(sessionId: string): Promise<{entries: AuditLogEntry[]}> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/audit-log`, {
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to fetch audit log'));
    return response.json();
  }

  async startDiscovery(sessionId: string): Promise<DiscoveryResponse> {
    const response = await fetch(`${this.apiBase}/template/discover/start?session_id=${sessionId}`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to start discovery'));
    return response.json();
  }

  async answerDiscovery(sessionId: string, answer: string): Promise<DiscoveryResponse> {
    const response = await fetch(`${this.apiBase}/template/discover/answer?session_id=${sessionId}&answer=${encodeURIComponent(answer)}`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to answer discovery question'));
    return response.json();
  }

  async discoverTemplateFromPlaybook(playbookText: string, engagementType = 'strategy'): Promise<GuardrailResponse | Record<string, unknown>> {
    const response = await fetch(`${this.apiBase}/template/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({ playbook_text: playbookText, engagement_type: engagementType })
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to discover guardrails from playbook'));
    return response.json();
  }

  async discoverTemplateFromPlaybookFile(
    sessionId: string,
    file: File,
    engagementType = 'strategy'
  ): Promise<PlaybookUploadDiscoveryResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams({ session_id: sessionId, engagement_type: engagementType });
    const response = await fetch(`${this.apiBase}/template/discover/upload?${params.toString()}`, {
      method: 'POST',
      body: formData,
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to discover guardrails from uploaded playbook'));
    return response.json();
  }

  private getAuthHeaders(): Record<string, string> {
    const role = localStorage.getItem('slideforge_role') || 'junior';
    return { 'X-User-Role': role };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async downloadAnnotated(sessionId: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/download`, {
      headers: this.getAuthHeaders()
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to download annotated deck'));
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SlideForge_annotated.pptx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  async downloadPackage(sessionId: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/download-package`);
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to download package'));
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Delivery_Package.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  async signOffSession(sessionId: string, userName: string): Promise<any> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/sign-off`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({ user_name: userName }),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to sign off'));
    return response.json();
  }

  async uploadSourceDocument(sessionId: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${this.apiBase}/session/${sessionId}/upload-source`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to upload source document'));
    return response.json();
  }

  async uploadExcelForDataLineage(sessionId: string, file: File): Promise<UploadExcelResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${this.apiBase}/session/${sessionId}/upload-excel`, {
      method: 'POST',
      body: formData,
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to upload Excel source'));
    return response.json();
  }

  async getSessionEvidence(sessionId: string): Promise<SessionEvidenceResponse> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/evidence`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to load evidence state'));
    return response.json();
  }

  async runRevisionLoop(sessionId: string): Promise<RevisionLoopResponse> {
    const response = await fetch(`${this.apiBase}/session/${sessionId}/revision`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to run revision loop'));
    return response.json();
  }

  async getLlmDiagnostics(): Promise<any> {
    const response = await fetch(`${this.apiBase}/settings/local-llm/diagnostics`);
    if (!response.ok) throw new Error(await this.getErrorMessage(response, 'Failed to get diagnostics'));
    return response.json();
  }

  async getSessionMetrics(includeSessions = false): Promise<SessionMetricsResponse> {
    return this.fetchJson<SessionMetricsResponse>(
      `${this.apiBase}/admin/session-metrics?include_sessions=${includeSessions ? 'true' : 'false'}`,
      { headers: this.getAuthHeaders() },
      { retries: 1 }
    );
  }

  async getRecentHistory(limit = 12): Promise<{items: HistoryItem[]}> {
    return this.fetchJson<{items: HistoryItem[]}>(`${this.apiBase}/history/recent?limit=${limit}`, {
      headers: this.getAuthHeaders()
    }, { retries: 1 });
  }

  async openHistory(fingerprint: string): Promise<AnalysisResponse> {
    return this.fetchJson<AnalysisResponse>(`${this.apiBase}/history/${encodeURIComponent(fingerprint)}/open`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    }, { retries: 1, timeoutMs: 120_000 });
  }
}

export const apiService = new ApiService();
export type {
  Annotation,
  SlideData,
  HistoryItem,
  LlmProviderResponse,
  RuntimeProviderStatus,
  UpdateLlmProviderPayload,
  TestLlmConnectionResponse,
};
