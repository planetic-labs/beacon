export class FreshSessionRequiredError extends Error {
  constructor() { super("Для добавления ключа подтвердите, что это вы."); this.name = "FreshSessionRequiredError"; }
}

// Use a bounded code, never expose raw server messages or credential data.
export function passkeyRegistrationError(error: unknown): Error {
  const value = error as { code?: string; name?: string; status?: number } | null;
  const code = value?.code ?? value?.name;
  if (code === "SESSION_NOT_FRESH") return new FreshSessionRequiredError();
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || code === "InvalidStateError")
    return new Error("На этом устройстве уже есть ключ для аккаунта. Попробуйте войти с ним или выбрать другое устройство.");
  if (code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" || code === "NotAllowedError" || code === "ERROR_CEREMONY_ABORTED" || code === "AUTH_CANCELLED")
    return new Error("Устройство не разрешило создать ключ или запрос был отменён. Проверьте, что на Mac включено сохранение паролей и ключей доступа, и повторите попытку.");
  if (code === "SecurityError" || code === "ERROR_INVALID_RP_ID")
    return new Error("Не удалось создать ключ: адрес приложения не соответствует настройкам ключей доступа.");
  if (value?.status === 401) return new Error("Сессия истекла. Войдите снова и добавьте ключ.");
  if (value?.status === 429) return new Error("Слишком много попыток. Подождите немного и повторите.");
  const safeCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? ` (${code})` : "";
  return new Error(`Не удалось добавить ключ${safeCode}. Попробуйте открыть Beacon в обычном окне Safari и повторить попытку.`);
}
