# Changelog

All notable changes to DHVANI are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Hindi is the default dub language, and the voice picker suggests Indian voices.** A new install
  starts on Hindi; an install still on the old Bengali default moves to Hindi once, and picking
  Bengali again afterwards sticks. The voice picker opens on an **Indian** filter — voices with an
  Indian accent or an Indian language on ElevenLabs, plus your own clones named for one ("Hindi dub
  2") — with voices that speak the dub language listed first and tagged with it. Click **Indian** to
  see the whole library; the choice is remembered. While it is on, the accent chips list Indian accents
  (Standard, Indian, Gujarati, Marathi, …) instead of American, British or Latin American.

- **Settings entered in the app now take precedence over `.env`.** DHVANI is installed per person,
  and each person has their own keys, gateway host and models. Previously an environment variable
  won and the setup screen went read-only over it — so a build shared with a colleague kept running
  on whoever's `.env` shipped inside it, and the screen could only report that, not fix it. The
  environment now *seeds* an install that has never been configured; anything saved from **API
  Settings** is written to this computer's own config file and takes over from there. Set
  `ALLOW_KEY_SETUP=false` to make the environment the last word instead.

### Fixed

- **Long dubs play as one continuous read, without cuts or voice changes between sections.** A long
  script is generated in passages, and the passages' MP3 files were appended byte for byte. Each
  generation carries its own edge silence — Eleven v3 leaves almost none, so one sentence ran
  straight into the next — plus its own encoder padding and level, and v3 passages had no link to
  one another at all. Now:
  - passages are decoded and joined as audio: the silence at each join is replaced by a pause
    matching the script (sentence, breath or paragraph), the joins are faded so they cannot click,
    and every passage is brought to the same speech loudness;
  - every passage of a dub shares one seed, so the voice is sampled the same way throughout;
  - on models that support it (Multilingual v2, Flash, Turbo) each passage is stitched to the audio
    before it with ElevenLabs request stitching, so voice and intonation carry across the join;
  - Eleven v3, which cannot stitch, is generated in passages of up to 3000 characters instead of
    1000, so a dub has a third as many joins.

  Smooth joins need ffmpeg (bundled with DHVANI); without it passages are appended as before.

- **Dubs no longer start or stop abruptly.** ElevenLabs often begins a generation on the first
  syllable and ends it on the last one (Eleven v3 left about 0.05 s either side), so a dub sounded
  cut off. Every dub now has a fixed 0.3 s lead-in and 1.2 s run-out of silence, whatever the take
  left, and the final word keeps its full decay.

- **Dubbed voices sound like they do on the ElevenLabs website, not robotic.** Four causes, all fixed:
  - Every dub forced one fixed set of voice settings, including a slowed-down speed of 0.9 that made
    voices drawl. A dub now uses the voice's own ElevenLabs settings, as the website does, and the
    Voice Settings sliders show them. Moving a slider stores a custom override for that voice;
    **Reset to this voice's own settings** clears it, and picking another voice clears it too.
    Settings saved by earlier versions are not carried over, because they were the old forced values.
  - Subtitle cues were joined with blank lines, so ElevenLabs treated each on-screen fragment as its
    own paragraph and paused mid-sentence. Cues are now rejoined into flowing sentences, with a line
    break only where a sentence ends at a real pause in the original audio.
  - A long script went to ElevenLabs as one request, and quality drifted over the length of the
    audio. It is now generated in passages of up to 1,000 characters, each given the text before
    and after it so the intonation carries across, then joined into one file.
  - Step 3 said "ElevenLabs v3" whatever model was chosen; it now names the model actually used.
- **Eleven v3 is in the built-in model list and is now the default voice model** (it was Eleven
  Multilingual v2). A model already picked in Voice Settings, or set with `ELEVENLABS_TTS_MODEL`,
  is kept. v3 ignores the Speaking Speed setting.

### Added

- **QA & sign-off cockpit.** A fifth review layout in Step 2, beside Studio Cards and Cue Sheet
  Table. Eleven automated checks run over the cue list — timestamp integrity, cue ordering, timing
  provenance, translation coverage, reading speed, cue duration and length, do-not-translate terms,
  house renderings, leftover Latin text, numerals, and speaker labelling — and each flagged cue is
  listed with its timecode, its source and target text, and the offending fragment highlighted.
  A house-rendering violation comes with a one-click correction; a blocking finding can instead be
  waived, which records who waived it, when, and why. Nothing is judged silently: a check with
  nothing to compare against reports as "not run" rather than as a pass.

  Above it sits a **sign-off chain** — automated QA, then a language lead, then brand and
  compliance — kept per job and per target language, because the same master dubbed into two
  languages is two approvals. Each human stage unlocks only when the one before it is clear, and
  correcting the script after a signature withdraws that signature with the reason recorded. If a
  rule is tightened after everyone has signed, the file reads as *signed but stale* rather than
  cleared, and the signatures can be withdrawn and given again.

  Locked terminology lives with it: a **do-not-translate** rule for names and programme titles that
  must survive translation, and a **house rendering** rule naming the approved word and the ones the
  language lead has rejected. Terms are stored on this computer and apply to every job.

  The review ribbon and the Step 2 footer both carry the blocking count, so a dub is never started
  in ignorance of an outstanding issue — it can still be started, which stays the reviewer's call.

- **The API & Translation Engine dialog fits on one screen.** The three cards — ElevenLabs, Google
  Gemini and your own gateway — sit side by side with the gateway spanning both rows, so the
  Detected panel fills the space beside it instead of leaving a dead strip. The endpoint sections
  start folded, with a badge on the summary when they hold a non-default value, and the gateway's
  own fields stack on the card's width rather than the window's. It no longer scrolls at 1024×768
  and up; previously the body needed 1337px against 712px available, most of it blank.
- **Endpoints and model names are editable in the app**, under an *Endpoint & models* disclosure in
  each provider card: ElevenLabs base URL, transcription model and voice model; Gemini base URL,
  translation models and speech model. They save to the same per-machine config as the keys, take
  effect immediately with no restart, and each row shows where its live value came from. Exposed on
  `GET /api/settings` as `server.values` / `server.origins`.
- **`ELEVENLABS_BASE_URL` and `GEMINI_BASE_URL`**, for a proxy, mirror or regional endpoint. An
  ElevenLabs base URL entered as a bare host gets `/v1` appended; a path typed deliberately is left
  alone.
- Saving an endpoint or model now validates it together with the key it belongs to — against the
  stored key when no new one was typed — so a good key against a mistyped host is caught at setup
  rather than on the first upload. A Gemini model list is checked by using it, and the model that
  answered is saved first so the next translation does not start with a failed round-trip.
- **Self-hosted LLM gateway support for translation.** Point DHVANI at your own LiteLLM, vLLM,
  OpenRouter, one-api, Portkey or LocalAI server instead of calling Google directly, via
  `LLM_GATEWAY_URL` / `LLM_GATEWAY_KEY` or the setup screen. Both the OpenAI Chat Completions and
  the Google generativelanguage wire formats are supported.
- **Gateway auto-discovery.** The setup screen probes the URL as you type: it resolves the base path
  (a bare `host:port`, a `/v1` URL and a full `/v1/chat/completions` endpoint all work), lists the
  models the gateway exposes, auto-picks a sensible one, and confirms with a real completion before
  anything is saved. Exposed as `POST /api/settings/gateway/test`.
- The API key is **optional for a gateway on localhost or a private network**, matching how local
  LiteLLM and vLLM deployments usually run. A public gateway still requires one.
- Discovered models are shown as a clickable list and filtered to chat-capable ones, with
  LiteLLM's provider-prefixed names (`vertex_ai/…`) preserved verbatim.
- `/api/health` and `/api/settings` now report which translation backend is active.
- **Detected panel** in both credential dialogs, reporting every credential in one vocabulary
  (working / key rejected / wrong URL / model missing / rate limited / provider down / unverified),
  with the provider identified from the key prefix with no network call, the endpoint's real model
  list, and a Re-check button. Picking a model from the list writes it into the field.
- **Advanced Settings** section in the Voice Settings dialog, with an **API & Translation Engine**
  button that reopens the credential form after first-run setup. It opens prefilled with the live
  configuration, and is replaced by an explanation when the backend will not accept changes.

### Fixed

- Reasoning models reported as broken. The connection probe allowed 16 output tokens, so a model
  that reasons before answering (`gemini-2.5-pro`, `gemini-3-pro-preview`) spent the whole budget
  thinking and returned no text. The probe now allows 512, gateway calls send
  `LLM_GATEWAY_MAX_TOKENS` (default 8192), and a budget-exhausted response says so rather than
  reporting "no content".
- A key scoped to a subset of models read as a bad key and aborted the whole model cascade, hiding
  every model the key could actually use. A model restriction now moves to the next candidate, and
  a single restricted model is swapped for one the key may use.
- A blank key field wiped the stored credential. The settings form cannot show a saved secret, so
  its key boxes start empty — changing only the gateway URL silently deleted the bearer token.
  Blank now means "leave unchanged"; clearing goes through the explicit delete.
- Reopening settings reported a working gateway as broken, because it probed with the blank key box
  rather than the stored credential.
- A gateway that requires a key but was probed without one reported "could not reach", sending
  people after a network problem that was not there. A 401 is now reported as such.
- A pasted chat-UI address (`…/ui`, `…/chat`, `…/playground`, `…/docs`) is trimmed to the API base.

### Changed

- Text-model calls go through a small router (`server/providers/textModel.js`) that picks Google or
  the gateway, so translation, alignment, Indic polish, cue splitting and SSML all work with either.
  Subtitle timing is unchanged — it comes from ElevenLabs regardless.

## [1.0.0] — 2026-09-18

First standalone release. DHVANI began as a Google AI Studio app; this version runs entirely on your
own machine and no longer depends on that platform in any way.

### Added

- **Local backend.** An Express server that holds your API keys and proxies every provider call, so
  no credential exists in client-side code.
- **ElevenLabs Scribe transcription** with word-level timestamps, which are now the source of truth
  for all subtitle timing.
- **Source language selection**, with auto-detect as the default. Any language Scribe supports, not
  just the two the old prompt allowed.
- **Video support.** Audio is extracted with ffmpeg before upload; the original video file is never
  modified.
- **First-run setup screen.** Validates and saves both API keys to your machine's config directory,
  so the packaged builds need no terminal. Loopback-only.
- **Live pipeline progress** streamed over NDJSON — upload, transcription, SRT generation and each
  translation batch, instead of one indeterminate spinner.
- **Original-language SRT export.** The export dialog now offers the translated or the original
  track, and marks an export "Exact ElevenLabs timings" when every cue edge is a measured word.
- **Timing-integrity checks.** `assertTimingsPreserved` verifies that translation changed no
  timestamp. Covered by tests, including one that feeds the pipeline a deliberately hostile
  translator returning timecode-shaped text.
- **Provider registry.** Transcription and translation are resolved by capability, so another engine
  can be added without touching routes or the pipeline.
- **Packaging.** Docker image and Compose file, Windows/macOS/Linux desktop installers, and a plain
  zip distribution with one-click launchers.
- **Security hardening.** Content Security Policy with `connect-src 'self'`, Helmet headers,
  compression, per-IP rate limiting, `trust proxy` restricted to loopback, and a warning when the
  server is bound to a non-loopback address.
- **Documentation.** `docs/ARCHITECTURE.md`, `docs/MIGRATION.md`, `SECURITY.md`, `CONTRIBUTING.md`.
- **Tests and CI.** 15 tests covering the timing guarantee and pipeline behaviour, plus GitHub
  Actions running typecheck, tests and build on Node 20 and 22.

### Changed

- **The subtitle workflow.** Previously Gemini listened to the audio and *estimated* timestamps,
  which drifted between runs. Now ElevenLabs measures every timestamp and Gemini translates text
  only — it never receives a timestamp and never returns one.
- **Long files** translate in batches merged by cue id, so cue order and numbering cannot break.
- **A failed translation no longer discards the run.** The transcript, word timestamps and original
  SRT are preserved, and retranslation reuses them without re-sending the audio.
- **Provider errors** are reported as messages that name the cause and the fix rather than a status
  code.
- **Build output** is split into app, React, icon and zip chunks so an update re-downloads only what
  changed.

### Removed

- The `aistudiocdn.com` import map for React and `@google/genai`.
- The Vite `define` block that compiled the Gemini API key into the browser bundle.
- `metadata.json`, the AI Studio app manifest.
- The Gemini SDK from the browser bundle entirely; it now runs server-side only.

### Fixed

- `VoiceSelectorCard` referenced an undeclared `filtered` variable, throwing a `ReferenceError` when
  rendering the voice list.
- `ProcessingStatus.READY` was used but missing from the enum, leaving those jobs with an undefined
  status.
- `AudioSegment` was missing the `originalText` / `targetText` / `text` aliases that several
  components read and write.
- SRT timecode parsing accumulated floating-point error, so a round-tripped SRT could fail the
  timing-integrity check by a fraction of a millisecond.
- Resolved all 8 npm audit advisories inherited from the original toolchain.

### Security

- API keys are never sent to the browser, never logged, and never returned by any endpoint.
- The key-setup endpoint accepts requests only from `127.0.0.1` / `::1`, and can be disabled with
  `ALLOW_KEY_SETUP=false`.
- Saved key files are written with owner-only permissions.
- Gemini receives subtitle text only — never your media, never timestamps.

[Unreleased]: https://github.com/dhvani-studio/dhvani/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dhvani-studio/dhvani/releases/tag/v1.0.0
