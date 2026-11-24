// Версія поточної збірки — підставляється Vite з package.json (vite.config.ts)
export const APP_VERSION = __APP_VERSION__;

// Правовласник і рядок копірайту — єдине джерело для UI.
// Юридичний першоджерело — LICENSE.txt у корені репозиторію
export const COPYRIGHT_HOLDER = "Махно Андрій Андрійович";
export const COPYRIGHT_LINE = `© 2026 ${COPYRIGHT_HOLDER}. Усі права захищено.`;

// Порівняння semver-рядків ("1.10.0" > "1.2.0") без сторонніх бібліотек
export function isNewerVersion(remote: string, local: string): boolean {
    const toParts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
    const r = toParts(remote);
    const l = toParts(local);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const rp = r[i] ?? 0;
        const lp = l[i] ?? 0;
        if (rp > lp) return true;
        if (rp < lp) return false;
    }
    return false;
}
