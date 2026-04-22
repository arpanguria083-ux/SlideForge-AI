export interface BoundingBox {
  top: number;
  left: number;
  width: number;
  height: number;
  label: string;
  visualKey?: string;
}

export interface ParsedTextRun {
  text: string;
  font_name: string;
  font_size: number;
  font_bold: boolean;
}

export interface ParsedTextBox {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  runs: ParsedTextRun[];
}

export interface ParsedVisualElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  coord_unit?: string;
  title?: string;
  type?: string;
  text?: string;
  rows?: number;
  columns?: number;
  has_content?: boolean;
  asset_url?: string | null;
  content_type?: string | null;
  extension?: string | null;
}

export interface ParsedSlideData {
  id: string;
  index: number;
  title: string;
  full_text: string;
  previewUrl: string;
  width: number;
  height: number;
  text_boxes: ParsedTextBox[];
  charts: ParsedVisualElement[];
  tables: ParsedVisualElement[];
  images: ParsedVisualElement[];
}

export interface PersonaComment {
  persona: 'Chairman' | 'Storyteller' | 'Data Auditor' | 'Designer';
  text: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'critical';
  score: number; // 0-10
}

export interface DeepFinding {
  slide_index: number;
  text: string;
  category: string;
  severity: string;
  message: string;
  suggestion?: string | null;
}

export interface DeepAgentReview {
  name: string;
  score?: number;
  summary: string;
  findings: DeepFinding[];
}

export interface DeepJudgeReview {
  name: string;
  summary: string;
  findings: DeepFinding[];
}

export interface DeepAnalysis {
  agents: DeepAgentReview[];
  judge: DeepJudgeReview;
  review?: {
    llm_understanding: string;
    layout_intelligence: string;
    guardrail_alignment: {
      status: 'aligned' | 'partial' | 'misaligned' | string;
      notes: string;
    };
    score_rationale: string;
    detailed_recommendations: string[];
    debug_reason?: string;
  };
}

export interface GuardrailCoverageItem {
  id: string;
  rule: string;
  source: 'human_confirmed' | 'playbook' | 'language' | 'discovered' | 'system';
  status: 'checked' | 'failed' | 'skipped';
  detail: string;
}

export interface FrameworkAnalysis {
  framework?: string | null;
  framework_key?: string | null;
  confidence?: 'high' | 'medium' | 'low' | string;
  completeness?: {
    expected: string[];
    present: string[];
    missing: string[];
    score: number;
  };
  quality?: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
  candidate_frameworks?: string[];
  vision_hint?: string | null;
}

export interface SoWhatResult {
  skipped?: boolean;
  reason?: string;
  has_clear_so_what?: boolean;
  so_what_location?: 'headline' | 'body_conclusion' | 'implied' | 'missing' | string;
  stated_so_what?: string;
  body_supports_so_what?: boolean;
  support_gap?: string;
  action_orientation?: 'explicit_action' | 'implicit_action' | 'informational_only' | 'decorative' | string;
  score?: number;
  suggestion?: string;
}

export interface BenchmarkAnalysis {
  is_benchmark_slide?: boolean;
  comparison_type?: 'direct_competitor' | 'industry_benchmark' | 'peer_group' | 'time_series' | string | null;
  entities_compared?: string[];
  fairness_issues?: string[];
  completeness_issues?: string[];
  conclusion_supported?: boolean;
  conclusion_gap?: string;
  score?: number;
}

export interface SlideContext {
  core_message?: string;
  so_what?: string;
  audience_impact?: string;
  narrative_role?: 'context' | 'problem' | 'diagnosis' | 'recommendation' | 'evidence' | 'transition' | 'appendix' | string;
  deck_fit?: string;
  executive_summary?: string;
  gaps?: string[];
}

export interface ImageAnalysisItem {
  type: string;
  id: string;
  visualKey?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  has_content?: boolean;
  chart_type?: string;
  title?: string;
  has_data?: boolean;
  vision_summary?: {
    chart_type?: string;
    title?: string;
    key_insight?: string;
    trends?: string;
  };
  vision_description?: string;
  visible_text?: string[];
  table_summary?: string;
  table_headers?: string[];
  table_rows?: Array<{
    label?: string;
    values?: string[];
  }>;
  discrepancies?: string[];
  analysis_confidence?: string;
  native_text?: string;
}

export interface SlideAnalysis {
  id: string;
  title: string;
  summary: string;
  overallScore: number;
  lastDeepAnalyzedAt?: string;
  scoreBreakdown?: {
    message_clarity: number;
    evidence_strength: number;
    layout_quality: number;
    visual_usefulness: number;
    guardrail_fit: number;
  };
  consultantSummary?: string;
  visualCoverage?: {
    status: 'strong' | 'partial' | 'weak' | 'not_applicable' | string;
    coverage_ratio: number;
    detected_visual_count: number;
    expected_visual_count: number;
    analyzed_visual_count: number;
    native_images: number;
    native_tables: number;
    native_charts: number;
    summary: string;
    gaps: string[];
  };
  reliability?: {
    status: 'strong' | 'moderate' | 'low' | string;
    score: number;
    summary: string;
    factors: string[];
  };
  imageAnalysis?: ImageAnalysisItem[];
  density: 'Low' | 'Medium' | 'High';
  visuals: BoundingBox[];
  fixes: BoundingBox[];
  councilDebate: PersonaComment[];
  frameworkDetected?: string;
  citationIssues: string[];
  hardBlockCount?: number;
  imageCount?: number;
  tableCount?: number;
  chartCount?: number;
  deepAnalysis?: DeepAnalysis;
  frameworkAnalysis?: FrameworkAnalysis | null;
  soWhatResult?: SoWhatResult | null;
  benchmarkAnalysis?: BenchmarkAnalysis | null;
  slideContext?: SlideContext | null;
  guardrailCoverage?: GuardrailCoverageItem[];
  analysisBackends?: {
    surya: boolean;
    vision: 'lm_studio' | 'fallback' | 'unavailable' | 'unknown' | string;
    ocr: 'surya' | 'native' | 'unknown' | string;
  };
  dynamicScorecard?: {
    schema_version: string;
    weights: Record<string, number>;
    thresholds: {
      pass: number;
      warn: number;
    };
    dimensions: Array<{
      id: string;
      score: number;
      weight: number;
      status: 'checked' | 'failed' | string;
    }>;
    coverage: {
      rules_total: number;
      rules_checked: number;
      rules_failed: number;
      rules_skipped: number;
    };
    overall: {
      score: number;
      status: 'pass' | 'warn' | 'fail' | 'hard_fail' | string;
      confidence_score: number;
      hard_block_count: number;
      warning_count: number;
    };
  };
}

export interface SlideModel {
  id: string;
  file: File;
  previewUrl: string;
  slideData?: ParsedSlideData;
  analysis: SlideAnalysis | null;
  status: 'idle' | 'analyzing' | 'complete' | 'error';
}

export enum ViewMode {
  UPLOAD = 'UPLOAD',
  DASHBOARD = 'DASHBOARD'
}
