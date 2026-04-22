import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { apiService } from '../services/apiService';

interface EvidencePanelProps {
  sessionId: string;
}

interface UploadedSourceItem {
  filename: string;
  documentsIndexed: number;
}

interface ExcelSnapshot {
  filename: string;
  sheets: string[];
  totalRows: number;
}

const EvidencePanel: React.FC<EvidencePanelProps> = ({ sessionId }) => {
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [excelMessage, setExcelMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<UploadedSourceItem[]>([]);
  const [excelSnapshot, setExcelSnapshot] = useState<ExcelSnapshot | null>(null);

  React.useEffect(() => {
    let active = true;
    const loadEvidenceState = async () => {
      setIsLoadingState(true);
      try {
        const result = await apiService.getSessionEvidence(sessionId);
        if (!active) return;
        setSources(
          (result.evidence_sources || []).map((item) => ({
            filename: item.filename,
            documentsIndexed: Number(item.documents_indexed || 0),
          }))
        );
        if (result.excel_snapshot) {
          setExcelSnapshot({
            filename: result.excel_snapshot.filename,
            sheets: result.excel_snapshot.sheets || [],
            totalRows: Number(result.excel_snapshot.total_rows || 0),
          });
        } else {
          setExcelSnapshot(null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load evidence state.');
      } finally {
        if (active) setIsLoadingState(false);
      }
    };

    loadEvidenceState();
    return () => {
      active = false;
    };
  }, [sessionId]);

  const totalIndexedDocs = useMemo(
    () => sources.reduce((sum, item) => sum + item.documentsIndexed, 0),
    [sources]
  );

  const handleSourceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploadingSource(true);
    setError(null);
    setSourceMessage(null);

    try {
      const result = await apiService.uploadSourceDocument(sessionId, file);
      const documentsIndexed = Number(result.documents_indexed || 0);
      setSources((prev) => [
        { filename: result.filename || file.name, documentsIndexed },
        ...prev.filter((item) => item.filename !== (result.filename || file.name)),
      ]);
      setSourceMessage(
        `Indexed ${documentsIndexed} evidence chunk(s) from ${result.filename || file.name}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload source document.');
    } finally {
      setIsUploadingSource(false);
    }
  };

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploadingExcel(true);
    setError(null);
    setExcelMessage(null);

    try {
      const result = await apiService.uploadExcelForDataLineage(sessionId, file);
      const nextSnapshot: ExcelSnapshot = {
        filename: result.filename || file.name,
        sheets: Array.isArray(result.sheets) ? result.sheets : [],
        totalRows: Number(result.total_rows || 0),
      };
      setExcelSnapshot(nextSnapshot);
      setExcelMessage(
        `Loaded ${nextSnapshot.filename} with ${nextSnapshot.sheets.length} sheet(s) and ${nextSnapshot.totalRows} total rows.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload Excel source.');
    } finally {
      setIsUploadingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Evidence Workspace</h2>
            <p className="text-sm text-slate-600 mt-1">
              Upload supporting sources before review so claim grounding and data lineage checks can run.
            </p>
          </div>
          <div className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
            Session {sessionId.slice(0, 8)}
          </div>
        </div>
      </div>

      {isLoadingState ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-3 text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading evidence state...
        </div>
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-800">Claim Evidence Sources</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Supported formats: PDF, DOCX, TXT, CSV, MD, XLSX, XLS.
          </p>

          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold cursor-pointer hover:bg-indigo-700 transition-colors">
            {isUploadingSource ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {isUploadingSource ? 'Uploading...' : 'Upload Source'}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.xlsx,.xls,.docx,.txt,.csv,.md"
              onChange={handleSourceUpload}
              disabled={isUploadingSource || isUploadingExcel}
            />
          </label>

          <div className="mt-4 space-y-2">
            <div className="text-xs text-slate-500">
              Sources uploaded: <span className="font-semibold text-slate-700">{sources.length}</span>
            </div>
            <div className="text-xs text-slate-500">
              Indexed chunks: <span className="font-semibold text-slate-700">{totalIndexedDocs}</span>
            </div>
          </div>

          {sources.length > 0 && (
            <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
              {sources.map((item) => (
                <div
                  key={item.filename}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                >
                  <div className="font-semibold truncate">{item.filename}</div>
                  <div className="text-slate-500">{item.documentsIndexed} indexed chunk(s)</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Excel Lineage Source</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Upload a workbook to validate chart and table values against source data.
          </p>

          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold cursor-pointer hover:bg-emerald-700 transition-colors">
            {isUploadingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {isUploadingExcel ? 'Uploading...' : 'Upload Excel'}
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              disabled={isUploadingSource || isUploadingExcel}
            />
          </label>

          {excelSnapshot && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-800 truncate">{excelSnapshot.filename}</div>
              <div className="text-xs text-emerald-700 mt-1">Sheets: {excelSnapshot.sheets.length}</div>
              <div className="text-xs text-emerald-700">Rows: {excelSnapshot.totalRows}</div>
              {excelSnapshot.sheets.length > 0 && (
                <div className="text-xs text-emerald-700 mt-2 truncate">
                  {excelSnapshot.sheets.slice(0, 5).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-slate-700" />
          <h4 className="text-sm font-bold text-slate-800">Coverage Guidance</h4>
        </div>
        <p className="text-xs text-slate-600">
          For stronger trust scores, upload evidence sources first, then run analysis. Claims without support are
          flagged as grounding issues.
        </p>
      </div>

      {sourceMessage && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{sourceMessage}</div>}
      {excelMessage && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{excelMessage}</div>}
      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{error}</div>}
    </div>
  );
};

export default EvidencePanel;
