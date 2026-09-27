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

  const waivedCount = Object.keys(overrides).length;
  const verdict = published
    ? { tone: 'text-emerald-300', Icon: ShieldCheck, text: `Signed off for delivery in ${targetLanguage}` }
    : staleSignatures
      ? {
          tone: 'text-amber-300',
          Icon: AlertTriangle,
          text: `Signed, but ${openBlocking.length} blocking ${openBlocking.length === 1 ? 'issue has' : 'issues have'} appeared since. The signatures no longer cover this script.`,
        }
      : machinePassed
        ? { tone: 'text-indigo-300', Icon: CheckCircle2, text: 'Automated checks passed. Waiting on a reviewer to sign.' }
        : {
            tone: 'text-rose-300',
            Icon: XCircle,
            text: `${openBlocking.length} blocking ${openBlocking.length === 1 ? 'issue' : 'issues'} to clear before this can ship.`,
          };
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
      on ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
    }`;
  const small =
    'h-[30px] px-2.5 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-200">
      <div className="rounded-[14px] border border-slate-800 bg-slate-900/90 overflow-hidden">
        {/* Summary */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-slate-800">
          <h3 className="text-[15px] font-semibold text-slate-100">QA &amp; sign-off</h3>
          <div className="flex flex-wrap gap-1.5">
            {report.blockingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300">{openBlocking.length} blocking</span>
            )}
            {report.warningCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300">
                {report.warningCount} {report.warningCount === 1 ? 'warning' : 'warnings'}
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300">
              {report.counts.pass} checks passed
            </span>
            {waivedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-700 text-slate-400">{waivedCount} waived</span>
            )}
          </div>
          <span className="ml-auto text-[11.5px] text-slate-500">Checked {relativeTime(report.generatedAt)}</span>
          <button
            type="button"
            onClick={() => {
              setConfig({ ...config });
              flash('Checked again against the current script.');
            }}
            className={small}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-run checks
          </button>
          <button type="button" onClick={() => setIsSettingsOpen((v) => !v)} aria-expanded={isSettingsOpen} className={small}>
            Rules &amp; terms {isSettingsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>

        <p className={`flex items-start gap-2 px-4 py-2.5 border-b border-slate-800 text-[12.5px] ${verdict.tone}`}>
          <verdict.Icon className="w-4 h-4 shrink-0 mt-px" />
          <span>
            {verdict.text}
            <span className="text-slate-500">
              {' '}
              · {fileName ? `${fileName} · ` : ''}
              {report.cueCount} cues
            </span>
          </span>
        </p>

        {/* Rules & terms */}
        {isSettingsOpen && (
          <div className="px-4 py-3.5 border-b border-slate-800 bg-slate-950/40 flex flex-col gap-3.5 animate-in fade-in duration-150">
            <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Limits</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { key: 'maxCps' as const, label: 'Fastest reading speed (cps)', step: 1, min: 8, max: 30 },
                { key: 'minCueSeconds' as const, label: 'Shortest cue (s)', step: 0.1, min: 0.2, max: 3 },
                { key: 'maxCueSeconds' as const, label: 'Longest cue (s)', step: 0.5, min: 3, max: 20 },
                { key: 'maxCharsPerCue' as const, label: 'Most characters per cue', step: 5, min: 30, max: 200 },
              ].map((field) => (
                <label key={field.key} className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] text-slate-400">{field.label}</span>
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
                    className="h-9 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 font-mono text-[13px] text-slate-100 focus:outline-none"
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2.5 text-[12.5px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.flagLatinDigits}
                onChange={(e) => setConfig({ ...config, flagLatinDigits: e.target.checked })}
                className="w-4 h-4 accent-indigo-500"
              />
              Flag English digits (0–9) left in the {targetLanguage}
            </label>
            <GlossaryPanel
              isOpen={isGlossaryOpen}
              onToggle={() => setIsGlossaryOpen((v) => !v)}
              terms={terms}
              targetLanguage={targetLanguage}
              onAdd={addTerm}
              onRemove={removeTerm}
            />
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          {/* Findings */}
          <div className="px-3.5 py-3 flex flex-col gap-2 min-w-0">
            <div role="group" aria-label="Show" className="self-start flex p-0.5 gap-0.5 rounded-[10px] bg-slate-950/60 border border-slate-800">
              {([
                ['all', `All ${report.findings.length}`],
                ['block', `Blocking ${report.blockingCount}`],
                ['warn', `Warnings ${report.warningCount}`],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={chip(filter === id)}>
                  {label}
                </button>
              ))}
            </div>

            {visibleFindings.length === 0 ? (
              <p className="flex items-center gap-2 px-3 py-6 justify-center rounded-xl border border-dashed border-slate-800 text-[12.5px] text-slate-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Nothing flagged here.{report.counts.skipped > 0 ? ' Some checks did not run; see all checks below.' : ''}
              </p>
            ) : (
              visibleFindings.map((finding) => {
                const waived = overrides[finding.id];
                const segment = segmentById.get(String(finding.segmentId));
                const target = segment ? segment.textTarget || segment.targetText || '' : '';
                const source = segment ? segment.textSource || segment.originalText || '' : '';
                const blocking = finding.severity === 'block';
                return (
                  <div
                    key={finding.id}
                    className={`grid grid-cols-[1.5rem_minmax(0,1fr)] sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-3 rounded-xl border ${
                      waived ? 'border-slate-800 bg-slate-950/40 opacity-70' : 'border-slate-800 bg-slate-950/60'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-[7px] flex items-center justify-center ${
                        waived ? 'bg-slate-800 text-slate-400' : blocking ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {waived ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-100">{finding.title}</span>
                        {waived && <span className="text-[10.5px] font-semibold px-1.5 rounded-md bg-slate-800 text-slate-400">Waived</span>}
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{finding.detail}</p>
                      {target && (
                        <p className="mt-2 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[14px] leading-relaxed text-slate-100">
                          <HighlightedTarget text={target} match={finding.match} />
                        </p>
                      )}
                      {source && <p className="mt-1 text-[11.5px] text-slate-500 truncate">{source}</p>}
                      {!waived && finding.fix && (
                        <p className="mt-1.5 text-xs text-emerald-300">
                          Suggested: <span className="text-[13px]">{finding.fix.nextTarget}</span>
                        </p>
                      )}
                      {waived && (
                        <p className="mt-1.5 text-[11.5px] text-slate-400">
                          Waived by {waived.by || 'a reviewer'} {relativeTime(waived.at)}
                          {waived.reason ? `: “${waived.reason}”` : ''}
                        </p>
                      )}
                    </div>
                    <div className="col-start-2 sm:col-start-auto flex sm:flex-col flex-wrap items-center sm:items-end gap-1.5">
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        #{String(finding.cueNumber).padStart(2, '0')} · {formatTimecode(finding.startTime)}
                      </span>
                      {waived ? (
                        <button
                          type="button"
                          onClick={() => {
                            clearOverride(jobId, targetLanguage, finding.id);
                            refresh();
                          }}
                          className={small}
                        >
                          <Undo2 className="w-3.5 h-3.5" /> Restore
                        </button>
                      ) : (
                        <>
                          {finding.fix && (
                            <button type="button" onClick={() => applyFix(finding)} className={`${small} text-emerald-300`}>
                              <Check className="w-3.5 h-3.5" /> {finding.fix.label}
                            </button>
                          )}
                          <button type="button" onClick={() => segment && onJumpToCue(segment)} disabled={!segment} className={small}>
                            Open cue
                          </button>
                          {blocking && (
                            <button
                              type="button"
                              onClick={() => {
                                setOverrideTarget(finding);
                                setOverrideReason('');
                              }}
                              className="text-xs text-slate-400 hover:text-amber-300 px-1 cursor-pointer"
                            >
                              Waive…
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            <details className="mt-1 pt-2.5 border-t border-slate-800 group">
              <summary className="list-none cursor-pointer flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-200 select-none">
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                All {report.rules.length} checks
                {report.counts.skipped > 0 && <span className="text-slate-500">· {report.counts.skipped} not run</span>}
              </summary>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-1.5 mt-2.5">
                {report.rules.map((rule) => {
                  const dot =
                    rule.status === 'pass'
                      ? 'bg-emerald-400'
                      : rule.status === 'warn'
                        ? 'bg-amber-400'
                        : rule.status === 'block'
                          ? 'bg-rose-400'
                          : 'bg-slate-600';
                  return (
                    <div key={rule.id} className="flex items-start gap-2 px-2.5 py-2 rounded-[9px] bg-slate-950/60" title={rule.description}>
                      <span className={`w-[7px] h-[7px] rounded-full mt-1.5 shrink-0 ${dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-slate-200 truncate">{rule.label}</span>
                        <span className="block text-[11px] text-slate-500 leading-snug">{rule.detail}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">{rule.findingCount}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>

          {/* Sign-off */}
          <aside aria-label="Sign-off" className="px-4 py-3.5 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950/40 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Sign-off</span>
              <span className="text-[11.5px] text-slate-400">Each step needs the one before</span>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Signing as</span>
              <input
                type="text"
                value={reviewer}
                placeholder="Your name"
                onChange={(e) => setReviewer(e.target.value)}
                onBlur={() => setReviewerName(reviewer.trim())}
                className="h-9 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 text-[13px] text-slate-100 placeholder-slate-500 focus:outline-none"
              />
            </label>

            {SIGNOFF_STAGES.map((stage, index) => {
              const state = signoff?.stages[stage.id];
              const status = state?.status || 'pending';
              const done = status === 'signed' || status === 'passed';
              const rejected = status === 'rejected';
              const available = stageAvailable(stage.id, signoff);
              const isMachine = stage.id === 'machine';
              return (
                <div
                  key={stage.id}
                  className={`flex flex-col gap-2 p-3 rounded-xl border bg-slate-900 ${
                    rejected ? 'border-rose-500/40' : done && !(isMachine && !machinePassed) ? 'border-emerald-500/30' : 'border-slate-800'
                  } ${!available && !done && !isMachine ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 font-mono text-[11px] ${
                        rejected
                          ? 'bg-rose-500/15 text-rose-300'
                          : isMachine
                            ? machinePassed
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                            : done
                              ? staleSignatures
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                              : 'border border-slate-700 text-slate-400'
                      }`}
                    >
                      {(isMachine ? machinePassed : done) ? <Check className="w-3 h-3" /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">{stage.label}</span>
                      <span className="block text-[11.5px] text-slate-400 leading-snug">
                        {state?.by ? `${state.by} · ${relativeTime(state.at)}` : stage.description}
                        {state?.note ? `: ${state.note}` : ''}
                      </span>
                    </span>
                  </div>

                  {isMachine ? (
                    <span
                      className={`self-start px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        machinePassed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {machinePassed ? 'Passed' : `Blocked by ${openBlocking.length} ${openBlocking.length === 1 ? 'issue' : 'issues'}`}
                    </span>
                  ) : done ? (
                    <span className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          staleSignatures ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {staleSignatures ? 'Out of date' : 'Signed'}
                      </span>
                      {staleSignatures && (
                        <button
                          type="button"
                          onClick={() => {
                            clearStage(jobId, targetLanguage, stage.id);
                            refresh();
                          }}
                          title="Withdraw this signature so it can be given again on the corrected script"
                          className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          Withdraw
                        </button>
                      )}
                    </span>
                  ) : available ? (
                    <>
                      <textarea
                        value={openStage === stage.id ? stageNote : ''}
                        onFocus={() => {
                          if (openStage !== stage.id) {
                            setOpenStage(stage.id);
                            setStageNote('');
                          }
                        }}
                        onChange={(e) => {
                          setOpenStage(stage.id);
                          setStageNote(e.target.value);
                        }}
                        rows={2}
                        placeholder="Note for the record. Needed if you send it back."
                        aria-label={`Note for ${stage.label}`}
                        className="w-full resize-none bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 py-2 text-[12.5px] text-slate-100 placeholder-slate-500 focus:outline-none"
                      />
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenStage(stage.id);
                            handleSign(stage.id);
                          }}
                          className="flex-1 h-[34px] flex items-center justify-center gap-1.5 rounded-[9px] bg-emerald-600 hover:bg-emerald-500 text-white text-[12.5px] font-semibold cursor-pointer"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Sign
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenStage(stage.id);
                            handleReject(stage.id);
                          }}
                          className="h-[34px] px-3 rounded-[9px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[12.5px] font-medium text-rose-300 cursor-pointer"
                        >
                          Send back
                        </button>
                      </span>
                    </>
                  ) : (
                    <span className="self-start px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-700 text-slate-400">
                      {stage.id === 'language-lead' ? 'Clear the blocking issues first' : 'Waiting for the language lead'}
                    </span>
                  )}
                </div>
              );
            })}
          </aside>
        </div>
      </div>

      {/* Waive dialog */}
      {overrideTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setOverrideTarget(null)}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="waive-title" className="w-full max-w-lg rounded-[18px] border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="px-5 pt-5">
              <h4 id="waive-title" className="text-base font-semibold text-slate-100">
                Waive a blocking issue
              </h4>
              <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
                Cue {overrideTarget.cueNumber}: {overrideTarget.title}. It stays on the record with your name and reason.
              </p>
              <label className="flex flex-col gap-1.5 mt-4">
                <span className="text-xs text-slate-400">Reason</span>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="e.g. The client approved the English programme name here."
                  className="w-full resize-none bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[10px] px-3 py-2 text-[13px] text-slate-100 placeholder-slate-500 focus:outline-none"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 mt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setOverrideTarget(null)}
                className="h-9 px-3.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!overrideReason.trim()}
                onClick={confirmOverride}
                className="h-9 px-4 rounded-[10px] bg-amber-500 hover:bg-amber-400 text-slate-950 text-[13px] font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
              >
                Waive and record
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-slate-100 text-slate-950 text-[12.5px] font-medium shadow-2xl">
          <Check className="w-3.5 h-3.5" /> {toast}
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

  const field =
    'h-9 min-w-0 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 text-[13px] text-slate-100 placeholder-slate-500 focus:outline-none';

  return (
    <div className="border-t border-slate-800 pt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 text-left cursor-pointer"
      >
        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Locked terms</span>
        <span className="text-[11.5px] text-slate-400">{terms.length === 0 ? 'none yet' : `${terms.length} set`}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 animate-in fade-in duration-150">
          <p className="text-xs text-slate-400 leading-relaxed">
            Names and terms the checks hold every cue to: either kept exactly as written, or always rendered one approved way.
          </p>

          {terms.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {terms.map((term) => (
                <div key={term.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-2 rounded-[9px] bg-slate-950/60 border border-slate-800">
                  <span className="text-[13px] font-semibold text-slate-100">{term.source}</span>
                  <span
                    className={`text-[10.5px] font-semibold px-1.5 py-px rounded-full ${
                      term.policy === 'keep' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-indigo-500/15 text-indigo-300'
                    }`}
                  >
                    {term.policy === 'keep' ? 'Keep as written' : 'Approved rendering'}
                  </span>
                  {term.target && <span className="text-[13px] text-slate-300">→ {term.target}</span>}
                  {term.forbidden && term.forbidden.length > 0 && (
                    <span className="text-[11.5px] text-rose-300">not {term.forbidden.join(', ')}</span>
                  )}
                  <span className="text-[11px] text-slate-500">{term.language ? `${term.language} only` : 'every language'}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(term.id)}
                    aria-label={`Remove ${term.source}`}
                    className="ml-auto p-1 rounded-md text-slate-500 hover:text-rose-300 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5 p-3 rounded-xl border border-dashed border-slate-700">
            <div role="group" aria-label="Kind of term" className="self-start flex p-0.5 gap-0.5 rounded-[9px] bg-slate-950/60 border border-slate-800">
              {([
                ['keep', 'Keep as written'],
                ['prefer', 'Approved rendering'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={policy === id}
                  onClick={() => setPolicy(id)}
                  className={`px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors cursor-pointer ${
                    policy === id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={policy === 'keep' ? 'Term, e.g. Inner Engineering' : 'Idea, e.g. technique'}
                aria-label="Term"
                className={field}
              />
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={policy === 'keep' ? 'Written as (blank = unchanged)' : `Approved ${targetLanguage} word`}
                aria-label="Written as"
                className={field}
              />
              {policy === 'prefer' ? (
                <input
                  type="text"
                  value={forbidden}
                  onChange={(e) => setForbidden(e.target.value)}
                  placeholder="Words to reject, comma separated"
                  aria-label="Words to reject"
                  className={field}
                />
              ) : (
                <label className="flex items-center gap-2 text-[12.5px] text-slate-400 px-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopeToLanguage}
                    onChange={(e) => setScopeToLanguage(e.target.checked)}
                    className="w-3.5 h-3.5 accent-indigo-500"
                  />
                  Only in {targetLanguage}
                </label>
              )}
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={!canAdd}
              className="self-start h-[30px] px-3 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add term
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
