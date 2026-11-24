import type { AxiosError } from 'axios'

/**
 * Витягує human-readable повідомлення з DRF-відповіді або axios-помилки.
 * DRF кладе текст по-різному: `detail` (помилки рівня view — 404, права),
 * `non_field_errors` (валідатори рівня обʼєкта, напр. unique_together)
 * або у конкретне поле (валідація поля). Перебираємо всі варіанти.
 */
export function getApiError(e: unknown, fallback = 'Невідома помилка'): string {
  const data = (e as AxiosError<Record<string, unknown>>)?.response?.data
  if (data && typeof data === 'object') {
    // 1. detail — стандартне поле DRF
    if (typeof data.detail === 'string') return data.detail
    // 2. non_field_errors — помилки рівня обʼєкта (unique_together тощо)
    const nonField = (data as { non_field_errors?: unknown }).non_field_errors
    if (Array.isArray(nonField) && nonField.length) return String(nonField[0])
    // 3. Перша помилка першого поля (валідація конкретного поля)
    const firstVal = Object.values(data)[0]
    if (Array.isArray(firstVal) && firstVal.length) return String(firstVal[0])
    if (typeof firstVal === 'string') return firstVal
  }
  return e instanceof Error ? e.message : fallback
}
