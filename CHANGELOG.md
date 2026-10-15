# Changelog

All notable changes to SeeRead are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and SeeRead uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Text in the teleprompter can be highlighted and copied with Ctrl/⌘+C or the right-click menu.

### Fixed

- Hovering a highlighted button (Start, the active reading mode, or a selected toggle) no longer
  swaps its accent colour for the plain hover background, which made its label hard to read or
  invisible in the dark and high-contrast themes.

## [0.2.0] - 2026-10-14

### Added

- Opt-in debug logs (Settings → General → Troubleshooting) that record app events, errors and crashes
  to a local file for bug reports, never script text, transcripts or audio (#3).

### Changed

- Settings detects Wayland sessions and explains that display choice, always-on-top and global
  shortcuts are limited there, with KDE Plasma instructions for keeping the teleprompter on top (#2).

### Fixed

- On Wayland, the teleprompter no longer saves a meaningless 0,0 position; only its size is restored
  (#2).
- The microphone test and voice tracking no longer close SeeRead a few seconds after starting when
  the microphone runs at a rate other than 16 kHz (#3).

## [0.1.0] - 2026-10-14

### Added

- Floating teleprompter overlay: transparent, always-on-top, draggable and resizable, with adjustable
  font, size, weight, line spacing, alignment, colours, tint, margins, reading guide, mirror modes,
  countdown, full-screen mode and auto-hiding controls.
- Automatic scrolling with adjustable speed, acceleration, start delay, paragraph pauses, loop or stop
  at the end, and instant manual override by mouse wheel or keyboard.
- Voice tracking with on-device speech recognition (sherpa-onnx, streaming English model), a
  confidence-aware alignment engine, word highlighting, look-ahead, pause/resume and manual
  repositioning by clicking a word.
- Configurable stage-direction delimiters, line-prefix markers, nesting and unmatched-delimiter handling;
  stage directions stay visible but are skipped by voice tracking.
- Script editor with paste, open/save/export of plain text, find & replace, undo/redo, clipboard
  actions, word count, reading-time estimate, recent files, autosave and crash recovery.
- Configurable global shortcuts, click-through mode with three ways to regain control, tray menu,
  multi-monitor placement.
- Screen-capture exclusion using documented OS APIs with read-back status reporting.
- First-run guide, light/dark/high-contrast themes, reduced-motion support.
- CI for formatting, linting, type checks, unit/integration/E2E tests, real-audio speech tests, Rust
  checks on Windows/macOS/Linux, dependency and license audits, secret scanning and workflow linting;
  tagged release workflow producing draft releases with checksums and provenance.

[Unreleased]: https://github.com/clintgalendez/SeeRead/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/clintgalendez/SeeRead/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/clintgalendez/SeeRead/releases/tag/v0.1.0
