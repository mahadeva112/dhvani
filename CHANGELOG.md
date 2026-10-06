# Changelog

All notable changes to DHVANI are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Split and join cues on the Review step.** Play to where a cue should end and press **S**, or
  click a word in the Original column and press **S** (or Ctrl+Enter): the cut lands on the
  measured word gap, and the dub text breaks at the nearest comma or full stop. A bar under the
  waveform then shows the cut: **Alt+← / →** moves it one word, **H** plays the original either
  side of it, clicking between two dub words moves where the dub text breaks, and **Re-translate
  halves** translates each half on its own. **M** joins a cue with the next, and **Ctrl+Z** undoes
  a split or join. A cut with no pause in it is still voiced as one line by Sync.

- **Take a script to another computer.** The script's row under Downloads in the Final dub saves
  it with every line's time, speaker and original; its arrow offers the dialogue, timecoded,
  bilingual and spreadsheet versions too, so every script format is saved from one place. On the
  other computer, **Paste script → Open file** (or pasting the file's text) puts each line back on
  the cue at its time. If that computer's transcript cut the audio into the same cues, each line
  goes back to its cue. If the cues differ, lines that fall inside a cue join it whole, and only a
  line that runs over several cues is split between them by meaning. Audio of another length is
  reported, and the script is then matched to the English as before. Dhvani's text exports
  (dialogue, timecoded, bilingual) can be pasted back too: their header, cue numbers, timings and
  speaker names no longer end up in the script.
- **An Expert estimate in the Sync preview, beside the Quick one.** A **Quick | Expert** switch on
  the Sync preview (Final dub and Sync) picks how long each dub line is expected to take. Quick is
  the estimate as before: characters at the voice's rate. Expert counts syllables, which suits
  Indian scripts, where one syllable can be several characters and a word's last "a" is often not
  said; adds the pauses its commas and full stops ask for; and shows a fast-to-slow range under each
  line. It also marks where the lips close (p, b, m, and प फ ब भ म in Indian scripts): ▼ on the
  original, from its word timings, and ▲ on the dub, with a count of how many match. In Expert the
  dub lane can also be a **Rythmo** band: the dub's words on the timeline, each squeezed or stretched
  to the time it takes, red once past its slot. A picked line shows its syllables word by word, how
  many to cut or how much room is left, and its own band. The syllable rate comes from the same
  measured rate, so over the whole dub both estimates agree; only how the time is shared between
  lines differs. The pick, and Bars or Rythmo, are remembered.
- **Three suggestions for a line, read in context.** In Review and the Final dub, suggesting a
  shorter or fuller wording for one line now offers three of different kinds (closest to the dub,
  most natural spoken, a different sentence shape), each checked against the original line's
  meaning; pick one, then edit it. The text model now works out what the original line means first,
  and reads it with the two dub lines either side and its speaker. **Suggest for all** still gives
  each line one wording.
- **Each track has its own level in the Final dub and Sync players.** Beside each lane, and beside
  the lanes in Edit timing, a strip gives the original and the dub a **M**ute, a **S**olo, a fader
  from −∞ to +6 dB (double-click for 0 dB) and a level meter. Solo replaces the Original / Dub / Both
  buttons: solo one track to hear only it, press again to hear both. The levels are for listening
  only; the dub files, renders and downloads are unchanged. Levels, mutes and the solo are
  remembered across restarts.
- **Review shows each line's length and lets you size the text.** Every Review view (Cues, Cards,
  Spotlight, Script) now shows the character count under both the original line and the
  translation, and the translation's count updates as you type. Document shows each column's total.
  **−** and **+** in the Review toolbar make the script smaller or larger (12 to 22 px), and clicking
  the size between them resets it. The size is remembered, and text now starts at 15 px instead of
  12 to 13 px.
