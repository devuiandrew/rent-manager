import time
import json
import logging

logger = logging.getLogger('api')

# Ці шляхи не логуємо в деталях (паролі, токени)
_SENSITIVE = {'/api/auth/login/', '/api/auth/refresh/'}


class RequestLoggingMiddleware:
    """
    Логує кожен HTTP-запит до API:
    [дата час] юзер | IP | МЕТОД /шлях | статус | час_с | тіло (для PUT/PATCH/POST)

    Приклади:
    [2026-05-29 10:30:00] admin      | 192.168.0.10  | PATCH /api/bills/5/        | 200 | 0.045s
    [2026-05-29 10:30:01] бухгалтер  | 192.168.0.12  | POST /api/periods/3/close/ | 200 | 0.032s
    [2026-05-29 10:30:02] —          | 192.168.0.99  | POST /api/auth/login/      | 401 | 0.012s  ← невдалий вхід
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        response = self.get_response(request)
        duration = time.monotonic() - start

        self._log(request, response, duration)
        return response

    def _log(self, request, response, duration: float) -> None:
        # Юзернейм — після аутентифікації Django заповнює request.user
        user = getattr(request, 'user', None)
        username = user.username if (user and user.is_authenticated) else '—'

        # IP: спочатку proxy-заголовок (якщо є nginx), потім прямий IP
        ip = (
            request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
            or request.META.get('REMOTE_ADDR', '—')
        )

        body_info = self._body_info(request)

        # Рівень логу: помилки серверу (5xx) — ERROR, клієнтські (4xx) — WARNING, решта — INFO
        status = response.status_code
        if status >= 500:
            log_fn = logger.error
        elif status >= 400:
            log_fn = logger.warning
        else:
            log_fn = logger.info

        log_fn(
            f'{username:<12} | {ip:<15} | {request.method:<6} {request.path:<40} '
            f'| {status} | {duration:.3f}s{body_info}'
        )

    @staticmethod
    def _body_info(request) -> str:
        """Повертає скорочений рядок з тілом запиту для мутацій."""
        if request.method not in ('POST', 'PATCH', 'PUT', 'DELETE'):
            return ''
        # Не логуємо тіло чутливих ендпойнтів
        if request.path in _SENSITIVE:
            return ' | [credentials hidden]'
        try:
            body = json.loads(request.body)
            # Видаляємо чутливі поля якщо раптом потрапили
            body.pop('password', None)
            body.pop('token', None)
            text = json.dumps(body, ensure_ascii=False)
            # Обрізаємо до 300 символів щоб лог не розбухав
            if len(text) > 300:
                text = text[:300] + '…'
            return f' | {text}'
        except Exception:
            return ''
