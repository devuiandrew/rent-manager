/**
 * Глобальний трекер незбережених змін.
 *
 * Використовується щоб відстежити коли користувач редагує комірку таблиці
 * (клікнув але ще не натиснув Enter/Tab або не вийшов з поля).
 * Якщо editCount > 0 при закритті вікна → показуємо попередження.
 *
 * Модульний рівень (не React state) — щоб уникнути prop drilling
 * і щоб window.onbeforeunload міг читати стан синхронно.
 */

let editCount = 0

/** Викликати коли комірка переходить в режим редагування */
export function trackEditStart(): void {
  editCount++
}

/** Викликати коли комірка виходить з режиму редагування (збережено або скасовано) */
export function trackEditEnd(): void {
  editCount = Math.max(0, editCount - 1)
}

/** Перевірити чи є зараз відкриті (незбережені) комірки */
export function hasActiveEdits(): boolean {
  return editCount > 0
}
