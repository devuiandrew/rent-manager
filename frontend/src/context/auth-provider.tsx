import {
    createContext,
    useContext,
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
    type ReactNode,
} from "react";
import axios from "axios";
import {BillingApiService} from "@/lib/api-client";

const API_BASE_URL =
    import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const REFRESH_TOKEN_KEY = "auth_refresh_token";

export type UserRole = "admin" | "accountant" | "manager";

interface User {
    id: number;
    username: string;
    name: string;
    role: UserRole;
}

interface AuthContextValue {
    isAuthenticated: boolean;
    isLoading: boolean;
    user: User | null;
    isAdmin: boolean;
    isAccountant: boolean;
    isManager: boolean;
    login: (username: string, password: string) => Promise<void>;
    logout: () => void;
    getAccessToken: () => Promise<string | undefined>;
    apiService: BillingApiService;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (!context)
        throw new Error("useAuthContext must be used within AuthProvider");
    return context;
}

function parseJwtPayload(token: string): Record<string, unknown> {
    try {
        return JSON.parse(atob(token.split(".")[1]));
    } catch {
        return {};
    }
}

function userFromPayload(payload: Record<string, unknown>): User {
    const role = (payload.role as UserRole | undefined) ?? 'manager';
    return {
        id: (payload.user_id as number) ?? 0,
        username: (payload.username as string) ?? "",
        name: (payload.name as string) || (payload.username as string) || "",
        role,
    };
}

export function AuthProvider({children}: {children: ReactNode}) {
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Ref so interceptor always reads the latest token without stale closure
    const accessTokenRef = useRef<string | null>(null);
    accessTokenRef.current = accessToken;

    const isAuthenticated = Boolean(accessToken && user);
    const isAdmin = user?.role === "admin";
    const isAccountant = user?.role === "admin" || user?.role === "accountant";
    const isManager = user?.role === "admin" || user?.role === "manager";

    const logout = useCallback(() => {
        setAccessToken(null);
        setUser(null);
        // sessionStorage очищається при закритті вікна — вхід потрібен при кожному запуску
        sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    }, []);

    const refreshTokens = useCallback(async (): Promise<string | null> => {
        const stored = sessionStorage.getItem(REFRESH_TOKEN_KEY);
        if (!stored) return null;
        try {
            const {data} = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
                refresh: stored,
            });
            setAccessToken(data.access);
            if (data.refresh)
                sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refresh);
            return data.access as string;
        } catch {
            logout();
            return null;
        }
    }, [logout]);

    // Stable function: returns current token or tries to refresh
    const getAccessToken = useCallback(async (): Promise<
        string | undefined
    > => {
        if (accessTokenRef.current) return accessTokenRef.current;
        const token = await refreshTokens();
        return token ?? undefined;
    }, [refreshTokens]);

    // При запуску: відновлюємо сесію з sessionStorage.
    // sessionStorage живе тільки поки відкрите вікно — при кожному новому
    // запуску (Electron або браузер) воно порожнє → потрібен вхід.
    useEffect(() => {
        const init = async () => {
            const stored = sessionStorage.getItem(REFRESH_TOKEN_KEY);
            if (!stored) {
                setIsLoading(false);
                return;
            }
            try {
                const {data} = await axios.post(
                    `${API_BASE_URL}/auth/refresh/`,
                    {
                        refresh: stored,
                    },
                );
                setAccessToken(data.access);
                if (data.refresh)
                    sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refresh);
                setUser(userFromPayload(parseJwtPayload(data.access)));
            } catch {
                sessionStorage.removeItem(REFRESH_TOKEN_KEY);
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, []);

    // Sync user whenever access token changes (after login or refresh)
    useEffect(() => {
        if (accessToken) setUser(userFromPayload(parseJwtPayload(accessToken)));
    }, [accessToken]);

    // On 401 from API client — try refresh, logout on failure
    useEffect(() => {
        const handle = async () => {
            const token = await refreshTokens();
            if (!token) logout();
        };
        window.addEventListener("auth:unauthorized", handle);
        return () => window.removeEventListener("auth:unauthorized", handle);
    }, [refreshTokens, logout]);

    const login = useCallback(async (username: string, password: string) => {
        const {data} = await axios.post(`${API_BASE_URL}/auth/login/`, {
            username,
            password,
        });
        setAccessToken(data.access);
        sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refresh);
    }, []);

    const apiService = useMemo(
        () => new BillingApiService(getAccessToken),
        [getAccessToken],
    );

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                isLoading,
                user,
                isAdmin,
                isAccountant,
                isManager,
                login,
                logout,
                getAccessToken,
                apiService,
            }}>
            {children}
        </AuthContext.Provider>
    );
}

export default AuthProvider;
