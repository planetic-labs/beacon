import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storageFileKind} from '../apps/web/src/components/storage-file-type';
test('storage icons distinguish real formats even with a generic MIME type',()=>{
 const cases={ 'Видео.MP4':'video','Запись.m4a':'audio','Фото.heic':'image','Архив.tar.gz':'archive','Заметки.txt':'text','Отчёт.pdf':'pdf','Документ.docx':'document','Таблица.csv':'spreadsheet','Доклад.pptx':'presentation','Данные.json':'code','unknown.bin':'file','README':'file','data.constructor':'file','data.__proto__':'file'};
 for(const [name,kind] of Object.entries(cases))assert.equal(storageFileKind({name,mime:'application/octet-stream',directory:false}),kind,name);
});
test('directories and explicit media MIME types take precedence over extensions',()=>{
 assert.equal(storageFileKind({name:'Album.mp4',directory:true,mime:'video/mp4'}),'folder');
 assert.equal(storageFileKind({name:'download',directory:false,mime:'audio/ogg; codecs=opus'}),'audio');
 assert.equal(storageFileKind({name:'movie.txt',directory:false,mime:'video/mp4'}),'video');
 assert.equal(storageFileKind({name:'readme',directory:false,mime:'text/plain'}),'text');
 assert.equal(storageFileKind({name:'sheet',directory:false,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'spreadsheet');
});
