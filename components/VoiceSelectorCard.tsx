import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Mic,
  Search,
  Play,
  Square,
  Check,
  ChevronDown,
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

export const VoiceSelectorCard: React.FC<VoiceSelectorCardProps> = ({
  elVoiceId,
  onElVoiceIdChange,
  availableVoices = [],
  onOpenVoiceChanger,
}) => {
  const [isVoiceBrowserOpen, setIsVoiceBrowserOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'premade' | 'cloned' | 'custom'>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const { favorites, isFavorite, toggleFavorite } = useFavoriteVoices();

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Consolidate API voices with default voices without duplicates
  const allVoices: VoiceItem[] = useMemo(() => {
    if (availableVoices && availableVoices.length > 0) {
      return availableVoices.map((v) => {
        const labels = v.labels || {};
        const gender = (labels.gender || '').toLowerCase();
        const accent = labels.accent || 'Neutral';
        const desc = [labels.accent, labels.gender, labels.age, labels.use_case || labels.description]
          .filter(Boolean)
          .join(' • ') || (v.category || 'Standard');

        return {
          id: v.voice_id,
          name: v.name,
          category: v.category || 'custom',
          gender: gender.includes('female') ? 'female' : gender.includes('male') ? 'male' : 'neutral',
          accent: accent,
          desc: desc,
          previewUrl: v.preview_url,
          labels: labels,
        };
      });
    }

    return POPULAR_ELEVENLABS_VOICES;
  }, [availableVoices]);

  // Extract unique accents for quick filtering
  const availableAccents = useMemo(() => {
    const set = new Set<string>();
    allVoices.forEach((v) => {
      if (v.accent && v.accent !== 'Neutral') set.add(v.accent);
    });
    return Array.from(set).slice(0, 6);
  }, [allVoices]);

  // Filter voices according to search and selected chips
  const filteredVoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = allVoices.filter((v) => {
      // Favourites-only filter
      if (favoritesOnly && !isFavorite(v.id)) return false;

      // Category filter
      if (categoryFilter !== 'all') {
        const cat = (v.category || '').toLowerCase();
        if (categoryFilter === 'premade' && !cat.includes('premade')) return false;
        if (categoryFilter === 'cloned' && !cat.includes('clon') && !cat.includes('professional')) return false;
        if (categoryFilter === 'custom' && (cat.includes('premade') || cat.includes('generated'))) return false;
      }

      // Gender filter
      if (genderFilter !== 'all') {
        if (v.gender !== genderFilter) return false;
      }

      // Accent filter
      if (accentFilter !== 'all') {
        if (!v.accent.toLowerCase().includes(accentFilter.toLowerCase())) return false;
      }

      // Text search
      if (!q) return true;
      const matchName = v.name.toLowerCase().includes(q);
      const matchDesc = v.desc.toLowerCase().includes(q);
      const matchAccent = v.accent.toLowerCase().includes(q);
      const matchCategory = v.category.toLowerCase().includes(q);

      return matchName || matchDesc || matchAccent || matchCategory;
    });

    // Favourites float to the top, then alphabetical by voice name (A to Z)
    return filtered.sort((a, b) => {
      const favDelta = Number(isFavorite(b.id)) - Number(isFavorite(a.id));
      if (favDelta !== 0) return favDelta;
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    });
  }, [allVoices, searchQuery, categoryFilter, genderFilter, accentFilter, favoritesOnly, isFavorite]);

  // Current active selected voice object
  const activeVoice = useMemo(() => {
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
                {`${allVoices.length} voice models available • Studio Quality Multilingual`}
              </p>
            </div>
          </div>
        </div>

        {/* ACTIVE VOICE SHOWCASE CARD (The main visual hero) */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl shadow-xs overflow-hidden">
          {/* Identity row: the name owns the full width; meta sits underneath */}
          <div className="p-3 sm:p-3.5 flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-base shadow-md shrink-0">
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
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 shrink-0">
                  Active
                </span>
              </div>

              {/* Meta badges on their own line so nothing squeezes the name */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase tracking-wide">
                  {activeVoice.category}
                </span>
                {activeVoice.gender && (
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
              onClick={() => setIsVoiceBrowserOpen(!isVoiceBrowserOpen)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer ${
                isVoiceBrowserOpen
                  ? 'bg-indigo-600 text-white border border-indigo-500 ring-2 ring-indigo-500/20'
                  : 'bg-indigo-950/80 hover:bg-indigo-900/90 text-indigo-300 hover:text-indigo-100 border border-indigo-700/60 hover:border-indigo-500/50'
              }`}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span>{isVoiceBrowserOpen ? 'Close Search' : 'Change Voice'}</span>
              {isVoiceBrowserOpen ? (
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
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

      {/* EXPANDED SEARCH & VOICE BROWSER (When toggled or searching) */}
      {isVoiceBrowserOpen && (
        <div className="p-3 sm:p-4 space-y-3.5 bg-slate-50/50 dark:bg-slate-950/70 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Real-time Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search voices by name, accent, gender, style (e.g., Roger, British, Female, Narrative)..."
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl pl-10 pr-9 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-xs"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-indigo-400 dark:hover:text-indigo-300 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filters Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {/* Category Chips */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
                <Filter className="w-3 h-3" /> Type:
              </span>
              <button
                type="button"
                onClick={() => setFavoritesOnly((f) => !f)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  favoritesOnly
                    ? 'bg-amber-500 text-slate-950 shadow-2xs font-bold'
                    : 'bg-slate-950 text-slate-400 hover:text-amber-200 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/40'
                }`}
                title="Show only favourite voices"
              >
                <Star className={`w-3 h-3 ${favoritesOnly ? 'fill-current' : ''}`} />
                Favourites{favorites.length > 0 ? ` (${favorites.length})` : ''}
              </button>
              {(['all', 'premade', 'cloned', 'custom'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    categoryFilter === cat
                      ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-indigo-200 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40'
                  }`}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            {/* Gender Filter Chips */}
            <div className="flex items-center gap-1.5 text-xs">
              {(['all', 'female', 'male'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenderFilter(g)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    genderFilter === g
                      ? 'bg-purple-600 text-white shadow-2xs font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-indigo-200 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40'
                  }`}
                >
                  {g === 'all' ? 'All Genders' : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Quick Chips if available */}
          {availableAccents.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] pt-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
                <Globe className="w-3 h-3" /> Accent:
              </span>
              <button
                type="button"
                onClick={() => setAccentFilter('all')}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  accentFilter === 'all'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-950 text-slate-400 hover:text-indigo-200 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40'
                }`}
              >
                All Accents
              </button>
              {availableAccents.map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => setAccentFilter(acc)}
                  className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                    accentFilter === acc
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-indigo-200 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40'
                  }`}
                >
                  {acc}
                </button>
              ))}
            </div>
          )}

          {/* Voices Grid */}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>Matching Voices ({filteredVoices.length})</span>
              <span>Click to activate voice</span>
            </div>

            {filteredVoices.length === 0 ? (
              <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <p className="text-xs text-slate-400">
                  {favoritesOnly && !searchQuery
                    ? 'No favourite voices yet — star a voice to pin it here.'
                    : `No voices found matching "${searchQuery}"`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('all');
                    setGenderFilter('all');
                    setAccentFilter('all');
                    setFavoritesOnly(false);
                  }}
                  className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
                >
                  Reset all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredVoices.map((v) => {
                  const isSelected = v.id === elVoiceId;
                  const isPlaying = playingVoiceId === v.id;

                  return (
                    <div
                      key={v.id}
                      onClick={() => {
                        onElVoiceIdChange(v.id);
                      }}
                      className={`voice-item-card p-2.5 rounded-xl border cursor-pointer transition-all duration-150 flex items-center justify-between gap-2.5 ${
                        isSelected
                          ? 'bg-indigo-950/90 border-indigo-500 ring-2 ring-indigo-500/30 text-indigo-100 shadow-xs'
                          : 'bg-slate-950/80 hover:bg-slate-900/90 border-slate-800/90 hover:border-indigo-500/50 text-slate-300'
                      }`}
                    >
                      {/* Left: Avatar + Details */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-900 text-slate-300 border border-slate-800'
                          }`}
                        >
                          {isSelected ? <Check className="w-4 h-4" /> : v.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-bold truncate ${
                                isSelected
                                  ? 'text-indigo-200'
                                  : 'text-slate-200'
                              }`}
                            >
                              {v.name}
                            </span>
                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-900 text-slate-400 uppercase border border-slate-800">
                              {v.category}
                            </span>
                          </div>

                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {v.desc}
                          </p>
                        </div>
                      </div>

                      {/* Right: Favourite Star + Audio Audition Play Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(v);
                        }}
                        className={`p-1.5 rounded-lg border text-xs transition-all shrink-0 ${
                          isFavorite(v.id)
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-amber-200 border border-slate-800 hover:border-amber-500/40'
                        }`}
                        title={isFavorite(v.id) ? 'Remove from favourites' : 'Add to favourites'}
                      >
                        <Star className={`w-3 h-3 ${isFavorite(v.id) ? 'fill-current' : ''}`} />
                      </button>

                      {v.previewUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePreview(v.id, v.previewUrl);
                          }}
                          className={`p-1.5 rounded-lg border text-xs transition-all shrink-0 ${
                            isPlaying
                              ? 'bg-amber-500 text-white border-amber-400 animate-pulse'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40'
                          }`}
                          title="Listen to sample"
                        >
                          {isPlaying ? (
                            <Square className="w-3 h-3 fill-current" />
                          ) : (
                            <Play className="w-3 h-3 fill-current text-indigo-400" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
