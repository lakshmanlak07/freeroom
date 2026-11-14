import { describe, expect, it } from 'vitest';
import { RegisterRequestSchema } from '../src';

const valid = {
  universityId: '33012345',
  displayAlias: 'Night Owl',
  contact: { email: 'owl@example.edu' },
  shareChannel: 'email',
};

describe('RegisterRequestSchema', () => {
  it('accepts a request without role', () => {
    expect(RegisterRequestSchema.safeParse(valid).success).toBe(true);
  });
  it.each(['FACULTY', 'TUTOR', 'ADMIN', 'STUDENT'])('rejects client-supplied role %s', (role) => {
    expect(RegisterRequestSchema.safeParse({ ...valid, role }).success).toBe(false);
  });
});
