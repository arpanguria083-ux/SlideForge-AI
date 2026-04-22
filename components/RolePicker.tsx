import React from 'react';
import { ArrowRight, ShieldCheck, UserRound } from 'lucide-react';

interface RolePickerProps {
  onSelect: (role: 'junior' | 'senior') => void;
}

const RolePicker: React.FC<RolePickerProps> = ({ onSelect }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-md">
      <div className="w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/50 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.22)] animate-in fade-in zoom-in duration-300">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
          <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-8 py-10 lg:border-b-0 lg:border-r lg:px-10 lg:py-12">
            <div className="space-y-8">
              <div>
                <div className="sf-eyebrow">Choose workspace access</div>
                <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
                  Start in the mode that matches your review responsibilities.
                </h1>
                <p className="mt-4 max-w-xl text-base leading-8 text-slate-600">
                  Consultants get a focused day-to-day workspace for slide review. Senior reviewers unlock final approval,
                  sign-off, and packaging controls.
                </p>
              </div>

              <div className="grid gap-4">
                {[
                  ['Clearer review flow', 'Keep attention on slide quality, recommendations, and delivery readiness.'],
                  ['Calmer defaults', 'Open advanced or administrative controls only when they are actually needed.'],
                  ['Easy to switch later', 'The selected mode sets the default workspace, not a permanent account policy.'],
                ].map(([title, copy]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-900">{title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recommended default</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Most users should start in the consultant workspace and switch to senior mode only for final review.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white px-8 py-10 lg:px-10 lg:py-12">
            <div className="space-y-4">
              <button
                onClick={() => onSelect('junior')}
                className="group w-full rounded-[1.6rem] border border-slate-200 bg-slate-50 p-6 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-lg active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-200">
                      <UserRound className="h-6 w-6" />
                    </div>
                    <h2 className="mt-5 text-2xl font-semibold text-slate-950">Consultant workspace</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      Best for daily deck review, issue resolution, evidence collection, and annotated exports.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
                      <span className="rounded-full bg-white px-3 py-1.5">Resolve recommendations</span>
                      <span className="rounded-full bg-white px-3 py-1.5">Review slides quickly</span>
                      <span className="rounded-full bg-white px-3 py-1.5">Export working drafts</span>
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-slate-600" />
                </div>
              </button>

              <button
                onClick={() => onSelect('senior')}
                className="group w-full rounded-[1.6rem] border border-indigo-200 bg-[linear-gradient(180deg,rgba(238,242,255,0.9)_0%,rgba(248,250,252,0.95)_100%)] p-6 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex rounded-full border border-indigo-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
                      Approval controls included
                    </div>
                    <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <h2 className="mt-5 text-2xl font-semibold text-slate-950">Senior reviewer workspace</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      Best for final QA, standards approval, sign-off, and packaging the client-ready handoff.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
                      <span className="rounded-full bg-white px-3 py-1.5">Review audit history</span>
                      <span className="rounded-full bg-white px-3 py-1.5">Record sign-off</span>
                      <span className="rounded-full bg-white px-3 py-1.5">Finalize delivery package</span>
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-5 w-5 text-indigo-300 transition-transform group-hover:translate-x-1 group-hover:text-indigo-600" />
                </div>
              </button>
            </div>

            <p className="mt-6 text-xs leading-6 text-slate-500">
              Workspace mode affects the default controls shown in the app and can be changed later from local storage-backed settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RolePicker;
