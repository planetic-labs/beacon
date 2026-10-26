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
    const raw=match[0];let end=raw.length;
    // Trim with bounded linear scans; an unanchored suffix regexp retries every punctuation offset.
    while(end>0&&".,!?;:".includes(raw[end-1]))end--;
    const balance:Record<string,number>={")":0,"]":0,"}":0};
    for(let i=0;i<end;i++){
      const char=raw[i];
      if(char==="(")balance[")"]--;else if(char==="[")balance["]"]--;else if(char==="{")balance["}"]--;
      else if(Object.hasOwn(balance,char))balance[char]++;
    }
    while(end>0&&balance[raw[end-1]]>0){balance[raw[end-1]]--;end--;}
    const value=raw.slice(0,end);
    try{const url=new URL(value);if(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password)links.add(url.href);}catch{/* Not a valid web URL. */}
    if(links.size>=20)break;
  }
  return [...links];
}
