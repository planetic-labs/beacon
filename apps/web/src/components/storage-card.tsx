import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useForm,useFieldArray} from 'react-hook-form';
import {Edit,X,Clock,ListVideo} from 'lucide-react';
import type {Material,MaterialInput} from '@beacon/shared';
import {Button} from './app-button';
import {Dialog,Field} from './ui';
import {storageApi,type FileNode} from './storage-api';
import {storageKey,useStorageMutation,useStorageListing} from './storage-queries';
import {FileContent,materialTime} from './file-content';
import '../materials.css';
export function useFileCard(id:string){return useQuery({queryKey:[...storageKey(),'card',id],queryFn:({signal})=>storageApi<Material&{canWrite:boolean}>(`/${id}/card`,'GET',undefined,signal),refetchInterval:q=>q.state.data?.checking?2000:false});}
export function StorageCardEditor({file,close}:{file:FileNode;close:()=>void}){
 const query=useFileCard(file.id);
 return <Dialog title="Карточка файла" close={close} className="material-editor">{query.error?<p role="alert">{query.error.message}</p>:query.data?<CardForm file={file} card={query.data} close={close}/>:<p role="status">Загружаем карточку…</p>}</Dialog>;
}
function parseTime(value:string){return /^\d+(?::[0-5]\d){0,2}$/.test(value)?value.split(':').reduce((total,part)=>total*60+Number(part),0):NaN;}
function CardForm({file,card,close}:{file:FileNode;card:Material&{canWrite:boolean};close:()=>void}){
 const form=useForm<MaterialInput>({defaultValues:{title:card.title,description:card.description,coverId:card.coverId,chapters:card.chapters,reviewed:false}}),chapters=useFieldArray({control:form.control,name:'chapters'}),mutation=useStorageMutation();
 const listing=useStorageListing(file.space_id,file.parent_id),position=useRef(0),[seek,setSeek]=useState<{seconds:number;key:number}>(),[time,setTime]=useState('0:00'),[name,setName]=useState(''),[editing,setEditing]=useState<number|null>(null),[error,setError]=useState('');
 const av=['video','audio'].includes(card.kind),cover=form.watch('coverId');
 function addChapter(){const seconds=parseTime(time);if(!Number.isFinite(seconds)||seconds>=card.duration||!name.trim()){setError('Укажите название и время в пределах записи');return;}chapters.replace([...form.getValues('chapters').filter(ch=>ch.seconds!==seconds&&ch.seconds!==editing),{seconds,title:name.trim()}].sort((a,b)=>a.seconds-b.seconds));setName('');setEditing(null);setError('');}
 return <><FileContent file={card} storage seek={seek} onPlaybackEvent={event=>{position.current=event.position;}}/><form onSubmit={form.handleSubmit(async value=>{setError('');try{await mutation.mutateAsync(()=>storageApi(`/${file.id}/card`,'PUT',value));close();}catch(e){setError((e as Error).message);}})}>
  <section className="material-editor-section"><Field label="Название"><input {...form.register('title',{required:'Укажите название',validate:v=>!!v.trim()||'Укажите название',maxLength:240})} maxLength={240} aria-invalid={!!form.formState.errors.title}/></Field><Field label="Описание"><textarea rows={3} {...form.register('description',{maxLength:20000})}/></Field><Field label="Обложка из этой папки"><select value={cover??''} onChange={e=>form.setValue('coverId',e.target.value||null,{shouldDirty:true})}><option value="">Без обложки</option>{cover&&!listing.nodes.some(n=>n.id===cover)&&<option value={cover}>Текущая обложка</option>}{listing.nodes.filter(n=>!n.directory&&['image/png','image/jpeg','image/webp'].includes(n.mime)).map(n=><option key={n.id} value={n.id}>{n.display_name??n.name}</option>)}</select></Field>{listing.hasNextPage&&<Button type="button" onClick={()=>void listing.fetchNextPage()}>Ещё файлы для обложки</Button>}</section>
  {av&&<section className="material-editor-section"><div className="material-section-title"><Clock size={20}/><div><h3>Тайм-коды</h3><p>Общие для файла во всех плейлистах</p></div></div><div className="material-editor-row material-chapter-fields"><Field label="Время"><input value={time} onChange={e=>setTime(e.target.value)} placeholder="05:30"/></Field><Field label="Название главы"><input value={name} maxLength={240} onChange={e=>setName(e.target.value)}/></Field></div><div className="inline-actions"><Button type="button" onClick={()=>setTime(materialTime(position.current))}>Взять текущий момент</Button><Button type="button" disabled={card.checking} onClick={addChapter}>{editing===null?'Добавить тайм-код':'Сохранить тайм-код'}</Button></div>{chapters.fields.map((ch,index)=><div className="material-editor-row" key={ch.id}><Button type="button" onClick={()=>setSeek({seconds:ch.seconds,key:Date.now()})}>{materialTime(ch.seconds)} · {ch.title}</Button><Button type="button" aria-label={`Редактировать главу ${ch.title}`} onClick={()=>{setEditing(ch.seconds);setTime(materialTime(ch.seconds));setName(ch.title);}}><Edit size={16}/></Button><Button type="button" aria-label={`Удалить главу ${ch.title}`} onClick={()=>chapters.remove(index)}><X size={16}/></Button></div>)}</section>}
  {card.needsReview&&<label className="material-checkbox"><input type="checkbox" {...form.register('reviewed')}/>Проверил тайм-коды после замены записи</label>}
  {(error||form.formState.errors.title)&&<p role="alert">{error||form.formState.errors.title?.message}</p>}<footer className="material-editor-footer"><Button type="button" onClick={close}>Отмена</Button><Button className="primary-button" type="submit" disabled={!card.canWrite||mutation.isPending}>Сохранить карточку</Button></footer>
 </form></>;
}
export function FolderPlaylist({file,close}:{file:FileNode;close:()=>void}){
 const query=useQuery({queryKey:[...storageKey(),'folder-playlist',file.id],queryFn:({signal})=>storageApi<{enabled:boolean}>(`/${file.id}/playlist`,'GET',undefined,signal)}),mutation=useStorageMutation();
 return <Dialog title="Папка как плейлист" close={close}><div className="material-section-title"><ListVideo size={22}/><h3>{file.display_name??file.name}</h3></div><p className="material-hint">Все готовые файлы непосредственно в этой папке появятся в «Материалах» для участников. Список будет обновляться автоматически, порядок — по имени файла. Вложенные папки не включаются.</p>{query.error&&<p role="alert">{query.error.message}</p>}{mutation.error&&<p role="alert">{mutation.error.message}</p>}<Button className="primary-button" disabled={query.isPending||!!query.error||mutation.isPending} onClick={()=>void mutation.mutateAsync(()=>storageApi(`/${file.id}/playlist`,'PUT',{enabled:!query.data?.enabled})).then(close).catch(()=>{})}>{query.data?.enabled?'Скрыть плейлист':'Показывать как плейлист'}</Button></Dialog>;
}
export function StorageCardPreview({file}:{file:FileNode}){
 const query=useFileCard(file.id),[seek,setSeek]=useState<{seconds:number;key:number}>();
 if(!query.data)return <p role={query.error?'alert':'status'}>{query.error?.message??'Загружаем файл…'}</p>;
 return <><FileContent file={query.data} storage seek={seek}/>{!!query.data.chapters.length&&<section className="material-chapters"><h3>Оглавление</h3>{query.data.chapters.map(ch=><Button key={ch.seconds} onClick={()=>setSeek({seconds:ch.seconds,key:Date.now()})}><time>{materialTime(ch.seconds)}</time>{ch.title}</Button>)}</section>}</>;
}
