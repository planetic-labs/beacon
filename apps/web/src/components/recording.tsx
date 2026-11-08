import {X,Square,Send,Mic,RotateCcw,FileText} from "lucide-react";
import {RecordingWave} from "./recording-wave";
import "../voice-recording.css";
import { Button } from "./app-button";
import { useEffect, useRef, useState } from "react";
import { recordingLimits, type RecordingKind } from "@beacon/shared";
import { v7 } from "uuid";
import { CirclePlayer } from "./message-types";
import { Dialog } from "./ui";

export function RecordingDialog({ inline=false,transcribed,kind, chatId, replyToId, close, notify, sent, activity }: {
  inline?: boolean;
  transcribed?:(text:string)=>void;
  activity?: (kind: RecordingKind | null) => void;
  kind: RecordingKind; chatId: string; replyToId?: string; close: () => void;
  notify: (error: unknown) => void; sent: (chatId: string) => Promise<void>;
}) {
  const [phase, setPhase] = useState<"idle" | "permission" | "recording" | "preview" | "sending" | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [url, setUrl] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const blob = useRef<Blob | null>(null);
  const live = useRef(true);
  const sourceUrl = useRef("");
  const clientId = useRef(v7());
  const upload = useRef<AbortController | null>(null);
  const sendOnStop=useRef(false),transcribeOnStop=useRef(false);
  const limit = recordingLimits[kind];
  useEffect(()=>{if(inline)void start();},[]);
  function release() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
  function cancel(){live.current=false;release();upload.current?.abort();close();}
  function stop() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  useEffect(() => {
    return () => {
      live.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release(); upload.current?.abort(); if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    };
  }, []);
  useEffect(()=>{ if(phase!=="recording")return;activity?.(kind);return()=>activity?.(null); },[phase,kind,activity]);
  useEffect(() => {
    if (phase !== "recording") return;
    const started = performance.now();
    const timer = setInterval(() => {
      const duration = (performance.now() - started) / 1000;
      setElapsed(Math.min(limit.seconds, Math.floor(duration)));
      if (duration >= limit.seconds - 0.5) stop();
    }, 100);
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", hidden); };
  }, [phase, limit.seconds]);
  useEffect(() => { if (phase === "recording" && preview.current && stream.current) { preview.current.srcObject = stream.current; void preview.current.play().catch(() => {}); } }, [phase]);
  useEffect(() => {
    const guard = (event: Event) => { if (phase !== "idle") event.preventDefault(); };
    window.addEventListener("beacon:before-update", guard);
    return () => window.removeEventListener("beacon:before-update", guard);
  }, [phase]);
  async function start() {
    if (phase === "permission" || phase === "sending" || phase === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { notify(new Error("Этот браузер не поддерживает запись. Откройте Beacon в современном браузере по HTTPS")); return; }
    setPhase("permission");
    try {
      sendOnStop.current=false;transcribeOnStop.current=false;
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === "circle" ? { facingMode: "user", width: { ideal: 512, max: 1280 }, height: { ideal: 512, max: 720 }, frameRate: { ideal: 24, max: 30 }, aspectRatio: { ideal: 1 } } : false });
      if (!live.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const candidates = kind === "audio" ? ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"] : ["video/webm;codecs=vp8,opus", "video/mp4", "video/webm"];
      const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Браузер не поддерживает подходящий формат записи");
      const instance = new MediaRecorder(media, { mimeType, audioBitsPerSecond: 64000, ...(kind === "circle" ? { videoBitsPerSecond: 800000 } : {}) });
      recorder.current = instance;
      const chunks: Blob[] = []; let size = 0; let failed = false;
      instance.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > limit.bytes) stop(); } };
      instance.onerror = () => { failed = true; release(); if (live.current) { setPhase("idle"); notify(new Error("Запись прервана. Попробуйте ещё раз")); } };
      instance.onstop = () => {
        release(); if (!live.current || failed) return;
        if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
        const result = new Blob(chunks, { type: instance.mimeType });
        if (!result.size || result.size > limit.bytes) { setPhase("idle"); notify(new Error("Запись пустая или слишком большая. Попробуйте записать короче")); return; }
        blob.current = result; clientId.current = v7(); sourceUrl.current = URL.createObjectURL(result); setUrl(sourceUrl.current); setPhase("preview");
        if(sendOnStop.current){sendOnStop.current=false;void send();}
        else if(transcribeOnStop.current){transcribeOnStop.current=false;void transcribe();}
      };
      setElapsed(0); instance.start(250); setPhase("recording");
    } catch (error) {
      release(); if (!live.current) return; setPhase("idle");
      const name = error instanceof DOMException ? error.name : "";
      notify(new Error(name === "NotAllowedError" ? (kind === "audio" ? "Разрешите доступ к микрофону в настройках браузера" : "Разрешите доступ к камере и микрофону в настройках браузера") : name === "NotFoundError" ? "Не найдены микрофон или камера" : "Не удалось начать запись. Проверьте доступ к микрофону и камере"));
    }
  }
  async function transcribe(){
    if(!blob.current||upload.current)return;
    setPhase("transcribing");const controller=new AbortController();upload.current=controller;
    const timeout=setTimeout(()=>controller.abort(),150000);
    try{
      const form=new FormData();form.set("chatId",chatId);form.set("file",blob.current,"recording");
      const response=await fetch("/api/transcriptions",{method:"POST",body:form,signal:controller.signal});
      if(response.status===401)window.dispatchEvent(new Event("beacon:unauthorized"));
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Не удалось расшифровать запись");
      if(typeof result.text!=="string"||!result.text.trim())throw new Error("В записи не удалось распознать речь");
      if(live.current){close();transcribed?.(result.text);}
    }catch(error){if(live.current){setPhase("preview");notify(controller.signal.aborted?new Error("Расшифровка заняла слишком много времени. Попробуйте ещё раз"):error);}}
    finally{clearTimeout(timeout);upload.current=null;}
  }
  async function send() {
    if (!blob.current || upload.current) return;
    setPhase("sending"); const controller = new AbortController(); upload.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const form = new FormData(); form.set("chatId", chatId); form.set("kind", kind); form.set("clientMessageId", clientId.current);
      form.set("file", blob.current, "recording"); if (replyToId) form.set("replyToId", replyToId);
      const response = await fetch("/api/recordings", { method: "POST", body: form, signal: controller.signal });
      if (response.status === 401) window.dispatchEvent(new Event("beacon:unauthorized"));
      if (!response.ok) throw new Error((await response.json()).error || "Не удалось отправить запись");
      close(); await sent(chatId);
    } catch (error) { if (live.current) { setPhase("preview"); notify(error); } }
    finally { clearTimeout(timeout); upload.current = null; }
  }
  if(inline)return <div className="voice-recording" role="region" aria-label="Запись голосового сообщения">
    <Button type="button" className="icon-button voice-cancel" aria-label="Отменить запись" disabled={phase==="sending"} onClick={cancel}><X/></Button>
    <span className="recording-timer">{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,"0")}</span>
    <div className="voice-recording-center">
      {phase==="preview"||phase==="sending"||phase==="transcribing"?<audio src={url} controls aria-label="Предпрослушать запись"/>:<RecordingWave stream={phase==="recording"?stream.current:null}/>}
      {(phase==="permission"||phase==="sending"||phase==="transcribing")&&<span className="voice-recording-status" role="status">{phase==="permission"?"Доступ к микрофону…":phase==="transcribing"?"Расшифровываем…":"Отправляем…"}</span>}
    </div>
    {phase==="idle"&&<Button type="button" className="icon-button" aria-label="Начать запись" onClick={()=>void start()}><Mic/></Button>}
    {phase==="recording"&&<Button type="button" className="icon-button" aria-label="Остановить запись" onClick={()=>{sendOnStop.current=false;transcribeOnStop.current=true;stop();}}><Square size={18}/></Button>}
    {phase==="preview"&&<><Button type="button" className="icon-button" aria-label="Расшифровать запись" onClick={()=>void transcribe()}><FileText/></Button><Button type="button" className="icon-button" aria-label="Записать заново" onClick={()=>void start()}><RotateCcw/></Button></>}
    <Button type="button" className="icon-button voice-send" aria-label="Отправить запись" disabled={phase!=="recording"&&phase!=="preview"} onClick={()=>{if(phase==="recording"){sendOnStop.current=true;stop();}else void send();}}><Send/></Button>
  </div>;
  return <Dialog title={limit.title} close={() => { if (phase !== "sending") close(); }}>
    <div className="recording-panel">
      {phase === "recording" && kind === "circle" && <video ref={preview} className="recording-circle" muted playsInline aria-label="Камера" />}
      {phase === "preview" || phase === "sending" ? kind === "audio" ? <audio src={url} controls aria-label="Предпрослушать запись" /> : <CirclePlayer src={url} duration={Math.max(elapsed, 1)} /> : null}
      <span className="recording-timer" aria-live="off">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / {Math.floor(limit.seconds / 60)}:00</span>
      {phase === "permission" && <p>Разрешите доступ к {kind === "audio" ? "микрофону" : "камере и микрофону"}…</p>}
      {phase === "sending" && <p role="status">Обрабатываем и отправляем запись…</p>}
      <div className="recording-actions">
        {phase === "idle" && <Button className="primary-button" onClick={() => void start()}>Начать запись</Button>}
        {phase === "recording" && <Button className="primary-button" onClick={stop}>Остановить запись</Button>}
        {phase === "preview" && <><Button className="primary-button" onClick={() => void send()}>Отправить запись</Button><Button className="secondary-button" onClick={() => void start()}>Записать заново</Button></>}
        <Button className="secondary-button" disabled={phase === "sending"} onClick={close}>Отмена</Button>
      </div>
    </div>
  </Dialog>;
}
