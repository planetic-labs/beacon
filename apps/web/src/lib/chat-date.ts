// Use calendar days in the viewer's timezone, including across DST changes.
export function chatDate(value:string|undefined|null,now=new Date()):string {
 if(!value)return "";
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return "";
 if(date.getFullYear()!==now.getFullYear())return date.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"});
 const day=(d:Date)=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;
 const age=day(now)-day(date);
 if(age===0)return date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
 if(age>0&&age<7)return date.toLocaleDateString("ru-RU",{weekday:"short"});
 return date.toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
}
