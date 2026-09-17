import { Ollama } from 'ollama';
import {
  PROFILE_FIELD_DESCRIPTIONS,
  SanitizedCandidateSchema,
  SanitizedJobSchema,
  type SanitizedCandidate,
  type SanitizedJob,
} from './schema';

export interface OllamaConfig {
  host: string;
  chatModel: string;
  embedModel: string;
  /** Context window (prompt + response) in tokens, passed as `options.num_ctx`. */
  numCtx?: number;
  /** Max tokens generated per chat call, passed as `options.num_predict`. `-1` (Ollama's own default) means unbounded. */
  numPredict?: number;
}

/**
 * The subset of Ollama capability this package needs - kept as an interface
 * so tests can inject a fake instead of talking to a real local model.
 */
export interface SanitizerClient {
  sanitizeJob(rawText: string): Promise<SanitizedJob>;
  sanitizeCandidate(rawText: string): Promise<SanitizedCandidate>;
  embed(text: string): Promise<number[]>;
}

// Field `description`s are what actually reach the model - Ollama's
// structured-output `format` is a plain JSON schema, not the zod schema, so
// without these the requiredSkills/softSkills split (schema.ts) is nothing
// but two same-looking array fields with no guidance distinguishing them.
const PROFILE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: PROFILE_FIELD_DESCRIPTIONS.title },
    requiredSkills: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.requiredSkills,
    },
    softSkills: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.softSkills,
    },
    experienceProfile: {
      type: 'string',
      description: PROFILE_FIELD_DESCRIPTIONS.experienceProfile,
    },
    coreResponsibilities: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.coreResponsibilities,
    },
  },
  required: [
    'title',
    'requiredSkills',
    'softSkills',
    'experienceProfile',
    'coreResponsibilities',
  ],
};

const CANDIDATE_JSON_SCHEMA = {
  ...PROFILE_JSON_SCHEMA,
  properties: {
    ...PROFILE_JSON_SCHEMA.properties,
    candidateName: {
      type: 'string',
      description: PROFILE_FIELD_DESCRIPTIONS.candidateName,
    },
  },
  required: [...PROFILE_JSON_SCHEMA.required, 'candidateName'],
};

const SKILL_SPLIT_INSTRUCTION =
  'requiredSkills and softSkills are NOT interchangeable buckets for ' +
  '"anything called a skill or requirement" - requiredSkills is ONLY named ' +
  'tools/languages/frameworks/platforms/methodologies (e.g. "Python", ' +
  '"Kubernetes", "Scrum"). Every behavioral, interpersonal, or mindset ' +
  'quality (e.g. "proactive", "strong communicator", "stakeholder ' +
  'management", "relationship-building") goes in softSkills instead, even ' +
  'when the source text phrases it as a requirement or lists it alongside ' +
  'technical ones. A customer-facing or non-technical role may legitimately ' +
  'have an empty requiredSkills list. Every requiredSkills item must be a ' +
  'single atomic technology name (1-3 words), never a sentence: split ' +
  '"experience with Kubernetes and Docker" into "Kubernetes" and "Docker" ' +
  'as two separate items, strip filler like "experience with"/' +
  '"familiarity with"/"understanding of"/"knowledge of", and drop any ' +
  'clause that names no specific technology at all. A base tool and a ' +
  'compound/derived term built on it are DISTINCT skills, never one ' +
  'subsuming the other - if the source text names both "Git" and ' +
  '"GitOps" (or "Kubernetes" and "GitOps", "Docker" and "Docker Compose", ' +
  'etc.), extract every one of them as its own separate item, never drop ' +
  'the base tool just because the compound term is also present.';

const JOB_SYSTEM_PROMPT =
  'You are an elite automated recruiter parser. Extract exact requirements ' +
  'and criteria fields into the requested JSON schema. Completely ignore ' +
  'company profiles, marketing fluff, company background history, cultural ' +
  'benefits like snacks or equity, and generic text. ' +
  SKILL_SPLIT_INSTRUCTION;

const CANDIDATE_SYSTEM_PROMPT =
  'You are an elite automated CV parser. Extract the candidate\'s name and ' +
  "their skills/experience into the requested JSON schema, framed as the " +
  "candidate's own most recent or target job title, skills and " +
  'responsibilities. Ignore formatting artifacts and personal contact ' +
  'details other than the name. ' +
  SKILL_SPLIT_INSTRUCTION;

export function createOllamaSanitizer(config: OllamaConfig): SanitizerClient {
  const client = new Ollama({ host: config.host });

  async function chatJson(
    system: string,
    userText: string,
    format: object,
  ): Promise<unknown> {
    const response = await client.chat({
      model: config.chatModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      format,
      options: {
        temperature: 0,
        num_ctx: config.numCtx,
        num_predict: config.numPredict,
      },
    });
    return JSON.parse(response.message.content);
  }

  return {
    async sanitizeJob(rawText) {
      const parsed = await chatJson(
        JOB_SYSTEM_PROMPT,
        `Extract the target schema from this job advertisement:\n\n${rawText}`,
        PROFILE_JSON_SCHEMA,
      );
      return SanitizedJobSchema.parse(parsed);
    },

    async sanitizeCandidate(rawText) {
      const parsed = await chatJson(
        CANDIDATE_SYSTEM_PROMPT,
        `Extract the target schema from this CV:\n\n${rawText}`,
        CANDIDATE_JSON_SCHEMA,
      );
      return SanitizedCandidateSchema.parse(parsed);
    },

    async embed(text) {
      const response = await client.embeddings({
        model: config.embedModel,
        prompt: text,
        options: { num_ctx: config.numCtx },
      });
      return response.embedding;
    },
  };
}
