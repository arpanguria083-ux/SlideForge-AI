import React from 'react';

interface TermsModalProps {
  open: boolean;
  accepted: boolean;
  onAccept: () => void;
}

const TermsModal: React.FC<TermsModalProps> = ({ open, accepted, onAccept }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 px-4 py-6">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-bold text-slate-900">Terms and Privacy Notice</h2>
          <p className="mt-1 text-sm text-slate-600">
            You must accept these terms before using SlideForge.
          </p>
        </div>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto px-6 py-5 text-sm text-slate-700">
          <section>
            <h3 className="mb-2 font-semibold text-slate-900">Terms and Conditions</h3>
            <p>
              SlideForge provides AI-assisted review outputs that may contain errors. You are solely
              responsible for validating all outputs before use. Do not upload data unless you are
              authorized to process it. Use of third-party model providers is governed by their terms.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-slate-900">Privacy Notice</h3>
            <p>
              SlideForge may store operational artifacts locally (sessions, logs, history, and generated
              files). If you configure remote model endpoints, uploaded content may be transmitted to those
              providers according to your configuration.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-slate-900">Full Text References</h3>
            <ul className="list-disc space-y-1 pl-5 text-slate-600">
              <li>`legal/TERMS_AND_CONDITIONS.md`</li>
              <li>`legal/PRIVACY_NOTICE.md`</li>
            </ul>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <p className="text-xs text-slate-500">
            Acceptance is stored locally on this device.
          </p>
          <button
            onClick={onAccept}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
          >
            {accepted ? 'Continue' : 'I Accept'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
