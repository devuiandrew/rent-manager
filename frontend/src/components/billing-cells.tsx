// Общая редактируемая ячейка биллинговых таблиц («Рахунки»: орендарі + постачальники).
// Вынесено из billing-table.tsx без изменений, чтобы секция постачальника
// переиспользовала ту же механику (trackEditStart/End — пауза авторефреша SWR).
// Раскраска месяцев (monthCellBg) — в billing-utils (react-refresh требует
// от файла с компонентом экспортировать только компоненты).
import React, {useState, useEffect, useRef} from "react";
import {Loader2} from "lucide-react";

import {trackEditStart, trackEditEnd} from "@/lib/unsaved-tracker";
import {Input} from "@/components/ui/input";
import {cn} from "@/lib/utils";
import {useBillingNav, type NavDir} from "@/lib/billing-nav";

export function EditableCell({
    value,
    onSave,
    type = "number",
    className,
    // Клавиатурная навигация включается ТОЛЬКО если задан cellKey и ячейка
    // внутри BillingNavProvider. Без него — прежнее локальное поведение
    // (используют секция «Постачальник» и любые ячейки вне сетки навигации).
    cellKey,
}: {
    value: number;
    onSave: (value: number) => Promise<void>;
    // 'quantity' — объём/тариф (до 9 знаков), 'currency' — деньги (ровно 2)
    type?: "number" | "currency" | "quantity";
    className?: string;
    cellKey?: string;
}) {
    const nav = useBillingNav();
    const controlled = cellKey !== undefined && nav !== null;

    // Локальное состояние редактирования — для uncontrolled-режима (без навигации)
    const [localEditing, setLocalEditing] = useState(false);
    const isEditing = controlled ? nav!.editingKey === cellKey : localEditing;

    const openEditing = () => {
        if (controlled) nav!.openCell(cellKey!);
        else setLocalEditing(true);
    };
    // closeCell закрывает только если ячейка ещё активна — не гасит соседа,
    // открытого за время await сохранения (гонка blur/click)
    const closeEditing = () => {
        if (controlled) nav!.closeCell(cellKey!);
        else setLocalEditing(false);
    };

    const [editValue, setEditValue] = useState(() => value.toString());
    const [isSaving, setIsSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    // Гасим blur-сохранение, когда закрытие вызвано навигацией (уже сохранили)
    const skipBlurRef = useRef(false);
    // Сброс editValue ровно один раз при переходе в редактирование
    const wasEditing = useRef(false);

    // «Adjust state during render»: при открытии подставляем актуальное value
    // (могло измениться фоновым refresh). Делаем в фазе рендера — тогда input
    // сразу коммитится со свежим значением, и focus+select ниже выделяют его,
    // даже если ячейку открыли с клавиатуры (без клика).
    if (isEditing && !wasEditing.current) {
        wasEditing.current = true;
        // Свежая сессия ввода: сбрасываем возможный «висящий» skip-флаг,
        // иначе он проглотил бы реальный blur этой сессии
        skipBlurRef.current = false;
        setEditValue(value.toString());
    } else if (!isEditing && wasEditing.current) {
        wasEditing.current = false;
    }

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
            // Повідомляємо трекер що є відкрита комірка (незбережені дані)
            trackEditStart();
            return () => trackEditEnd();
        }
    }, [isEditing]);

    // Сохранение с индикатором + закрытием (blur, Enter в обычном режиме)
    const handleSave = async () => {
        const numValue = parseFloat(editValue) || 0;
        if (numValue !== value) {
            setIsSaving(true);
            try {
                await onSave(numValue);
            } finally {
                setIsSaving(false);
            }
        }
        closeEditing();
    };

    // Переход к соседней ячейке: сохраняем без ожидания (кеш SWR оптимистичный,
    // ошибки тостит родитель) и сразу открываем соседа — ощущение Excel
    const commitAndNavigate = (dir: NavDir) => {
        skipBlurRef.current = true;
        const numValue = parseFloat(editValue) || 0;
        if (numValue !== value) onSave(numValue);
        nav!.navigate(cellKey!, dir);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            setEditValue(value.toString());
            closeEditing();
            return;
        }
        if (controlled) {
            if (e.key === "Enter") {
                e.preventDefault();
                commitAndNavigate(e.shiftKey ? "up" : "down");
            } else if (e.key === "Tab") {
                // Перехватываем Tab — двигаемся по сетке, а не по DOM-фокусу
                e.preventDefault();
                commitAndNavigate(e.shiftKey ? "left" : "right");
            }
            return;
        }
        // Обычный режим (без навигации): Enter — сохранить+закрыть
        if (e.key === "Enter") handleSave();
    };

    if (isEditing) {
        return (
            <div className="flex items-center gap-1">
                <Input
                    ref={inputRef}
                    type="number"
                    step="any"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                        // Закрытие через навигацию уже сохранило — не дублируем
                        if (skipBlurRef.current) {
                            skipBlurRef.current = false;
                            return;
                        }
                        handleSave();
                    }}
                    className="h-7 w-full min-w-0 px-1 text-sm"
                    disabled={isSaving}
                />
                {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
        );
    }

    const display =
        type === "currency"
            ? value.toLocaleString("uk-UA", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              })
            : type === "quantity"
              ? value.toLocaleString("uk-UA", {maximumFractionDigits: 9})
              : value.toLocaleString("uk-UA");

    // truncate — длинное число (объём до 9 знаков) не вылезает в соседнюю
    // колонку; полное значение — в title на hover
    return (
        <button
            onClick={() => openEditing()}
            title={display}
            className={cn(
                "w-full truncate text-right px-2 py-1 rounded hover:bg-muted/50 transition-colors",
                className,
            )}>
            {display}
        </button>
    );
}
