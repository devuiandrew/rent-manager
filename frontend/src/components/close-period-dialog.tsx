import {useState} from "react";
import {toast} from "sonner";
import {Lock} from "lucide-react";
import {useAuthContext} from "@/context/auth-provider";
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
import {cn} from "@/lib/utils";
import {
    CLOSABLE_SCOPES,
    LOCK_SCOPE_LABELS,
    isPeriodClosedFor,
    type ClosableScope,
} from "@/lib/billing-utils";
import type {BillingPeriod} from "@/types/billing";

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

interface ClosePeriodDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    periods: BillingPeriod[];
    defaultYear?: number;
    serviceName?: string;
    serviceBillMonths?: Set<number>;
    onSuccess: () => void;
}

export function ClosePeriodDialog({
    open,
    onOpenChange,
    periods,
    defaultYear,
    serviceName,
    serviceBillMonths,
    onSuccess,
}: ClosePeriodDialogProps) {
    const {apiService} = useAuthContext();
    const now = new Date();
    const [year, setYear] = useState(String(defaultYear ?? now.getFullYear()));
    const [month, setMonth] = useState(String(now.getMonth() + 1));
    // Сущность: замки арендаторов и поставщиков независимы — поставщиков
    // закрывают позже, их данные приходят задним числом за 1–2 месяца
    const [scope, setScope] = useState<ClosableScope>("tenants");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const years = [-2, -1, 0, 1, 2].map((d) => now.getFullYear() + d);
    // serviceBillMonths валідні тільки для defaultYear (bills завантажені під той рік).
    // Якщо в діалозі вибрали інший рік — даних по послузі нема, підказку не показуємо.
    const canCheckService = Number(year) === defaultYear && !!serviceName;
    const serviceHasBills = serviceBillMonths?.has(Number(month)) ?? false;
    // serviceBillMonths — месяцы с АРЕНДАТОРСКИМИ счетами: к поставщикам не относится
    const serviceNotGenerated =
        scope === "tenants" && canCheckService && !serviceHasBills;

    // Знаходимо існуючий BillingPeriod для вибраного місяця/року
    const selectedPeriod = periods.find(
        (p) => p.year === Number(year) && p.month === Number(month),
    );
    const isClosed = selectedPeriod
        ? isPeriodClosedFor(selectedPeriod, scope)
        : false;
    const scopeLabel = LOCK_SCOPE_LABELS[scope];

    const handleSubmit = async () => {
        if (!selectedPeriod) {
            toast.error(
                "Період не знайдено. Спочатку згенеруйте рахунки за цей місяць.",
            );
            return;
        }
        setIsSubmitting(true);
        try {
            if (isClosed) {
                await apiService.reopenPeriod(selectedPeriod.id, scope);
                toast.success(
                    `${MONTHS[Number(month) - 1]} ${year} (${scopeLabel}) — відкрито`,
                );
            } else {
                await apiService.closePeriod(selectedPeriod.id, scope);
                toast.success(
                    `${MONTHS[Number(month) - 1]} ${year} (${scopeLabel}) — закрито. Редагування заблоковано.`,
                );
            }
            onSuccess();
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(getApiError(e, "Помилка"));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Lock className="h-5 w-5" />
                        Закрити / Відкрити період
                    </DialogTitle>
                    <DialogDescription>
                        Орендарі та постачальники закриваються окремо: закритий
                        період блокує редагування записів лише обраної сутності.
                        Відкрити його може бухгалтер або адміністратор.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-1.5 pt-2">
                    <Label>Що закриваємо</Label>
                    <Select
                        value={scope}
                        onValueChange={(v) => setScope(v as ClosableScope)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CLOSABLE_SCOPES.map((sc) => (
                                <SelectItem key={sc} value={sc}>
                                    {LOCK_SCOPE_LABELS[sc]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-3 py-2">
                    <div className="space-y-1.5">
                        <Label>Рік</Label>
                        <Select value={year} onValueChange={setYear}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {years.map((y) => (
                                    <SelectItem key={y} value={String(y)}>
                                        {y}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Місяць</Label>
                        <Select value={month} onValueChange={setMonth}>
                            <SelectTrigger>
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
                </div>

                {/* Статус обеих сущностей: замки независимы, видно сразу,
                что по месяцу уже закрыто. Выбранная — с рамкой */}
                {selectedPeriod && (
                    <div className="space-y-1">
                        {CLOSABLE_SCOPES.map((sc) => {
                            const closed = isPeriodClosedFor(selectedPeriod, sc);
                            return (
                                <div
                                    key={sc}
                                    className={cn(
                                        "flex items-center justify-between rounded-md px-3 py-1.5 text-sm",
                                        closed
                                            ? "bg-red-50 text-red-800"
                                            : "bg-green-50 text-green-800",
                                        sc === scope &&
                                            "ring-1 ring-current font-medium",
                                    )}>
                                    <span>{LOCK_SCOPE_LABELS[sc]}</span>
                                    <span>
                                        {closed ? "🔒 Закрито" : "🔓 Відкрито"}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
                {/* {!selectedPeriod && (
                    <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        ⚠️ Рахунки за цей місяць ще не створено
                    </div>
                )} */}
                {selectedPeriod && serviceNotGenerated && (
                    <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        ⚠️ По послузі «{serviceName}» рахунків за цей місяць ще
                        нема — період створено іншими послугами. Закриття
                        заблокує і цю послугу.
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}>
                        Скасувати
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={
                            isSubmitting ||
                            !selectedPeriod ||
                            (!isClosed && serviceNotGenerated)
                        }
                        variant={isClosed ? "outline" : "default"}>
                        {isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                        {isClosed ? "🔓 Відкрити" : "🔒 Закрити"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
