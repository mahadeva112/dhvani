import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useDeferredValue } from 'react';
import {
  Search,
  Play,
  Square,
  Check,
  ChevronUp,
  ChevronDown,
  Filter,
  X,
  Star,
} from 'lucide-react';
import { Voice } from '../services/elevenLabsService';
import { useFavoriteVoices } from '../services/favoriteVoicesService';
import { isIndianVoice, languageFit } from '../services/indianVoices';

export interface VoiceItem {
  id: string;
  name: string;
  category: string;
  gender: string;
  accent: string;
  desc: string;
  previewUrl?: string;
  labels?: Record<string, string | undefined>;
  /** Which engine speaks the voice. Absent means ElevenLabs. */
  provider?: 'elevenlabs' | 'cartesia';
}

export const POPULAR_ELEVENLABS_VOICES: VoiceItem[] = [
  {
    id: 'CwhRBWXzGAHq8TQ4Fs17',
    name: 'Roger',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Laid-Back, Casual, Resonant',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    category: 'premade',
    gender: 'female',
    accent: 'American',
    desc: 'Calm, Natural, Expressive',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/21m00Tcm4TlvDq8ikWAM/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Narrative, Deep & Dynamic',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi',
    category: 'premade',
    gender: 'female',
    accent: 'American',
    desc: 'Strong, Confident & Expressive',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/AZnzlk1XvdvUeBnXmlld/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    category: 'premade',
    gender: 'female',
    accent: 'American',
    desc: 'Soft, Gentle & Warm',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Smooth, Clear & Engaging',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/ErXwobaYiN019PkySvjV/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    name: 'Josh',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Warm, Deep & Natural',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/TxGEqnHWrfWFTfGW9XjX/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'MF3mGyEYCl7XYWbV9V6O',
    name: 'Elli',
    category: 'premade',
    gender: 'female',
    accent: 'American',
    desc: 'Young, Lively & Conversational',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/MF3mGyEYCl7XYWbV9V6O/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'VR6AewLTigWG4xSOukaG',
    name: 'Arnold',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Crisp, Authoritative & Formal',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/VR6AewLTigWG4xSOukaG/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'yoZ06a0pyUx65Gax4E0g',
    name: 'Sam',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Direct, Conversational & Friendly',
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/yoZ06a0pyUx65Gax4E0g/df6788f9-5c96-470d-8312-aab3b3d8f503.mp3',
  },
  {
    id: 'JBFqnCBsd6RMkjVDRZzb',
    name: 'George',
    category: 'premade',
    gender: 'male',
    accent: 'British',
    desc: 'Warm, Storyteller & Classic British',
  },
  {
    id: 'Xb7hH8MSUJpSbSDYk0k2',
    name: 'Alice',
    category: 'premade',
    gender: 'female',
    accent: 'British',
    desc: 'Confident, Newsroom & Articulate',
  },
  {
    id: 'IKne3meq5aSn9XLyUdCD',
    name: 'Charlie',
    category: 'premade',
    gender: 'male',
    accent: 'Australian',
    desc: 'Natural, Casual & Friendly',
  },
  {
    id: 'pFZP5JQG7iQjIQuC4Bku',
    name: 'Lily',
    category: 'premade',
    gender: 'female',
    accent: 'British',
    desc: 'Warm, Soft Narration & Documentary',
  },
  {
    id: 'nPczCjzI2devNBz1zQrb',
    name: 'Brian',
    category: 'premade',
    gender: 'male',
    accent: 'American',
    desc: 'Deep, Resonant & Podcast Host',
  },
  {
    id: 'XRExE9yKIg1WjnnlVkGX',
    name: 'Matilda',
    category: 'premade',
    gender: 'female',
    accent: 'American',
    desc: 'Warm, Audiobooks & Storytelling',
  },
];

interface VoiceSelectorCardProps {
  elVoiceId: string;
  onElVoiceIdChange: (voiceId: string) => void;
  availableVoices?: Voice[];
  onOpenVoiceChanger?: () => void;
  /** The dub language; voices that speak it are suggested first. */
  targetLanguage?: string;
  /** Extra classes for the outer panel, e.g. to size it to a sibling column. */
  className?: string;
  /**
   * The voice engine that is on. With `onVoiceEngineChange`, the card shows an
   * ElevenLabs / Cartesia switch; the parent passes only that engine's voices.
   */
  voiceEngine?: VoiceEngine;
  onVoiceEngineChange?: (engine: VoiceEngine) => void;
  /**
   * The library is still on its way. With no voices yet, the grid shows
   * placeholder cards instead of the built-in list, so it fills once, not twice.
   */
  loading?: boolean;
  /** Replaces the "Dubbing voice" title, e.g. "Voice for Speaker 2". */
  heading?: React.ReactNode;
  /**
   * Until something is typed or filtered, list only a short set: the voices in
   * this dub, favourites, recently used and a few suggested for the dub
   * language. The whole library is a search away.
   */
  shortlist?: boolean;
  /** Voices listed first in the short set (the main voice and the cast's). */
  pinnedVoiceIds?: string[];
  /**
   * `list`: one voice a row. `cards`: the short set as two columns of cards
   * with their tags, a style shelf and recently used voices under them.
   */
  layout?: 'grid' | 'list' | 'cards';
}

