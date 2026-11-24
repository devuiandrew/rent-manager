// Контекст + хук клавиатурной навигации по ячейкам билинга.
// Не-компонентная часть вынесена сюда из billing-nav-context.tsx: react-refresh
// требует, чтобы файл с компонентом (провайдером) экспортировал только компоненты
// (тот же приём, что с monthCellBg в billing-utils).
import {createContext, useContext} from "react";

export type NavDir = "up" | "down" | "left" | "right";

export interface BillingNavValue {
    // Ключ ячейки в режиме редактирования (`${rowId}::${colId}`), null — ни одна
    editingKey: string | null;
    // Открыть ячейку на редактирование
    openCell: (key: string) => void;
    // Закрыть ячейку — ТОЛЬКО если она сейчас активна. Гасит гонку blur/click:
    // отложенное сохранение (await) не должно закрыть соседа, открытого за это время
    closeCell: (key: string) => void;
    // Перейти от fromKey к соседней редактируемой ячейке в направлении dir
    navigate: (fromKey: string, dir: NavDir) => void;
}

export const BillingNavContext = createContext<BillingNavValue | null>(null);

// null — навигация выключена (ячейка вне провайдера, напр. секция «Постачальник»)
export function useBillingNav(): BillingNavValue | null {
    return useContext(BillingNavContext);
}
