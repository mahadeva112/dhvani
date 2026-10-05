import React from 'react';
import { Pencil, Plus, Trash2, FolderOpen } from 'lucide-react';
import { BatchJob } from '../types';
import { jobStage, projectName, projectWhen, StageKind } from '../services/projects';
import { ProjectNameField } from './ProjectNameField';

/** How many projects the menu lists; the rest are in Your projects. */
const MENU_LIMIT = 8;

const stageDot: Record<StageKind, { dot: string; label: string }> = {
  dubbed: { dot: 'bg-emerald-400', label: 'Dubbed' },
  review: { dot: 'bg-indigo-400', label: 'In review' },
  working: { dot: 'bg-cyan-400 animate-pulse', label: 'Working' },
  waiting: { dot: 'bg-slate-600', label: 'Not started' },
  error: { dot: 'bg-rose-400', label: 'Failed' },
};

interface ProjectsMenuProps {
  projects: BatchJob[];
  activeJobId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onNewDub?: () => void;
  onSeeAll?: () => void;
  onClose: () => void;
}

/** The header's projects menu: switch, rename or delete a recent project, or start a new one. */
export const ProjectsMenu: React.FC<ProjectsMenuProps> = ({
  projects,
  activeJobId,
  onSelect,
  onRename,
  onRemove,
  onNewDub,
  onSeeAll,
  onClose,
}) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  // Deleting loses the project's file, translation and dub, so it asks first.
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const shown = projects.slice(0, MENU_LIMIT);

  return (
    <div
      role="dialog"
      aria-label="Your projects"
      className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-28 sm:top-auto sm:mt-2 sm:w-[23rem] p-2 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl z-50 flex flex-col animate-in fade-in zoom-in-95"
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
        <span className="text-[13px] font-semibold text-slate-100">
          Your projects <span className="font-normal text-slate-500 tabular-nums">· {projects.length}</span>
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="px-2 py-6 text-center text-[12.5px] text-slate-400">No projects yet. Drop a file to start your first dub.</p>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-[min(26rem,60vh)] overflow-y-auto custom-scrollbar">
          {shown.map((job) => {
            const name = projectName(job);
            const isOpen = job.id === activeJobId;
            const stage = stageDot[jobStage(job).kind];
            const when = projectWhen(job);
            return (
              <div key={job.id}>
                <div
                  className={`group flex items-center gap-2.5 px-2 py-2 rounded-[10px] transition-colors ${
                    isOpen ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/40' : 'hover:bg-slate-800/60'
                  } ${editingId === job.id ? '' : 'cursor-pointer'}`}
                  onClick={() => {
                    if (editingId === job.id) return;
                    if (!isOpen) onSelect(job.id);
                    onClose();
                  }}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${stage.dot}`} title={stage.label} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    {editingId === job.id ? (
                      <ProjectNameField
                        initial={name}
                        onSave={(next) => {
                          onRename(job.id, next);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px] font-semibold text-slate-100 truncate" title={name}>
                          {name}
                        </span>
                        {isOpen && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 rounded-md bg-indigo-500/15 text-indigo-300">
                            Open
                          </span>
                        )}
                      </span>
                    )}
                    <span className="block text-[11.5px] text-slate-400 truncate">
                      {[`${job.detectedLanguage || job.sourceLanguage || 'Auto'} → ${job.language}`, stage.label, when]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {editingId !== job.id && (
                    <span className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmId(null);
                          setEditingId(job.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
                        aria-label={`Rename ${name}`}
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(null);
                          setConfirmId(job.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-rose-300 hover:bg-slate-800 cursor-pointer"
                        aria-label={`Delete ${name}`}
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                {confirmId === job.id && (
                  <div className="flex flex-wrap items-center gap-2 mx-1 my-1 px-2.5 py-2 rounded-[9px] bg-rose-500/10 text-[12.5px] text-slate-200">
                    <span className="min-w-0 flex-1">
                      Delete <span className="font-semibold">{name}</span>? Its file, translation and dub are gone for good.
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="h-7 px-2.5 rounded-md text-xs font-semibold text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onRemove(job.id);
                        setConfirmId(null);
                      }}
                      className="h-7 px-2.5 rounded-md bg-rose-500 hover:bg-rose-400 text-xs font-semibold text-white cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-2 pt-2 px-1 border-t border-slate-800">
        {onSeeAll ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onSeeAll();
            }}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] text-[12.5px] font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {projects.length > MENU_LIMIT ? `See all ${projects.length} projects` : 'See all projects'}
          </button>
        ) : (
          <span />
        )}
        {onNewDub && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onNewDub();
            }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-[9px] bg-slate-100 hover:bg-white text-slate-950 text-[12.5px] font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> New dub
          </button>
        )}
      </div>
    </div>
  );
};
