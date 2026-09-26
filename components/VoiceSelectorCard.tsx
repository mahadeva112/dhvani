import React, { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
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
}

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

/** Rows rendered per page; the list grows as you scroll so thousands of voices stay fast. */
const PAGE_SIZE = 60;

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
  return `flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer whitespace-nowrap ${
    active
      ? `${activeTone} shadow-2xs`
      : 'bg-slate-950 text-slate-400 hover:text-indigo-200 hover:bg-slate-900 border-slate-800 hover:border-indigo-500/40'
  }`;
};

export const VoiceSelectorCard: React.FC<VoiceSelectorCardProps> = ({
  elVoiceId,
  onElVoiceIdChange,
  availableVoices = [],
  targetLanguage = 'Hindi',
  className = '',
}) => {
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [indianOnly, setIndianOnly] = useState(readIndianOnly);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
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
              indian: isIndianVoice(v),
              fit: languageFit(v, targetLanguage),
            };
          })
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
  }, [availableVoices, targetLanguage]);

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

  const selectVoice = (id: string) => onElVoiceIdChange(id);

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

  return (
    <section
      id="voice-selector-card-container"
      aria-labelledby="voice-library-heading"
      className={`w-full flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden ${className}`}
    >
      {/* Heading */}
      <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4">
        <div className="min-w-0">
          <h2 id="voice-library-heading" className="text-[15px] font-semibold text-slate-100 leading-tight">
            Dubbing voice
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Voices that speak {targetLanguage} are shown first. Play a preview before you choose.
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-mono uppercase tracking-wider text-slate-500 tabular-nums pt-0.5">
          {allVoices.length.toLocaleString()} voices
        </span>
      </div>

      {/* Search and main filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-slate-800">
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
            placeholder="Search voices"
            title="Search by name, accent, style or voice ID"
            className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-all"
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
                className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Kbd>/</Kbd>
            )}
          </span>
        </div>

        <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5" role="group" aria-label="Gender">
          {(['all', 'female', 'male'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={genderFilter === g}
              onClick={() => setGenderFilter(g)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
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
            className="flex items-center gap-2 px-1 text-xs font-medium text-slate-300 cursor-pointer"
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
        <div id="voice-more-filters" className="px-4 sm:px-5 py-3 space-y-2 border-b border-slate-800 bg-slate-950/60">
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
        className="flex-1 min-h-0 max-h-[32rem] lg:max-h-none overflow-y-auto custom-scrollbar p-4"
      >
        {filteredVoices.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-800 space-y-2">
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
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer"
            >
              Reset search and filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {visibleVoices.map((v, idx) => {
              const isSelected = v.id === elVoiceId;
              const isPlaying = playingVoiceId === v.id;
              const isHighlighted = idx === highlightIndex && searchQuery.length > 0;
              const fav = isFavorite(v.id);
              // Library names often carry a tagline: "Aaditya - Rich, Deep and Suspenseful".
              const [title, ...rest] = v.name.split(/\s+[-–—|]\s+/);
              const tagline = rest.join(' – ');
              const subtitle = tagline || v.desc || capitalize(v.category);
              const showAccent = v.accent !== 'Neutral' && v.accent !== 'Standard';

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
                  className={`group relative flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-950/40 ring-4 ring-indigo-500/10'
                      : isHighlighted
                        ? 'border-slate-600 bg-slate-800'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/50'
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
                    className={`relative w-10 h-10 rounded-full bg-gradient-to-br ${avatarGradient(v.id)} text-white flex items-center justify-center font-semibold text-sm shrink-0 disabled:cursor-default ${
                      v.previewUrl ? 'cursor-pointer' : ''
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

                  <div className="min-w-0 flex-1">
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
                        className={`p-1 -m-1 rounded-md transition-opacity shrink-0 cursor-pointer ${
                          fav
                            ? 'text-amber-300'
                            : 'text-slate-500 hover:text-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        title={fav ? 'Remove from favourites' : 'Add to favourites'}
                        aria-label={fav ? `Remove ${v.name} from favourites` : `Add ${v.name} to favourites`}
                      >
                        <Star className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
                      </button>
                      {isSelected && <Check className="w-4 h-4 text-indigo-400 shrink-0" aria-label="Selected" />}
                    </div>

                    <p className="text-xs text-slate-400 truncate mt-0.5" title={subtitle}>
                      <Highlight text={subtitle} tokens={tokens} />
                    </p>

                    <div className="flex items-center gap-1 mt-2 overflow-hidden whitespace-nowrap">
                      {v.languageFit > 0 && (
                        <span
                          className="shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md bg-cyan-500/10 text-cyan-300"
                          title={
                            v.languageFit === 2 ? `A ${targetLanguage} voice` : `Verified by ElevenLabs in ${targetLanguage}`
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
                      {showAccent && (
                        <span className="truncate text-[10px] font-medium px-1.5 py-px rounded-md bg-slate-800 text-slate-400">
                          <Highlight text={v.accent} tokens={tokens} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {visibleCount < filteredVoices.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="w-full mt-3 py-2 text-xs font-semibold text-slate-500 hover:text-indigo-300 cursor-pointer"
          >
            Show more voices
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-2.5 border-t border-slate-800 text-[11px] text-slate-500">
        <span className="tabular-nums">
          Showing {Math.min(visibleCount, filteredVoices.length).toLocaleString()} of{' '}
          {filteredVoices.length.toLocaleString()} {filteredVoices.length === 1 ? 'voice' : 'voices'}
          {tokens.length > 0 ? ' · best match first' : ''}
        </span>
        {(activeFilterCount > 0 || searchQuery) && (
          <button
            type="button"
            onClick={resetFilters}
            className="font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            Reset{activeFilterCount > 0 ? ` ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : ''}
          </button>
        )}
      </div>
    </section>
  );
};

/** The picked voice for the setup panel, from the live library or the built-in list. */
export const SelectedVoiceSummary: React.FC<{ voiceId: string; availableVoices?: Voice[] }> = ({
  voiceId,
  availableVoices = [],
}) => {
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
  const meta = [gender, accent && accent !== 'Neutral' && accent !== 'Standard' ? accent : '', tagline || capitalize(prettify(labels.use_case))]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 min-w-0">
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
