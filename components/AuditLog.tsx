import React, { useState, useEffect } from 'react';
import { History, FileText, User, Activity, Clock } from 'lucide-react';
import { apiService } from '../services/apiService';

interface AuditLogProps {
  sessionId: string;
}

interface AuditLogEntry {
  timestamp: string;
  user_role: string;
  action: string;
  details: Record<string, unknown>;
}

const AuditLog: React.FC<AuditLogProps> = ({ sessionId }) => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchLog = async () => {
      try {
        const data = await apiService.getAuditLog(sessionId);
        if (!active) return;
        setEntries([...data.entries].reverse());
        setError(null);
      } catch (err) {
        console.error(err);
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        if (active) setLoading(false);
      }
    };
    
    fetchLog();
    const interval = setInterval(fetchLog, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sessionId]);

  const copyToClipboard = async () => {
    const text = entries.map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.user_role.toUpperCase()}: ${e.action} - ${JSON.stringify(e.details)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage('Audit log copied to clipboard.');
      window.setTimeout(() => setCopyMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy audit log');
    }
  };

  if (loading) return <div className="p-8 text-center"><Activity className="animate-spin mx-auto mb-2" /> Loading Audit Trail...</div>;

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      <div className="p-8 max-w-5xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
             <History className="w-8 h-8 text-slate-400" />
              <div>
                <h1 className="text-2xl font-black text-slate-800 tracking-tight">Engagement Audit Trail</h1>
                <p className="text-sm text-slate-500 font-medium italic">Immutable record of all evaluator decisions</p>
              </div>
          </div>
          <button 
            onClick={copyToClipboard}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all active:scale-95"
          >
            <Activity className="w-4 h-4" /> Copy to Clipboard
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}
        {copyMessage && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-green-700 text-sm">
            {copyMessage}
          </div>
        )}

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Evaluator</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <Clock className="w-3 h-3" />
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                       <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                         entry.user_role === 'senior' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'
                       }`}>
                         {entry.user_role[0].toUpperCase()}
                       </div>
                       <span className="text-xs font-bold text-slate-700 capitalize">{entry.user_role}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-tight ${
                      entry.action === 'SIGN_GUARDRAIL' ? 'bg-green-100 text-green-700' :
                      entry.action === 'OVERRIDE' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs text-slate-500 font-medium max-w-xs truncate">
                       {JSON.stringify(entry.details)}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && (
            <div className="p-12 text-center text-slate-400 italic text-sm">
              No events recorded for this session yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditLog;
