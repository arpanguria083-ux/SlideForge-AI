import React from 'react';
import { Columns, Minus, Plus, AlertCircle } from 'lucide-react';

interface Rule {
  id: string;
  text: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}

interface GuardrailDiffProps {
  oldRules: Rule[];
  newRules: Rule[];
}

const GuardrailDiff: React.FC<GuardrailDiffProps> = ({ oldRules, newRules }) => {
  return (
    <div className="flex flex-col h-full bg-slate-50/50">
       <div className="p-8 max-w-6xl mx-auto w-full space-y-8">
          <div className="flex items-center gap-3">
             <Columns className="w-8 h-8 text-slate-400" />
             <div>
               <h1 className="text-2xl font-black text-slate-800 tracking-tight">Configuration Diff</h1>
               <p className="text-sm text-slate-500 font-medium italic">Comparing current engagement rules with global playbook</p>
             </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            {/* Version A */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                 <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Global Playbook (v1.2)</span>
                 <span className="text-[10px] font-bold text-slate-400">BASELINE</span>
              </div>
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
                 {oldRules.map((rule, i) => (
                   <div key={i} className={`p-4 border-b border-slate-100 flex items-start gap-3 ${rule.status === 'removed' ? 'bg-red-50/30' : ''}`}>
                      <div className={`mt-1 flex-shrink-0 ${rule.status === 'removed' ? 'text-red-400' : 'text-slate-300'}`}>
                        {rule.status === 'removed' ? <Minus className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      </div>
                      <p className={`text-xs font-semibold ${rule.status === 'removed' ? 'text-red-400 line-through' : 'text-slate-600'}`}>
                        {rule.text}
                      </p>
                   </div>
                 ))}
              </div>
            </div>

            {/* Version B */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                 <span className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">Engagement Config (Draft)</span>
                 <span className="text-[10px] font-bold text-indigo-400">PROPOSED</span>
              </div>
              <div className="bg-white rounded-3xl border-2 border-indigo-200 shadow-xl shadow-indigo-50 overflow-hidden min-h-[400px]">
                 {newRules.map((rule, i) => (
                   <div key={i} className={`p-4 border-b border-indigo-50 flex items-start gap-3 ${rule.status === 'added' ? 'bg-indigo-50/50' : ''}`}>
                      <div className={`mt-1 flex-shrink-0 ${rule.status === 'added' ? 'text-indigo-500' : 'text-slate-300'}`}>
                        {rule.status === 'added' ? <Plus className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      </div>
                      <p className={`text-xs font-bold ${rule.status === 'added' ? 'text-indigo-600' : 'text-slate-600'}`}>
                        {rule.text}
                      </p>
                   </div>
                 ))}
              </div>
            </div>
          </div>

          <div className="bg-indigo-600 p-8 rounded-[2rem] text-white shadow-2xl shadow-indigo-100">
             <div className="space-y-1">
               <h3 className="text-xl font-black tracking-tight">Diff Review</h3>
               <p className="text-sm font-medium text-indigo-100">
                 This view is read-only. Signing the current session guardrail remains the authoritative approval action.
               </p>
             </div>
          </div>
       </div>
    </div>
  );
};

export default GuardrailDiff;
