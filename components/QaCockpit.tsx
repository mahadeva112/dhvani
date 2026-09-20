import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileWarning,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Trash2,
  Undo2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { AudioSegment } from '../types';
import {
  QaFinding,
  QaReport,
  formatTimecode,
  runQa,
  useQaConfig,
} from '../services/qaService';
import { GlossaryTerm, useGlossaryTerms } from '../services/glossaryService';
import {
  JobSignoff,
  SIGNOFF_STAGES,
  SignoffStageId,
  clearOverride,
  clearStage,
  getReviewerName,
  invalidateHumanStages,
  overrideFinding,
  recordMachineResult,
  rejectStage,
  setReviewerName,
  signStage,
  useSignoff,
} from '../services/signoffService';

interface QaCockpitProps {
  jobId: string;
  fileName?: string;
  segments: AudioSegment[];
  targetLanguage: string;
  onUpdateSegment: (id: string | number, updates: Partial<AudioSegment>) => void;
  /** Move the player and the cue list to this cue. */
  onJumpToCue: (segment: AudioSegment) => void;
}

const relativeTime = (at?: number): string => {
  if (!at) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
};

/** Target text with the flagged substring marked, so the eye lands on it. */
const HighlightedTarget: React.FC<{ text: string; match?: string }> = ({ text, match }) => {
  if (!match) return <>{text}</>;
  const index = text.toLowerCase().indexOf(match.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-rose-500/25 text-rose-200 rounded px-1 border-b-2 border-rose-500">
        {text.slice(index, index + match.length)}
      </mark>
      {text.slice(index + match.length)}
    </>
  );
};

