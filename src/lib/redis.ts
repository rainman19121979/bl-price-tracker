import IORedis from 'ioredis'

const globalForRedis = globalThis as unknown as {
  redis: IORedis | undefined
}

function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const connection = new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 5000,
  })

  connection.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message)
  })

  return connection
}

export const redis = globalForRedis.redis ?? createRedisConnection()

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}
