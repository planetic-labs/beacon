import path from "node:path";
import { z } from "zod";
import { nodeName } from "./validation";
const definition=z.object({
  id:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  name:nodeName,
  path:z.string().min(1).refine(value=>path.isAbsolute(value)&&!value.includes('\0')),
  mode:z.enum(['local','sshfs']).default('local'),
  personal_parent:z.string().min(1).refine(value=>!path.isAbsolute(value)&&!value.split(/[\\/]/).some(part=>!part||part==="."||part==="..")&&!/[\x00-\x1f]/.test(value)).optional(),
}).strict();
export type StorageDefinition=z.infer<typeof definition>;
export function configuredStorages(raw=process.env.STORAGES_JSON?.trim()||JSON.stringify([{id:'home',name:'Домашнее',path:process.env.STORAGE_ROOT??path.join(process.env.MEDIA_ROOT??'/data/media','storage'),mode:'local',personal_parent:'users'}])):StorageDefinition[]{
  try{
    const entries=z.array(definition).parse(JSON.parse(raw));
    if(new Set(entries.map(item=>item.id)).size!==entries.length)throw new Error();
    if(entries.filter(item=>item.personal_parent!==undefined).length>1)throw new Error();
    return entries;
  }catch{throw new Error('Invalid STORAGES_JSON: check storage identifiers, names, absolute container paths and modes');}
}
export const providerKey=(id:string)=>`config:${id}`;
export function activeProviders(){return configuredStorages().filter(item=>item.personal_parent===undefined).map(item=>providerKey(item.id));}
