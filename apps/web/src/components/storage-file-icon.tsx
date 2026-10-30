import {File,Folder,FileImage,FileVideoCamera,FileMusic,FileText,FileSpreadsheet,Presentation,FileArchive,FileCode} from 'lucide-react';
import {storageFileKind} from './storage-file-type';
const icons={folder:Folder,image:FileImage,video:FileVideoCamera,audio:FileMusic,pdf:FileText,text:FileText,document:FileText,spreadsheet:FileSpreadsheet,presentation:Presentation,archive:FileArchive,code:FileCode,file:File};
const labels={folder:'Папка',image:'Изображение',video:'Видео',audio:'Аудиозапись',pdf:'PDF-документ',text:'Текстовый файл',document:'Документ',spreadsheet:'Таблица',presentation:'Презентация',archive:'Архив',code:'Код или данные',file:'Файл'};
export function StorageFileIcon({file}:{file:{name:string;directory:boolean;mime?:string}}){
 const kind=storageFileKind(file),Icon=icons[kind];
 return <span className={`ss-file-icon ss-file-icon-${kind}`} data-file-kind={kind} title={labels[kind]} aria-hidden="true"><Icon size={21}/></span>;
}