- **Edit timing: fix a synced dub's lines by hand.** After Sync, **Edit timing** in the Sync step's
  player turns its lanes into an editor under the original. As in REAPER and DaVinci Resolve, no
  tool has to be picked: where a drag starts on a line says what it does, and the cursor and a hint
  show it first. Drag the middle to move a line (Shift: push the lines after it along), an edge to
  trim it, Alt + an edge to stretch it (pitch kept), Alt + the middle to slip the audio inside, a
  top corner to fade it and the top edge up or down to turn it up or down. **Snap** (N) catches the
  original's lines, other lines and the playhead (a moved line's first word snaps to its original
  line's start); **Ripple** pushes later lines along on every move; **Blade** (B) cuts where you
  click. **Split** (S) at the pointer or the playhead, **Join** (G), **Align to original** (A),
  **Mute** (M), **Lock** (L), nudges of 10 ms or 100 ms (`,` `.`), Undo / Redo and a history to
  step back to.
  An overview of the whole dub, sync links, the script under each line and a start-drift lane show
  how every line lands as you edit; the report, the download and the player follow once the edit is
  rendered. Every line you edit is locked: **Sync again** places the others around it and leaves it
  where you put it, as long as it comes back as the same take. A line you leave alone is copied in
  exactly as Sync placed it, so **Reset all edits** is the synced dub again, sample for sample; speed,
  level and fades change only on the lines you set them on. The lines are kept with the project, so
  edits work after a restart. Dubs synced before this release need **Sync again** to be edited.
- **Your projects: every dub is kept until you delete it.** **New dub** no longer deletes the dub
  you were on; it starts a new project beside it. A **Projects** menu in the header lists your recent
  projects to switch between, rename or delete, and **See all projects** opens the full list (what
  was the Batch queue), with **Clear all history**. A project's file, translation and dub are only
  removed when you delete it or clear all history, each after a confirmation. Projects are listed
  newest first, show when they were last worked on, and the app reopens the one you had open.
  Opening a project lands on the step you last had it on, or as far as it has got: a file not yet
  transcribed opens on **Source & voice** (it used to open on Review with empty cues), and is listed
  as not started.
- **Dubs with several speakers, one voice each.** Turn on **More than one person speaks** in Dub
  setup and ElevenLabs labels who says each line (optionally told how many speakers there are). The
  Review step then shows who speaks when, filters cues by speaker, lets you rename speakers or merge
  one into another, hand any cue to another speaker, and flags labels that look like slips (a short
  switch between two lines of one speaker, or a speaker who says almost nothing) with **Make it …**
  and **Keep**. In Final dub a **Cast** card gives each speaker their own voice, from ElevenLabs or
  Cartesia; anyone without one is read by the main voice. Each speaker is voiced as one read, told
  only their own lines either side, so voices never pick up each other's delivery. Sync keeps the
  overlaps where people talk at once in the original instead of pushing lines back. Every line is
  kept exactly as voiced; **Even out speakers** (off by default) gives one gain per speaker. Where
  speakers overlap, the mix is kept as summed in 32-bit float so nothing clips, or, if you choose,
  lowered as a whole by a stated amount. Both dubs come with one stem per speaker to download, all
  the same length. The QA check no longer blocks on two speakers overlapping.
- **A new version announces itself once.** When the desktop app finds a newer release, a notice in
  the corner says so, with **See what's new** and **Later**. Each version shows it once; the header's
  Update button stays as before.
- **Updates show their progress while they install.** **Restart and install** used to close DHVANI
  with nothing on screen until the new version opened. Now the app shows the install steps for a
  moment before it closes, a small **Updating DHVANI** window stays on top while the installer runs
  (Windows, in-app updates only), and once the new version opens a message in the corner confirms
  it, once.
- **Final dub shows each line's sync fit.** The Final script now times every dub line against its
  source sentence, the same estimate the Sync preview makes: a badge (**+0.6 s over**, **Ends 1.4 s
  early**, **Tight** or **Fits**), a bar against the slot, and a **Sync fit** strip with the counts and
  a **Lines to fix** filter. The software picks the direction from the source sentence, so a line
  offers **Suggest a shorter line** or **Suggest a fuller line**, never both, with the length to aim
  for; fitting lines show nothing to do. **Suggest for all** asks for every open line its own way.
  Nothing is voiced and no ElevenLabs characters are used; Sync voices the new wording.
