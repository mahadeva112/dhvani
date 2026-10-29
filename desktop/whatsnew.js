/**
 * Help → What's New (desktop/whatsnew.html). One or two short, plain lines per
 * version, newest first. Add the next version's lines here before releasing;
 * versions newer than the running app are not shown.
 */
window.WHATS_NEW = [
  {
    version: '1.4.5',
    changes: [
      'Translation style: save your instructions under your own name with Save as. Your prompts are listed under the built-in styles, where you can pick, rename or delete them. App updates never change or reset them.',
    ],
  },
  {
    version: '1.4.4',
    changes: [
      'Edit timing: split a line in the wrong place? Drag the cut between the two parts and both move together, as in REAPER or DaVinci Resolve. Nothing is lost or heard twice, and the cut snaps to the middle of a pause. Hold Shift to trim one part only.',
      'Dub step: on wide screens the Final script runs down to the foot of the page and scrolls inside, with Top and Bottom under it.',
    ],
  },
  {
    version: '1.4.3',
    changes: [
      "Translation builds each sentence the way the dub language does, not in English word order, and keeps who does what to whom. Each Indian language is written in its own script only, so Punjabi no longer comes back in Urdu letters.",
      'Translation no longer leaves half a file in English when the model adds something after its answer, and slower thinking models such as Gemini 3.8 Flash and 3.1 Pro no longer get cut off.',
    ],
  },
  {
    version: '1.4.2',
    changes: [
      "Two people on one project: whoever does the script sends a Dhvani JSON, and the dubber opens later ones with Update script. Only the lines the script changed are voiced again on the next Sync; your takes, timing edits and other changes stay.",
      'Export a project light: Projects, the export icon, Light, dub only. It leaves out the original media (it asks for it when opened), takes that are not playing and the undo history, so the file is much smaller. The dub is exactly as it plays.',
    ],
  },
  {
    version: '1.4.1',
    changes: [
      'Retake (T): type [ or press Tags to put ElevenLabs tags such as [whispers] or [sighs] in a line, or write your own in English. They change how it is read and never go into the script or subtitles.',
      'Retake pro (Shift+T): a bigger window with every tag, your own tags and saved styles, what is sent to the voice, Stability (Creative, Natural, Robust) and 1 to 5 takes at once.',
    ],
  },
  {
    version: '1.4.0',
    changes: [
      'Dhvani 1.4: the same app as 1.3.101 (Undo back to the AI translation, and the whole script in one passage in the Word file), under the new version number.',
    ],
  },
  {
    version: '1.3.101',
    changes: [
      'Undo in Review now goes all the way back to the AI translation, one edit at a time, even while you type in a line (Ctrl+Z; Ctrl+Shift+Z to redo). Back to the AI translation puts every line back at once, and that can be undone too.',
      'The Word file now has the whole script in one passage by default (Full), each speaker under their name. Short, Medium and Long next to the Word button give shorter paragraphs.',
    ],
  },
  {
    version: '1.3.100',
    changes: [
      'Save the script as a Word file: each passage as a paragraph in a table, the original on the left and the dub on the right. Use the Word button in Script view, or Word in the Dub step\'s script menu.',
      'When a window can\'t write to the file you pick, saving now downloads it instead of leaving an empty file.',
    ],
  },
  {
    version: '1.3.99',
    changes: [
      'Lines in Edit timing now move freely, as in REAPER: drag one anywhere, over other lines too. Where two lines play together the lane shows red, and nothing is cut. Drag to the edge to scroll, and press Esc to put it back.',
      'The player under the timeline shows the original line above the dub line, in full, without the timing numbers.',
    ],
  },
  {
    version: '1.3.98',
    changes: [
      'A retake used in Edit timing now shows its own waveform at its own length right away, with no trim needed. A longer take plays to its end and shows as an overlap on the next line.',
    ],
  },
  {
    version: '1.3.97',
    changes: [
      'Suggest wording is faster: each wording\'s meaning check and its English ("Says:") now come from one request instead of two.',
    ],
  },
  {
    version: '1.3.96',
    changes: [
      'New Split at pauses (D) in Edit timing: cuts the picked lines in the middle of every pause, as REAPER\'s Dynamic split, and nothing moves. It shares one panel with Tighten silences (Q).',
      'The panel can keep or remove the silence, and Close up now has Off, which takes the silence out but leaves every piece where it was.',
    ],
  },
  {
    version: '1.3.95',
    changes: [
      'The Dub page is simpler: one slim bar shows how the sync went, and a single zoomable player with track lanes, line clips and a scroll bar replaces the second timeline. The line list has tabs: Worth a listen, Too long, End early, Hand edits, Every line.',
      'A translated project can now be re-translated fast: Fast re-translate in Review and in the Translation style window translates without the meaning, length and term checks.',
      'Shorter and longer wording suggestions now come two at a time instead of three.',
    ],
  },
  {
    version: '1.3.94',
    changes: [
      'New Fast translate button above Translate: it only translates, skipping the meaning, length and key-term checks, and sends three batches at once, so a long transcript is ready much sooner.',
    ],
  },
  {
    version: '1.3.93',
    changes: [
      'Matching a long script by meaning no longer leaves a whole paragraph in one cue with the cues after it empty: the paragraph is spread over the cues it says, using only your words.',
      'Every cue left empty now says why (Not in script, Script ended, Not spread, Zero length), and a script file opens cue for cue only when its English matches this transcript.',
    ],
  },
  {
    version: '1.3.92',
    changes: [
      'The transcript can be exported before translating: Dhvani JSON to carry on later (open it with Import project and pick the audio), paragraph text, or one subtitle per segment.',
      'Edit segments on the transcript splits and merges segments before you translate. Click the waveform and press S to split at the playhead.',
      'Clicking the player no longer scrolls it off the screen.',
    ],
  },
  {
    version: '1.3.91',
    changes: [
      'Translation with a slower model no longer fails with "524: A timeout occurred": the answer now arrives as it is written, and a batch that still runs out of time is sent again in smaller pieces.',
    ],
  },
  {
    version: '1.3.90',
    changes: [
      'The synced dub can be saved as MP3 too: Synced dub now has an MP3 button beside WAV (320 kbps). Before, it always saved as WAV, even with MP3 picked under Audio quality.',
    ],
  },
  {
    version: '1.3.89',
    changes: [
      'Every project in See all projects now has an Export button, so projects older than the newest eight can be saved as a .dhvani file too.',
    ],
  },
  {
    version: '1.3.88',
    changes: [
      'Translate no longer sits at 50% the whole time on a short file: it says when it is translating and when it is checking meaning and length.',
      'The long upload message under Transcribe is gone.',
    ],
  },
  {
    version: '1.3.87',
    changes: [
      'Export a project as one .dhvani file, with its video, script, dub, takes and timing edits, from the Projects window. Import project opens it again later or on another computer, and you carry on dubbing from there.',
    ],
  },
  {
    version: '1.3.86',
    changes: [
      'Changing the voice line by line on a long dub no longer stops part way with "Too many requests to the local DHVANI backend".',
      'Timelines play like DaVinci Resolve: the waveform holds still and the playhead walks across it, then the next page starts where the last one ended.',
    ],
  },
  {
    version: '1.3.85',
    changes: [
      'After the voice changer replaces the whole dub, Undo voice change beside Edit timing brings back the dub from before, with your timing edits, so you can edit its timing again.',
    ],
  },
  {
    version: '1.3.84',
    changes: [
      'The hint beside the Edit timing tools stays on one line and only says what a drag does where you point, so the timeline no longer jumps up and down. Shortcuts has the whole guide.',
      'The Sadhguru 3-Step translation style is gone: it left many lines untranslated. Sadhguru is the style to use, and a project that was on 3-Step moves to it.',
    ],
  },
  {
    version: '1.3.83',
    changes: [
      'Matching a pasted script by meaning is about three times faster than in 1.3.82, and it still keeps your lines.',
    ],
  },
  {
    version: '1.3.82',
    changes: [
      'A pasted script keeps its lines. By meaning matches whole lines to the cues and cuts a line only where it runs over several cues, so words no longer drift into the wrong cues.',
      'Paste as many lines as cues and each line goes to its cue. One line too many or too few only moves the cues next to it, and those are marked to check.',
    ],
  },
  {
    version: '1.3.81',
    changes: [
      'Edit timing gives the lanes more room: the picked line’s start, speed, gain and fades sit in one row above them. Scroll over a value or press the up and down keys to change it, and double-click its name to set it back.',
      'Right-click a line for everything it can do, or double-click it to set its start, speed, gain and fades in a box over it. History is now a menu beside Undo and Redo, and Shortcuts lists every key.',
    ],
  },
  {
    version: '1.3.80',
    changes: [
      'Check for updates is now in the Tools and settings list, under App, with the version you have and whether a newer one is out. The foot of the window shows only the keys: arrows to move, Enter to open, Esc to close.',
    ],
  },
  {
    version: '1.3.79',
    changes: [
      'The Script view in Review can show each passage as a paragraph, to read along while it plays. The line being heard is lit in light amber, and clicking a line plays from it. Switch back to Lines to edit.',
      'Translations no longer leave numbers like "100%" in digits; they come back written the way they are said, so line lengths are measured right.',
    ],
  },
  {
    version: '1.3.78',
    changes: [
      'Buttons and windows across the app now show the plain arrow pointer instead of a hand.',
      'In Edit timing, End jumps to the end as Home jumps to the start, and Shift + Z shows the whole track, then goes back to your zoom when pressed again. They work wherever you last clicked.',
    ],
  },
  {
    version: '1.3.77',
    changes: [
      'Zoomed in, the timelines now move smoothly under the playhead while playing, instead of jumping a page at a time. Play follows the playhead again after you scroll away.',
      'Click the times above a timeline to put the playhead there, or drag along them to scrub. Lines show the plain arrow pointer instead of a hand.',
    ],
  },
  {
    version: '1.3.76',
    changes: [
      "When your own gateway's Google key stops working, API settings now says your key is fine, shows where it broke, and lets you pick another model or copy a note for the gateway admin.",
      'Retakes voice two takes. Suggest wording makes a line shorter when it runs past its time, fuller when it ends too early, and says which. Three dots typed between words become a pause.',
      "Clear takes empties a line's takes, keeping Sync's own and the one in the dub.",
    ],
  },
  {
    version: '1.3.75',
    changes: [
      'New default translation style, Sadhguru: each sentence is translated by its meaning, the way a native speaker would say it, never word for word, and split over the lines by their time.',
      'After translating, every line is checked: lines too long for their time are reworded, and a word that went missing or changed meaning is put back. A Natural Spoken style does the same for any speaker.',
      'The translation styles are now Sadhguru, Sadhguru 3-Step, Natural Spoken and Custom. A project on a removed style moves to Sadhguru.',
    ],
  },
  {
    version: '1.3.74',
    changes: [
      'Errors now open in one window that says what went wrong in plain words, what the server said, and what to do next, with Try again where it helps.',
      'A server error page no longer shows up as a wall of code.',
    ],
  },
  {
    version: '1.3.73',
    changes: [
      'Work on another project while one dubs: pressing Dub there puts it in line, and it starts on its own when the first one finishes. Each project shows only its own progress and errors.',
      'Transcribing or translating one project no longer stops or locks another.',
      'Urdu is no longer in the language lists.',
    ],
  },
  {
    version: '1.3.72',
    changes: [
      'Export subtitles no longer gets stuck on timing: it shows the seconds as it works, gives up after 90 s, and Retry starts it fresh, so no restart is needed.',
      'Only the subtitle list scrolls now; the settings and the video stay in place.',
    ],
  },
  {
    version: '1.3.71',
    changes: [
      'Voice changer: Replace the dub now works line by line, so every line keeps its place and your Edit timing edits. Each speaker can get their own voice.',
      'When a translation misses a few lines, the notice now has a button that translates just those lines, leaving every other line and the dub as they are.',
    ],
  },
  {
    version: '1.3.70',
    changes: [
      'Shorter wording suggestions are measured in syllables, so they really fit, and Suggest 3 in the Sync report offers three at once, best fit first.',
      'Chunk sync closes up pauses the original never made, even inside a line, and Close up in Edit timing works on picked lines or on all lines.',
      'Pause detection and cue starts catch soft sounds (a quiet "s" or "h") better, with an Advanced gate section in the pause settings.',
    ],
  },
  {
    version: '1.3.69',
    changes: [
      'A dub that stops part way (DHVANI closed, crashed, or a request failed) now picks up where it left off: Resume dub voices only the lines it never got, so you do not pay for the rest twice.',
      'If a project cannot be saved to this computer, a notice now says so, with Save again, instead of losing the latest changes silently.',
      'New Audio quality setting on the Dub step: WAV 48 kHz by default, or MP3 192 / 128. If your ElevenLabs plan refuses a format, the next one down is used and a note says why.',
    ],
  },
  {
    version: '1.3.68',
    changes: [
      'The Dub step no longer freezes for several seconds when it opens or when you zoom the Rythmo view on a long script.',
      'Editing timing stays light on memory: renders you have already replaced are no longer kept, and dragging lines is smoother with many lines on screen.',
      'New translation style, Sadhguru 3-Step (Full Meaning): long lines are shortened by word choice and by rewording neighbouring lines together, not by cutting detail.',
    ],
  },
  {
    version: '1.3.67',
    changes: [
      'When ElevenLabs splits one person into two speakers, Review now notices: it compares the voices and offers to merge speakers that sound alike and never talk over each other, with Hear first.',
      'Cues that sound like another speaker than their label are flagged, with Relabel by voice to fix them all. Tick cues (Shift-click for a range) and set them to one speaker in one go.',
      'In the Script view each passage has its own play button and stops at its end, and a white bar glides along the playing line in the original and the dub.',
    ],
  },
  {
    version: '1.3.66',
    changes: [
      'Editing a long dub no longer runs DHVANI out of memory: edits render one at a time, and renders you have already replaced are skipped. This fixes "Could not reach the local DHVANI backend" after many quick edits.',
    ],
  },
  {
    version: '1.3.65',
    changes: [
      'The review video now floats over the Dub page, also while you edit timing: drag it by its title, resize it from any edge or corner, and it settles into a corner when you drop it near one. Reels and wide videos both fit, with black bars.',
      'The floating video has its own play, line jumps and Listen to. The ✕ hides it, and Show video in the player brings it back.',
    ],
  },
  {
    version: '1.3.64',
    changes: [
      'Watch your video while you review the dub: Add video in the Dub player shows a silent video that follows playback. It is not saved with the project or used in the render.',
      'Your projects and Balance now open in the middle of the screen, like Tools and settings. Click outside or press Esc to close them.',
    ],
  },
  {
    version: '1.3.63',
    changes: [
      'Sync voices no line again on its own: Pick the best of 3 takes and Read it faster start off. Turn either to Ask or Auto under When a line still runs long.',
      'Picking a preset no longer turns wording suggestions on. They stay off until you turn them on.',
    ],
  },
  {
    version: '1.3.62',
    changes: [
      'Phonetic typing works in the Script view too: type Roman letters and get the script as you go, pick another spelling with 1 to 5, or press Esc to keep a word in English. Ctrl G turns it on or off.',
      'The mini player comes up as soon as the play button starts to scroll out of sight, and Esc in a Script cell now really undoes your changes.',
    ],
  },
  {
    version: '1.3.61',
    changes: [
      'Review has a Script view: each passage is one row, the original beside the dub text, which you edit like a table cell, one line per cue. It replaces the Document view.',
      'Sync presets now go by how long the dub runs against the original, and what is on screen. After a sync, Dub suggests the preset that suits the dub.',
      'A line that is still too long can get the best of 3 takes or a calm, faster read. Review lets you compare old and new, or Sync uses the new one at once.',
    ],
  },
  {
    version: '1.3.60',
    changes: [
      'The script follows the synced dub: a line you remove or mute in Edit timing is left out, and each line keeps its time in the dub. Choose Full script to keep every line.',
      'In Export subtitles, press Edit subtitles to change the words or times of any subtitle by hand, or remove one. Your edits are kept, and the subtitles also save as a script.',
      'In Edit timing, press Shift M to put a marker with a note at the playhead, for a spot to check again. Markers never change the dub.',
    ],
  },
  {
    version: '1.3.59',
    changes: [
      'Tools and settings opens in the middle of the screen: point at any tool or setting to see what it is set to now, then open it. Search it, use the arrow keys, or press Ctrl K from anywhere.',
      'Sync settings fills the screen with every section in view, a search, a small picture of what each setting does, and a reset for each setting. It also opens from Tools and settings on any step.',
    ],
  },
  {
    version: '1.3.58',
    changes: [
      'Sync now places each line in chunks, split where the voice goes quiet, and puts every chunk on the original\'s words. Pauses shrink between words first and at sentence ends last, and no word is ever cut.',
      'A line that is still too long is voiced again a little faster, up to 1.15×. Eleven v3 and v4 voices ignore speed, so Review says to shorten those lines instead.',
      'In Edit timing, pick lines and press Q to take out long silences: see in red what will be cut, listen, then apply or undo.',
    ],
  },
  {
    version: '1.3.57',
    changes: ['DHVANI now notices on its own when the window freezes and notes in its log what it was busy with, so the freeze can be found and fixed.'],
  },
  {
    version: '1.3.56',
    changes: [
      'A new Sadhguru translation style keeps every thought, its pauses and its spoken length, in every language.',
      'If the window stops responding, DHVANI now notes in its log what it was busy with, so a freeze can be traced and fixed.',
    ],
  },
  {
    version: '1.3.55',
    changes: [
      'Review reads in passages. Cues and Document break the script wherever the original speaker pauses (0.8, 1.2 or 2 seconds), and each passage shows how many lines are too fast, tight or end early.',
      'Document marks lines that need work right in the text, with the speed or the gap beside them, and can save the dub script as a .txt file.',
      'Review now has three views: Cues, Document and QA. Cards, Spotlight and Script are gone, because Cues and Document do everything they did.',
    ],
  },
  {
    version: '1.3.54',
    changes: [
      'In Edit timing you can drag a line past the lines next to it and drop it into any empty gap it fits. The gap shows green when it fits and red when it is too small.',
    ],
  },
  {
    version: '1.3.53',
    changes: [
      'Retaking a line is easier. In Edit timing, pick a line and press T: its takes open in a window you can drag anywhere, and clicking the timeline does not close it.',
      'Use a take and it goes straight into the timeline. Pick another line while the window is open and it follows.',
    ],
  },
  {
    version: '1.3.52',
    changes: [
      'Edit timing now shows every line as a solid coloured clip with a clean, sharp waveform, in the original and in the dub.',
      'The players are back to the familiar dense bars, and they hold still while you scroll.',
    ],
  },
  {
    version: '1.3.51',
    changes: [
      'Sharper waveforms. Each bar now shows how loud the voice really is as a solid core inside its peak, and the bars hold still while you scroll the timeline.',
    ],
  },
  {
    version: '1.3.50',
    changes: [
      'Pasting a script into Custom Script no longer starts matching on its own. Paste, choose how to split it, then press the button to match it to the English.',
    ],
  },
  {
    version: '1.3.49',
    changes: [
      'DHVANI now starts even when another program on the computer is already using its usual connection port. It quietly picks a free one, and your saved projects and settings stay as they were.',
    ],
  },
  {
    version: '1.3.48',
    changes: [
      'DHVANI now always uses its dark look. The Theme option has been removed from the menu.',
    ],
  },
  {
    version: '1.3.47',
    changes: [
      'Sync now pauses only where the original speaker pauses. A pause the voice adds where the speaker talked straight on is cut down to a short gap, so the dub no longer runs longer than the original. Turn it off in Sync settings → Pauses inside a line. Sync again to apply it to an existing dub.',
      'Review and the Dub step point out commas and full stops in a line where the original speaker doesn’t pause, since the voice tends to stop there.',
    ],
  },
  {
    version: '1.3.46',
    changes: [
      'Continue to dub on the Review page now stays at the bottom of the window, so you can always see it without scrolling down.',
    ],
  },
  {
    version: '1.3.45',
    changes: [
      'Sync settings open in a window of their own from the Dub step, with every setting in sections you can jump between. The Dub step keeps a short summary of what the sync will use, so the dub, subtitles and files fit without scrolling.',
    ],
  },
  {
    version: '1.3.44',
    changes: [
      'Click a line in Edit timing to edit its words and retake it right there. Suggest wording offers new wordings with pauses placed where the meaning wants them, sized to the line’s time, and you see and can change every pause.',
      'Locked lines can be retaken without unlocking them, and they stay locked. Lines too long or short in the Dub step’s estimate get their suggestions and your own edit right there, without going to Review.',
    ],
  },
  {
    version: '1.3.43',
    changes: [
      'Long dubs no longer stop with “Too many requests to the local DHVANI backend”. Checking a dub’s progress no longer counts toward that limit, so an hour-long video dubs through.',
    ],
  },
  {
    version: '1.3.42',
    changes: [
      'If another program is using the port DHVANI needs, DHVANI now says which program it is and can close it for you, instead of waiting 30 seconds and failing. A DHVANI engine left running from before is closed on its own.',
    ],
  },
  {
    version: '1.3.41',
    changes: [
      'With several speakers, Edit timing gives each speaker their own lane, with their voice and speed, a level for the dub, and mute and solo for listening. Speakers’ lines can overlap, as in the original.',
      'Each speaker’s own voice is measured too, and translation and Review size each line for the voice that says it. You can pick each speaker’s voice on Source & voice, before translating.',
    ],
  },
  {
    version: '1.3.40',
    changes: [
      'When you pick a voice, it reads a short sample once to measure how fast it speaks in your dub language. Review’s line fit and syllable hints use that speed before the first sync, and translation can size each line for the voice (a checkbox turns this off).',
      'The language list is shorter: Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri, Sanskrit, Santali, Sindhi and Urdu are no longer offered.',
    ],
  },
  {
    version: '1.3.39',
    changes: [
      'Review shows each line’s syllables next to its characters, and the dub line says how many syllables to take out to fit its time, or how many more it has room for. It updates as you type.',
    ],
  },
  {
    version: '1.3.38',
    changes: [
      'When a translated script is matched to the lines by meaning, a sentence’s last word or two (like “है।”) now stays on the line it ends instead of starting the next one. Line timings don’t change.',
    ],
  },
  {
    version: '1.3.37',
    changes: [
      'Sync settings are kept with each project and can be saved as named presets. Strict timing and Protect long pauses never fail a sync: a line that can’t meet its limit is placed as early as it can go and flagged.',
      'Breaths can be softened instead of removed, and an optional check measures each line’s spoken words against the original’s timing. The check never changes the dub.',
      'Locked lines stay where you put them unless the lines before need the room; then they move only that far and are flagged. A locked line can be retaken.',
    ],
  },
  {
    version: '1.3.36',
    changes: [
      'Retake a synced line instantly: hear three new takes, compare their timing and choose which one goes in the dub. Return to another take while working on the same sync.',
      'In Edit timing, Select range picks words directly from the dub waveform using forced alignment. Retake the whole line or only the selected phrase.',
      'Choose Same, A bit faster, A bit slower, Calmer or More energy. Retake buttons show estimated character costs; locked or changed lines are protected.',
    ],
  },
  {
    version: '1.3.35',
    changes: [
      'Sync has one Export subtitles section, with the .srt download inside it.',
      'Voice Settings shows when a long dub’s stability was steadied, and a new Auto-tune stability switch turns that off.',
      'The text-to-speech studio uses the dub’s voice settings by default (Same as the dub).',
      'A dub rebuilt from its decoded copy is now the same audio, bit for bit. Review plays the original.',
    ],
  },
  {
    version: '1.3.34',
    changes: [
      'Subtitles are cut where each phrase ends and appear exactly when the words start. Subtitles for the dub are timed to the dub’s own words.',
      'Retake several lines of a synced dub at once, from the Sync report.',
      'Expression has a new Off setting, now the default, and Neutral, Natural and Expressive also work with Cartesia Sonic 3 voices.',
    ],
  },
  {
    version: '1.3.33',
    changes: [
      'Edit timing: pick several lines (Ctrl + A for the whole dub) and set one Speed for all of them. The voice keeps its pitch, and each line still starts where it did.',
    ],
  },
  {
    version: '1.3.32',
    changes: [
      'Dub has a new Expression setting: Neutral (calm and steady in the speaker’s own voice, the new default), Natural (follows how the original speaker spoke) or Expressive (adds emotion from the script).',
      'Natural no longer adds dramatic pauses or playful, emphatic tags.',
    ],
  },
  {
    version: '1.3.31',
    changes: [
      'Ask for a line’s wordings as often as you like: after you use one, Suggest again offers new ones, and Undo still goes back to the line as it was. Each suggestion shows what it says in English.',
      'A line that would lose more than a third of its words to fit is no longer shortened for you: give it more time, or join it with the line beside it.',
      'Retake voices the line three times and keeps the take that fits best. Suggestions also follow the wordings you chose before in the project.',
    ],
  },
  {
    version: '1.3.30',
    changes: [
      'After Sync, Show all lines lists every line with Listen and Retake, so you can retake any line, not only the flagged ones.',
      'Splitting a line in Review now counts as one changed line, not two.',
    ],
  },
  {
    version: '1.3.29',
    changes: [
      'In Review, any line can get other wordings: hover a line that fits and click Suggest other wordings. Suggestions keep names, numbers and glossary terms exactly, and read the lines around them.',
      'Export subtitles has a player: play the original, the dub or the synced dub and watch each subtitle as it is said; click one to play from there.',
      'Splitting, joining or moving a cut in Review now marks those lines for Sync again; a retaken line keeps its new take after a restart.',
    ],
  },
  {
    version: '1.3.28',
    changes: [
      'Dub and Sync are now one step: Dub voices your script and syncs it to the original in one go.',
      'Fill a gap in the dub with the original voice: in Edit timing, drag across the Original lane, then drag it down onto the dub (or Ctrl + C, Ctrl + V at the playhead).',
      'Scrolling up or down over Edit timing moves the timeline when zoomed in.',
    ],
  },
  {
    version: '1.3.27',
    changes: [
      'Edit timing plays your edits live: move, trim, fade or turn a line up while it plays and you hear it at once, without the player stopping.',
      'Pick several lines with Ctrl + click, a drag across empty lane or Ctrl + A, then move them, or set gain, fades and mute, all together.',
    ],
  },
  {
    version: '1.3.26',
    changes: ['The video panel in Sync is removed; the Sync player is back to the original and the dub.'],
  },
  {
    version: '1.3.24',
    changes: [
      'Sync now cuts each line out of your Final dub, so the synced dub sounds exactly like the dub; only lines you changed are voiced again.',
      'Lines Sync does voice again keep Enhance emotion and Match source audio.',
    ],
  },
  {
    version: '1.3.23',
    changes: ['Match source audio, under Enhance emotion: the dub is tagged from how the original speaker actually spoke, with no added drama.'],
  },
  {
    version: '1.3.22',
    changes: ['Match the original pace is gone from Sync settings: Eleven v3 and v4 pace themselves, so it never changed a line.'],
  },
  {
    version: '1.3.21',
    changes: [
      'The status pill now reads Online; click it to see what ElevenLabs, Cartesia and your LLM gateway have left.',
      'The voice list opens full instead of filling in after a few seconds.',
    ],
  },
  {
    version: '1.3.20',
    changes: ['Fit to this video in Sync settings: measures the original’s pauses and suggests the gaps, nothing changes until you apply.'],
  },
  {
    version: '1.3.19',
    changes: [
      'What’s New in the Help menu: every version’s changes, inside the app.',
      'Updates never open a web page; portable copies download the new version inside the app.',
    ],
  },
  {
    version: '1.3.18',
    changes: [
      'Phonetic typing and copy in the Document view.',
      'Sync can match the original speaker’s pace (off by default, in Sync settings).',
      'A quieter Review panel.',
    ],
  },
  { version: '1.3.17', changes: ['Even out loudness is now on by default.'] },
  { version: '1.3.16', changes: ['Drag a cut on the Review waveform to move it.'] },
  { version: '1.3.15', changes: ['Split and join cues by hand on the Review step.'] },
  { version: '1.3.14', changes: ['Timeline scrollbar sits under the lanes.', 'About DHVANI in the app’s colours.'] },
  { version: '1.3.13', changes: ['One Export subtitles button on Sync; it remembers language and timing.'] },
  { version: '1.3.12', changes: ['Take a script to another computer; each line goes back to its time.'] },
  { version: '1.3.11', changes: ['An Expert estimate in the Sync preview, beside the Quick one.'] },
  { version: '1.3.10', changes: ['Three suggested wordings for a line, read in context.'] },
  { version: '1.3.9', changes: ['Shows the dub’s real drift.', 'Each track has its own listening level.'] },
  { version: '1.3.8', changes: ['A clearer update window.'] },
  { version: '1.3.7', changes: ['Breaths are removed from synced dubs.'] },
  { version: '1.3.6', changes: ['Lines the voice cuts off mid-word are retaken.', 'Sentences stay whole in Sync.'] },
  { version: '1.3.5', changes: ['A loading screen while DHVANI starts.'] },
  { version: '1.3.4', changes: ['About DHVANI in the Help menu.'] },
  { version: '1.3.3', changes: ['Update window matches the app; no stray console window.'] },
  { version: '1.3.2', changes: ['Translation starts on Natural Conversational.', 'A simpler script popup.'] },
  { version: '1.3.1', changes: ['An “Updating DHVANI” window while an update installs.'] },
  { version: '1.3.0', changes: ['Edit timing.', 'Type the transcript by hand, or cancel transcription.', 'Step locks.'] },
  { version: '1.2.0', changes: ['Every dub is kept as a project until you delete it.'] },
  { version: '1.1.4', changes: ['Start-error dots are coloured by line.'] },
  { version: '1.1.3', changes: ['The Sync player is coloured by line.'] },
  { version: '1.1.2', changes: ['Each line has one colour; waveforms are drawn over the line bars.'] },
  { version: '1.1.1', changes: ['Sync timelines open on the whole track, with zoom for detail.'] },
  { version: '1.1.0', changes: ['Multi-speaker dubbing.', 'The synced dub is kept as its own file.'] },
  { version: '1.0.8', changes: ['Play the picked track from the Sync players.'] },
  { version: '1.0.7', changes: ['Progress while an update installs, and faster installs.'] },
  { version: '1.0.6', changes: ['Natural sync keeps some of the pause after a long line.'] },
  { version: '1.0.5', changes: ['Playheads stay on the audio.', 'Shows how synced lines landed.'] },
  { version: '1.0.4', changes: ['Sync suggestions start off.', 'Each new version is announced once.'] },
  { version: '1.0.3', changes: ['Light mode panels fixed.', 'Shorter or fuller wording always comes back when asked.'] },
  { version: '1.0.2', changes: ['Suggest shorter and fuller lines on the Review step.'] },
  { version: '1.0.1', changes: ['Works through office proxies and certificates.', 'Synced lines get room to breathe.'] },
];
