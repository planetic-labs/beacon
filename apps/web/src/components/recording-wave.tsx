import {useEffect,useRef} from 'react';
/** Sample at 20Hz; interpolate scrolling each frame without React state updates. */
export function RecordingWave({stream}:{stream:MediaStream|null}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const element=canvas.current;if(!element)return;const drawing=element.getContext('2d');if(!drawing)return;
  let context:AudioContext|undefined,source:MediaStreamAudioSourceNode|undefined,analyser:AnalyserNode|undefined,frame=0,lastSample=0,width=0,height=0,head=0,total=0;
  const peaks=new Float32Array(512),data=new Uint8Array(256);
  try{if(stream){context=new AudioContext();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);void context.resume().catch(()=>{});}}catch{/* Recording remains usable if visualization is unavailable. */}
  const resize=()=>{const bounds=element.getBoundingClientRect();if(width===bounds.width&&height===bounds.height)return;width=bounds.width;height=bounds.height;const ratio=Math.min(devicePixelRatio||1,1.5);element.width=Math.round(width*ratio);element.height=Math.round(height*ratio);drawing.setTransform(ratio,0,0,ratio,0,0);};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const draw=(now:number)=>{frame=requestAnimationFrame(draw);
   if(now-lastSample>=50){lastSample=now;let level=0;if(analyser){analyser.getByteTimeDomainData(data);let sum=0;for(const value of data)sum+=((value-128)/128)**2;level=Math.min(1,Math.sqrt(sum/data.length)*4);}peaks[head]=level;head=(head+1)%peaks.length;total=Math.min(total+1,peaks.length);}
   drawing.clearRect(0,0,width,height);drawing.strokeStyle='#7f8aa9';drawing.lineWidth=2.5;drawing.lineCap='round';drawing.beginPath();
   const count=Math.min(Math.ceil(width/5)+2,peaks.length),offset=Math.min(1,(now-lastSample)/50)*5;
   for(let i=0;i<count;i++){const ago=count-1-i,level=ago<total?peaks[(head-1-ago+peaks.length)%peaks.length]:0,bar=Math.max(.1,level*(height-8));const x=i*5-offset;drawing.moveTo(x,(height-bar)/2);drawing.lineTo(x,(height+bar)/2);}
   drawing.stroke();
  };frame=requestAnimationFrame(draw);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();source?.disconnect();analyser?.disconnect();if(context&&context.state!=='closed')void context.close().catch(()=>{});};
 },[stream]);
 return <canvas ref={canvas} className="recording-wave" role="img" aria-label="Уровень звука микрофона"/>;
}
