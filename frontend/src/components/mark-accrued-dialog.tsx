import {useState, useEffect} from "react";
import {toast} from "sonner";
import {useSWRConfig} from "swr";
import {Calculator} from "lucide-react";

import {useAuthContext} from "@/context/auth-provider";
import {useServices} from "@/hooks/use-billing-data";
import {getApiError} from "@/lib/api-error";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {Label} from "@/components/ui/label";
import {Button} from "@/components/ui/button";
import {Spinner} from "@/components/ui/spinner";
import {Input} from "@/components/ui/input";

const MONTHS = [
    "Січень",
    "Лютий",
    "Березень",
    "Квітень",
    "Травень",
    "Червень",
    "Липень",
    "Серпень",
    "Вересень",
    "Жовтень",
    "Листопад",
    "Грудень",
];

// "all" — проставити нарахування для всіх послуг одночасно
const ALL_SERVICES = "all";

interface MarkAccruedDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // Початкові значення (наприклад поточні рік + послуга)
    defaultYear?: number;
    defaultMonth?: number;
    defaultServiceId?: number | null;
}

export function MarkAccruedDialog({
    open,
    onOpenChange,
    defaultYear,
    defaultMonth,
    defaultServiceId,
}: MarkAccruedDialogProps) {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const {data: services} = useServices();

    const now = new Date();
    const [year, setYear] = useState(String(defaultYear ?? now.getFullYear()));
    const [month, setMonth] = useState(
        String(defaultMonth ?? now.getMonth() + 1),
    );
    // Конец диапазона (включительно); по умолчанию = месяц «з» → один месяц
    const [monthTo, setMonthTo] = useState(
        String(defaultMonth ?? now.getMonth() + 1),
    );
    const [serviceId, setServiceId] = useState<string>(
        defaultServiceId ? String(defaultServiceId) : ALL_SERVICES,
    );
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Диапазон невалиден, если конец раньше начала
    const invalidRange = parseInt(monthTo, 10) < parseInt(month, 10);

    // При відкритті — скидаємо стан на актуальні defaultYear/defaultServiceId
    useEffect(() => {
        if (open) {
            setYear(String(defaultYear ?? now.getFullYear()))
            setMonth(String(defaultMonth ?? now.getMonth() + 1))
            setMonthTo(String(defaultMonth ?? now.getMonth() + 1))
            setServiceId(defaultServiceId ? String(defaultServiceId) : ALL_SERVICES)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const monthFrom = parseInt(month, 10);
            const monthEnd = parseInt(monthTo, 10);
            const result = await apiService.markBillsAccrued({
                year: parseInt(year, 10),
                month: monthFrom,
                month_to: monthEnd,
                // undefined — означає "всі послуги"
                service_id:
                    serviceId === ALL_SERVICES
                        ? undefined
                        : parseInt(serviceId, 10),
            });

            const scopeLabel =
                serviceId === ALL_SERVICES
                    ? "для всіх послуг"
                    : `для послуги ${services?.find((s) => String(s.id) === serviceId)?.name}`;

            // Один месяц — «Березень 2026», диапазон — «Березень – Червень 2026»
            const monthLabel =
                monthEnd > monthFrom
                    ? `${MONTHS[monthFrom - 1]} – ${MONTHS[monthEnd - 1]}`
                    : MONTHS[monthFrom - 1];
            toast.success(
                <div>
                    <div>
                        <span className="font-semibold">
                            {monthLabel} {year}
                        </span>{" "}
                        <span className="opacity-75 text-sm">{scopeLabel}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-sm flex-wrap">
                        <span className="text-green-600 font-medium">
                            ✓ Нараховано: {result.accrued}
                        </span>
                        {result.skipped_manual > 0 && (
                            <span className="text-amber-600 font-medium">
                                Пропущено (ручне нарах.): {result.skipped_manual}
                            </span>
                        )}
                    </div>
                    {result.skipped_closed.length > 0 && (
                        <div className="mt-1 text-sm text-red-500">
                            Закриті місяці пропущено:{" "}
                            {result.skipped_closed
                                .map((m) => MONTHS[m - 1])
                                .join(", ")}
                        </div>
                    )}
                </div>,
            );

            // Інвалідуємо кеш рахунків орендарів — постачальників не чіпаємо
            await mutate(
                (key) => typeof key === "string" && key.startsWith("/bills"),
            );
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(getApiError(e, "Помилка проставлення нарахування"));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Calculator className="h-5 w-5" />
                        Проставити нарахування
                    </DialogTitle>
                    <DialogDescription>
                        Проставить нарахування = обсяг × тариф (те саме число,
                        що показує колонка «Спожито») для всіх орендарів за
                        вказаний місяць. Постачальників не зачіпає. Комірки,
                        заповнені вручну, лишаються як є — скидайте їх іконкою
                        біля комірки.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="accrued-year">Рік</Label>
                            <Input
                                id="accrued-year"
                                type="number"
                                min={2000}
                                max={2100}
                                value={year}
                                onChange={(e) => setYear(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="accrued-month">З місяця</Label>
                            <Select
                                value={month}
                                onValueChange={(v) => {
                                    setMonth(v);
                                    // Конец диапазона не может быть раньше начала — подтягиваем
                                    if (
                                        parseInt(monthTo, 10) <
                                        parseInt(v, 10)
                                    )
                                        setMonthTo(v);
                                }}>
                                <SelectTrigger id="accrued-month">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MONTHS.map((name, idx) => (
                                        <SelectItem
                                            key={idx + 1}
                                            value={String(idx + 1)}>
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="accrued-month-to">По місяць</Label>
                            <Select value={monthTo} onValueChange={setMonthTo}>
                                <SelectTrigger id="accrued-month-to">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MONTHS.map((name, idx) => (
                                        <SelectItem
                                            key={idx + 1}
                                            value={String(idx + 1)}
                                            disabled={
                                                idx + 1 < parseInt(month, 10)
                                            }>
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="accrued-service">Послуга</Label>
                        <Select value={serviceId} onValueChange={setServiceId}>
                            <SelectTrigger id="accrued-service">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_SERVICES}>
                                    <span className="font-medium">
                                        Всі послуги
                                    </span>
                                </SelectItem>
                                {services?.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>
                                        <span className="flex items-center gap-2">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{
                                                    backgroundColor:
                                                        s.color || "#94a3b8",
                                                }}
                                            />
                                            {s.name}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter className="w-full gap-0 space-x-2">
                    <Button
                        variant="outline"
                        className="w-1/2 max-md:w-auto"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}>
                        Скасувати
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || invalidRange}
                        className="w-1/2  max-md:w-auto">
                        {isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                        Проставити
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
