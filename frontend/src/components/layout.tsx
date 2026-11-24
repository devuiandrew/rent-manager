import {useEffect, useRef, useState} from "react";
import {Outlet, NavLink} from "react-router-dom";
import {toast} from "sonner";
import {useAuthContext} from "@/context/auth-provider";
import {Button} from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {Toaster} from "@/components/ui/sonner";
import {ChangelogDialog} from "@/components/changelog-dialog";
import {LogOut, User, Settings, HelpCircle, Sparkles} from "lucide-react";
import {cn} from "@/lib/utils";
import {APP_VERSION, isNewerVersion} from "@/lib/version";

function AppLogo({className}: {className?: string}) {
    return (
        <div className={className}>
            <img
                src="./logo.png"
                alt="Логотип"
                className="w-full h-full object-contain"
            />
        </div>
    );
}

const NAV_ITEMS = [
    {to: "/dashboard", label: "Дашборд", accountantOnly: true},
    {to: "/", label: "Рахунки", end: true},
    {to: "/tenants", label: "Орендарі"},
    {to: "/contracts", label: "Договори"},
    {to: "/reimbursements", label: "Відшкодування"},
    {to: "/suppliers", label: "Постачальники"},
    {to: "/services", label: "Послуги"},
    {to: "/contract-services", label: "Тарифи"},
];

export function Layout() {
    const {user, logout, isAuthenticated, isAccountant, apiService} =
        useAuthContext();
    const [changelogOpen, setChangelogOpen] = useState(false);
    // Флаг щоб перевірка версії не дублювалась при перерендерах
    const versionCheckDone = useRef(false);

    // Перевірка нової версії — раз за сесію, поки користувач залогінений
    useEffect(() => {
        if (!isAuthenticated) return;
        if (versionCheckDone.current) return;
        versionCheckDone.current = true;

        apiService
            .getLatestVersion()
            .then(({latest_version}) => {
                if (!latest_version) return;
                if (!isNewerVersion(latest_version, APP_VERSION)) return;
                toast.info(
                    <div>
                        <div className="font-semibold">
                            Доступна нова версія {latest_version}
                        </div>
                        <div className="text-sm opacity-80 mt-0.5">
                            Зараз встановлена {APP_VERSION}. Зверніться до
                            адміністратора, щоб оновити застосунок
                        </div>
                    </div>,
                    {
                        duration: 15000,
                        icon: <Sparkles className="h-4 w-4" />,
                        action: {
                            label: "Що нового",
                            onClick: () => setChangelogOpen(true),
                        },
                    },
                );
            })
            .catch(() => {
                // Немає з'єднання або бэкенд ще без /version/ — мовчки ігноруємо
            });
    }, [isAuthenticated, apiService]);

    return (
        <div className="h-screen bg-background flex flex-col">
            <header className="border-b bg-card sticky top-0 z-50 shrink-0">
                <div className="px-4">
                    <div className="flex items-center justify-between h-14">
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-3">
                                <AppLogo className="w-9 h-9" />
                                <div>
                                    <h1 className="font-semibold text-base text-foreground leading-tight">
                                        Комунальні платежі
                                    </h1>
                                    <p className="text-xs text-muted-foreground leading-tight">
                                        Система обліку
                                    </p>
                                </div>
                            </div>

                            <nav className="flex items-center gap-1">
                                {NAV_ITEMS.filter(
                                    (item) =>
                                        !item.accountantOnly || isAccountant,
                                ).map((item) => (
                                    <NavLink
                                        key={item.to}
                                        to={item.to}
                                        end={item.end}
                                        className={({isActive}) =>
                                            cn(
                                                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                                isActive
                                                    ? "bg-primary text-primary-foreground"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                            )
                                        }>
                                        {item.label}
                                    </NavLink>
                                ))}
                            </nav>
                        </div>

                        {isAuthenticated && user && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                                            <User className="h-4 w-4 text-primary" />
                                        </div>
                                        <div className="hidden sm:block text-left">
                                            <p className="text-sm font-medium leading-tight">
                                                {user.name}
                                            </p>
                                            <p className="text-xs text-muted-foreground leading-tight">
                                                {user.username}
                                            </p>
                                        </div>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-56">
                                    <DropdownMenuLabel>
                                        <div>
                                            <p className="font-medium">
                                                {user.name}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {user.username}
                                            </p>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem>
                                        <Settings className="h-4 w-4 mr-2" />
                                        Налаштування
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() =>
                                            setChangelogOpen(true)
                                        }>
                                        <HelpCircle className="h-4 w-4 mr-2" />
                                        Довідка
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={logout}
                                        className="text-destructive">
                                        <LogOut className="h-4 w-4 mr-2" />
                                        Вийти
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <Outlet />
            </main>
            <Toaster position="bottom-right" richColors />
            <ChangelogDialog
                open={changelogOpen}
                onOpenChange={setChangelogOpen}
            />
        </div>
    );
}
