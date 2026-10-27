import { useEffect, useState } from "react";
import { authClient, registerPasskey } from "../auth-client";
import { suggestPasskeyLabel } from "../lib/passkey-label";
import { FreshSessionRequiredError } from "../lib/passkey-error";
import { Dialog } from "./ui";

export function PasskeyConfirmation({email, close, done}: {email:string;close:()=>void;done:()=>Promise<void>}) {
  const [step,setStep]=useState<"request"|"code"|"ready">("request");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [cooldown,setCooldown]=useState(0);
  useEffect(()=>{
    if(!cooldown)return;
    const timer=setTimeout(()=>setCooldown(value=>Math.max(0,value-1)),1000);
    return ()=>clearTimeout(timer);
  },[cooldown]);
  async function sendCode() {
    if(busy||cooldown)return;
    setBusy(true);setError("");
    try {
      const result=await authClient.emailOtp.sendVerificationOtp({email,type:"sign-in"});
      if(result.error)throw new Error("Не удалось отправить код. Попробуйте позже.");
      setCode("");setCooldown(60);setStep("code");
    }catch(error){setError(error instanceof Error?error.message:"Не удалось отправить код.");}
    finally{setBusy(false);}
  }
  return <Dialog title="Подтвердите, что это вы" close={()=>{if(!busy)close();}}>
    <p>Для добавления ключа нужно подтвердить вход кодом на почту текущего аккаунта.</p>
    <p>{email}</p>
    {step==="request"&&<button type="button" className="primary-button" disabled={busy} onClick={()=>void sendCode()}>{busy?"Отправляем…":"Отправить код"}</button>}
    {step==="code"&&<form onSubmit={async event=>{
      event.preventDefault();if(busy||!/^\d{6}$/.test(code))return;
      setBusy(true);setError("");
      try{
        const result=await authClient.signIn.emailOtp({email,otp:code});
        if(result.error)throw new Error("Код неверен или срок действия истёк. Попробуйте ещё раз.");
        if(result.data?.user.email.toLowerCase()!==email.toLowerCase())throw new Error("Не удалось подтвердить текущий аккаунт.");
        setCode("");setStep("ready");
      }catch(error){setError(error instanceof Error?error.message:"Не удалось подтвердить вход.");}
      finally{setBusy(false);}
    }}>
      <label className="field">Код из письма<input aria-label="Код подтверждения" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={event=>setCode(event.target.value.replace(/\D/g,""))}/></label>
      <div className="inline-actions">
        <button className="primary-button" disabled={busy||code.length!==6}>{busy?"Проверяем…":"Подтвердить"}</button>
        <button type="button" className="text-button" disabled={busy||cooldown>0} onClick={()=>void sendCode()}>{cooldown?`Отправить повторно через ${cooldown} с`:"Отправить код повторно"}</button>
      </div>
    </form>}
    {step==="ready"&&<>
      <p>Вход подтверждён. Теперь можно создать ключ доступа.</p>
      <button type="button" className="primary-button" disabled={busy} onClick={async()=>{
        if(busy)return;setBusy(true);setError("");
        try{await registerPasskey(suggestPasskeyLabel(navigator));await done();}
        catch(error){
          if(error instanceof FreshSessionRequiredError){setStep("request");setError("Подтвердите вход ещё раз.");}
          else setError(error instanceof Error?error.message:"Не удалось добавить ключ.");
        }finally{setBusy(false);}
      }}>{busy?"Создаём ключ…":"Продолжить создание ключа"}</button>
    </>}
    {error&&<p role="alert">{error}</p>}
    <button type="button" className="text-button" disabled={busy} onClick={close}>Отмена</button>
  </Dialog>;
}
