export type AttachmentCategory = "photo" | "video" | "file" | "links" | "audio";
export type ChatAttachment = {
  messageId:string; type:string; text:string; authorName:string; createdAt:string;
  files:{id:string;mime:string;size:number;name?:string}[]; duration?:number; links:string[];
};
export type AttachmentPage = {items:ChatAttachment[];next?:{id:string;at:string}};
export type PhotoAlbum = {messageId:string;authorName:string;createdAt:string;text:string;files:{id:string;mime:string;size:number}[];previousMessageId?:string;nextMessageId?:string};
export type MessageReceipt = {userId:string;name:string;image?:string;status:"sent"|"delivered"|"read";deliveredAt:string|null;readAt:string|null};
// Only explicit web URLs; no external fetches, previews or execution of arbitrary schemes.
export function messageLinks(text:string):string[] {
  const links=new Set<string>();
  for(const match of text.matchAll(/https?:\/\/[^\s<>"\u0000-\u001f]+/giu)){
    let value=match[0].replace(/[.,!?;:]+$/u,"");
    for(const [left,right] of [["(",")"],["[","]"],["{","}"]])while(value.endsWith(right)&&value.split(right).length>value.split(left).length)value=value.slice(0,-1);
    try{const url=new URL(value);if(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password)links.add(url.href);}catch{/* Not a valid web URL. */}
    if(links.size>=20)break;
  }
  return [...links];
}
