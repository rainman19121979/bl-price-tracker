import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubsetEntry {
  item: { no: string; name: string; type: string; category_id: number }
  color_id: number
  quantity: number
  extra_quantity: number
  is_alternate: boolean
  is_counterpart: boolean
}

export interface SubsetGroup {
  match_no: number
  entries: SubsetEntry[]
}

export interface SubsetsResponse {
  meta: { description: string; message: string; code: number }
  data: SubsetGroup[]
}

export interface PriceDetail {
  quantity: number
  unit_price: string
  shipping_available: boolean
  seller_country_code: string
  buyer_country_code: string
  date_ordered: string
  qunatity: number // BrickLink API actually returns this typo
}

export interface PriceGuideData {
  item: {
    no: string
    type: string
  }
  new_or_used: 'N' | 'U'
  currency_code: string
  min_price: string
  max_price: string
  avg_price: string
  qty_avg_price: string
  unit_quantity: number
  total_quantity: number
  price_detail: PriceDetail[]
}

export interface PriceGuideResponse {
  meta: {
    description: string
    message: string
    code: number
  }
  data: PriceGuideData
}

export interface InventoryItem {
  inventory_id: number
  item: {
    no: string
    name: string
    type: string
    category_id: number
  }
  color_id: number
  color_name: string
  quantity: number
  new_or_used: 'N' | 'U'
  unit_price: string
  description: string
  remarks: string
  bulk: number
  is_retain: boolean
  is_stock_room: boolean
  stock_room_id: string
  my_cost: string
  sale_rate: number
  date_created?: string
  tier_quantity1: number
  tier_price1: string
  tier_quantity2: number
  tier_price2: string
  tier_quantity3: number
  tier_price3: string
}

export interface InventoryResponse {
  meta: {
    description: string
    message: string
    code: number
  }
  data: InventoryItem[]
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class BrickLinkApiError extends Error {
  public readonly statusCode: number
  public readonly apiCode: number | undefined
  public readonly apiMessage: string | undefined

  constructor(
    message: string,
    statusCode: number,
    apiCode?: number,
    apiMessage?: string
  ) {
    super(message)
    this.name = 'BrickLinkApiError'
    this.statusCode = statusCode
    this.apiCode = apiCode
    this.apiMessage = apiMessage
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.bricklink.com/api/store/v1'
const DEFAULT_DELAY_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent) */
function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export class BrickLinkClient {
  private consumerKey: string
  private consumerSecret: string
  private tokenValue: string
  private tokenSecret: string
  private delayMs: number

  constructor(
    consumerKey: string,
    consumerSecret: string,
    tokenValue: string,
    tokenSecret: string,
    delayMs: number = DEFAULT_DELAY_MS
  ) {
    this.consumerKey = consumerKey.trim()
    this.consumerSecret = consumerSecret.trim()
    this.tokenValue = tokenValue.trim()
    this.tokenSecret = tokenSecret.trim()
    this.delayMs = delayMs
  }

  /**
   * Build OAuth 1.0 Authorization header for BrickLink.
   * BrickLink requires: oauth_version, realm="", HMAC-SHA1.
   */
  private buildAuthHeader(method: string, url: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = crypto.randomBytes(16).toString('hex')

    // Parse URL to separate base URL and query params
    const urlObj = new URL(url)
    const baseUrl = `${urlObj.origin}${urlObj.pathname}`

    // Collect all params (query + oauth) for signature base string
    const params: Record<string, string> = {}

    // Add query params
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value
    })

    // Add OAuth params
    params['oauth_consumer_key'] = this.consumerKey
    params['oauth_token'] = this.tokenValue
    params['oauth_signature_method'] = 'HMAC-SHA1'
    params['oauth_timestamp'] = timestamp
    params['oauth_nonce'] = nonce
    params['oauth_version'] = '1.0'

    // Sort params and build parameter string
    const paramString = Object.keys(params)
      .sort()
      .map((k) => `${encodeRFC3986(k)}=${encodeRFC3986(params[k])}`)
      .join('&')

    // Build signature base string
    const signatureBase = [
      method.toUpperCase(),
      encodeRFC3986(baseUrl),
      encodeRFC3986(paramString),
    ].join('&')

    // Build signing key
    const signingKey = `${encodeRFC3986(this.consumerSecret)}&${encodeRFC3986(this.tokenSecret)}`

    // Generate HMAC-SHA1 signature
    const signature = crypto
      .createHmac('sha1', signingKey)
      .update(signatureBase)
      .digest('base64')

    // Build Authorization header
    return [
      'OAuth realm=""',
      `oauth_consumer_key="${encodeRFC3986(this.consumerKey)}"`,
      `oauth_token="${encodeRFC3986(this.tokenValue)}"`,
      `oauth_signature_method="HMAC-SHA1"`,
      `oauth_signature="${encodeRFC3986(signature)}"`,
      `oauth_timestamp="${timestamp}"`,
      `oauth_nonce="${nonce}"`,
      `oauth_version="1.0"`,
    ].join(',')
  }

