import { promises as fs } from 'fs'
import { join } from 'path'
import SMB2 from '@marsaud/smb2'
import { prisma } from './db'
import { decrypt } from './encryption'

export type BsxSourceType = 'local' | 'smb'

export interface BsxLocalSource {
  type: 'local'
  dir: string
}

export interface BsxSmbSource {
  type: 'smb'
  host: string
  share: string
  subpath: string | null
  domain: string | null
  user: string
  password: string
}

export type BsxSource = BsxLocalSource | BsxSmbSource

/**
 * Load and decrypt the user's BSX-source configuration.
 * Returns null if the user has no source configured (or missing pieces for SMB).
 */
export async function loadUserBsxSource(userId: number): Promise<BsxSource | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      bsxSourceType: true,
      bsxOrdersDir: true,
      bsxSmbHost: true,
      bsxSmbShare: true,
      bsxSmbSubpath: true,
      bsxSmbDomain: true,
      bsxSmbUser: true,
      bsxSmbPasswordEnc: true,
    },
  })
  if (!u) return null

  if (u.bsxSourceType === 'smb') {
    if (!u.bsxSmbHost || !u.bsxSmbShare || !u.bsxSmbUser || !u.bsxSmbPasswordEnc) return null
    let password: string
    try {
      password = decrypt(Buffer.from(u.bsxSmbPasswordEnc))
    } catch {
      return null
    }
    return {
      type: 'smb',
      host: u.bsxSmbHost,
      share: u.bsxSmbShare,
      subpath: u.bsxSmbSubpath || null,
      domain: u.bsxSmbDomain || null,
      user: u.bsxSmbUser,
      password,
    }
  }

  // default: local
  if (!u.bsxOrdersDir) return null
  return { type: 'local', dir: u.bsxOrdersDir }
}

interface OpenedSmb {
  client: SMB2
  basePath: string
  close: () => void
}

function openSmb(src: BsxSmbSource): OpenedSmb {
  const client = new SMB2({
    share: `\\\\${src.host}\\${src.share}`,
    domain: src.domain || 'WORKGROUP',
    username: src.user,
    password: src.password,
    autoCloseTimeout: 30_000,
  })
  const basePath = (src.subpath || '').replace(/^\/+|\/+$/g, '').replace(/\//g, '\\')
  return {
    client,
    basePath,
    close: () => { try { client.disconnect() } catch { /* ignore */ } },
  }
}

/** List *.bsx filenames (not paths) in the source. */
export async function listOrderFiles(source: BsxSource): Promise<string[]> {
  if (source.type === 'local') {
    const files = await fs.readdir(source.dir)
    return files.filter(f => f.toLowerCase().endsWith('.bsx'))
  }
  const opened = openSmb(source)
  try {
    const files = await opened.client.readdir(opened.basePath || '.')
    return files.filter((f: string) => f.toLowerCase().endsWith('.bsx'))
  } finally {
    opened.close()
  }
}

/** Read one order file by its basename (as returned by listOrderFiles). */
export async function readOrderFile(source: BsxSource, filename: string): Promise<Buffer> {
  if (source.type === 'local') {
    return fs.readFile(join(source.dir, filename))
  }
  const opened = openSmb(source)
  try {
    const path = opened.basePath ? `${opened.basePath}\\${filename}` : filename
    // Default (no encoding) returns Buffer; the type overload isn't precise enough.
    const data = (await opened.client.readFile(path)) as unknown as Buffer
    return Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as string, 'utf-8')
  } finally {
    opened.close()
  }
}

/**
 * Test whether the source is reachable and count *.bsx files.
 * Returns a friendly result for the UI.
 */
export async function testSource(source: BsxSource): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const files = await listOrderFiles(source)
    return { ok: true, count: files.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
