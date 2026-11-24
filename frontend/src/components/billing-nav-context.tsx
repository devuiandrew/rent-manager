// Провайдер клавиатурной навигации по редактируемым ячейкам билинга.
// Держит editingKey (какая ячейка сейчас в режиме ввода) и умеет прыгать
// к соседней редактируемой ячейке по сетке. Контекст/хук/тип — в lib/billing-nav
// (react-refresh: файл с компонентом экспортирует только компоненты).
import React, {useCallback, useMemo, useState} from "react";

import {
    BillingNavContext,
    type BillingNavValue,
    type NavDir,
} from "@/lib/billing-nav";

export function BillingNavProvider({
    // grid[row][col] — ключ редактируемой ячейки в ВИЗУАЛЬНОМ порядке
    // (строки сверху вниз, колонки слева направо), null — ячейки нет
    grid,
    children,
}: {
    grid: (string | null)[][];
    children: React.ReactNode;
}) {
    const [editingKey, setEditingKey] = useState<string | null>(null);

    // Индекс ключ → [row, col] для O(1) поиска позиции по ключу
    const posByKey = useMemo(() => {
        const map = new Map<string, [number, number]>();
        grid.forEach((row, r) =>
            row.forEach((key, c) => {
                if (key !== null) map.set(key, [r, c]);
            }),
        );
        return map;
    }, [grid]);

    const openCell = useCallback((key: string) => {
        setEditingKey(key);
    }, []);

    // Функциональный апдейт читает АКТУАЛЬНЫЙ editingKey — закрываем только свою
    const closeCell = useCallback((key: string) => {
        setEditingKey((prev) => (prev === key ? null : prev));
    }, []);

    const navigate = useCallback(
        (fromKey: string, dir: NavDir) => {
            const pos = posByKey.get(fromKey);
            if (!pos) return;
            const [r, c] = pos;

            // Ищем ближайшую ненулевую ячейку в направлении.
            // Вертикаль (up/down) — та же колонка; горизонталь (left/right) —
            // в пределах строки, а на краю переносимся на соседнюю строку.
            let target: string | null = null;

            if (dir === "down") {
                for (let i = r + 1; i < grid.length; i++)
                    if (grid[i][c]) {
                        target = grid[i][c];
                        break;
                    }
            } else if (dir === "up") {
                for (let i = r - 1; i >= 0; i--)
                    if (grid[i][c]) {
                        target = grid[i][c];
                        break;
                    }
            } else if (dir === "right") {
                // Остаток текущей строки
                for (let j = c + 1; j < grid[r].length; j++)
                    if (grid[r][j]) {
                        target = grid[r][j];
                        break;
                    }
                // Перенос: первая редакт. ячейка следующих строк
                for (let i = r + 1; target === null && i < grid.length; i++)
                    for (let j = 0; j < grid[i].length; j++)
                        if (grid[i][j]) {
                            target = grid[i][j];
                            break;
                        }
            } else if (dir === "left") {
                for (let j = c - 1; j >= 0; j--)
                    if (grid[r][j]) {
                        target = grid[r][j];
                        break;
                    }
                // Перенос назад: последняя редакт. ячейка предыдущих строк
                for (let i = r - 1; target === null && i >= 0; i--)
                    for (let j = grid[i].length - 1; j >= 0; j--)
                        if (grid[i][j]) {
                            target = grid[i][j];
                            break;
                        }
            }

            // Нет соседа (край сетки) — закрываем редактор (target === null)
            setEditingKey(target);
        },
        [grid, posByKey],
    );

    // Активная ячейка могла исчезнуть из сетки (сменили услугу/год/фильтр).
    // Считаем «эффективный» ключ прямо в рендере — без эффекта и лишнего setState:
    // если ключа нет в сетке, консюмеры видят null (ни одна ячейка не открыта).
    const effectiveKey =
        editingKey !== null && posByKey.has(editingKey) ? editingKey : null;

    const value = useMemo<BillingNavValue>(
        () => ({editingKey: effectiveKey, openCell, closeCell, navigate}),
        [effectiveKey, openCell, closeCell, navigate],
    );

    return (
        <BillingNavContext.Provider value={value}>
            {children}
        </BillingNavContext.Provider>
    );
}