- **Final dub shows the Sync preview, and you can trim a line to the length you want.** The same
  counts and Original / Dub timeline as the Sync step now sit above the Final script. Click a dub
  bar and drag its end (or use the arrow keys) to the length the line should take: a readout shows
  the seconds and the characters they hold, the trim snaps to the end of the original speech, and
  it never runs past the next line. That line's suggestion then aims for your length
  (**Suggest a 2.6 s line**), shorter or fuller as the trim needs. Trims are saved with the project,
  the Sync step's suggestions use them too, and **Reset trim** goes back to the length from the
  slot. Only the length is trimmed: Sync still starts every line where its sentence starts.
- **The speaking rate no longer drifts as you edit.** A dub now saves how many characters it was
  voiced from, so editing lines afterwards no longer moves every other line's estimate.

- **Sync suggests a fuller line when a dub line ends early.** The Sync preview already offered a
  shorter wording for lines too long for their slot; it now also flags lines likely to end well
  before the original speaker stops (under 60% of their speech and at least 1 s left quiet) under
  **Fill out lines that end early**, and offers **Suggest a fuller line**: the same meaning, said in
  full, restoring what the translation dropped, never new content or filler. The timeline shows the
  quiet stretch as a dashed box. As with shorter lines, nothing changes until you press **Use this line**.
  Sync itself does the same from the real voiced clips: a new **Suggest fuller lines** setting (on by
  default) sits under **Suggest shorter lines**, the report counts **Lines that end early**, and each
  one under **Worth a listen** gets a suggested fuller line with **Try another** and an estimate of
  whether it now fills the original speech.
- **Every suggested line is checked against the source line's meaning before you see it.** Shorter and
  fuller wordings alike go to a second, strict text-model check that compares them with the original
  line: every idea, negation, condition, tense, name and number must be kept, and nothing added. A
  wording that fails gets one repair, told exactly what changed; if that fails too, no suggestion is
  shown, and Sync says how many were held back. An unreadable check counts as a failure.
- **Update button in the desktop app.** When a newer release is published on GitHub, a blue
  **Update to 1.x.x** button appears in the header. It opens a window with the release notes,
  **Download and install** with a progress bar, then **Restart and install** (held back while a dub or
  sync runs) or **Install when I close**. **Tools → Check for updates** checks on demand; DHVANI also
  checks when it opens and every four hours, and never downloads without being asked. The installed
  Windows app and the Linux AppImage install updates themselves; portable copies and macOS builds are
  sent to the Releases page. Only published releases are offered, never drafts.
- **Cartesia as a second voice engine.** ElevenLabs stays the default. Switch to Cartesia under
  **API settings → Transcription and voice**, or with the **ElevenLabs | Cartesia** switch in the
  voice picker (without a Cartesia key yet, it opens API settings on Cartesia so you can paste one). Only one engine is on at a time: switching to
  Cartesia shows only Cartesia voices and dubs with Cartesia, and switching back turns Cartesia off.
  Each engine remembers the last voice picked on it, and the header shows the engine that is on
  (the ElevenLabs allowance is hidden while Cartesia speaks). Cartesia dubs (`sonic-3.6` by default, which speaks Hindi, Tamil, Telugu,
  Bengali, Odia and the other Indian languages). Long scripts are voiced in passages and joined like
  an ElevenLabs dub, with the same progress bar and Cancel button. The Voice changer can clone a
  voice on Cartesia from one clip, and **API settings** can switch transcription to Cartesia Ink,
  whose word timestamps set cue edges exactly as ElevenLabs' do. Cartesia retired its voice changer
  in August 2026, so changing a recording's voice still needs an ElevenLabs voice.

- **The synced timeline shows how every line landed.** Sync's Original / Dub view now draws a
  line from each original line's start to its dub line's start (upright when in sync, slanted when
  early or late, coloured by how far off), numbers the lines in both lanes, shows both waveforms,
  outlines where each original line is, hatches the part of a dub line that runs into the next
  line, and charts each line's start error against the tolerance so drift that builds up line after
  line is plain to see. Hover a line for its times, offset and overrun; when long lines push the dub
  late, a note says so.
