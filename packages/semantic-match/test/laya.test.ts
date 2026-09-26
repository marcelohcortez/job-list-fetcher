import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLayaClient, parseReasoningResponse, type ReasoningGenerator } from '../src/laya';

function fakeReasoner(
  reasoning = 'Looks like a solid match.',
  mismatchReasoning = 'No notable gaps.',
): ReasoningGenerator {
  return { generate: vi.fn().mockResolvedValue({ reasoning, mismatchReasoning }) };
}

describe('createLayaClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes Laya\'s ordinal fit score into 0-1 and stitches in generated reasoning', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          answers: {
            verdict: { choice: 'strong', confidence: 0.95 },
            fit: { score: 2, confidence: 0.9 }, // top of the 0..2 rubric
          },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const reasoner = fakeReasoner('Great backend overlap.', 'No cloud experience listed.');
    const client = createLayaClient({ apiUrl: 'http://localhost:8001' }, reasoner);

    const result = await client.evaluate({ jobText: 'job', cvText: 'cv' });

    expect(result).toEqual({
      score: 1,
      choice: 'strong',
      reasoning: 'Great backend overlap.',
      mismatchReasoning: 'No cloud experience listed.',
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8001/v1/systemone',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(reasoner.generate).toHaveBeenCalledWith({
      jobText: 'job',
      cvText: 'cv',
      verdict: 'strong',
      score: 1,
    });
  });

  it('flags truncated when reported input_tokens is near the two-question ceiling', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          answers: {
            verdict: { choice: 'moderate', confidence: 0.8 },
            fit: { score: 1, confidence: 0.7 },
          },
          usage: { input_tokens: 2010, output_tokens: 0 }, // 2 * 1024 - 40 threshold is 2008
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createLayaClient({ apiUrl: 'http://localhost:8001' }, fakeReasoner());
    const result = await client.evaluate({ jobText: 'a very long job', cvText: 'a very long cv' });

    expect(result.truncated).toBe(true);
  });

  it('does not flag truncated when reported input_tokens is well under the ceiling', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          answers: {
            verdict: { choice: 'moderate', confidence: 0.8 },
            fit: { score: 1, confidence: 0.7 },
          },
          usage: { input_tokens: 433, output_tokens: 0 },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createLayaClient({ apiUrl: 'http://localhost:8001' }, fakeReasoner());
    const result = await client.evaluate({ jobText: 'short job', cvText: 'short cv' });

    expect(result.truncated).toBe(false);
  });

  it('sends a bearer token when an API key is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          answers: { verdict: { choice: 'weak', confidence: 0.6 }, fit: { score: 0, confidence: 0.6 } },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createLayaClient(
      { apiUrl: 'http://localhost:8001', apiKey: 'secret' },
      fakeReasoner(),
    );
    await client.evaluate({ jobText: 'job', cvText: 'cv' });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
  });

  it('throws when Laya returns a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const client = createLayaClient({ apiUrl: 'http://localhost:8001' }, fakeReasoner());
    await expect(client.evaluate({ jobText: 'job', cvText: 'cv' })).rejects.toThrow('HTTP 503');
  });

  it('throws when the response is missing the expected answers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ answers: {} }),
    }) as unknown as typeof fetch;
    const client = createLayaClient({ apiUrl: 'http://localhost:8001' }, fakeReasoner());
    await expect(client.evaluate({ jobText: 'job', cvText: 'cv' })).rejects.toThrow(
      'missing expected',
    );
  });
});

describe('parseReasoningResponse', () => {
  it('splits the MATCH/MISMATCH sections without mixing them', () => {
    const content =
      'MATCH:\nStrong React overlap and shipped similar dashboards.\n\n' +
      'MISMATCH:\nNo Kubernetes experience mentioned.';
    expect(parseReasoningResponse(content)).toEqual({
      reasoning: 'Strong React overlap and shipped similar dashboards.',
      mismatchReasoning: 'No Kubernetes experience mentioned.',
    });
  });

  it('tolerates markdown-wrapped or lowercase markers', () => {
    const content =
      '**match:** Strong React overlap and shipped similar dashboards.\n\n' +
      '**mismatch:** No Kubernetes experience mentioned.';
    expect(parseReasoningResponse(content)).toEqual({
      reasoning: 'Strong React overlap and shipped similar dashboards.',
      mismatchReasoning: 'No Kubernetes experience mentioned.',
    });
  });

  it('falls back to treating the whole response as positive reasoning when unlabeled', () => {
    const content = 'Just a plain sentence with no markers.';
    expect(parseReasoningResponse(content)).toEqual({
      reasoning: content,
      mismatchReasoning: '',
    });
  });

  it('still extracts the mismatch section when the MATCH header is missing', () => {
    const content =
      'Strong React overlap and shipped similar dashboards.\n\n' +
      'MISMATCH:\nNo Kubernetes experience mentioned.';
    expect(parseReasoningResponse(content)).toEqual({
      reasoning: 'Strong React overlap and shipped similar dashboards.',
      mismatchReasoning: 'No Kubernetes experience mentioned.',
    });
  });

  it('does not let "MATCH:" match inside "MISMATCH:" when only the mismatch header is present', () => {
    const content = 'MISMATCH:\nNo Kubernetes experience mentioned.';
    expect(parseReasoningResponse(content)).toEqual({
      reasoning: '',
      mismatchReasoning: 'No Kubernetes experience mentioned.',
    });
  });
});
