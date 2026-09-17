import { ChromaClient, type Collection } from 'chromadb';

export interface ChromaConfig {
  host: string;
  port: number;
}

export interface VectorStore {
  upsertJob(id: string, embedding: number[], document: string): Promise<void>;
  deleteJob(id: string): Promise<void>;
  upsertCandidate(
    id: string,
    embedding: number[],
    document: string,
  ): Promise<void>;
  deleteCandidate(id: string): Promise<void>;
  getCandidateEmbedding(id: string): Promise<number[] | null>;
  queryJobsForCandidate(
    embedding: number[],
    nResults?: number,
  ): Promise<Array<{ id: string; similarity: number }>>;
  upsertRolePhrase(id: string, embedding: number[], document: string): Promise<void>;
  queryNearestRolePhrase(
    embedding: number[],
  ): Promise<{ id: string; similarity: number } | null>;
  upsertSkill(id: string, embedding: number[], document: string): Promise<void>;
  queryNearestSkill(
    embedding: number[],
  ): Promise<{ id: string; similarity: number } | null>;
}

const JOB_COLLECTION = 'job_openings';
const CANDIDATE_COLLECTION = 'candidates';
const ROLE_PHRASE_COLLECTION = 'target_role_phrases';
const SKILL_COLLECTION = 'skills';

/** Cosine distance -> similarity, clamped to [0, 1]. */
function toSimilarity(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}

export function createVectorStore(config: ChromaConfig): VectorStore {
  const client = new ChromaClient({ host: config.host, port: config.port });

  let jobCollection: Promise<Collection> | null = null;
  let candidateCollection: Promise<Collection> | null = null;
  let rolePhraseCollection: Promise<Collection> | null = null;
  let skillCollection: Promise<Collection> | null = null;

  function getJobCollection(): Promise<Collection> {
    jobCollection ??= client.getOrCreateCollection({
      name: JOB_COLLECTION,
      configuration: { hnsw: { space: 'cosine' } },
      embeddingFunction: null,
    });
    return jobCollection;
  }

  function getCandidateCollection(): Promise<Collection> {
    candidateCollection ??= client.getOrCreateCollection({
      name: CANDIDATE_COLLECTION,
      configuration: { hnsw: { space: 'cosine' } },
      embeddingFunction: null,
    });
    return candidateCollection;
  }

  function getRolePhraseCollection(): Promise<Collection> {
    rolePhraseCollection ??= client.getOrCreateCollection({
      name: ROLE_PHRASE_COLLECTION,
      configuration: { hnsw: { space: 'cosine' } },
      embeddingFunction: null,
    });
    return rolePhraseCollection;
  }

  function getSkillCollection(): Promise<Collection> {
    skillCollection ??= client.getOrCreateCollection({
      name: SKILL_COLLECTION,
      configuration: { hnsw: { space: 'cosine' } },
      embeddingFunction: null,
    });
    return skillCollection;
  }

  return {
    async upsertJob(id, embedding, document) {
      const collection = await getJobCollection();
      await collection.upsert({
        ids: [id],
        embeddings: [embedding],
        documents: [document],
      });
    },

    async deleteJob(id) {
      const collection = await getJobCollection();
      await collection.delete({ ids: [id] });
    },

    async upsertCandidate(id, embedding, document) {
      const collection = await getCandidateCollection();
      await collection.upsert({
        ids: [id],
        embeddings: [embedding],
        documents: [document],
      });
    },

    async deleteCandidate(id) {
      const collection = await getCandidateCollection();
      await collection.delete({ ids: [id] });
    },

    async getCandidateEmbedding(id) {
      const collection = await getCandidateCollection();
      const result = await collection.get({
        ids: [id],
        include: ['embeddings'],
      });
      const embedding = result.embeddings?.[0];
      return embedding ?? null;
    },

    async queryJobsForCandidate(embedding, nResults) {
      const collection = await getJobCollection();
      const limit = nResults ?? (await collection.count());
      if (limit === 0) return [];
      const result = await collection.query({
        queryEmbeddings: [embedding],
        nResults: limit,
        include: ['distances'],
      });
      const ids = result.ids[0] ?? [];
      const distances = result.distances?.[0] ?? [];
      return ids.map((id, index) => ({
        id,
        similarity: toSimilarity(distances[index] ?? 1),
      }));
    },

    async upsertRolePhrase(id, embedding, document) {
      const collection = await getRolePhraseCollection();
      await collection.upsert({
        ids: [id],
        embeddings: [embedding],
        documents: [document],
      });
    },

    async queryNearestRolePhrase(embedding) {
      const collection = await getRolePhraseCollection();
      const result = await collection.query({
        queryEmbeddings: [embedding],
        nResults: 1,
        include: ['distances'],
      });
      const id = result.ids[0]?.[0];
      if (!id) return null;
      const distance = result.distances?.[0]?.[0] ?? 1;
      return { id, similarity: toSimilarity(distance) };
    },

    async upsertSkill(id, embedding, document) {
      const collection = await getSkillCollection();
      await collection.upsert({
        ids: [id],
        embeddings: [embedding],
        documents: [document],
      });
    },

    async queryNearestSkill(embedding) {
      const collection = await getSkillCollection();
      const result = await collection.query({
        queryEmbeddings: [embedding],
        nResults: 1,
        include: ['distances'],
      });
      const id = result.ids[0]?.[0];
      if (!id) return null;
      const distance = result.distances?.[0]?.[0] ?? 1;
      return { id, similarity: toSimilarity(distance) };
    },
  };
}
