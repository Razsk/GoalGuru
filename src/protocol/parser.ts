import { ProposalEnvelope, Mutation } from './types.js';

const CODEBLOCK_REGEX = /```(?:goalguru-proposal|json)?\s*([\s\S]*?)\s*```/;

/**
 * Extracts the goalguru-proposal JSON block from conversational text (ADR 0007)
 */
export function extractProposalFromText(rawText: string): string {
  // First look for explicit ```goalguru-proposal ... ```
  const specificMatch = rawText.match(/```goalguru-proposal\s*([\s\S]*?)\s*```/);
  if (specificMatch && specificMatch[1]) {
    return specificMatch[1].trim();
  }

  // Fallback: look for general code block containing "changeSet"
  const generalMatch = rawText.match(CODEBLOCK_REGEX);
  if (generalMatch && generalMatch[1] && generalMatch[1].includes('"changeSet"')) {
    return generalMatch[1].trim();
  }

  // Fallback: if raw text itself is raw JSON object with changeSet
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes('"changeSet"')) {
    return trimmed;
  }

  throw new Error('No goalguru-proposal codeblock found in the provided text.');
}

/**
 * Validates and parses the proposal envelope JSON (ADR 0008)
 */
export function parseProposalEnvelope(jsonString: string): ProposalEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in proposal envelope: ${msg}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Proposal envelope must be a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.protocolVersion !== 'string') {
    throw new Error('Missing or invalid protocolVersion in proposal envelope.');
  }

  if (typeof obj.stateVersion !== 'number') {
    throw new Error('Missing or invalid stateVersion in proposal envelope.');
  }

  if (!Array.isArray(obj.changeSet)) {
    throw new Error('Missing or invalid changeSet array in proposal envelope.');
  }

  const validMutationTypes = new Set([
    'create_node',
    'update_node',
    'update_status',
    'delete_node',
    'add_dependency',
    'remove_dependency',
    'add_evidence',
    'remove_evidence',
  ]);

  for (let i = 0; i < obj.changeSet.length; i++) {
    const m = obj.changeSet[i];
    if (typeof m !== 'object' || m === null || !('type' in m) || !validMutationTypes.has(m.type)) {
      throw new Error(`Invalid mutation at index ${i}: unsupported or missing type.`);
    }
  }

  return parsed as ProposalEnvelope;
}