/** Voices picked lately, newest first, for the short set. */
const RECENT_VOICES_KEY = 'dhvani_recent_voices';
const RECENT_VOICES_MAX = 12;
export const readRecentVoices = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_VOICES_KEY) || '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};
/** Suggested voices in the short set. */
const SUGGESTED_COUNT = 8;

/** A voice plus the precomputed fields the search ranks against. */
interface IndexedVoice extends VoiceItem {
  nameLc: string;
  nameWords: string[];
  haystack: string;
  accentKey: string;
  styleKey: string;
  indian: boolean;
  /** 2: the dub language is the voice's own, 1: verified in it, 0: neither. */
  languageFit: number;
}

type CategoryFilter = 'all' | 'premade' | 'cloned' | 'custom';
type GenderFilter = 'all' | 'female' | 'male';
/** The engine that speaks the dub. Only one is on at a time. */
export type VoiceEngine = 'elevenlabs' | 'cartesia';

export const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  elevenlabs: 'ElevenLabs',
  cartesia: 'Cartesia',
};

/** Rows rendered per page; the list grows as you scroll so thousands of voices stay fast. */
const PAGE_SIZE = 60;
// Grid gap and vertical list padding, in px (Tailwind gap-2.5 / py-2.5 / scroll-pt-2.5).
const GRID_GAP = 10;
// A short list stretches its rows to fill the viewport, up to this multiple of the natural card height.
const MAX_ROW_STRETCH = 1.6;

/** Whether the list shows only Indian voices; on unless the user turned it off. */
const INDIAN_ONLY_KEY = 'dhvani_voice_indian_only';
const readIndianOnly = () => {
  try {
    return localStorage.getItem(INDIAN_ONLY_KEY) !== 'false';
  } catch {
    return true;
  }
};

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  premade: 'Premade',
  cloned: 'Cloned / Pro',
  custom: 'My Voices',
};

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-sky-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-fuchsia-500 to-purple-600',
  'from-cyan-500 to-blue-600',
];

/** "narrative_story" -> "narrative story" */
const prettify = (s?: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stable per-voice avatar colour, so a voice is recognisable at a glance. */
const avatarGradient = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
};

const matchesCategory = (category: string, filter: CategoryFilter) => {
  if (filter === 'all') return true;
  const cat = category.toLowerCase();
  if (filter === 'premade') return cat.includes('premade');
  if (filter === 'cloned') return cat.includes('clon') || cat.includes('professional');
  return !cat.includes('premade') && !cat.includes('generated');
};

/**
 * Ranks a voice against the query tokens. Every token must match somewhere
 * (AND semantics); name hits outrank metadata hits. "male"/"female" match the
 * gender exactly, so "male" never pulls in every female voice. Returns null
 * when the voice doesn't match.
 */
const scoreVoice = (v: IndexedVoice, tokens: string[]): number | null => {
  let score = 0;
  for (const t of tokens) {
    if (t === 'male' || t === 'female') {
      if (v.gender !== t) return null;
      score += 5;
    } else if (v.nameLc.startsWith(t)) {
      score += 100;
    } else if (v.nameWords.some((w) => w.startsWith(t))) {
      score += 60;
    } else if (v.nameLc.includes(t)) {
      score += 40;
    } else if (v.haystack.includes(t)) {
      score += 10;
    } else {
      return null;
    }
  }
  return score;
};