- **The Final dub preview names the line being heard.** The line under the playhead is ringed on
  both lanes and spelled out under the timeline (**Now #12**), and the Final script highlights it
  and keeps it in view while playing.

### Changed

- **One Export subtitles button on Sync.** The .vtt and Subtitle settings buttons under the
  subtitle card are now one **Export subtitles** button, which opens the settings (now titled
  Export subtitles) to check the subtitles and then download the .srt or .vtt. The subtitle card
  still downloads in one click. Export subtitles now remembers its **Language** and **Timed to**
  choices as well as the style, and the card downloads with all of them: its name and line show the
  language and timing it will use.
- **Translation uses Natural Conversational by default.** It now heads the style list as the
  recommended style, in place of Sadhguru 3-Step Dubbing. A style you picked yourself in the
  Translation style dialog is kept.
- **Review says how a line paces in words, not cps.** The cue list, Cards, Spotlight, the player's
  caption and the Review panel's "Needs attention" no longer show characters-per-second figures:
  each line reads **Natural**, **Tight** or **Too fast**, with its pacing bar, and a QA finding says
  "Cue 2 is too fast for its 3.2s slot". The QA settings still set the limit in cps.
- **Adding a file no longer starts transcribing it, and a transcription can be cancelled.** A new
  file is only added: its waveform and length show, and nothing goes to ElevenLabs until you press
  **Transcribe audio**, so the language and speakers can be set first. While it runs, **Cancel
  transcription** stops it at once, in the app and on the server: ffmpeg is stopped, the request to
  ElevenLabs is dropped and never retried, nothing after it (translation) runs, and the uploaded
  file is deleted. The project stays as it was; a cancelled **Transcribe again** keeps the
  transcript you had. Once the audio has reached ElevenLabs, ElevenLabs may still count it.
- **Steps open one at a time.** All four steps stay in the header as they look today, and a step
  not reached yet can't be opened (hover it to see why): **Review** opens once the audio is
  transcribed, **Final dub** once there is a script (translated or your own), and **Sync** once
  there is a dub. While a step's work runs (transcribing, translating, dubbing), the steps after it
  can't be opened until it finishes. The buttons on each page that lead on follow the same rule, and a project reopens on
  the furthest step it has reached.
- **Review's mini player is a slim bar that never covers a cue.** Once the full player scrolls out
  of sight, play, previous / next cue, the cue and time, the waveform and a way back to the full
  player sit in one 40 px bar along the bottom of the window, in place of the card in the corner
  that hid the cue text under it. The page keeps that much room below its end, so the last cues
  scroll clear of the bar.
- **Each line keeps one colour, and the waveforms are no longer covered.** In Final dub, the Sync
  preview and the **Sync to the original** report, every line has its own colour, the same in the
  Original and dub lanes, the line lists and the links between them, so a line can be followed from
  step to step. The waveform is drawn bright over a light tint of that colour instead of faintly
  under solid or striped bars. How a line fits or landed shows as a dot by its number; a line that
  runs past its slot or into the next line has a thin strip under it in place of the stripes. The
  Sync preview's Original lane now shows the original's waveform, and the report's Original lane
  says where the original ends.
- **The Sync step's player shows line colours too.** Its Original and Synced lanes draw each line in
  its colour, with links between them showing where each line moved to in the synced dub.
- **Sync timelines open on the whole track, and zoom in for detail.** The Sync preview's timeline
  and the **Sync to the original** report used to show 30 seconds at a time. Both now open on the
  whole track. To see a part up close, use the **Zoom in** / **Zoom out** buttons, Ctrl + scroll (or
  a trackpad pinch) over the lanes, or drag across the times above them; **Whole track** goes back.
  Zoomed in, the scroll bar and following the playhead work as before. The preview's timeline now
  has the same time ruler as the report's.
- **Updates install faster.** The desktop app no longer ships about 4,300 files it never used (the
  UI's libraries are already bundled into it), so each update has far fewer files to delete, write
  and virus-scan.
- **Natural syncs closer, with fewer pause cuts.** A line that runs long now uses more of the pause
  after it before any silence inside it is taken out: the dub keeps at least 30% of the original
  pause between lines (was 50%), never less than 180 ms, and 250 ms where the speaker changes (was
  300 ms). Lines are grouped, voiced, trimmed and rendered as before. If you picked Natural (or any
  preset) before, Sync uses the new values; Custom settings are kept as they are.
- **Sync starts with line suggestions off.** **Suggest shorter lines** and **Suggest fuller lines**
  are now unchecked by default; turn them on when you want them.
- **Sync is its own step.** The steps are now **Source & voice → Review → Final dub → Sync**. The
  Sync panel moved out of Final dub into step 4. The results (line counts, the Original/Dub timeline and
  **Worth a listen**) fill the main column, and a right-hand panel holds Precision, **Suggest shorter
  lines**, **Even out loudness**, the Sync / Sync again / Cancel button and, once synced, the synced
  dub (.wav) and subtitles timed to it (.srt). A small player at the top plays the lines you
  **Listen** to. Once a dub exists, Final dub shows a **Continue to sync** strip where the panel used
  to be. The header marks each step done, current, next or locked (with the reason on hover), shows
  how many lines changed since the last sync, and shows sync progress while you work on other steps.
  Sync is available whenever there are cues, as before. Review and Final dub are otherwise unchanged.
- **Subtitles come from Sync, after a sync.** The .srt, .vtt and Subtitle settings moved from Final dub
  to step 4's right-hand panel, and appear once the dub is synced, timed to the synced dub: each cue
  sits exactly where Sync placed its line (files end in `_synced`). Subtitle settings gains a **Synced
  dub** timing, chosen by default, next to Original speech and The dub.
- **A preview before you sync.** Before the first sync, step 4 estimates which lines will fit the time
  the original gives them, with nothing voiced and no ElevenLabs characters used. It groups lines and
  works out each line's time exactly as Sync does. How long each dub line takes is estimated from its
  length and the voice's speaking rate, measured from your Final dub (or a typical rate, marked rough,
  when there is no dub yet). The Original/Dub timeline shows the estimate striped, with the part that
  should run past its slot in yellow. **Shorten before you sync** lists the lines likely too long:
  **Suggest a shorter line** asks your text model for one (**Try another** asks for a different one),
  or **Edit it myself**. Either way you see the new estimate as you type, and nothing reaches the script
  until **Use this line**, which can be undone. Changing Precision updates the preview; once a dub is
  synced, the real results take its place.
- **Sync timelines scroll and play.** Under the preview's and the report's Original/Dub timeline, a
  scroll bar covers the whole dub. Drag it, click to jump, use the arrow, Page and Home / End keys, or
  swipe sideways on the lanes. It marks every line to check and where playback is. A play / pause
  button and the clock sit right under the graph. Tight lines now show an amber edge instead of a
  ring, and their row is a proper Show / Hide toggle. The playhead, the scroll bar's playback mark and
  the clock follow the audio every frame, as on the Final dub step, instead of stepping a few times a
  second.
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

### Removed

- **Cue sheet .csv and Data .json downloads** are gone from Final dub.

### Fixed

- **The players no longer make an out-of-sync dub look synced.** The Final dub and Sync players
  drew each lane over its own length, so a 0:59 dub and a 0:47 original both filled the width and an
  11 s drift looked like none. Both lanes now share one timeline as long as the longer track: the
  shorter one ends early with "Original ends 0:47", and the links between the lanes slant as far
  as each line moved. In Both, the clock's total is the longer track.
- **"Synced" no longer reads as "in sync".** The Sync badge is green only when every line is in
  sync; otherwise it is amber and says what is off, such as "Synced · 9 lines too long · worst line
  off by 11.4 s". The Sync step's player shows the same badge.
- **Sync no longer cuts off the end of a line, or clicks there.** A line the voice stopped
  mid-word, still loud, used to go into the dub as it was, ending on an audible click. Sync now
  spots such a take and voices the line again with another seed, up to two more times, and uses the
  first take that finishes its last word. A line still cut off after that is listed under **Worth a
  listen**, so you can retake or reword it. A take you locked in Edit timing is kept as it is.
  Two changes make cut-off takes rarer. Sync no longer splits a sentence across two lines: a cue
  whose sentence isn't over takes the next cue, past the grouping gap (up to 1.2 s) and past the
  longest line (up to 30 s). And each line is voiced ending in a full stop, or a danda in Bengali,
  Hindi, Marathi, Nepali, Assamese and Odia, so the voice finishes it.
- **Review's Previous / Next buttons work, and stay in reach.** While the playhead rested inside a
  cue, the list snapped straight back to that cue's page, so Next and Previous looked dead. Now the
  list moves only when playback reaches a new cue. The paging bar stays pinned to the bottom of the
  list, and Spotlight's Previous / Next bar stays pinned to the top, so neither scrolls away on a
  long page. A new page opens at its first cue, and clicking a cue in the player spotlights the right
  cue when a filter is on.
- **Sync no longer replaces the dub.** Syncing used to overwrite the Final dub, so the unsynced dub
  was gone. Now the synced dub is its own file: the Final dub step keeps playing the dub, and the
  Sync step plays the synced dub. Its player shows the whole original with the whole synced dub
  under it, one waveform each, as the Final dub step does, and the line view below names its lanes
  **Original** and **Synced**. Download
  and the voice changer use the file of the step you are on, a new dub keeps the synced one, and a
  batch export carries both (`_dubbed` and `_synced`).
- **The dub and the synced dub come back after a reload.** They were saved but nothing reopened
  them, so a reloaded session had no dub to play. Now both play again, and a job reloaded while it
  was dubbing or syncing no longer shows as still working. A session saved before this fix shows its
  synced dub in the Sync step, since the dub that sync replaced was already gone.
- **Playheads always match what you hear.** Every waveform and timeline now moves its playhead on
  the frame being drawn, from the audio's own position, and never re-renders the page to do it:
  - Switching Original / Dub / Both is one step, so the playhead's clock and the audio can no
    longer disagree; the Listen buttons no longer play the wrong track.
  - In **Both**, the dub is kept locked to the original instead of drifting.
  - Pauses from the system or media keys, a track ending, and a new dub arriving now update the
    player instead of leaving it showing play.
  - Each lane and waveform is drawn on its own track's length, and waveforms line up with the audio
    over long files (they drifted by up to 1.6 s an hour on 44.1 kHz devices).
  - While an unsynced dub plays, cue highlights and jumps follow the dub; the sync previews hide
    their playhead instead of guessing, since an unsynced dub's lines don't sit on the original's
    timeline.
  - Long scripts no longer make the playhead stutter.
  - A new dub no longer shows the previous dub's waveform while it loads.

- **The Sync step plays the track you picked.** The Sync preview's play button and timeline switched
  back to **Original**, and **Listen** on a synced line switched to **Both**, whatever was picked in
  Listen to. They now play **Original**, **Dub** or **Both** as chosen; on an unsynced dub, a click on
  the preview timeline lands on the same line in the dub. **▶ Original** on a line still plays the
  original.

- **Dubs sound spoken, not read aloud.** Three causes:
  - Translation was briefed as subtitles, so it came back as written language. It is now briefed as
    a dub to be spoken: everyday spoken vocabulary rather than bookish words, the speaker's own
    rhythm, and punctuation for the ear. The chosen style preset still sets the tone.
  - Eleven v3 reads plain text evenly. Before a v3 dub, the text model now adds delivery cues —
    sparse audio tags such as `[thoughtful]` or `[chuckles]`, and speech punctuation such as "…" —
    as the Enhance button on the ElevenLabs website does. The words themselves are checked to be
    unchanged; if the model altered any, or is unavailable, the passage is spoken as written.
  - A voice's saved settings are usually tuned for older models, and their stability put v3 in its
    "Robust" mode, which ElevenLabs describes as similar to v2 and less responsive. A dub on the
    voice's own settings now uses v3's "Natural" mode; a stability you set yourself is kept.

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
