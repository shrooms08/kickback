import { useDiag } from '../stores/diag'

/**
 * Log an error to the console and record it in Diagnostics. Safe to call where no Pinia is
 * active (unit tests, very early boot): then it only logs.
 */
export function logError(where: string, error: unknown) {
  try { useDiag().error(where, error) }
  catch { console.warn(`[kickback] ${where}:`, error) }
}
