/**
 * BR-5 / PRD §9: contact info is KMS envelope-encrypted (GenerateDataKey + AES-256-GCM).
 * Encrypt needs kms:GenerateDataKey (register/PATCH /me). Decrypt needs kms:Decrypt, which only
 * the privileged Lambda (GET/PATCH /me, GET /claims/:id/contact) and the notifier are granted.
 * The KMS encryption context binds each ciphertext to its user.
 */
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyProvider {
  generateDataKey(
    ctx: Record<string, string>,
  ): Promise<{ plaintext: Uint8Array; encrypted: Uint8Array }>;
  decryptDataKey(encrypted: Uint8Array, ctx: Record<string, string>): Promise<Uint8Array>;
}

export class AwsKmsKeyProvider implements KeyProvider {
  constructor(
    private readonly keyId: string,
    private readonly kms = new KMSClient({}),
  ) {}

  async generateDataKey(ctx: Record<string, string>) {
    const r = await this.kms.send(
      new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: 'AES_256', EncryptionContext: ctx }),
    );
    return { plaintext: r.Plaintext!, encrypted: r.CiphertextBlob! };
  }

  async decryptDataKey(encrypted: Uint8Array, ctx: Record<string, string>) {
    const r = await this.kms.send(
      new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: encrypted, EncryptionContext: ctx }),
    );
    return r.Plaintext!;
  }
}

/** Dev/test stand-in for KMS: data keys wrapped by a process-local master key. Never used in AWS. */
export class LocalKeyProvider implements KeyProvider {
  constructor(private readonly master: Buffer = randomBytes(32)) {}

  async generateDataKey(ctx: Record<string, string>) {
    const plaintext = randomBytes(32);
    return { plaintext, encrypted: seal(this.master, plaintext, aad(ctx)) };
  }

  async decryptDataKey(encrypted: Uint8Array, ctx: Record<string, string>) {
    return open(this.master, Buffer.from(encrypted), aad(ctx));
  }
}

const aad = (ctx: Record<string, string>) =>
  Buffer.from(JSON.stringify(Object.entries(ctx).sort(([a], [b]) => a.localeCompare(b))));

/** AES-256-GCM: output = iv(12) | tag(16) | ciphertext. */
function seal(key: Uint8Array, plaintext: Uint8Array, additional: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additional);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Uint8Array, blob: Buffer, additional: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAAD(additional);
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export interface Contact {
  email?: string;
  phone?: string;
}

/** What is stored at rest: encrypted data key + sealed contact. No plaintext. */
export interface EncryptedContact {
  v: 1;
  edk: string;
  blob: string;
}

export class ContactService {
  constructor(private readonly keys: KeyProvider) {}

  private ctx = (userId: string) => ({ userId, purpose: 'contact' });

  async encrypt(userId: string, contact: Contact): Promise<EncryptedContact> {
    const { plaintext, encrypted } = await this.keys.generateDataKey(this.ctx(userId));
    try {
      const blob = seal(plaintext, Buffer.from(JSON.stringify(contact)), aad(this.ctx(userId)));
      return {
        v: 1,
        edk: Buffer.from(encrypted).toString('base64'),
        blob: blob.toString('base64'),
      };
    } finally {
      plaintext.fill(0);
    }
  }

  async decrypt(userId: string, enc: EncryptedContact): Promise<Contact> {
    const key = await this.keys.decryptDataKey(Buffer.from(enc.edk, 'base64'), this.ctx(userId));
    try {
      return JSON.parse(
        open(key, Buffer.from(enc.blob, 'base64'), aad(this.ctx(userId))).toString('utf8'),
      );
    } finally {
      key.fill(0);
    }
  }
}
