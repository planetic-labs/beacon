import {useQuery} from '@tanstack/react-query';
import {FileText,Download} from 'lucide-react';
import type {Material} from '@beacon/shared';
import {MediaPlayer,type PlaybackEvent} from './media-player';
import {storageKey} from './storage-queries';
export const materialTime=(seconds:number)=>{const s=Math.floor(seconds);return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export const kindLabel={video:'Видео',audio:'Аудио',image:'Изображение',document:'Документ'};
export function FileContent({file,storage=false,startAt,seek,onPlaybackEvent}:{file:Material;storage?:boolean;startAt?:number;seek?:{seconds:number;key:number};onPlaybackEvent?:(event:PlaybackEvent)=>void}){
 const base=storage?`/api/storage/${file.id}/card`:`/api/materials/${file.id}`,src=`${base}/content`;
 const text=useQuery({queryKey:[...storageKey(),'file-text',file.id,file.revision,storage],enabled:file.mime==='text/plain'&&file.available&&!file.checking,queryFn:async({signal})=>{const r=await fetch(src,{headers:{Range:'bytes=0-1048575'},signal});if(!r.ok)throw Error('Не удалось прочитать документ');return r.text();}});
 if(file.checking)return <p className="material-hint" role="status">Проверяем файл…</p>;
 if(!file.available)return <p role="status">Файл недоступен или его формат не поддерживается.</p>;
 if(file.kind==='video'||file.kind==='audio')return <MediaPlayer key={`${file.id}/${file.revision}`} kind={file.kind} src={src} title={file.title} hideDownload={!storage} poster={file.coverId?`${base}/cover`:undefined} startAt={startAt} seek={seek} onPlaybackEvent={onPlaybackEvent}/>;
 if(file.kind==='image')return <img className="material-image-view" src={src} alt={file.title}/>;
 return <div className="material-document-view">{file.mime==='application/pdf'?<iframe title={file.title} src={src}/>:file.mime==='text/plain'?<pre>{text.error?.message??text.data??'Загружаем документ…'}</pre>:<div className="material-empty"><FileText size={42}/><p>Предпросмотр этого формата недоступен</p></div>}<a className="text-button" href={`${src}?download=1`}><Download size={16}/>Скачать файл</a></div>;
}