/** Top-N most common values of a key, so the quick chips reflect the actual library. */
const topValues = (voices: IndexedVoice[], key: 'accentKey' | 'styleKey', limit: number) => {
  const counts = new Map<string, number>();
  voices.forEach((v) => {
    const k = v[key];
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
};

const Highlight: React.FC<{ text: string; tokens: string[] }> = ({ text, tokens }) => {
  const terms = tokens.filter((t) => t !== 'male' && t !== 'female');
  if (!terms.length || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-indigo-500/30 text-indigo-100 rounded-sm px-0.5 -mx-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
};

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-md border border-slate-700 bg-slate-900 text-[10px] font-mono font-semibold text-slate-400 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]">
    {children}
  </kbd>
);

const chipClass = (active: boolean, tone: 'indigo' | 'purple' | 'amber' = 'indigo') => {
  const activeTone = {
    indigo: 'bg-indigo-600 text-white border-indigo-500',
    purple: 'bg-purple-600 text-white border-purple-500',
    amber: 'bg-amber-500 text-slate-950 border-amber-400',
  }[tone];
  return `flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-default whitespace-nowrap ${
    active
      ? `${activeTone} shadow-2xs`
      : 'bg-slate-950 text-slate-400 hover:text-indigo-200 hover:bg-slate-900 border-edge hover:border-indigo-500/40'
  }`;
};

const GRID_COLUMNS = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5 gap-2.5';
const CARD_COLUMNS = 'grid grid-cols-1 xl:grid-cols-2 min-[1900px]:grid-cols-3 gap-2.5';

/**
 * A small wave on a voice card, its shape drawn from the voice ID (not the
 * sample's audio). It plays the sample too, and fills as the sample plays.
 */
const PreviewWave: React.FC<{ id: string; progress: number; onClick: (e: React.MouseEvent) => void }> = ({ id, progress, onClick }) => {
  const heights = useMemo(() => {
    let h = 7;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Array.from({ length: 18 }, (_, i) => {
      h = (Math.imul(h, 1103515245) + 12345) | 0;
      const r = ((h >>> 8) & 0xff) / 255;
      // Taller in the middle, like a spoken phrase.
      const shape = 0.45 + 0.55 * Math.sin(((i + 0.5) / 18) * Math.PI);
      return Math.max(3, Math.round(18 * shape * (0.35 + 0.65 * r)));
    });
  }, [id]);
  const playing = progress >= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-hidden="true"
      tabIndex={-1}
      className={`hidden xl:flex items-center gap-[2px] h-[18px] shrink-0 cursor-default transition-opacity ${
        playing ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'
      }`}
    >
      {heights.map((height, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-full ${playing && i / heights.length < progress ? 'bg-indigo-400' : 'bg-slate-500'}`}
          style={{ height }}
        />
      ))}
    </button>
  );
};

export const VoiceSelectorCard: React.FC<VoiceSelectorCardProps> = ({
  elVoiceId,
  onElVoiceIdChange,
  availableVoices = [],
  targetLanguage = 'Hindi',
  className = '',
  voiceEngine = 'elevenlabs',
  onVoiceEngineChange,
  loading = false,
  heading,
  shortlist = false,
  pinnedVoiceIds,
  layout = 'grid',
}) => {
  const list = layout === 'list';
  const cards = layout === 'cards';
  const [recentIds, setRecentIds] = useState<string[]>(readRecentVoices);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [indianOnly, setIndianOnly] = useState(readIndianOnly);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  // How far the playing preview is, 0 to 1, for the card's wave.
  const [playProgress, setPlayProgress] = useState(0);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { favorites, isFavorite, toggleFavorite } = useFavoriteVoices();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Typing stays responsive even while thousands of rows re-rank.
  const deferredQuery = useDeferredValue(searchQuery);
  const tokens = useMemo(
    () => deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [deferredQuery],
  );

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // "/" opens the voice search from anywhere on the page, like a command palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Consolidate API voices (or the built-in fallback list) into one searchable index
  const allVoices: IndexedVoice[] = useMemo(() => {
    const base: VoiceItem[] =
      availableVoices && availableVoices.length > 0
        ? availableVoices.map((v) => {
            const labels = v.labels || {};
            const gender = (labels.gender || '').toLowerCase();
            // "en-indian" and "hi-standard" carry a language prefix; without it
            // they merge with "Indian" and "Standard".
            const accent = titleCase(prettify((labels.accent || '').trim().replace(/^[a-z]{2,3}-(?=[a-z])/i, ''))) || 'Neutral';
            // Accent and gender already have their own badges; the description carries the rest.
            const desc =
              [labels.age, labels.use_case, labels.description]
                .map((x) => capitalize(prettify(x)))
                .filter(Boolean)
                .join(' · ') || capitalize(v.category || 'Standard');

            return {
              id: v.voice_id,
              name: v.name,
              category: v.category || 'custom',
              gender: gender.includes('female') ? 'female' : gender.includes('male') ? 'male' : 'neutral',
              accent,
              desc,
              previewUrl: v.preview_url,
              labels,
              provider: v.provider,
              indian: isIndianVoice(v),
              fit: languageFit(v, targetLanguage),
            };
          })
        : // The built-in list is ElevenLabs voices; it must not stand in for Cartesia's.
          voiceEngine === 'cartesia' || loading
          ? []
          : POPULAR_ELEVENLABS_VOICES;

    return (base as (VoiceItem & { indian?: boolean; fit?: number })[]).map((raw) => {
      // Library names sometimes carry stray whitespace (" Knightley Javier"), which blanks the avatar initial
      const v = { ...raw, name: (raw.name || '').trim() || raw.id };
      const nameLc = v.name.toLowerCase();
      const labelText = Object.values(v.labels || {})
        .map((x) => prettify(x))
        .join(' ');
      return {
        ...v,
        nameLc,
        nameWords: nameLc.split(/[\s\-–—,()]+/).filter(Boolean),
        haystack: [nameLc, v.accent, v.category, v.desc, labelText, v.id].join(' ').toLowerCase(),
        accentKey: v.accent && v.accent !== 'Neutral' ? v.accent : '',
        styleKey: capitalize(prettify(v.labels?.use_case)),
        indian: Boolean(raw.indian),
        languageFit: raw.fit || 0,
      };
    });
  }, [availableVoices, targetLanguage, voiceEngine, loading]);
  const awaitingLibrary = loading && allVoices.length === 0;

  const indianCount = useMemo(() => allVoices.filter((v) => v.indian).length, [allVoices]);
  // With no Indian voices in the library (or only the built-in list), the filter would empty the list.
  const showIndianOnly = indianOnly && indianCount > 0;

  useEffect(() => {
    try {
      localStorage.setItem(INDIAN_ONLY_KEY, String(indianOnly));
    } catch {}
  }, [indianOnly]);

  // Chips count the voices on offer, so with the Indian filter on they show
  // Indian accents rather than American, British or Latin American.
  const chipPool = useMemo(
    () => (showIndianOnly ? allVoices.filter((v) => v.indian) : allVoices),
    [allVoices, showIndianOnly],
  );
  const accentOptions = useMemo(() => topValues(chipPool, 'accentKey', 8), [chipPool]);
  const styleOptions = useMemo(() => topValues(chipPool, 'styleKey', 8), [chipPool]);

  // An accent picked from the full library may not exist among Indian voices.
  useEffect(() => {
    if (accentFilter !== 'all' && !chipPool.some((v) => v.accentKey === accentFilter)) setAccentFilter('all');
  }, [chipPool, accentFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = { all: allVoices.length, premade: 0, cloned: 0, custom: 0 };
    allVoices.forEach((v) => {
      if (matchesCategory(v.category, 'premade')) counts.premade++;
      if (matchesCategory(v.category, 'cloned')) counts.cloned++;
      if (matchesCategory(v.category, 'custom')) counts.custom++;
    });
    return counts;
  }, [allVoices]);

  // Filter + rank: best name matches first while searching, favourites, then dub-language voices, then A to Z otherwise
  const filteredVoices = useMemo(() => {
    const scored: { v: IndexedVoice; score: number }[] = [];
    for (const v of allVoices) {
      if (favoritesOnly && !isFavorite(v.id)) continue;
      if (showIndianOnly && !v.indian) continue;
      if (!matchesCategory(v.category, categoryFilter)) continue;
      if (genderFilter !== 'all' && v.gender !== genderFilter) continue;
      if (accentFilter !== 'all' && v.accentKey !== accentFilter) continue;
      if (styleFilter !== 'all' && v.styleKey !== styleFilter) continue;
      const score = tokens.length ? scoreVoice(v, tokens) : 0;
      if (score === null) continue;
      scored.push({ v, score: score + (isFavorite(v.id) ? 5 : 0) + v.languageFit * 8 });
    }

    return scored
      .sort((a, b) => {
        if (tokens.length && b.score !== a.score) return b.score - a.score;
        const favDelta = Number(isFavorite(b.v.id)) - Number(isFavorite(a.v.id));
        if (favDelta !== 0) return favDelta;
        // Voices that speak the dub language come first.
        if (b.v.languageFit !== a.v.languageFit) return b.v.languageFit - a.v.languageFit;
        return a.v.name.localeCompare(b.v.name, undefined, { sensitivity: 'base' });
      })
      .map((s) => s.v);
  }, [allVoices, tokens, categoryFilter, genderFilter, accentFilter, styleFilter, favoritesOnly, showIndianOnly, isFavorite]);

  // New results: start from the top again
  useEffect(() => {
    setHighlightIndex(0);
    setVisibleCount(PAGE_SIZE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filteredVoices]);

  // Keep the keyboard-highlighted card in view while typing in the search box
  useEffect(() => {
    if (document.activeElement !== inputRef.current) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlightIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  const activeFilterCount = [
    categoryFilter !== 'all',
    genderFilter !== 'all',
    accentFilter !== 'all',
    styleFilter !== 'all',
    favoritesOnly,
  ].filter(Boolean).length;

  // The short set, in groups, until a search or filter asks for the whole library.
  const groups = useMemo(() => {
    if (!shortlist || tokens.length || activeFilterCount > 0) return null;
    const byId = new Map(allVoices.map((v) => [v.id, v]));
    const seen = new Set<string>();
    const take = (ids: string[]) => {
      const out: IndexedVoice[] = [];
      for (const id of ids) {
        const v = byId.get(id);
        if (v && !seen.has(id)) {
          seen.add(id);
          out.push(v);
        }
      }
      return out;
    };
    const result = [
      { key: 'dub', label: 'In this dub', voices: take(pinnedVoiceIds || [elVoiceId]) },
      { key: 'favourites', label: 'Favourites', voices: take(favorites.map((f) => f.id)) },
      // Cards show recent voices on the shelf under the list instead.
      { key: 'recent', label: 'Recently used', voices: cards ? [] : take(recentIds) },
      {
        key: 'suggested',
        label: `Suggested for ${targetLanguage}`,
        // Voices of the dub language before ones only verified in it. Instant clones are left out:
        // an account can hold thousands, often named by an ID, and search finds them.
        voices: take(
          filteredVoices
            .filter((v) => v.languageFit > 0 && !seen.has(v.id) && !v.category.toLowerCase().includes('clon'))
            .sort((a, b) => b.languageFit - a.languageFit)
            .slice(0, SUGGESTED_COUNT)
            .map((v) => v.id),
        ),
      },
    ].filter((g) => g.voices.length > 0);
    return result;
  }, [shortlist, tokens, activeFilterCount, allVoices, pinnedVoiceIds, elVoiceId, favorites, recentIds, filteredVoices, targetLanguage, cards]);
  const shortlistCount = groups ? groups.reduce((n, g) => n + g.voices.length, 0) : 0;
  // The shelf's recently used voices: those not already in a group above.
  const recentShelf = useMemo(() => {
    if (!cards || !groups) return [];
    const shown = new Set(groups.flatMap((g) => g.voices.map((v) => v.id)));
    const byId = new Map(allVoices.map((v) => [v.id, v]));
    return recentIds
      .flatMap((id) => {
        const v = byId.get(id);
        return v && !shown.has(id) ? [v] : [];
      })
      .slice(0, 6);
  }, [cards, groups, allVoices, recentIds]);

  const resetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setGenderFilter('all');
    setAccentFilter('all');
    setStyleFilter('all');
    setFavoritesOnly(false);
    setIndianOnly(false);
  };

  const handleToggleFavorite = (v: VoiceItem) => {
    toggleFavorite({
      id: v.id,
      name: v.name,
      category: v.category,
      gender: v.gender,
      accent: v.accent,
      previewUrl: v.previewUrl,
    });
  };

  // Handle playing voice sample
  const handleTogglePreview = (voiceId: string, previewUrl?: string) => {
    if (playingVoiceId === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingVoiceId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (previewUrl) {
      const audio = new Audio(previewUrl);
      audioRef.current = audio;
      setPlayingVoiceId(voiceId);
      setPlayProgress(0);
      audio.ontimeupdate = () => {
        if (audio.duration > 0) setPlayProgress(audio.currentTime / audio.duration);
      };
      audio.play().catch((err) => {
        console.warn('Voice preview playback failed:', err);
        setPlayingVoiceId(null);
      });
      audio.onended = () => {
        setPlayingVoiceId(null);
        audioRef.current = null;
      };
    }
  };

  const selectVoice = (id: string) => {
    onElVoiceIdChange(id);
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_VOICES_MAX);
      try {
        localStorage.setItem(RECENT_VOICES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const last = filteredVoices.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => {
        const next = Math.min(i + 1, last);
        if (next >= visibleCount - 1) setVisibleCount((c) => c + PAGE_SIZE);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const v = filteredVoices[highlightIndex];
      if (v) selectVoice(v.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (searchQuery) setSearchQuery('');
      else inputRef.current?.blur();
    } else if (e.key === ' ' && e.ctrlKey) {
      // Ctrl+Space auditions the highlighted voice without leaving the keyboard
      e.preventDefault();
      const v = filteredVoices[highlightIndex];
      if (v?.previewUrl) handleTogglePreview(v.id, v.previewUrl);
    }
  };

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160 && visibleCount < filteredVoices.length) {
      setVisibleCount((c) => c + PAGE_SIZE);
    }
  };

  const visibleVoices = filteredVoices.slice(0, visibleCount);
  const hasVoices = visibleVoices.length > 0;

  // Size rows so a whole number of them fills the list viewport exactly. Together with
  // row snapping, no card is ever left half visible at the bottom edge.
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    // Rows and the grouped short set keep their natural height.
    if (!el || !hasVoices || list || groups) return;
    const fit = () => {
      const bodies = el.querySelectorAll<HTMLElement>('[data-card-body]');
      if (!bodies.length) return;
      const cs = getComputedStyle(bodies[0].parentElement!);
      const chrome =
        parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      let natural = 0;
      bodies.forEach((b) => { natural = Math.max(natural, b.offsetHeight); });
      natural += chrome;
      const h = el.clientHeight;
      const rows = Math.max(1, Math.floor((h - GRID_GAP) / (natural + GRID_GAP)));
      // A short list (e.g. the 16 built-in voices while the library loads) has fewer
      // rows than the viewport holds. Stretch those rows to fill it rather than leave
      // an empty band below the last row, but only when the stretch stays modest.
      const grid = bodies[0].parentElement!.parentElement!;
      const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
      const contentRows = Math.ceil(bodies.length / cols);
      const fillRows = contentRows < rows ? contentRows : rows;
      const filled = (h - (fillRows + 1) * GRID_GAP) / fillRows;
      const next = Math.max(natural, filled <= natural * MAX_ROW_STRETCH ? filled : natural);
      setRowHeight((prev) => (prev === next ? prev : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasVoices, visibleVoices.length, list, groups]);

  /** One voice: a card in the grid, or a row in the list. */
  const renderVoice = (v: IndexedVoice, idx: number) => {
    const isSelected = v.id === elVoiceId;
    const isPlaying = playingVoiceId === v.id;
    const isHighlighted = idx === highlightIndex && searchQuery.length > 0;
    const fav = isFavorite(v.id);
    // Library names often carry a tagline: "Aaditya - Rich, Deep and Suspenseful".
    const [title, ...rest] = v.name.split(/\s+[-–—|]\s+/);
    const tagline = rest.join(' – ');
    // Cards carry age and style as tags, so their line under the name is the description alone.
    const age = capitalize(prettify(v.labels?.age));
    const ownDescription = capitalize(prettify(v.labels?.description));
    const subtitle = tagline || (cards && ownDescription) || v.desc || capitalize(v.category);
    const showAccent = v.accent !== 'Neutral' && v.accent !== 'Standard';
    const tags = (
      <>
        {v.languageFit > 0 && (
          <span
            className="shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md bg-cyan-500/10 text-cyan-300"
            title={
              v.languageFit === 2
                ? `A ${targetLanguage} voice`
                : `Verified by ${VOICE_ENGINE_LABELS[voiceEngine]} in ${targetLanguage}`
            }
          >
            {targetLanguage}
          </span>
        )}
        {v.gender !== 'neutral' && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md bg-slate-800 text-slate-300">
            {capitalize(v.gender)}
          </span>
        )}
        {cards && age && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md bg-slate-800 text-slate-300">{age}</span>
        )}
        {cards && v.styleKey && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md bg-slate-800 text-slate-300">
            <Highlight text={v.styleKey} tokens={tokens} />
          </span>
        )}
        {showAccent && (
          <span className="truncate text-[10px] font-medium px-1.5 py-px rounded-md bg-slate-800 text-slate-400">
            <Highlight text={v.accent} tokens={tokens} />
          </span>
        )}
      </>
    );

    return (
      <div
        key={v.id}
        id={`voice-opt-${v.id}`}
        role="option"
        aria-selected={isSelected}
        tabIndex={0}
        data-idx={idx}
        onClick={() => selectVoice(v.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectVoice(v.id);
          }
        }}
        className={`group relative flex items-center gap-3 rounded-xl border cursor-default transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          list ? 'px-3 py-2' : 'p-3 snap-start'
        } ${
          isSelected
            ? list
              ? 'border-indigo-500/70 bg-indigo-950/40'
              : 'border-indigo-500 bg-indigo-950/40 ring-4 ring-indigo-500/10'
            : isHighlighted
              ? 'border-slate-600 bg-slate-800'
              : list
                ? 'border-transparent hover:bg-slate-800/50'
                : 'border-edge bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/50'
        }`}
      >
        {/* Avatar doubles as the preview button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleTogglePreview(v.id, v.previewUrl);
          }}
          disabled={!v.previewUrl}
          className={`relative ${list ? 'w-9 h-9' : 'w-10 h-10'} rounded-full bg-gradient-to-br ${avatarGradient(v.id)} text-white flex items-center justify-center font-semibold text-sm shrink-0 ${
            v.previewUrl ? 'cursor-default' : ''
          }`}
          title={v.previewUrl ? (isPlaying ? 'Stop preview' : `Play ${v.name} preview`) : 'No preview available'}
        >
          <span className={isPlaying ? 'opacity-0' : v.previewUrl ? 'group-hover:opacity-0 transition-opacity' : ''}>
            {v.name.charAt(0).toUpperCase()}
          </span>
          {v.previewUrl && (
            <span
              className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/40 transition-opacity ${
                isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {isPlaying ? (
                <Square className="w-3.5 h-3.5 fill-current animate-pulse" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </span>
          )}
        </button>

        <div data-card-body className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-[13.5px] font-semibold truncate ${isSelected ? 'text-indigo-100' : 'text-slate-100'}`}
              title={v.name}
            >
              <Highlight text={title} tokens={tokens} />
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite(v);
              }}
              className={`p-1 -m-1 rounded-md transition-opacity shrink-0 cursor-default ${
                fav
                  ? 'text-amber-300'
                  : 'text-slate-500 hover:text-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
              title={fav ? 'Remove from favourites' : 'Add to favourites'}
              aria-label={fav ? `Remove ${v.name} from favourites` : `Add ${v.name} to favourites`}
            >
              <Star className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
            </button>
            {isSelected && !list && <Check className="w-4 h-4 text-indigo-400 shrink-0" aria-label="Selected" />}
          </div>

          <p className="text-xs text-slate-400 truncate mt-0.5" title={subtitle}>
            <Highlight text={subtitle} tokens={tokens} />
          </p>

          {!list && <div className="flex items-center gap-1 mt-2 overflow-hidden whitespace-nowrap">{tags}</div>}
        </div>

        {cards && v.previewUrl && (
          <PreviewWave
            id={v.id}
            progress={isPlaying ? playProgress : -1}
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePreview(v.id, v.previewUrl);
            }}
          />
        )}

        {list && <div className="hidden md:flex items-center gap-1 shrink-0 max-w-[40%] overflow-hidden whitespace-nowrap">{tags}</div>}
        {list && (isSelected ? (
          <Check className="w-4 h-4 text-indigo-400 shrink-0" aria-label="Selected" />
        ) : (
          <span aria-hidden="true" className="shrink-0 px-2.5 py-1 rounded-lg border border-edge text-[11.5px] font-medium text-slate-200 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            Use
          </span>
        ))}
      </div>
    );
  };

  return (
    <section
      id="voice-selector-card-container"
      aria-labelledby="voice-library-heading"
      className={`w-full flex flex-col bg-slate-900/90 border border-edge rounded-2xl overflow-hidden ${className}`}
    >
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 sm:px-5 pt-4">
        <div className="min-w-[11rem] flex-1">
          <h2 id="voice-library-heading" className="flex items-center gap-2 text-[15px] font-semibold text-slate-100 leading-tight">
            {heading ?? 'Dubbing voice'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {shortlist
              ? `Your voices first. Search to find any voice in your library; ${targetLanguage} voices come first.`
              : `Voices that speak ${targetLanguage} are shown first. Play a preview before you choose.`}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          {onVoiceEngineChange && (
            <div
              role="radiogroup"
              aria-label="Voice engine"
              className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5"
            >
              {(['elevenlabs', 'cartesia'] as const).map((engine) => (
                <button
                  key={engine}
                  type="button"
                  role="radio"
                  aria-checked={voiceEngine === engine}
                  onClick={() => onVoiceEngineChange(engine)}
                  title={
                    voiceEngine === engine
                      ? `Dubbing with ${VOICE_ENGINE_LABELS[engine]}`
                      : `Switch the dub to ${VOICE_ENGINE_LABELS[engine]} voices; ${VOICE_ENGINE_LABELS[voiceEngine]} turns off`
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-default whitespace-nowrap ${
                    voiceEngine === engine ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {VOICE_ENGINE_LABELS[engine]}
                </button>
              ))}
            </div>
          )}
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 tabular-nums pt-0.5">
            {awaitingLibrary ? 'Loading' : `${allVoices.length.toLocaleString()} voices`}
          </span>
        </div>
      </div>

      {/* Search and main filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-edge">
        <div className="relative flex-1 min-w-[15rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            ref={inputRef}
            id="voice-search-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="voice-search-results"
            aria-activedescendant={
              filteredVoices[highlightIndex] ? `voice-opt-${filteredVoices[highlightIndex].id}` : undefined
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={shortlist && allVoices.length > 0 ? `Search all ${allVoices.length.toLocaleString()} voices` : 'Search voices'}
            title="Search by name, accent, style or voice ID"
            className="w-full h-9 bg-slate-950 border border-edge rounded-xl pl-9 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-all"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  inputRef.current?.focus();
                }}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 cursor-default"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Kbd>/</Kbd>
            )}
          </span>
        </div>

        <div className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5" role="group" aria-label="Gender">
          {(['all', 'female', 'male'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={genderFilter === g}
              onClick={() => setGenderFilter(g)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-default ${
                genderFilter === g ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {g === 'all' ? 'All' : capitalize(g)}
            </button>
          ))}
        </div>

        {indianCount > 0 && (
          <button
            type="button"
            role="switch"
            aria-checked={indianOnly}
            onClick={() => setIndianOnly((on) => !on)}
            className="flex items-center gap-2 px-1 text-xs font-medium text-slate-300 cursor-default"
            title={`Show only Indian voices; those that speak ${targetLanguage} are listed first`}
          >
            <span
              className={`relative w-7 h-4 rounded-full transition-colors ${indianOnly ? 'bg-indigo-500' : 'bg-slate-700'}`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${indianOnly ? 'left-3.5' : 'left-0.5'}`}
              />
            </span>
            Indian voices only
          </button>
        )}

        <button
          type="button"
          onClick={() => setFavoritesOnly((f) => !f)}
          aria-pressed={favoritesOnly}
          className={chipClass(favoritesOnly, 'amber')}
          title="Show only favourite voices"
        >
          <Star className={`w-3 h-3 ${favoritesOnly ? 'fill-current' : ''}`} />
          Favourites
          {favorites.length > 0 && <span className="opacity-70 tabular-nums">{favorites.length}</span>}
        </button>

        <button
          type="button"
          onClick={() => setShowMoreFilters((v) => !v)}
          aria-expanded={showMoreFilters}
          aria-controls="voice-more-filters"
          className={chipClass(showMoreFilters)}
        >
          <Filter className="w-3 h-3" />
          More filters
          {showMoreFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Type, accent and style */}
      {showMoreFilters && (
        <div id="voice-more-filters" className="px-4 sm:px-5 py-3 space-y-2 border-b border-edge bg-slate-950/60">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider shrink-0 w-14">Type</span>
            {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={chipClass(categoryFilter === cat)}
              >
                {CATEGORY_LABELS[cat]}
                <span className="opacity-60 tabular-nums">{categoryCounts[cat].toLocaleString()}</span>
              </button>
            ))}
          </div>

          {accentOptions.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider shrink-0 w-14">Accent</span>
              <button type="button" onClick={() => setAccentFilter('all')} className={chipClass(accentFilter === 'all')}>
                Any
              </button>
              {accentOptions.map(({ value, count }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAccentFilter(accentFilter === value ? 'all' : value)}
                  className={chipClass(accentFilter === value)}
                >
                  {value}
                  <span className="opacity-60 tabular-nums">{count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}

          {styleOptions.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider shrink-0 w-14">Style</span>
              <button type="button" onClick={() => setStyleFilter('all')} className={chipClass(styleFilter === 'all')}>
                Any
              </button>
              {styleOptions.map(({ value, count }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStyleFilter(styleFilter === value ? 'all' : value)}
                  className={chipClass(styleFilter === value)}
                >
                  {value}
                  <span className="opacity-60 tabular-nums">{count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Voice grid */}
      <div
        ref={listRef}
        id="voice-search-results"
        role="listbox"
        aria-label="Voices"
        onScroll={handleListScroll}
        className={`flex-1 min-h-0 max-h-[32rem] lg:max-h-none overflow-y-auto custom-scrollbar ${
          list ? 'px-2.5 py-2' : 'px-4 py-2.5'
        } ${list || groups ? '' : 'snap-y snap-mandatory scroll-pt-2.5'}`}
      >
        {awaitingLibrary ? (
          <div
            aria-busy="true"
            aria-label="Loading voices"
            className={cards ? CARD_COLUMNS : GRID_COLUMNS}
          >
            {Array.from({ length: cards ? 8 : 20 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-edge bg-slate-950/60 h-[88px]">
                <div className="w-10 h-10 rounded-full bg-slate-800 animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-3 w-24 rounded bg-slate-800 animate-pulse" />
                  <div className="h-2.5 w-40 max-w-full rounded bg-slate-800/70 animate-pulse" />
                  <div className="h-2.5 w-20 rounded bg-slate-800/70 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : groups && groups.length > 0 ? (
          // The short set: a heading per group, then its voices.
          <div className="flex flex-col gap-4">
            {groups.map((g, gi) => {
              const offset = groups.slice(0, gi).reduce((n, x) => n + x.voices.length, 0);
              return (
                <div key={g.key} role="group" aria-label={g.label} className="flex flex-col gap-1.5">
                  <div className="px-1.5 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                    {g.label} <span className="font-mono text-slate-600 tabular-nums">{g.voices.length}</span>
                  </div>
                  <div className={list ? 'flex flex-col gap-0.5' : cards ? CARD_COLUMNS : GRID_COLUMNS}>
                    {g.voices.map((v, i) => renderVoice(v, offset + i))}
                  </div>
                </div>
              );
            })}
            {cards && (styleOptions.length > 0 || recentShelf.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-x-8 gap-y-4">
                {styleOptions.length > 0 && (
                  <div className="min-w-0 flex-1 basis-80">
                    <div className="px-1.5 mb-2 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                      Browse by style
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {styleOptions.map(({ value, count }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setStyleFilter(value);
                            setShowMoreFilters(true);
                          }}
                          title={`Show the ${count.toLocaleString()} ${value.toLowerCase()} voices`}
                          className="flex items-center gap-2 h-8 px-3 rounded-full border border-edge bg-slate-950/60 text-[12px] text-slate-200 hover:border-slate-600 hover:bg-slate-800/60 cursor-default"
                        >
                          {value}
                          <span className="font-mono text-[10.5px] text-slate-500 tabular-nums">{count.toLocaleString()}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {recentShelf.length > 0 && (
                  <div className="min-w-0">
                    <div className="px-1.5 mb-2 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                      Recently used
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentShelf.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => selectVoice(v.id)}
                          title={`Use ${v.name}`}
                          className="flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border border-edge bg-slate-950/60 text-[12px] text-slate-200 hover:border-slate-600 hover:bg-slate-800/60 cursor-default max-w-[14rem]"
                        >
                          <span
                            className={`w-6 h-6 rounded-full bg-gradient-to-br ${avatarGradient(v.id)} grid place-items-center text-[10.5px] font-semibold text-white shrink-0`}
                          >
                            {v.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate">{v.name.split(/\s+[-–—|]\s+/)[0]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : filteredVoices.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-edge space-y-2">
            <Search className="w-5 h-5 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400">
              {favoritesOnly && !searchQuery
                ? 'No favourite voices yet. Star a voice to pin it here.'
                : searchQuery
                  ? `No voices match “${searchQuery}”${activeFilterCount ? ' with these filters' : ''}.`
                  : 'No voices match these filters.'}
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline cursor-default"
            >
              Reset search and filters
            </button>
          </div>
        ) : (
          <div
            className={list ? 'flex flex-col gap-0.5' : cards ? CARD_COLUMNS : GRID_COLUMNS}
            style={rowHeight && !list ? { gridAutoRows: `${rowHeight}px` } : undefined}
          >
            {visibleVoices.map((v, idx) => renderVoice(v, idx))}
          </div>
        )}

        {!groups && visibleCount < filteredVoices.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="w-full mt-3 py-2 text-xs font-semibold text-slate-500 hover:text-indigo-300 cursor-default"
          >
            Show more voices
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-2.5 border-t border-edge text-[11px] text-slate-500">
        <span className="tabular-nums">
          {awaitingLibrary ? 'Loading your voice library…' : groups && groups.length > 0 ? (
            `${shortlistCount} of ${allVoices.length.toLocaleString()} voices · type to search the rest`
          ) : <>
          Showing {Math.min(visibleCount, filteredVoices.length).toLocaleString()} of{' '}
          {filteredVoices.length.toLocaleString()} {filteredVoices.length === 1 ? 'voice' : 'voices'}
          {tokens.length > 0 ? ' · best match first' : ''}
          </>}
        </span>
        {(activeFilterCount > 0 || searchQuery) && (
          <button
            type="button"
            onClick={resetFilters}
            className="font-semibold text-indigo-400 hover:text-indigo-300 cursor-default"
          >
            Reset{activeFilterCount > 0 ? ` ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : ''}
          </button>
        )}
      </div>
    </section>
  );
};

/** The picked voice for the setup panel, from the live library or the built-in list. */
export const SelectedVoiceSummary: React.FC<{
  voiceId: string;
  availableVoices?: Voice[];
  /** One line with no box: a small avatar, the name, then what the voice is. */
  compact?: boolean;
}> = ({ voiceId, availableVoices = [], compact = false }) => {
  const live = availableVoices.find((v) => v.voice_id === voiceId);
  const fallback = POPULAR_ELEVENLABS_VOICES.find((v) => v.id === voiceId);
  const missing = !voiceId
    ? 'No voice selected'
    : availableVoices.length === 0
      ? 'Loading voices…'
      : 'Voice not in your library';
  const fullName = (live?.name || fallback?.name || missing).trim();
  const [name, ...rest] = fullName.split(/\s+[-–—|]\s+/);
  const tagline = rest.join(' – ');
  const labels = live?.labels || {};
  const accent = titleCase(prettify((labels.accent || '').replace(/^[a-z]{2,3}-(?=[a-z])/i, ''))) || fallback?.accent;
  const gender = capitalize((labels.gender || fallback?.gender || '').toLowerCase());
  const meta = [
    live?.provider === 'cartesia' ? 'Cartesia' : '',
    gender,
    accent && accent !== 'Neutral' && accent !== 'Standard' ? accent : '',
    tagline || capitalize(prettify(labels.use_case || labels.description)),
  ]
    .filter(Boolean)
    .join(' · ');

  if (compact)
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-5 h-5 rounded-full bg-gradient-to-br ${avatarGradient(voiceId || name)} text-white flex items-center justify-center font-semibold text-[10px] shrink-0`}
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-slate-100" title={[fullName, meta].filter(Boolean).join(' · ')}>
          {name}
          {meta && <span className="text-[11px] text-slate-500"> · {meta}</span>}
        </span>
      </div>
    );

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950/70 border border-edge min-w-0">
      <span
        className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGradient(voiceId || name)} text-white flex items-center justify-center font-semibold text-sm shrink-0`}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-100 truncate" title={fullName}>
          {name}
        </span>
        <span className="block text-xs text-slate-400 truncate" title={meta}>
          {meta || 'Pick a voice from the library'}
        </span>
      </span>
    </div>
  );
};
