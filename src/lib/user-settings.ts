import { prisma } from './db'

/**
 * Get the user's shipping countries filter.
 * Returns null if no filter (all countries), or an array of country codes.
 */
export async function getShippingCountries(userId: number): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { shippingCountries: true },
  })

  if (!user?.shippingCountries) return null
  return user.shippingCountries.split(',')
}

/**
 * Build SQL WHERE clause fragment for buyer_country filter.
 * Returns empty string if no filter, or "AND buyer_country = ANY($N)" with the param.
 */
export function buildCountryFilter(countries: string[] | null): {
  sql: string
  params: string[] | null
} {
  if (!countries || countries.length === 0) {
    return { sql: '', params: null }
  }
  return {
    sql: 'AND buyer_country = ANY($COUNTRIES)',
    params: countries,
  }
}