export const QaCockpit: React.FC<QaCockpitProps> = ({
  jobId,
  fileName,
  segments,
  targetLanguage,
  onUpdateSegment,
  onJumpToCue,
}) => {
  const { terms, add: addTerm, remove: removeTerm } = useGlossaryTerms();
  const { signoff, refresh } = useSignoff(jobId, targetLanguage);
  const [config, setConfig] = useQaConfig();
  const [filter, setFilter] = useState<'all' | 'block' | 'warn'>('all');
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<QaFinding | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [reviewer, setReviewer] = useState<string>(() => getReviewerName());
  const [stageNote, setStageNote] = useState('');
  const [openStage, setOpenStage] = useState<SignoffStageId | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const report: QaReport = useMemo(
    () => runQa(segments, { language: targetLanguage, glossary: terms, config }),
    [segments, targetLanguage, terms, config]
  );

  const overrides = signoff?.overrides || {};
  const openBlocking = useMemo(
    () => report.findings.filter((f) => f.severity === 'block' && !overrides[f.id]),
    [report.findings, overrides]
  );
  const machinePassed = openBlocking.length === 0;

  /* The automated stage is not signed by anyone — it simply reflects the last
     run of the checks, so it is recorded rather than clicked. */
  useEffect(() => {
    if (!jobId) return;
    const note = machinePassed
      ? `${report.counts.pass} checks passed, ${report.warningCount} warnings`
      : `${openBlocking.length} blocking ${openBlocking.length === 1 ? 'issue' : 'issues'}`;
    recordMachineResult(jobId, targetLanguage, machinePassed, note);
    refresh();
    // Re-recorded only when the verdict itself moves, never on every render.
  }, [jobId, targetLanguage, machinePassed, openBlocking.length, report.warningCount, report.counts.pass, refresh]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const segmentById = useMemo(() => {
    const map = new Map<string, AudioSegment>();
    segments.forEach((s) => map.set(String(s.id), s));
    return map;
  }, [segments]);

  const visibleFindings = useMemo(
    () => report.findings.filter((f) => (filter === 'all' ? true : f.severity === filter)),
    [report.findings, filter]
  );

  const applyFix = (finding: QaFinding) => {
    if (!finding.fix) return;
    onUpdateSegment(finding.segmentId, {
      textTarget: finding.fix.nextTarget,
      targetText: finding.fix.nextTarget,
    });
    invalidateHumanStages(jobId, targetLanguage);
    refresh();
    flash(`Cue ${finding.cueNumber} corrected — signatures cleared for re-review.`);
  };

  const confirmOverride = () => {
    if (!overrideTarget) return;
    const who = reviewer.trim() || 'Unnamed reviewer';
    overrideFinding(jobId, targetLanguage, overrideTarget.id, who, overrideReason.trim());
    setReviewerName(who);
    refresh();
    setOverrideTarget(null);
    setOverrideReason('');
    flash(`Cue ${overrideTarget.cueNumber} waived — recorded against ${who}.`);
  };

  const handleSign = (stage: SignoffStageId) => {
    const who = reviewer.trim();
    if (!who) {
      flash('Add your name first — a signature needs someone behind it.');
      return;
    }
    setReviewerName(who);
    signStage(jobId, targetLanguage, stage, who, stageNote.trim() || undefined);
    refresh();
    setOpenStage(null);
    setStageNote('');
    flash(`Signed as ${who}.`);
  };

  const handleReject = (stage: SignoffStageId) => {
    const who = reviewer.trim() || 'Unnamed reviewer';
    if (!stageNote.trim()) {
      flash('Say what needs fixing — a rejection without a reason is not useful.');
      return;
    }
    setReviewerName(who);
    rejectStage(jobId, targetLanguage, stage, who, stageNote.trim());
    refresh();
    setOpenStage(null);
    setStageNote('');
    flash('Sent back with your note attached.');
  };

  const stageAvailable = (stage: SignoffStageId, s: JobSignoff | null): boolean => {
    if (!s) return false;
    if (stage === 'machine') return false;
    if (stage === 'language-lead') return s.stages.machine.status === 'passed';
    return s.stages['language-lead'].status === 'signed';
  };

  const fullySigned =
    signoff?.stages['language-lead'].status === 'signed' &&
    signoff?.stages.compliance.status === 'signed';
  /*
    Signatures alone are not a clearance. A rule can be tightened, or the
    glossary extended, after everyone has signed — the file is then signed and
    blocked at the same time, and saying "signed off" would be a lie.
  */
  const published = fullySigned && machinePassed;
  const staleSignatures = fullySigned && !machinePassed;

  return (
    <div className="space-y-3.5 animate-in fade-in duration-200">
      {/* ---------------------------------------------------------------- */}
      {/* Verdict banner                                                     */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 flex flex-wrap items-center gap-4 shadow-sm ${
          published
            ? 'bg-emerald-950/50 border-emerald-700/70'
            : machinePassed
            ? 'bg-slate-900/80 border-slate-800'
            : 'bg-rose-950/40 border-rose-800/70'
        }`}
      >
        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
            published
              ? 'bg-emerald-500/20 text-emerald-300'
              : machinePassed
              ? 'bg-indigo-500/20 text-indigo-300'
              : 'bg-rose-500/20 text-rose-300'
          }`}
        >
          {published ? (
            <ShieldCheck className="w-5 h-5" />
          ) : machinePassed ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <XCircle className="w-5 h-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm sm:text-base font-bold text-white">
            {published
              ? `Signed off for delivery in ${targetLanguage}`
              : staleSignatures
              ? `Signed, but ${openBlocking.length} blocking ${
                  openBlocking.length === 1 ? 'issue has' : 'issues have'
                } appeared since — the signatures no longer cover this script`
              : machinePassed
              ? `Automated QA passed — waiting on a human signature`
              : `${openBlocking.length} blocking ${
                  openBlocking.length === 1 ? 'issue' : 'issues'
                } before this can ship`}
          </h3>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-1 leading-relaxed">
            {fileName ? `${fileName} · ` : ''}
            {report.cueCount} cues · {report.counts.pass} checks passed ·{' '}
            {report.warningCount} warnings ·{' '}
            {Object.keys(overrides).length > 0
              ? `${Object.keys(overrides).length} waived`
              : 'nothing waived'}{' '}
            · checked {relativeTime(report.generatedAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSettingsOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Thresholds</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConfig({ ...config });
              flash('Checks re-run against the current script.');
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-run checks</span>
          </button>
        </div>
      </div>

      {/* Threshold editor */}
      {isSettingsOpen && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3.5 animate-in fade-in duration-150">
          {[
            { key: 'maxCps' as const, label: 'Max reading speed (cps)', step: 1, min: 8, max: 30 },
            { key: 'minCueSeconds' as const, label: 'Min cue length (s)', step: 0.1, min: 0.2, max: 3 },
            { key: 'maxCueSeconds' as const, label: 'Max cue length (s)', step: 0.5, min: 3, max: 20 },
            { key: 'maxCharsPerCue' as const, label: 'Max characters per cue', step: 5, min: 30, max: 200 },
          ].map((field) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400">{field.label}</span>
              <input
                type="number"
                value={config[field.key]}
                step={field.step}
                min={field.min}
                max={field.max}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setConfig({ ...config, [field.key]: value });
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </label>
          ))}
          <label className="flex items-center gap-2.5 col-span-2 sm:col-span-4 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={config.flagLatinDigits}
              onChange={(e) => {
                setConfig({ ...config, flagLatinDigits: e.target.checked });
              }}
              className="w-4 h-4 accent-indigo-500"
            />
            <span>Flag Latin numerals (0-9) left in the target script</span>
          </label>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Rule board                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center gap-2.5 mb-3.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Automated checks
          </h4>
          <span className="text-[11px] text-emerald-400 font-semibold">{report.counts.pass} pass</span>
          <span className="text-[11px] text-amber-400 font-semibold">{report.counts.warn} warn</span>
          <span className="text-[11px] text-rose-400 font-semibold">{report.counts.block} block</span>
          {report.counts.skipped > 0 && (
            <span className="text-[11px] text-slate-500 font-semibold">
              {report.counts.skipped} not run
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {report.rules.map((rule) => {
            const tone =
              rule.status === 'pass'
                ? 'text-emerald-400'
                : rule.status === 'warn'
                ? 'text-amber-400'
                : rule.status === 'block'
                ? 'text-rose-400'
                : 'text-slate-500';
            const Icon =
              rule.status === 'pass'
                ? CheckCircle2
                : rule.status === 'warn'
                ? AlertTriangle
                : rule.status === 'block'
                ? XCircle
                : SkipForward;
            return (
              <div
                key={rule.id}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80"
                title={rule.description}
              >
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${tone}`} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{rule.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{rule.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Findings                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center gap-2.5 mb-3.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Flagged cues
          </h4>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {([
              { id: 'all' as const, label: `All ${report.findings.length}` },
              { id: 'block' as const, label: `Blocking ${report.blockingCount}` },
              { id: 'warn' as const, label: `Warnings ${report.warningCount}` },
            ]).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  filter === chip.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {visibleFindings.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-6 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-xs text-slate-400">
              Nothing flagged in this view. {report.counts.skipped > 0 && 'Some checks did not run — see the board above for why.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[32rem] overflow-y-auto pr-1">
            {visibleFindings.map((finding) => {
              const waived = overrides[finding.id];
              const segment = segmentById.get(String(finding.segmentId));
              const target = segment ? segment.textTarget || segment.targetText || '' : '';
              const source = segment ? segment.textSource || segment.originalText || '' : '';
              const blocking = finding.severity === 'block';
              return (
                <div
                  key={finding.id}
                  className={`rounded-xl border p-3.5 transition-all ${
                    waived
                      ? 'border-slate-800 bg-slate-950/40 opacity-70'
                      : blocking
                      ? 'border-rose-800/70 bg-rose-950/20'
                      : 'border-amber-800/60 bg-amber-950/10'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                      {finding.cueNumber}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {formatTimecode(finding.startTime)} → {formatTimecode(finding.endTime)}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        waived
                          ? 'bg-slate-700 text-slate-300'
                          : blocking
                          ? 'bg-rose-600 text-white'
                          : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {waived ? 'waived' : blocking ? 'blocked' : 'warning'}
                    </span>
                    <span className="text-xs font-semibold text-slate-100 min-w-0">
                      {finding.title}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{finding.detail}</p>

                  {source && (
                    <p className="text-[11px] text-slate-500 mt-2.5 leading-relaxed italic">{source}</p>
                  )}
                  {target && (
                    <p className="text-sm text-slate-100 mt-1.5 leading-relaxed">
                      <HighlightedTarget text={target} match={finding.match} />
                    </p>
                  )}

                  {waived ? (
                    <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-slate-400">
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      <span>
                        Waived by <strong className="text-slate-200">{waived.by}</strong>{' '}
                        {relativeTime(waived.at)}
                        {waived.reason ? ` — “${waived.reason}”` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          clearOverride(jobId, targetLanguage, finding.id);
                          refresh();
                        }}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-semibold transition-all cursor-pointer"
                      >
                        <Undo2 className="w-3 h-3" />
                        <span>Restore</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {finding.fix && (
                        <button
                          type="button"
                          onClick={() => applyFix(finding)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>{finding.fix.label}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => segment && onJumpToCue(segment)}
                        disabled={!segment}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-semibold transition-all disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronRight className="w-3 h-3" />
                        <span>Open cue</span>
                      </button>
                      {blocking && (
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideTarget(finding);
                            setOverrideReason('');
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-transparent hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700 text-[11px] font-semibold transition-all cursor-pointer"
                        >
                          <FileWarning className="w-3 h-3" />
                          <span>Waive with reason</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Locked terms                                                       */}
      {/* ---------------------------------------------------------------- */}
      <GlossaryPanel
        isOpen={isGlossaryOpen}
        onToggle={() => setIsGlossaryOpen((v) => !v)}
        terms={terms}
        targetLanguage={targetLanguage}
        onAdd={addTerm}
        onRemove={removeTerm}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Sign-off chain                                                     */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Sign-off chain
          </h4>
          <label className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] text-slate-500">Signing as</span>
            <input
              type="text"
              value={reviewer}
              placeholder="Your name"
              onChange={(e) => setReviewer(e.target.value)}
              onBlur={() => setReviewerName(reviewer.trim())}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white w-44 focus:outline-none focus:border-indigo-500"
            />
          </label>
        </div>

        <div className="space-y-2">
          {SIGNOFF_STAGES.map((stage, index) => {
            const state = signoff?.stages[stage.id];
            const status = state?.status || 'pending';
            const done = status === 'signed' || status === 'passed';
            const rejected = status === 'rejected';
            const available = stageAvailable(stage.id, signoff);
            return (
              <div
                key={stage.id}
                className={`rounded-xl border p-3.5 ${
                  rejected
                    ? 'border-rose-800/70 bg-rose-950/20'
                    : done
                    ? 'border-emerald-800/60 bg-emerald-950/15'
                    : 'border-slate-800 bg-slate-950/50'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                      rejected
                        ? 'bg-rose-600 text-white'
                        : done
                        ? 'bg-emerald-500 text-slate-950'
                        : available
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : index + 1}
                  </span>

                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-100">{stage.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {state?.by ? `${state.by} · ` : ''}
                      {state?.at ? relativeTime(state.at) : stage.description}
                      {state?.note ? ` — ${state.note}` : ''}
                    </div>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    {stage.id === 'machine' ? (
                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                          machinePassed
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {machinePassed ? 'passed' : 'blocked'}
                      </span>
                    ) : done ? (
                      <>
                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                            staleSignatures
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {staleSignatures ? 'stale' : 'signed'}
                        </span>
                        {staleSignatures && (
                          <button
                            type="button"
                            onClick={() => {
                              clearStage(jobId, targetLanguage, stage.id);
                              refresh();
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-semibold transition-all cursor-pointer"
                            title="Withdraw this signature so it can be given again on the corrected script"
                          >
                            <Undo2 className="w-3 h-3" />
                            <span>Withdraw</span>
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={!available}
                        onClick={() => {
                          setOpenStage(openStage === stage.id ? null : stage.id);
                          setStageNote('');
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-[11px] font-bold transition-all disabled:cursor-not-allowed cursor-pointer"
                        title={
                          available
                            ? `Sign as ${stage.label}`
                            : stage.id === 'language-lead'
                            ? 'Clear the blocking issues first'
                            : 'The language lead signs first'
                        }
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </button>
                    )}
                  </div>
                </div>

                {openStage === stage.id && available && !done && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5 animate-in fade-in duration-150">
                    <textarea
                      value={stageNote}
                      onChange={(e) => setStageNote(e.target.value)}
                      rows={2}
                      placeholder="Optional note for the record — required if you send it back."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSign(stage.id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Sign as {stage.label}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(stage.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-transparent hover:bg-slate-800 text-rose-300 border border-rose-800/70 text-xs font-semibold transition-all cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Send back</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Waive dialog */}
      {overrideTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h4 className="text-sm font-bold text-white">Waive a blocking issue</h4>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Cue {overrideTarget.cueNumber} — {overrideTarget.title}. Waiving keeps the finding on
              the record with your name and reason against it.
            </p>
            <label className="block mt-4">
              <span className="text-[11px] font-semibold text-slate-400">Reason</span>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
                placeholder="e.g. Client approved the English programme name in this context."
                className="mt-1.5 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-indigo-500"
              />
            </label>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setOverrideTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!overrideReason.trim()}
                onClick={confirmOverride}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-bold transition-all active:scale-95 disabled:cursor-not-allowed cursor-pointer"
              >
                Waive and record
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-slate-900 border border-slate-700 text-xs text-white shadow-2xl animate-in slide-in-from-bottom-4">
          {toast}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Locked terms panel                                                  */
/* ------------------------------------------------------------------ */

interface GlossaryPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  terms: GlossaryTerm[];
  targetLanguage: string;
  onAdd: (term: Omit<GlossaryTerm, 'id'>) => void;
  onRemove: (id: string) => void;
}

const GlossaryPanel: React.FC<GlossaryPanelProps> = ({
  isOpen,
  onToggle,
  terms,
  targetLanguage,
  onAdd,
  onRemove,
}) => {
  const [source, setSource] = useState('');
  const [policy, setPolicy] = useState<'keep' | 'prefer'>('keep');
  const [target, setTarget] = useState('');
  const [forbidden, setForbidden] = useState('');
  const [scopeToLanguage, setScopeToLanguage] = useState(false);

  const canAdd =
    source.trim() !== '' && (policy === 'keep' || (target.trim() !== '' && forbidden.trim() !== ''));

  const submit = () => {
    if (!canAdd) return;
    onAdd({
      source: source.trim(),
      policy,
      target: target.trim() || undefined,
      forbidden:
        policy === 'prefer'
          ? forbidden
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
          : undefined,
      language: scopeToLanguage || policy === 'prefer' ? targetLanguage : '',
    });
    setSource('');
    setTarget('');
    setForbidden('');
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer"
      >
        <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Locked terms
        </span>
        <span className="text-[11px] text-slate-500">{terms.length} defined</span>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 ml-auto transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 animate-in fade-in duration-150">
          {terms.length > 0 && (
            <div className="space-y-1.5">
              {terms.map((term) => (
                <div
                  key={term.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800/80"
                >
                  <span className="text-xs font-semibold text-slate-100">{term.source}</span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      term.policy === 'keep'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-indigo-500/15 text-indigo-300'
                    }`}
                  >
                    {term.policy === 'keep' ? 'do not translate' : 'house term'}
                  </span>
                  {term.target && <span className="text-xs text-slate-300">→ {term.target}</span>}
                  {term.forbidden && term.forbidden.length > 0 && (
                    <span className="text-[11px] text-rose-300/80">
                      not: {term.forbidden.join(', ')}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">
                    {term.language ? term.language : 'all languages'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(term.id)}
                    aria-label={`Remove ${term.source}`}
                    className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2.5">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 w-fit">
              <button
                type="button"
                onClick={() => setPolicy('keep')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  policy === 'keep'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                Do not translate
              </button>
              <button
                type="button"
                onClick={() => setPolicy('prefer')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  policy === 'prefer'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                House rendering
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={policy === 'keep' ? 'Term in the source, e.g. Sadhguru' : 'Concept, e.g. technique'}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={
                  policy === 'keep'
                    ? 'Must appear as (blank = unchanged)'
                    : `Approved ${targetLanguage} rendering`
                }
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              {policy === 'prefer' ? (
                <input
                  type="text"
                  value={forbidden}
                  onChange={(e) => setForbidden(e.target.value)}
                  placeholder="Rejected renderings, comma separated"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              ) : (
                <label className="flex items-center gap-2 text-[11px] text-slate-400 px-1">
                  <input
                    type="checkbox"
                    checked={scopeToLanguage}
                    onChange={(e) => setScopeToLanguage(e.target.checked)}
                    className="w-3.5 h-3.5 accent-indigo-500"
                  />
                  <span>{targetLanguage} only</span>
                </label>
              )}
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={!canAdd}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold transition-all active:scale-95 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add term</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
