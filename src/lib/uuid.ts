/** A v4 uuid (also where crypto.randomUUID is missing, e.g. older WebViews). */
export function uuid(): string {
  try { return crypto.randomUUID() }
  catch {
    const h = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0'))
    h[6] = '4' + h[6][1]; h[8] = ((parseInt(h[8], 16) & 0x3f) | 0x80).toString(16)
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
  }
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
