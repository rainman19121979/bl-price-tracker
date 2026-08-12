import { redis } from './redis'

const KEYS = {
  registrationOpen: 'app:registration_open',
}

export async function isRegistrationOpen(): Promise<boolean> {
  const val = await redis.get(KEYS.registrationOpen)
  return val === '1' // default: closed (single-user self-host)
}

export async function setRegistrationOpen(open: boolean): Promise<void> {
  await redis.set(KEYS.registrationOpen, open ? '1' : '0')
}
