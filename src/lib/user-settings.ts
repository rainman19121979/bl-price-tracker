import { prisma } from './db'

/**
 * Get the user's shipping-countries filter (buyer-country in price_sales).
 * Returns null if no filter (all buyer countries counted).
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
 * Get the user's seller-countries filter (seller_country in price_sales + price_stock).
 * Returns null if no filter (all seller countries counted).
 * Default for pre-migration users is 'DE' — see 20260813120000_add_seller_countries.
 */
export async function getSellerCountries(userId: number): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sellerCountries: true },
  })
  if (!user?.sellerCountries) return null
  return user.sellerCountries.split(',')
}

/**
 * Fetch both country filters at once (one query instead of two).
 */
export async function getCountryFilters(userId: number): Promise<{
  shippingCountries: string[] | null
  sellerCountries: string[] | null
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { shippingCountries: true, sellerCountries: true },
  })
  return {
    shippingCountries: user?.shippingCountries ? user.shippingCountries.split(',') : null,
    sellerCountries: user?.sellerCountries ? user.sellerCountries.split(',') : null,
  }
}
