import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Badge} from "@/components/ui/badge";
import {CHANGELOG, type ChangeType} from "@/lib/changelog";
import {APP_VERSION, COPYRIGHT_LINE} from "@/lib/version";
import {cn} from "@/lib/utils";

const TYPE_LABEL: Record<ChangeType, string> = {
    feature: "Нове",
    fix: "Виправлення",
    improvement: "Покращення",
};

const TYPE_CLASS: Record<ChangeType, string> = {
    feature: "bg-primary/10 text-primary border-primary/20",
    fix: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    improvement:
        "bg-muted text-muted-foreground border-muted-foreground/20",
};

function formatDate(date: string) {
    return new Date(date).toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
}

export function ChangelogDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Що нового</DialogTitle>
                    <DialogDescription>
                        Історія оновлень застосунку за версіями
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[65vh] pr-4 -mr-4">
                    <div className="space-y-6">
                        {CHANGELOG.map((release) => (
                            <div key={release.version}>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <h3 className="text-base font-semibold">
                                        Версія {release.version}
                                    </h3>
                                    <span className="text-xs text-muted-foreground">
                                        {formatDate(release.date)}
                                    </span>
                                </div>
                                {release.title && (
                                    <p className="text-sm text-muted-foreground mb-2">
                                        {release.title}
                                    </p>
                                )}
                                <ul className="space-y-1.5">
                                    {release.entries.map((entry, i) => (
                                        <li
                                            key={i}
                                            className="flex items-start gap-2 text-sm">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    "shrink-0 mt-0.5",
                                                    TYPE_CLASS[entry.type],
                                                )}>
                                                {TYPE_LABEL[entry.type]}
                                            </Badge>
                                            <span>{entry.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                {/* Копірайт + версія — правова позначка «Про програму» */}
                <p className="border-t pt-3 text-center text-xs text-muted-foreground">
                    {COPYRIGHT_LINE} · v{APP_VERSION}
                </p>
            </DialogContent>
        </Dialog>
    );
}
