import { Bookmark, ChevronRight, FolderOpen, Leaf, MessageCircle, Sprout } from "lucide-react";
import { Button } from "./app-button";
import { VideoCard, videos } from "./materials";
import "../home.css";

export function Home({name,chats,saved,materials,storage}:{name:string;chats:()=>void;saved:()=>void;materials:()=>void;storage:()=>void}){
  return <main className="home-main">
    <header className="home-heading"><div><p>Ваше сообщество</p><h1>Главная</h1></div><span className="home-demo">Макет</span></header>
    <section className="home-welcome" aria-label="Добро пожаловать">
      <div><span className="home-eyebrow">Место для открытий</span><h2>Привет, {name}!</h2><p>Новые истории, знакомые люди и немного вдохновения — всё рядом.</p><Button onClick={chats}>Перейти к общению<ChevronRight size={18}/></Button></div><Leaf className="home-leaf" aria-hidden="true"/>
    </section>
    <section className="home-section" aria-labelledby="home-materials"><header><div><p>Открывайте новое</p><h2 id="home-materials">Свежие материалы</h2></div><Button onClick={materials}>Все материалы<ChevronRight size={16}/></Button></header>
      <div className="home-materials">{videos.filter(video=>["ideas","focus","first"].includes(video.id)).map(video=><VideoCard key={video.id} video={video} open={materials}/>)}</div>
      <p className="home-demo-note">Пример подборки о природе. Здесь будут появляться новые материалы сообщества.</p>
    </section>
    <section className="home-section" aria-labelledby="home-shortcuts"><header><h2 id="home-shortcuts">Под рукой</h2></header><div className="home-shortcuts">
      <Button onClick={saved}><Bookmark/><span><strong>Избранное</strong><small>Заметки и сохранённое</small></span><ChevronRight/></Button>
      <Button onClick={storage}><FolderOpen/><span><strong>Хранилище</strong><small>Файлы в одном месте</small></span><ChevronRight/></Button>
      <Button onClick={chats}><MessageCircle/><span><strong>Общение</strong><small>Вернуться к перепискам</small></span><ChevronRight/></Button>
    </div></section>
    <section className="home-notice"><Sprout aria-hidden="true"/><div><h2>Пространство для вашего</h2><p>Здесь могут быть объявления, полезные ссылки и личные виджеты. Пока примеряем, что будет удобно сообществу.</p></div></section>
  </main>;
}
