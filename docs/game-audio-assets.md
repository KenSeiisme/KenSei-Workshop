# Game audio assets

The three game families use locally served CC0 audio. The website never downloads a track from Freesound or Kenney while someone is playing. Original source archives and MP3 previews are development inputs only, cached under ignored `_qa/game-audio/`.

## Sources

| Family / purpose       | Work                                                                                                          | Creator           | License |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------- | ------- |
| Board background       | [Easy Going Music Loop](https://freesound.org/people/Seth_Makes_Sounds/sounds/691837/)                        | Seth_Makes_Sounds | CC0-1.0 |
| Puzzle background      | [Retro Game Music 90BPM Loop — Bass, Lead, Pad and Keys](https://freesound.org/people/Jadis0x/sounds/859283/) | Jadis0x           | CC0-1.0 |
| Arcade background      | [Simple Game Music Loop](https://freesound.org/people/Seth_Makes_Sounds/sounds/684511/)                       | Seth_Makes_Sounds | CC0-1.0 |
| Quiet interface cues   | [Interface Sounds](https://kenney.nl/assets/interface-sounds)                                                 | Kenney            | CC0-1.0 |
| Chips / card contact   | [Casino Audio](https://kenney.nl/assets/casino-audio)                                                         | Kenney            | CC0-1.0 |
| Arcade feedback        | [Digital Audio](https://kenney.nl/assets/digital-audio)                                                       | Kenney            | CC0-1.0 |
| Short outcome stingers | [Music Jingles](https://kenney.nl/assets/music-jingles)                                                       | Kenney            | CC0-1.0 |

Source pages and the four archive `License.txt` files were checked on 3 November 2026. Copies of the latter are retained in `src/assets/game-audio/licenses/`. Music uses the publicly supplied high-quality preview from each official Freesound page; these files carry the corresponding sound's CC0 license. The manifest records stable source URLs, author names, source hashes, processing notes and every served file's SHA-256. Temporary signed Kenney download URLs are never stored.

## Preparation and interface

```text
python scripts/prepare-game-audio.py
python scripts/prepare-game-audio.py --check
```

Preparation needs FFmpeg (tested with 7.1.1); the script itself uses only Python's standard library. It downloads missing pinned inputs through the platforms' public download mechanisms and refuses changed hashes. It is not part of the Vercel build. `--check` inspects the existing assets without rewriting tracked files.

`manifest.json` has version `1` and `profiles.board`, `profiles.puzzle`, `profiles.arcade`. Each profile includes a music descriptor and `cues[kind]` arrays. Descriptors contain `file`, `bytes`, `sha256`, `duration`, `gain`, source identity and processing information. Music adds `loopStart` / `loopEnd`. File names are relative to `/assets/game-audio/`. Repeated descriptors intentionally refer to the same physical file; loaders must deduplicate by `file`.

The same three neutral chip variants are available to both Go colors. No audio file encodes stone ownership or a game-rule random value. Rising / falling Pizzicato and NES phrases distinguish win / loss, with separate neutral outcome files. Selection of a variation belongs to the presentation layer.

## Processing and measured limits

- One-shots: leading / trailing silence trimmed, 44.1kHz mono PCM16 WAV, 70Hz high-pass and 9.5kHz low-pass, peak normalized to −12dBFS, approximately 2ms attack / 10ms release tapers. Per-cue gain further reduces frequent events.
- Music: the first quarter / whole / half of the board / puzzle / arcade source loops respectively, giving 47.052653 / 53.333333 / 52.5 seconds. Loudness target −16 LUFS and −3dBTP before MP3 encoding; actual post-encode peak is recorded separately. Endpoint tapers are 3ms, with LAME gapless metadata. Files use 96kbps stereo MP3.
- Decoded MP3 endpoint peaks are 0.002096 / 0.001422 / 0.005815 in linear amplitude. These waveform measurements help identify hard discontinuities; they do not prove that the musical phrase or loop transition sounds natural.

| Profile | Unique audio files | Audio bytes | Including 71,921-byte manifest | Decoded float PCM at 48kHz |
| ------- | -----------------: | ----------: | -----------------------------: | -------------------------: |
| Board   |                 15 |     927,880 |                        999,801 |                 18,855,772 |
| Puzzle  |                 18 |   1,056,795 |                      1,128,716 |                 21,384,124 |
| Arcade  |                 27 |   1,341,078 |                      1,412,999 |                 21,703,948 |

Each profile stays below 2,000,000 transferred bytes and 32MiB decoded PCM. The figures count each physical file once and include all mapped profile cues, even when a particular game uses only a subset. A validation pass checks path containment, hashes, sizes, decode success, clipping and budgets.

## Acceptance boundary

Asset decoding, peak checks and memory / transfer budgets have passed locally. Subjective headphone / computer-speaker listening, physical Android output and prolonged listening fatigue remain **pending**. Browser output capture / waveform inspection is additional technical evidence and must not be reported as a physical listening test. In particular, the equal-length musical cuts and loop joins require an actual listening check; metadata and source descriptions alone do not certify them.
