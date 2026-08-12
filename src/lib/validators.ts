import { z } from 'zod'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export type LoginInput = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(100, 'Username must be at most 100 characters')
      .regex(
        /^[a-zA-Z0-9]+$/,
        'Username may only contain letters and numbers'
      ),
    password: z.string()
      .min(8, 'Mindestens 8 Zeichen')
      .regex(/[A-Z]/, 'Mindestens ein Grossbuchstabe')
      .regex(/[a-z]/, 'Mindestens ein Kleinbuchstabe')
      .regex(/[0-9]/, 'Mindestens eine Zahl'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type RegisterInput = z.infer<typeof registerSchema>

// ---------------------------------------------------------------------------
// BrickLink API Keys
// ---------------------------------------------------------------------------

export const apiKeySchema = z.object({
  consumerKey: z.string().min(1, 'Consumer Key is required'),
  consumerSecret: z.string().min(1, 'Consumer Secret is required'),
  tokenValue: z.string().min(1, 'Token Value is required'),
  tokenSecret: z.string().min(1, 'Token Secret is required'),
})

export type ApiKeyInput = z.infer<typeof apiKeySchema>

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export const watchlistAddSchema = z.object({
  partNo: z.string().min(1, 'Part number is required'),
  colorId: z.number().int('Color ID must be an integer'),
  newOrUsed: z.enum(['N', 'U']).optional(),
  priority: z
    .number()
    .int()
    .min(1, 'Priority must be between 1 and 10')
    .max(10, 'Priority must be between 1 and 10')
    .optional(),
  alertBelow: z
    .number()
    .positive('Alert-below threshold must be a positive number')
    .optional(),
  alertAbove: z
    .number()
    .positive('Alert-above threshold must be a positive number')
    .optional(),
})

export type WatchlistAddInput = z.infer<typeof watchlistAddSchema>

// ---------------------------------------------------------------------------
// Import (file upload)
// ---------------------------------------------------------------------------

export const importSchema = z.object({
  file: z
    .instanceof(File, { message: 'A file is required' })
    .refine((f) => f.size > 0, 'File must not be empty')
    .refine(
      (f) => f.size <= 5 * 1024 * 1024,
      'File must be smaller than 5 MB'
    )
    .refine(
      (f) =>
        ['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(
          f.type
        ) || f.name.endsWith('.csv'),
      'Only CSV files are accepted'
    ),
})

export type ImportInput = z.infer<typeof importSchema>

// ---------------------------------------------------------------------------
// Price query
// ---------------------------------------------------------------------------

export const priceQuerySchema = z.object({
  partNo: z.string().min(1, 'Part number is required'),
  colorId: z.coerce.number().int('Color ID must be an integer'),
  newOrUsed: z.enum(['N', 'U']).optional(),
  days: z.coerce.number().int().positive().default(90).optional(),
})

export type PriceQueryInput = z.infer<typeof priceQuerySchema>
