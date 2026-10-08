/**
 * The wordings a user put into the script in Review, per project: a line as it
 * was and as they chose to say it. A new request for wordings carries the last
 * few, so the text model follows how this user likes lines said (plainer,
 * more formal, shorter words) without being told. Only the style is learnt
 * from them: the prompt tells the model never to take content from them.
 */

const STORAGE_KEY = 'dhvani_wording_choices';
/** Choices kept per project, newest last. */
const MAX_KEPT = 20;
/** Choices one request carries. */
export const MAX_EXAMPLES = 5;
/** Projects kept; the least recently changed are dropped first. */
const MAX_PROJECTS = 50;

export interface WordingChoice {
  /** The line as it read before. */
  from: string;
  /** The wording the user put in its place. */
  to: string;
}

type Store = Record<string, { at: number; choices: WordingChoice[] }>;

const read = (): Store => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const write = (store: Store) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* Storage full or off: the choices last until the app closes. */
  }
};

/** Remembers that, in project `projectId`, the user changed line `from` to `to`. */
export const rememberChoice = (projectId: string | null | undefined, choice: WordingChoice) => {
  const from = choice.from.trim();
  const to = choice.to.trim();
  if (!projectId || !from || !to || from === to) return;
  const store = read();
  const choices = (store[projectId]?.choices || []).filter((c) => c.from !== from);
  store[projectId] = { at: Date.now(), choices: [...choices, { from, to }].slice(-MAX_KEPT) };
  const projects = Object.keys(store);
  if (projects.length > MAX_PROJECTS) {
    projects
      .sort((a, b) => store[a].at - store[b].at)
      .slice(0, projects.length - MAX_PROJECTS)
      .forEach((id) => delete store[id]);
  }
  write(store);
};

/** The project's latest choices for other lines than `text`, at most MAX_EXAMPLES, oldest first. */
export const choicesFor = (projectId: string | null | undefined, text: string): WordingChoice[] => {
  if (!projectId) return [];
  const line = text.trim();
  return (read()[projectId]?.choices || []).filter((c) => c.from !== line && c.to !== line).slice(-MAX_EXAMPLES);
};
