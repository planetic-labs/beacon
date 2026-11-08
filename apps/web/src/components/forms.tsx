import {X,Search,ArrowLeft,ArrowRight} from "lucide-react";
import { Form } from "react-aria-components";
import { Button } from "./app-button";
import { FreshSessionRequiredError } from "../lib/passkey-error";
import { PasskeyConfirmation } from "./passkey-confirmation";
import { suggestPasskeyLabel } from "../lib/passkey-label";
import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { authClient, registerPasskey } from "@/auth-client";
import type { User, Group } from "@beacon/shared";
import { api, Avatar, Field, AvatarPicker, OverlayDialog } from "./ui";
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
    <Form
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
      <Button className="primary-button" disabled={busy}>
        {busy ? "Сохраняем…" : onboarding ? "Продолжить" : "Сохранить профиль"}
      </Button>
    </Form>
  );
}
export function Security({ email, notify }: { email: string | undefined; notify: (e: unknown) => void }) {
  const [keys, setKeys] = useState<{ id: string; name?: string | null; createdAt?: string | Date }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
        <div className="passkey-row" key={k.id}>
          {editing === k.id ? (
            <Form className="inline-actions" onSubmit={async event => {
              event.preventDefault();
              if (busy || !label.trim()) return;
              setBusy(true);
              try {
                const result = await authClient.passkey.updatePasskey({ id: k.id, name: label.trim() });
                if (result.error) throw new Error("Не удалось переименовать ключ");
                await refresh();
                setEditing(null);
              } catch (e) { notify(e); }
              finally { setBusy(false); }
            }}>
              <input aria-label="Название ключа" value={label} maxLength={80} required disabled={busy} onChange={event => setLabel(event.target.value)} />
              <Button className="text-button" disabled={busy || !label.trim()}>Сохранить название</Button>
              <Button type="button" className="text-button" disabled={busy} onClick={() => setEditing(null)}>Отмена</Button>
            </Form>
          ) : (
            <div className="inline-actions">
              <strong>{k.name || "Ключ доступа"}</strong>
              <Button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(k.id); setLabel(k.name ?? ""); }}>Переименовать</Button>
            </div>
          )}
          {k.createdAt && <span className="field-note">Создан {new Date(k.createdAt).toLocaleDateString("ru")}</span>}
          <Button
            type="button"
            disabled={busy}
            className="text-button"
            onClick={async () => {
              try {
                setBusy(true);
                const r = await authClient.passkey.deletePasskey({ id: k.id });
                if (r.error) throw new Error("Не удалось удалить ключ");
                await refresh();
                if (editing === k.id) setEditing(null);
              } catch (e) {
                notify(e);
              } finally { setBusy(false); }
            }}
          >
            Удалить ключ
          </Button>
        </div>
      ))}
      <p className="field-note">Название можно изменить, например на «Samsung» или «MacBook». При входе браузер показывает email аккаунта.</p>
      <Button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            if (!email) throw new Error("Не удалось определить email аккаунта");
            await registerPasskey(suggestPasskeyLabel(navigator));
            await refresh();
          } catch (e) {
            if (e instanceof FreshSessionRequiredError) setConfirming(true);
            else notify(e);
          } finally { setBusy(false); }
        }}
      >
        Добавить ключ доступа
      </Button>
      {confirming && email && <PasskeyConfirmation email={email} close={() => setConfirming(false)} done={async () => { setConfirming(false); await refresh(); }} />}
    </section>
  );
}
export function NewGroupChat({users,done,notify,close}: {
  users: User[];
  close: () => void;
  done: (id: string) => Promise<void>;
  notify: (e: unknown) => void;
}) {
  const [step,setStep]=useState<"members"|"details">("members");
  const searchInput=useRef<HTMLInputElement>(null),retainSearch=useRef(false);
  const [ids,setIds]=useState<string[]>([]),[query,setQuery]=useState(""),[title,setTitle]=useState(""),[busy,setBusy]=useState(false);
  const finishInput=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(event.key!=="Enter"||event.nativeEvent.isComposing)return;
    event.preventDefault();
    const dialog=event.currentTarget.closest<HTMLElement>('[role="dialog"]');
    if(dialog)dialog.focus({preventScroll:true});else event.currentTarget.blur();
  };
  const toggle=(id:string)=>setIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  const selected=ids.map(id=>users.find(user=>user.id===id)).filter((user):user is User=>!!user);
  const available=users.filter(user=>!ids.includes(user.id));
  const visible=available.filter(user=>user.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <OverlayDialog title="Создать группу" close={close} className="dialog new-group-dialog" backdropClassName="dialog-backdrop new-group-dialog-backdrop">
    <header className="panel-heading new-group-header">
      <Button type="button" className="icon-button" aria-label={step==="members"?"Закрыть":"Назад к участникам"} disabled={busy} onClick={()=>step==="members"?close():setStep("members")}>{step==="members"?<X size={20}/>:<ArrowLeft size={20}/>}</Button>
      <div><strong>{step==="members"?"Участники":"Новая группа"}</strong><small>Шаг {step==="members"?1:2} из 2</small></div>
      {step==="members"?<Button type="button" className="icon-button new-group-next" aria-label="Далее" disabled={!ids.length} onClick={()=>setStep("details")}><ArrowRight size={22}/></Button>:<span className="new-group-header-spacer"/>}
    </header>
    <Form className="dialog-body new-group-form" onSubmit={async event=>{
    event.preventDefault();if(step!=="details"||busy||!ids.length||!title.trim())return;
    setBusy(true);
    try{const result=await api("chats","POST",{kind:"group",userIds:ids,title:title.trim()});await done(result.id);}
    catch(error){notify(error);}finally{setBusy(false);}
  }}>
    {step==="members"?<>
    {!!selected.length&&<div className="new-group-members" aria-label="Выбранные участники">
      {selected.map(user=><Button key={user.id} type="button" className="new-group-tag" aria-label={`Убрать ${user.name}`} disabled={busy} onClick={()=>toggle(user.id)}><span>{user.name}</span><X size={14} aria-hidden="true"/></Button>)}
    </div>}
    <div className="new-group-people-heading"><strong>Участники</strong><span>{ids.length?`Выбрано: ${ids.length}`:""}</span></div>
    <label className="new-group-search"><Search size={18} aria-hidden="true"/><input ref={searchInput} type="search" enterKeyHint="search" onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing)event.preventDefault();}} aria-label="Найти участника" placeholder="Найти по имени" value={query} onChange={event=>setQuery(event.target.value)} disabled={busy}/></label>
    <div className="new-group-people" aria-label="Участники сообщества">
      {visible.map(user=><Button key={user.id} type="button" className="new-group-person" aria-label={user.name} disabled={busy} onPointerDown={event=>{retainSearch.current=document.activeElement===searchInput.current;if(retainSearch.current)event.preventDefault();}} onClick={()=>{toggle(user.id);setQuery("");if(retainSearch.current)searchInput.current?.focus({preventScroll:true});retainSearch.current=false;}}><Avatar name={user.name} image={user.image}/><span>{user.name}</span></Button>)}
      {!visible.length&&<p className="field-note">{!users.length?"Пока нет доступных участников.":!available.length?"Все участники выбраны.":"Никого не нашли. Попробуйте другое имя."}</p>}
    </div>
    </>:<>
    <Field label="Название группы"><input name="title" value={title} onChange={event=>setTitle(event.target.value)} enterKeyHint="done" onKeyDown={finishInput} placeholder="Как назовём группу?" required maxLength={120} disabled={busy}/></Field>
    <div className="new-group-summary"><strong>Участники · {selected.length}</strong><p>{selected.map(user=>user.name).join(", ")}</p></div>
    <Button className="primary-button" disabled={busy||!ids.length||!title.trim()}>{busy?"Создаём…":"Создать группу"}</Button>
    </>}
  </Form></OverlayDialog>;
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
    <Form
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
      <Button className="primary-button" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </Button>
    </Form>
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
    <Form
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
      <Button className="primary-button" disabled={busy}>
        {busy ? "Сохраняем…" : group ? "Сохранить" : "Создать группу"}
      </Button>
    </Form>
  );
}
