export function pushErrorMessage(error: unknown, brave = false): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NotAllowedError")
    return "Разрешите уведомления для Beacon в настройках сайта в браузере.";
  if (name === "AbortError" || /registration failed.*push service/i.test(message))
    return brave
      ? "Brave не смог подключить push-уведомления. Проверьте «Use Google services for push messaging» в brave://settings/privacy, затем повторите попытку."
      : "Браузер не смог подключиться к службе push-уведомлений. Проверьте соединение и настройки браузера, затем повторите попытку.";
  if (name === "TimeoutError") return "Браузер не ответил вовремя. Повторите попытку подключения уведомлений.";
  return message;
}
