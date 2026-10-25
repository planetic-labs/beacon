import { useState, useEffect } from "react";
import { authClient } from "@/auth-client";
import type { User, Group } from "@beacon/shared";
import { api, Avatar, Field, AvatarPicker } from "./ui";
export function Profile({
  me,
  refresh,
  notify,
  onboarding = false,
}: {
  me: User;
  refresh: () => Promise<void>;
  notify: (e: unknown) => void;
  onboarding?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="settings-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await api("me", "PATCH", {
            firstName: f.get("firstName"),
            lastName: f.get("lastName"),
          });
          await refresh();
        } catch (e) {
          notify(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Имя">
        <input
          name="firstName"
          defaultValue={me.firstName}
          required
          maxLength={80}
        />
      </Field>
      <Field label="Фамилия">
        <input
          name="lastName"
          defaultValue={me.lastName}
          required
          maxLength={80}
        />
      </Field>
      <Field label="Email">
        <input value={me.email ?? ""} readOnly type="email" />
      </Field>
      {!onboarding && !!me.groups?.length && (
        <p className="field-note">
          Группы: {me.groups.map((g) => g.name).join(", ")}
        </p>
      )}
      {!onboarding && (
        <>
          <Avatar name={me.name} image={me.image} />
          <Field label="Аватар · PNG, JPEG, WebP до 5 МБ">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                try {
                  const r = await fetch("/api/avatar", {
                    method: "POST",
                    body: form,
                  });
                  if (!r.ok) throw new Error((await r.json()).error);
                  await refresh();
                } catch (e) {
                  notify(e);
                }
              }}
            />
          </Field>
        </>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Сохраняем…" : onboarding ? "Продолжить" : "Сохранить профиль"}
      </button>
    </form>
  );
}
export function Security({ notify }: { notify: (e: unknown) => void }) {
  const [keys, setKeys] = useState<{ id: string; name?: string | null }[]>([]);
  async function refresh() {
    const r = await authClient.passkey.listUserPasskeys();
    if (r.error) throw new Error("Не удалось загрузить ключи");
    setKeys(r.data ?? []);
  }
  useEffect(() => {
    void refresh().catch(notify);
  }, []);
  return (
    <section className="settings-card">
      <h2>Ключи доступа</h2>
      <p className="field-note">
        Вход через Face ID, отпечаток или PIN устройства. Email-код остаётся
        запасным способом.
      </p>
      {keys.map((k) => (
        <div className="inline-actions" key={k.id}>
          <span>{k.name || "Ключ доступа"}</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                const r = await authClient.passkey.deletePasskey({ id: k.id });
                if (r.error) throw new Error("Не удалось удалить ключ");
                await refresh();
              } catch (e) {
                notify(e);
              }
            }}
          >
            Удалить ключ
          </button>
        </div>
      ))}
      <button
        className="secondary-button"
        onClick={async () => {
          try {
            const r = await authClient.passkey.addPasskey({
              name: "Мой ключ доступа",
            });
            if (r.error) throw new Error("Не удалось добавить ключ");
            await refresh();
          } catch (e) {
            notify(e);
          }
        }}
      >
        Добавить ключ доступа
      </button>
    </section>
  );
}
export function NewChat({
  users,
  done,
  notify,
}: {
  users: User[];
  done: (id: string) => Promise<void>;
  notify: (e: unknown) => void;
}) {
  const [kind, setKind] = useState("direct"),
    [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="dialog-body"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          const result = await api("chats", "POST", {
            kind,
            userIds: ids,
            title: kind === "group" ? f.get("title") : undefined,
          });
          await done(result.id);
        } catch (e) {
          notify(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Тип чата">
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setIds([]);
          }}
        >
          <option value="direct">Личная переписка</option>
          <option value="group">Групповой чат</option>
        </select>
      </Field>
      {kind === "group" && (
        <Field label="Название">
          <input name="title" required maxLength={120} />
        </Field>
      )}
      <div className="people-options">
        {users.map((u) => (
          <label className="person-select" key={u.id}>
            <input
              type={kind === "direct" ? "radio" : "checkbox"}
              name="person"
              checked={ids.includes(u.id)}
              onChange={() =>
                setIds(
                  kind === "direct"
                    ? [u.id]
                    : ids.includes(u.id)
                      ? ids.filter((id) => id !== u.id)
                      : [...ids, u.id],
                )
              }
            />
            <Avatar name={u.name} image={u.image} />
            {u.name}
          </label>
        ))}
      </div>
      <button className="primary-button" disabled={busy || !ids.length}>
        {busy ? "Создаём…" : "Открыть чат"}
      </button>
    </form>
  );
}
export function UserForm({
  user,
  done,
  notify,
}: {
  user: User | null;
  done: () => Promise<void>;
  notify: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await api(
            user ? `admin/users/${user.id}` : "admin/users",
            user ? "PATCH" : "POST",
            {
              firstName: f.get("firstName"),
              lastName: f.get("lastName"),
              email: f.get("email"),
              role: f.get("role"),
              banned: f.get("banned") === "on",
            },
          );
          await done();
        } catch (e) {
          notify(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Имя">
        <input
          name="firstName"
          defaultValue={user?.firstName}
          required
          maxLength={80}
        />
      </Field>
      <Field label="Фамилия">
        <input
          name="lastName"
          defaultValue={user?.lastName}
          required
          maxLength={80}
        />
      </Field>
      <Field label="Email">
        <input name="email" type="email" defaultValue={user?.email} required />
      </Field>
      <Field label="Роль">
        <select name="role" defaultValue={user?.role ?? "user"}>
          <option value="user">Пользователь</option>
          <option value="admin">Администратор</option>
        </select>
      </Field>
      {user && <AvatarPicker userId={user.id} done={done} notify={notify} />}
      {user && (
        <label className="check-row">
          <input name="banned" type="checkbox" defaultChecked={user.banned} />
          Заблокирован
        </label>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}
export function MembershipForm({
  group,
  users,
  done,
  notify,
}: {
  group: Group | null;
  users: User[];
  done: () => Promise<void>;
  notify: (e: unknown) => void;
}) {
  const [ids, setIds] = useState(group?.members ?? []),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="dialog-body"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await api(
            group ? `admin/groups/${group.id}` : "admin/groups",
            group ? "PATCH" : "POST",
            { name: f.get("name"), code: f.get("code"), userIds: ids },
          );
          await done();
        } catch (e) {
          notify(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Название">
        <input
          name="name"
          defaultValue={group?.name}
          required
          maxLength={100}
        />
      </Field>
      <Field label="Постоянный код для интеграций">
        <input
          name="code"
          defaultValue={group?.code}
          disabled={!!group}
          required
          pattern="[a-z][a-z0-9_-]{1,63}"
        />
      </Field>
      {group && (
        <div className="people-options">
          {users.map((u) => (
            <label className="person-select" key={u.id}>
              <input
                type="checkbox"
                checked={ids.includes(u.id)}
                onChange={() =>
                  setIds(
                    ids.includes(u.id)
                      ? ids.filter((id) => id !== u.id)
                      : [...ids, u.id],
                  )
                }
              />
              {u.name}
            </label>
          ))}
        </div>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Сохраняем…" : group ? "Сохранить" : "Создать группу"}
      </button>
    </form>
  );
}
