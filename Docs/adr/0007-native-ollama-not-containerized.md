# ADR 0007: Run Ollama Natively on the Host, Not in Docker

**Status**: Accepted
**Date**: 2026-09-15
**Author**: Claude Sonnet 5

**Context**:

1. `docker-compose.yml` (added in [ADR 0004](0004-semantic-matching-pipeline.md)) ran Ollama as a container alongside `app` and `chroma`. A CV upload was observed taking 10-17 minutes to sanitize.
2. Diagnosis: the containerized `ollama/ollama` image has no path to the host GPU. Docker Desktop cannot pass Apple Silicon's Metal through to the Linux VM a container runs in, so `qwen2.5:7b` fell back to CPU-only inference — confirmed via `docker exec ... ollama ps` (`100% CPU`) and `docker logs` showing individual `/api/chat` calls generating at ~3.5 tokens/sec, some taking 4+ minutes each. `processCandidate` chains multiple sequential chat calls (refactor, score, sanitize — see [ADR 0005](0005-cv-refactor-gate.md)), so the per-call cost multiplied directly into end-to-end latency.
3. The same model run natively on the host (`ollama serve` via Homebrew, already installed) measured ~50+ tokens/sec on the same machine — roughly a 15x difference, purely from GPU access.

**Decision**:

1. **Remove the `ollama` service from `docker-compose.yml`.** Only `app` and `chroma` remain containerized; Ollama runs natively on the host via `ollama serve` (Homebrew on macOS, or the equivalent native install elsewhere).
2. **`app`'s `OLLAMA_HOST` now defaults to `http://host.docker.internal:11434`** inside `docker-compose.yml`, so the containerized API reaches the host's native Ollama without any `.env` change. `host.docker.internal` resolves out of the box on Docker Desktop (Mac/Windows); a Linux Docker host needs its actual bridge/LAN IP set explicitly via `OLLAMA_HOST` in `.env`, since Linux Docker doesn't provide that DNS name by default.
3. **`packages/config`'s `OLLAMA_HOST` default stays `http://localhost:11434`** — unchanged, since running the API directly with `npm run dev` (not in Docker) talks to native Ollama on the same host with no networking indirection at all.
4. **Chroma stays containerized.** It isn't a generative model and has no GPU-bound hot path; there's no equivalent win to moving it out of Docker, and keeping it there preserves one-command (`docker compose up chroma`) setup for the piece that still needs isolation/persistence via a volume.

**Considered Options**:

- **Pass the GPU into the Ollama container** (e.g. `--gpus` on Linux with NVIDIA, or a Docker Desktop Apple Silicon GPU passthrough feature). Rejected — Docker Desktop on macOS does not expose Metal to Linux containers at all; there's no flag that fixes this on Apple Silicon.
- **Keep Ollama in Docker and just cap generation length (`num_predict`) to bound the worst case.** Considered as a smaller, additive change, but doesn't address the root cause — CPU-only inference stays ~15x slower regardless of caps; a cap only prevents runaway *tail* latency, not the baseline. Kept as a separate, complementary follow-up rather than a substitute.
- **Drop Docker entirely for local dev.** Rejected — `chroma` has no GPU dependency and containerizing it costs nothing; only the model-serving piece needed to move.

**Consequences**:

- **Pro**: CV sanitizing/embedding drops from 10-17 minutes to roughly the low tens of seconds per candidate, matching the ~15x measured token-rate difference.
- **Pro**: No `.env` change needed for the most common local-dev path (`npm run dev` + `npm run web`), since `packages/config`'s default already pointed at `localhost:11434`.
- **Con**: One more manual setup step outside `docker compose up` — Ollama must be installed and running natively before uploads/matching work; `npm run docker:up` alone no longer boots a complete semantic-matching stack.
- **Con**: `host.docker.internal` is a Docker Desktop convenience, not a Docker Engine standard — a Linux host running this via plain `docker compose` needs to override `OLLAMA_HOST` manually in `.env`.
