import type { Upload } from "tus-js-client";
export type Space={id:string;name:string;owner_id:string|null;personal_folder_label?:string;online?:boolean;free?:number|null;total?:number|null};
export type FileNode={id:string;space_id:string;parent_id:string|null;name:string;display_name?:string;directory:boolean;state:string;size:number;mime:string;favorite:boolean;updated_at:string;sha256:string|null;hash_state:string};
export const fileLabel=(node:Pick<FileNode,"name"|"display_name">)=>node.display_name??node.name;
export async function storageApi<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(`/api/storage${path}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'Не удалось выполнить запрос');return result;
}
export type Transfer={id:string;name:string;size:number;progress:number;state:'uploading'|'paused'|'processing'|'done'|'error';error?:string;upload:Upload};
export async function uploadFile(file:File,spaceId:string,parentId:string|null,update:(transfer:Transfer)=>void){
  // Fingerprints are scoped to the current personal/shared space and folder, not just the file.
  // Only the authenticated creator can resume the corresponding server-side upload.
  const { Upload }=await import("tus-js-client");
  const upload=new Upload(file,{endpoint:'/api/storage/uploads',chunkSize:8*1024*1024,retryDelays:[0,1000,3000,5000],removeFingerprintOnSuccess:true,storeFingerprintForResuming:true,
    fingerprint:async()=>`beacon:${spaceId}:${parentId??''}:${file.name}:${file.size}:${file.lastModified}`,
    metadata:{},onProgress:(sent,total)=>{transfer.progress=total?Math.round(sent/total*100):100;update({...transfer});},
    onError:error=>{void storageApi<FileNode>(`/${id}`).then(n=>{transfer.state=n.state==='ready'?'done':n.state==='processing'?'processing':'error';transfer.error=error.message;update({...transfer});}).catch(()=>{transfer.state='error';transfer.error=error.message;update({...transfer});});},
    onSuccess:()=>{transfer.state='processing';transfer.progress=100;update({...transfer});},
  });
  const previous=await upload.findPreviousUploads();
  let id:string;
  const existing=previous[0];
  if(existing?.uploadUrl){
    const savedId=existing.uploadUrl.split('/').pop()!;
    try{const node=await storageApi<FileNode>(`/${savedId}`);if(node.state!=='uploading')throw new Error('Not resumable');id=savedId;upload.resumeFromPreviousUpload(existing);}catch{id=(await storageApi<FileNode>('','POST',{spaceId,parentId,name:file.name,size:file.size})).id;}
  }else id=(await storageApi<FileNode>('','POST',{spaceId,parentId,name:file.name,size:file.size})).id;
  upload.options.metadata={nodeId:id};
  const transfer:Transfer={id,name:file.name,size:file.size,progress:0,state:'uploading',upload};
  update({...transfer});upload.start();return transfer;
}
