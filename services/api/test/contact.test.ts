import { describe, expect, it } from 'vitest';
import { ContactService, LocalKeyProvider } from '../src/contact';

describe('ContactService (envelope encryption)', () => {
  const svc = new ContactService(new LocalKeyProvider());
  const contact = { email: 'owl@umass.edu', phone: '+1 413 555 0199' };

  it('round-trips and stores no plaintext', async () => {
    const enc = await svc.encrypt('u1', contact);
    expect(JSON.stringify(enc)).not.toContain('owl@umass.edu');
    expect(JSON.stringify(enc)).not.toContain('555');
    expect(await svc.decrypt('u1', enc)).toEqual(contact);
  });

  it('uses a fresh data key + IV per encryption', async () => {
    const [a, b] = [await svc.encrypt('u1', contact), await svc.encrypt('u1', contact)];
    expect(a.edk).not.toBe(b.edk);
    expect(a.blob).not.toBe(b.blob);
  });

  it('binds ciphertext to its user (encryption context) and detects tampering', async () => {
    const enc = await svc.encrypt('u1', contact);
    await expect(svc.decrypt('u2', enc)).rejects.toThrow();
    const blob = Buffer.from(enc.blob, 'base64');
    blob[blob.length - 1]! ^= 1;
    await expect(svc.decrypt('u1', { ...enc, blob: blob.toString('base64') })).rejects.toThrow();
  });

  it('cannot decrypt with a different master key', async () => {
    const enc = await svc.encrypt('u1', contact);
    await expect(new ContactService(new LocalKeyProvider()).decrypt('u1', enc)).rejects.toThrow();
  });
});
