import { randomBytes } from 'node:crypto';
import { NodeType } from './types.js';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generateNanoId(size = 8): string {
  const bytes = randomBytes(size);
  let id = '';
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}

export function generateNodeId(type: NodeType): string {
  switch (type) {
    case 'goal':
      return `goal_${generateNanoId(8)}`;
    case 'sub_goal':
      return `sub_${generateNanoId(8)}`;
    case 'milestone':
      return `mile_${generateNanoId(8)}`;
    case 'action':
      return `act_${generateNanoId(8)}`;
    case 'sub_action':
      return `act_${generateNanoId(8)}`; // actions and sub-actions share act_ prefix for consistency
    default:
      return `node_${generateNanoId(8)}`;
  }
}

export function generateId(prefix: 'ws' | 'usr' | 'dep' | 'ev' | 'prop' | 'err'): string {
  return `${prefix}_${generateNanoId(8)}`;
}
