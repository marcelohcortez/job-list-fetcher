import { Ollama } from 'ollama';
import { createOllamaFetch, type OllamaConfig } from './ollama';

/**
 * Automated, headless cousin of the interactive `cv-refactor` Claude Code
 * skill (see /.claude/skills/cv-refactor/SKILL.md). It applies the same
 * intent - rewrite the CV to be clearer and more evidence-aligned without
 * inventing facts - as a single local-model pass. It never produces the
 * skill's PDF/LinkedIn deliverables; it only prepares text for embedding.
 *
 * This step is explicitly NOT where deduplication happens (see ADR 0014):
 * it must preserve every mention of every tool/technology exactly as the
 * source CV lists it, even when the same tool appears under several job
 * entries. Deduplication belongs downstream, at the point skills are
 * resolved to canonical ids and stored (`createSkillCanonicalizer` in
 * `apps/api/src/skill-taxonomy.ts`, which already dedups via a `Set` of
 * skill ids) - never in this free-text rewrite, which has no reliable way
 * to tell "the same skill, correctly repeated because it's true of three
 * different jobs" from "an accidental duplicate" and previously guessed
 * wrong (see ADR 0013/0014's account of "Git" being silently collapsed and
 * then dropped entirely).
 */
export interface CvRefactorClient {
  refactorCv(rawText: string): Promise<string>;
}

const REFACTOR_SYSTEM_PROMPT =
  'You refactor CV text so it reads clearly, consistently, and in an ' +
  'ATS-friendly plain-text style. This is a REFORMATTING pass, not a ' +
  'summarization pass: the output must cover every job entry, every ' +
  'TOOLS/TECHNOLOGIES/ENVIRONMENTS list, and every named item the source ' +
  'has, at comparable length and detail to the source - never condense ' +
  'multiple job entries or their tool lists into a shorter combined ' +
  'summary. Preserve every fact exactly: employers, titles, dates, ' +
  'technologies, scope, and claims. Never invent, infer, or embellish ' +
  'experience, skills, metrics, or seniority that is not already stated. ' +
  'Do not add or drop sections, job entries, or named tools/technologies - ' +
  'every one of them must still be present in the output, under whichever ' +
  'job entry mentioned it. Improve wording, structure, and consistency ' +
  'only. Do NOT deduplicate, merge, or drop a tool/technology mention ' +
  'because it also appears elsewhere in the CV - if a named tool (e.g. ' +
  '"Git") is listed under three different roles, keep it listed under all ' +
  'three; deduplication happens later, when skills are resolved and stored, ' +
  'never here. Reply with the refactored CV text and nothing else - no ' +
  'commentary, no markdown fences.';

export function createOllamaCvRefactor(config: OllamaConfig): CvRefactorClient {
  const client = new Ollama({ host: config.host, fetch: createOllamaFetch() });

  return {
    async refactorCv(rawText) {
      const response = await client.chat({
        model: config.chatModel,
        messages: [
          { role: 'system', content: REFACTOR_SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        options: {
          temperature: 0,
          num_ctx: config.numCtx,
          num_predict: config.numPredict,
        },
      });
      return response.message.content.trim();
    },
  };
}