  /**
   * Make a signed GET request to the BrickLink API.
   */
  private async signedGet(url: string): Promise<Response> {
    await sleep(this.delayMs)

    const authorization = this.buildAuthHeader('GET', url)

    return fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
      },
    })
  }

  /**
   * Parse and validate BrickLink API response.
   */
  private async parseResponse<T>(response: Response): Promise<{ meta: { description: string; message: string; code: number }; data: T }> {
    const body = await response.json()

    if (!response.ok || (body.meta?.code && body.meta.code >= 400)) {
      throw new BrickLinkApiError(
        `BrickLink API error ${body.meta?.code ?? response.status}: ${body.meta?.message ?? 'Unknown error'}`,
        body.meta?.code ?? response.status,
        body.meta?.code,
        body.meta?.message
      )
    }

    return body
  }

  /**
   * Fetch a price guide from the BrickLink API.
   */
  async getPriceGuide(
    itemNo: string,
    itemType: string,
    colorId: number,
    newOrUsed: 'N' | 'U',
    guideType: 'sold' | 'stock' = 'sold',
    countryCode?: string,
  ): Promise<PriceGuideResponse> {
    // No country_code by default: BL returns all sellers/sales worldwide,
    // each price_detail entry carries seller_country_code so we can
    // filter per-user in SQL. Pass a code to narrow at the BL side
    // (e.g. `test` route in keys/[id]/test uses "DE" as a cheap probe).
    const params = new URLSearchParams({
      color_id: String(colorId),
      guide_type: guideType,
      new_or_used: newOrUsed,
      currency_code: 'EUR',
      vat: 'Y',
    })
    if (countryCode) params.set('country_code', countryCode)
    const url = `${BASE_URL}/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/price?${params}`

    const response = await this.signedGet(url)
    return this.parseResponse<PriceGuideData>(response) as Promise<PriceGuideResponse>
  }

  /**
   * Fetch subset inventory of a SET (= all parts inside the set).
   * break_minifigs=N: minifigs as a single entry; =Y: split into components.
   */
  async getSetSubsets(setNo: string, breakMinifigs: 'Y' | 'N' = 'N'): Promise<SubsetsResponse> {
    const params = new URLSearchParams({ break_minifigs: breakMinifigs });
    const url = `${BASE_URL}/items/SET/${encodeURIComponent(setNo)}/subsets?${params}`
    const response = await this.signedGet(url)
    return this.parseResponse(response) as Promise<SubsetsResponse>
  }

  /**
   * Get item metadata (used to fetch part_name, color_name etc when creating new parts).
   */
  async getItem(itemType: string, itemNo: string): Promise<{
    meta: { code: number };
    data: { no: string; name: string; type: string; category_id: number };
  }> {
    const url = `${BASE_URL}/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`
    const response = await this.signedGet(url)
    return this.parseResponse(response) as Promise<{ meta: { code: number }; data: { no: string; name: string; type: string; category_id: number } }>
  }

  /**
   * Fetch the user's store inventory from BrickLink.
   */
  async getInventory(options?: { itemType?: string; status?: string }): Promise<InventoryResponse> {
    const params = new URLSearchParams()
    if (options?.itemType) params.set('item_type', options.itemType)
    if (options?.status) params.set('status', options.status)

    const queryString = params.toString()
    const url = `${BASE_URL}/inventories${queryString ? `?${queryString}` : ''}`

    const response = await this.signedGet(url)
    return this.parseResponse<InventoryItem[]>(response) as Promise<InventoryResponse>
  }

  /**
   * Generic signed GET request — useful for debugging.
   */
  async rawGet(path: string): Promise<unknown> {
    const url = `${BASE_URL}${path}`
    const response = await this.signedGet(url)
    return response.json()
  }
}
