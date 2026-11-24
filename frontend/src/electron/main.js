import {app, BrowserWindow, Menu, session} from "electron";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app.isPackaged = true коли запущено з .exe (не з npm run dev)
const isDev = !app.isPackaged;

// В dev: public/logo.png поруч з проектом; в prod: витягнутий через extraResources
const iconPath = isDev
    ? path.join(__dirname, "../../public/logo.png")
    : path.join(process.resourcesPath, "logo.png");

// Меню с ролями: панель меню скрыта (setMenuBarVisibility ниже), но её
// акселераторы продолжают работать. Без ролей copy/paste горячие клавиши
// не срабатывают на кириллической раскладке — Chromium видит Ctrl+С
// (кириллическая «С»), а роли меню layout-независимы
const buildAppMenu = () => {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: "Редагування",
                submenu: [
                    {role: "undo"},
                    {role: "redo"},
                    {type: "separator"},
                    {role: "cut"},
                    {role: "copy"},
                    {role: "paste"},
                    {role: "selectAll"},
                ],
            },
            {
                label: "Вигляд",
                submenu: [
                    // reload/DevTools оставлены и в prod — для поддержки у клиента
                    {role: "reload"},
                    {role: "toggleDevTools"},
                    {type: "separator"},
                    // Масштаб Ctrl+0 / Ctrl+= / Ctrl+- — полезно на разных мониторах
                    {role: "resetZoom"},
                    {role: "zoomIn"},
                    {role: "zoomOut"},
                ],
            },
        ]),
    );
};

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        // Нижняя граница — где работать невозможно, а не «некрасиво»:
        // панель кнопок в два ряда — нормальное состояние. Выше не поднимать —
        // на ноутбуке 1280/1366 окно не влезет в экран
        minWidth: 1100,
        minHeight: 650,
        show: false,
        title: "Менеджер Оренди",
        icon: iconPath,
        // Фон до первой отрисовки страницы — совпадает со светлой темой,
        // чтобы не было белой/чёрной вспышки
        backgroundColor: "#f9fafb",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // ОС-песочница Chromium: у процесса рендерера нет прав на файловую
            // систему и системные вызовы — даже если через XSS выполнится чужой
            // код, он заперт внутри окна. Безопасно, т.к. preload/IPC нет
            sandbox: true,
        },
    });

    // Показываем окно только когда страница отрисована (ready-to-show) —
    // раньше show() вызывался сразу и юзер видел пустое белое окно
    win.once("ready-to-show", () => {
        win.maximize();
        win.show();
    });

    // Панель меню скрыта (Alt её НЕ возвращает), акселераторы меню работают
    win.setMenuBarVisibility(false);

    // Запрет навигации на чужие адреса: даже если в страницу попадёт
    // вредоносная ссылка/redirect, окно не уйдёт на внешний сайт
    // с правами приложения
    win.webContents.on("will-navigate", (event, url) => {
        const allowed = isDev
            ? url.startsWith("http://localhost:5173")
            : url.startsWith("file://");
        if (!allowed) event.preventDefault();
    });

    // Новые окна (window.open / target=_blank) запрещены — приложение их
    // не использует, а каждое новое окно = новая поверхность атаки
    win.webContents.setWindowOpenHandler(() => ({action: "deny"}));

    if (isDev) {
        win.webContents.openDevTools();
        win.loadURL("http://localhost:5173");
    } else {
        // app.getAppPath() — коренева папка .asar (надійніше ніж __dirname)
        win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
    }
};

app.whenReady().then(() => {
    // Камера/микрофон/геолокация/уведомления приложению не нужны — запрещаем
    // все запросы разрешений разом (по умолчанию Chromium решает сам)
    session.defaultSession.setPermissionRequestHandler(
        (_webContents, _permission, callback) => {
            callback(false);
        },
    );

    buildAppMenu();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
