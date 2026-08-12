import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY
  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }

  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        `Received ${keyHex.length} characters.`
    )
  }

  return Buffer.from(keyHex, 'hex')
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * Returns a single Buffer containing:
 *   - IV (12 bytes)
 *   - Auth Tag (16 bytes)
 *   - Ciphertext (variable length)
 */
export function encrypt(text: string): Buffer {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Concatenate: iv + authTag + ciphertext
  return Buffer.concat([iv, authTag, encrypted])
}

/**
 * Decrypts a buffer that was produced by encrypt().
 *
 * Expects the buffer layout: IV (12) + Auth Tag (16) + Ciphertext (rest).
 */
export function decrypt(encryptedData: Buffer): string {
  if (encryptedData.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error(
      `Encrypted data too short: expected at least ${IV_LENGTH + AUTH_TAG_LENGTH + 1} bytes, ` +
        `got ${encryptedData.length}.`
    )
  }

  const key = getEncryptionKey()

  const iv = encryptedData.subarray(0, IV_LENGTH)
  const authTag = encryptedData.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch (_error) {
    throw new Error(
      'Decryption failed — the data may be corrupted or the encryption key may have changed.'
    )
  }
}
