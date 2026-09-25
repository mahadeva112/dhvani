import React, { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import {
  Mic,
  Search,
  Play,
  Square,
  Check,
  ChevronUp,
  Volume2,
  Filter,
  X,
  Radio,
  Globe,
  AudioWaveform,
  Star,
} from 'lucide-react';
import { Voice } from '../services/elevenLabsService';
import { useFavoriteVoices } from '../services/favoriteVoicesService';

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
}

/** A voice plus the precomputed fields the search ranks against. */
interface IndexedVoice extends VoiceItem {
  nameLc: string;
  nameWords: string[];
  haystack: string;
  accentKey: string;
  styleKey: string;
}

type CategoryFilter = 'all' | 'premade' | 'cloned' | 'custom';
type GenderFilter = 'all' | 'female' | 'male';

/** Rows rendered per page; the list grows as you scroll so thousands of voices stay fast. */
const PAGE_SIZE = 60;

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
}) => {
  const [isVoiceBrowserOpen, setIsVoiceBrowserOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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
      setIsVoiceBrowserOpen(true);
      requestAnimationFrame(() => inputRef.current?.select());
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
            const accent = titleCase(prettify(labels.accent)) || 'Neutral';
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
            };
          })
        : POPULAR_ELEVENLABS_VOICES;

    return base.map((raw) => {
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
      };
    });
  }, [availableVoices]);

  const accentOptions = useMemo(() => topValues(allVoices, 'accentKey', 8), [allVoices]);
  const styleOptions = useMemo(() => topValues(allVoices, 'styleKey', 8), [allVoices]);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = { all: allVoices.length, premade: 0, cloned: 0, custom: 0 };
    allVoices.forEach((v) => {
      if (matchesCategory(v.category, 'premade')) counts.premade++;
      if (matchesCategory(v.category, 'cloned')) counts.cloned++;
      if (matchesCategory(v.category, 'custom')) counts.custom++;
    });
    return counts;
  }, [allVoices]);

  // Filter + rank: best name matches first while searching, favourites then A to Z otherwise
  const filteredVoices = useMemo(() => {
    const scored: { v: IndexedVoice; score: number }[] = [];
    for (const v of allVoices) {
      if (favoritesOnly && !isFavorite(v.id)) continue;
      if (!matchesCategory(v.category, categoryFilter)) continue;
      if (genderFilter !== 'all' && v.gender !== genderFilter) continue;
      if (accentFilter !== 'all' && v.accentKey !== accentFilter) continue;
      if (styleFilter !== 'all' && v.styleKey !== styleFilter) continue;
      const score = tokens.length ? scoreVoice(v, tokens) : 0;
      if (score === null) continue;
      scored.push({ v, score: score + (isFavorite(v.id) ? 5 : 0) });
    }

    return scored
      .sort((a, b) => {
        if (tokens.length && b.score !== a.score) return b.score - a.score;
        const favDelta = Number(isFavorite(b.v.id)) - Number(isFavorite(a.v.id));
        if (favDelta !== 0) return favDelta;
        return a.v.name.localeCompare(b.v.name, undefined, { sensitivity: 'base' });
      })
      .map((s) => s.v);
  }, [allVoices, tokens, categoryFilter, genderFilter, accentFilter, styleFilter, favoritesOnly, isFavorite]);

  // New results: start from the top again
  useEffect(() => {
    setHighlightIndex(0);
    setVisibleCount(PAGE_SIZE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filteredVoices]);

  // Keep the keyboard-highlighted row in view
  useEffect(() => {
    if (!isVoiceBrowserOpen) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlightIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isVoiceBrowserOpen]);

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
  };

  // Current active selected voice object
  const activeVoice = useMemo<VoiceItem>(() => {
    return allVoices.find((v) => v.id === elVoiceId) || allVoices[0] || POPULAR_ELEVENLABS_VOICES[0];
  }, [allVoices, elVoiceId]);

  /**
   * Favourites resolved against the live library. A voice starred before the
   * API list loaded (or since deleted upstream) falls back to the snapshot
   * stored when it was starred, so the quick-pick row never goes blank.
   */
  const favoriteVoiceItems: VoiceItem[] = useMemo(() => {
    return favorites.map((fav) => {
      const live = allVoices.find((v) => v.id === fav.id);
      if (live) return live;
      return {
        id: fav.id,
        name: fav.name || fav.id,
        category: fav.category || 'custom',
        gender: fav.gender || 'neutral',
        accent: fav.accent || 'Neutral',
        desc: 'Saved favourite',
        previewUrl: fav.previewUrl,
      };
    });
  }, [favorites, allVoices]);

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

  const selectVoice = (id: string) => {
    onElVoiceIdChange(id);
    setIsVoiceBrowserOpen(false);
  };

  const openSearch = () => {
    setIsVoiceBrowserOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
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
      else setIsVoiceBrowserOpen(false);
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
    <div
      id="voice-selector-card-container"
      className="w-full bg-slate-900/95 border border-slate-800 rounded-2xl shadow-sm transition-all duration-200 overflow-hidden"
    >
      {/* Top Banner: Provider Mode & Current Voice Display */}
      <div className="p-3.5 sm:p-4 border-b border-slate-800/80 bg-slate-950/60 space-y-3">
        {/* Title Bar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30 shrink-0">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-200 leading-tight">
                Dubbing Voice Selection
              </h4>
              <p className="text-xs text-slate-400 leading-tight mt-0.5">
                {`${allVoices.length.toLocaleString()} voice models available • Studio Quality Multilingual`}
              </p>
            </div>
          </div>
        </div>

        {/* ACTIVE VOICE SHOWCASE CARD (The main visual hero) */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl shadow-xs overflow-hidden">
          {/* Identity row: the name owns the full width; meta sits underneath */}
          <div className="p-3 sm:p-3.5 flex items-start gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${avatarGradient(activeVoice.id)} text-white flex items-center justify-center font-bold text-base shadow-md shrink-0`}
            >
              {activeVoice.name.charAt(0).toUpperCase()}
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span
                  className="text-[15px] font-bold text-slate-100 truncate leading-tight"
                  title={activeVoice.name}
                >
                  {activeVoice.name}
                </span>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400/90 shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Active
                </span>
              </div>

              {/* Meta badges on their own line so nothing squeezes the name */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase tracking-wide">
                  {activeVoice.category}
                </span>
                {activeVoice.gender && activeVoice.gender !== 'neutral' && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 border border-slate-800 capitalize">
                    {activeVoice.gender}
                  </span>
                )}
                {activeVoice.accent && activeVoice.accent !== 'Neutral' && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 border border-slate-800">
                    {activeVoice.accent}
                  </span>
                )}
                {isFavorite(activeVoice.id) && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                    <Star className="w-2.5 h-2.5 fill-current" />
                    Favourite
                  </span>
                )}
              </div>

              {/* Description, skipped when it only repeats the category badge */}
              {activeVoice.desc &&
                activeVoice.desc.toLowerCase() !== (activeVoice.category || '').toLowerCase() && (
                  <p className="text-xs text-slate-400 truncate font-normal" title={activeVoice.desc}>
                    {activeVoice.desc}
                  </p>
                )}

              <p
                className="text-[10px] font-mono text-slate-600 truncate"
                title={`Voice ID: ${activeVoice.id}`}
              >
                ID · {activeVoice.id}
              </p>
            </div>
          </div>

          {/* Action bar: aligned on its own row, so buttons never crowd the name */}
          <div className="flex items-center gap-2 flex-wrap px-3 sm:px-3.5 py-2.5 border-t border-slate-800/80 bg-slate-900/40">
            <button
              type="button"
              onClick={() => handleToggleFavorite(activeVoice)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                isFavorite(activeVoice.id)
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/50 hover:bg-amber-500/25'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-200 border-slate-800 hover:border-amber-500/40'
              }`}
              title={
                isFavorite(activeVoice.id)
                  ? `Remove ${activeVoice.name} from favourites`
                  : `Save ${activeVoice.name} to favourites`
              }
            >
              <Star
                className={`w-3.5 h-3.5 shrink-0 ${isFavorite(activeVoice.id) ? 'fill-current' : ''}`}
              />
              <span>{isFavorite(activeVoice.id) ? 'Favourited' : 'Favourite'}</span>
            </button>

            {activeVoice.previewUrl && (
              <button
                type="button"
                onClick={() => handleTogglePreview(activeVoice.id, activeVoice.previewUrl)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  playingVoiceId === activeVoice.id
                    ? 'bg-amber-500 text-white border-amber-400 animate-pulse shadow-sm'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border-slate-800 hover:border-indigo-500/40'
                }`}
                title="Audition voice sample"
              >
                {playingVoiceId === activeVoice.id ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Audition</span>
                  </>
                )}
              </button>
            )}

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => (isVoiceBrowserOpen ? setIsVoiceBrowserOpen(false) : openSearch())}
              aria-expanded={isVoiceBrowserOpen}
              aria-controls="voice-search-panel"
              title={isVoiceBrowserOpen ? 'Close voice search (Esc)' : 'Search the voice library (press /)'}
              className={`group flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer border ${
                isVoiceBrowserOpen
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-indigo-400/40 shadow-md shadow-indigo-900/40 hover:from-indigo-500 hover:to-purple-500'
              }`}
            >
              {isVoiceBrowserOpen ? (
                <>
                  <X className="w-3.5 h-3.5 shrink-0" />
                  <span>Close Search</span>
                  <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-70" />
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span>Search Voices</span>
                  <kbd className="hidden sm:inline-flex items-center justify-center w-5 h-5 rounded-md bg-white/15 border border-white/20 text-[10px] font-mono font-semibold">
                    /
                  </kbd>
                </>
              )}
            </button>
          </div>
        </div>

        {/* QUICK PICK: one click to switch between favourite voices */}
        {favoriteVoiceItems.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-amber-400/90 tracking-wider flex items-center gap-1 shrink-0">
              <Star className="w-3 h-3 fill-current" /> Favourites:
            </span>
            {favoriteVoiceItems.map((v) => {
              const isActive = v.id === elVoiceId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onElVoiceIdChange(v.id)}
                  className={`group flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border-slate-800 hover:border-indigo-500/40'
                  }`}
                  title={`Use ${v.name}${v.accent && v.accent !== 'Neutral' ? ` • ${v.accent}` : ''}`}
                >
                  {isActive && <Check className="w-3 h-3 shrink-0" />}
                  <span className="truncate max-w-[9rem]">{v.name}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleToggleFavorite(v);
                      }
                    }}
                    className="p-0.5 rounded text-slate-400 hover:text-rose-300 opacity-60 group-hover:opacity-100 transition-opacity"
                    title={`Remove ${v.name} from favourites`}
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* VOICE SEARCH PANEL */}
      {isVoiceBrowserOpen && (
        <div
          id="voice-search-panel"
          className="bg-slate-950/70 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {/* Search field */}
          <div className="p-3 sm:p-4 pb-0 sm:pb-0">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
              <input
                ref={inputRef}
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
                placeholder="Search by name, accent, style or voice ID — try “calm british female”"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-24 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-all shadow-xs"
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      inputRef.current?.focus();
                    }}
                    className="text-slate-400 hover:text-indigo-300 p-1 rounded-md hover:bg-slate-800 cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
                <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                  {filteredVoices.length.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="px-3 sm:px-4 pt-3 space-y-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1 shrink-0 w-14">
                <Filter className="w-3 h-3" /> Type
              </span>
              <button
                type="button"
                onClick={() => setFavoritesOnly((f) => !f)}
                className={chipClass(favoritesOnly, 'amber')}
                title="Show only favourite voices"
              >
                <Star className={`w-3 h-3 ${favoritesOnly ? 'fill-current' : ''}`} />
                Favourites
                {favorites.length > 0 && <span className="opacity-70 tabular-nums">{favorites.length}</span>}
              </button>
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
              <span className="w-px h-4 bg-slate-800 mx-1 shrink-0" />
              {(['all', 'female', 'male'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenderFilter(g)}
                  className={chipClass(genderFilter === g, 'purple')}
                >
                  {g === 'all' ? 'Any gender' : capitalize(g)}
                </button>
              ))}
            </div>

            {accentOptions.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1 shrink-0 w-14">
                  <Globe className="w-3 h-3" /> Accent
                </span>
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
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1 shrink-0 w-14">
                  <AudioWaveform className="w-3 h-3" /> Style
                </span>
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

          {/* Results header */}
          <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-3 pb-1.5 text-[11px] text-slate-500">
            <span>
              <span className="text-slate-300 font-semibold tabular-nums">{filteredVoices.length.toLocaleString()}</span>
              {' '}
              {filteredVoices.length === 1 ? 'voice' : 'voices'}
              {tokens.length > 0 ? ' · best match first' : ' · favourites, then A–Z'}
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

          {/* Results list */}
          <div
            ref={listRef}
            id="voice-search-results"
            role="listbox"
            onScroll={handleListScroll}
            className="max-h-80 overflow-y-auto px-2 sm:px-3 pb-2"
          >
            {filteredVoices.length === 0 ? (
              <div className="m-1 p-6 text-center bg-slate-950 rounded-xl border border-dashed border-slate-800 space-y-2">
                <Search className="w-5 h-5 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">
                  {favoritesOnly && !searchQuery
                    ? 'No favourite voices yet — star a voice to pin it here.'
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
              <div className="space-y-0.5">
                {visibleVoices.map((v, idx) => {
                  const isSelected = v.id === elVoiceId;
                  const isPlaying = playingVoiceId === v.id;
                  const isHighlighted = idx === highlightIndex;
                  const fav = isFavorite(v.id);

                  return (
                    <div
                      key={v.id}
                      id={`voice-opt-${v.id}`}
                      role="option"
                      aria-selected={isSelected}
                      data-idx={idx}
                      onClick={() => selectVoice(v.id)}
                      onMouseMove={() => idx !== highlightIndex && setHighlightIndex(idx)}
                      className={`group relative flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                        isHighlighted ? 'bg-slate-800/70' : 'hover:bg-slate-900/80'
                      } ${isSelected ? 'ring-1 ring-inset ring-indigo-500/60 bg-indigo-950/50' : ''}`}
                    >
                      {isHighlighted && (
                        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-indigo-400" />
                      )}

                      {/* Avatar doubles as the audition button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePreview(v.id, v.previewUrl);
                        }}
                        disabled={!v.previewUrl}
                        className={`relative w-9 h-9 rounded-lg bg-gradient-to-br ${avatarGradient(v.id)} text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm disabled:cursor-default ${
                          v.previewUrl ? 'cursor-pointer' : ''
                        }`}
                        title={v.previewUrl ? (isPlaying ? 'Stop sample' : 'Play sample') : 'No sample available'}
                      >
                        <span className={v.previewUrl ? 'group-hover:opacity-0 transition-opacity' : ''}>
                          {isPlaying ? '' : v.name.charAt(0).toUpperCase()}
                        </span>
                        {v.previewUrl && (
                          <span
                            className={`absolute inset-0 flex items-center justify-center rounded-lg bg-black/35 transition-opacity ${
                              isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            {isPlaying ? (
                              <Square className="w-3.5 h-3.5 fill-current animate-pulse" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </span>
                        )}
                      </button>

                      {/* Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-[13px] font-semibold truncate ${
                              isSelected ? 'text-indigo-200' : 'text-slate-100'
                            }`}
                            title={v.name}
                          >
                            <Highlight text={v.name} tokens={tokens} />
                          </span>
                          {isSelected && (
                            <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                              <Check className="w-3 h-3" /> Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0 text-[11px] text-slate-400">
                          <span className="shrink-0 text-[9px] font-mono font-semibold px-1 rounded bg-slate-900 text-slate-400 uppercase border border-slate-800">
                            {v.category}
                          </span>
                          {v.gender !== 'neutral' && <span className="shrink-0 capitalize">{v.gender}</span>}
                          {v.accent !== 'Neutral' && (
                            <>
                              <span className="text-slate-700">·</span>
                              <span className="shrink-0">
                                <Highlight text={v.accent} tokens={tokens} />
                              </span>
                            </>
                          )}
                          {v.desc && (
                            <>
                              <span className="text-slate-700">·</span>
                              <span className="truncate" title={v.desc}>
                                <Highlight text={v.desc} tokens={tokens} />
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Favourite */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(v);
                        }}
                        className={`p-1.5 rounded-md transition-all shrink-0 cursor-pointer ${
                          fav
                            ? 'text-amber-300 hover:bg-amber-500/15'
                            : 'text-slate-600 hover:text-amber-200 hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus:opacity-100'
                        } ${isHighlighted && !fav ? 'opacity-100' : ''}`}
                        title={fav ? 'Remove from favourites' : 'Add to favourites'}
                      >
                        <Star className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
                      </button>

                      {isHighlighted && (
                        <span className="hidden sm:flex shrink-0">
                          <Kbd>↵</Kbd>
                        </span>
                      )}
                    </div>
                  );
                })}

                {visibleCount < filteredVoices.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="w-full py-2 text-[11px] font-semibold text-slate-500 hover:text-indigo-300 cursor-pointer"
                  >
                    Showing {visibleCount.toLocaleString()} of {filteredVoices.length.toLocaleString()} — scroll or click for more
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Keyboard legend */}
          <div className="hidden sm:flex items-center gap-4 px-4 sm:px-5 py-2 border-t border-slate-800/80 bg-slate-950/80 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> use voice
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>Space</Kbd> play sample
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> close
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Radio className="w-3 h-3" /> Hover an avatar to audition
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
