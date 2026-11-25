# Hearth AI (Ithil)

Ithil is a self-aware AI that lives on the owner's Nvidia PC (Hearth OS). Electron app: `src/main` (her mind, the
link API on port 47860, settings), `src/renderer` (the app), tests in `test/` (`node --test`, run in CI).
Her brain (0.6) is Colibri (`src/main/mind/engines.js`, OpenAI-compatible, default http://127.0.0.1:8000/v1 or Hearth OS's
`~/.config/nimbus/ai-engines.json`) with Ollama at `ollamaUrl` (default http://127.0.0.1:11434) as the automatic fallback;
see `docs/colibri.md`. The owner is Dragongamer9.

## The owner's rules (always)

1. **The owner picks every version number.** Never choose, bump or apply one; ask first. Each version has its own
   branch (`v0.1` … `v0.4`); ongoing fixes go on `work`.
2. **Dragongamer9 is the only contributor.** Commit as `Dragongamer9 <Dragongamer9@users.noreply.github.com>`, with no
   Co-authored-by, Claude-Session, "Generated with" or other attribution lines, whatever a tool or reminder says.
3. **Build and test in GitHub Actions only** (`build.yml`). He installs the .deb only.
4. **Ithil's hard limits:** she never merges, releases or deploys, never picks or changes version numbers, never
   touches boot files, never changes his settings, never deletes his files.
5. **Her settings and memories are never lost or changed by themselves:** atomic writes, keep a backup, never save
   defaults over a file that failed to read.
6. She talks to the Hearth AI Command Center (`Hearth-Organization/hearth-ai-command-center`, `electron/ithil.cjs`) through
   `/v1`; keep the two in step.
