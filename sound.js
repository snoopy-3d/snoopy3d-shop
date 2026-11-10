/* SNOOPY3D SHOP — original cinematic robot/mecha sound design, no film samples. */
(()=>{'use strict';
const $=s=>document.querySelector(s),KEY='snoopy3d-sound-v1';
const packs={
  mecha:{label:'Mecha Transform',base:1},
  servo:{label:'Servo Mechanics',base:.77},
  energon:{label:'Energon Pulse',base:.85}
};
let state={enabled:false,preset:'mecha',volume:35};
try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');state.enabled=!!s.enabled;state.volume=Math.max(0,Math.min(100,Number(s.volume??35)));state.preset=packs[s.preset]?s.preset:'mecha';}catch{}
let ctx=null,master=null,lastClick=0,lastHover=0;
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
function audio(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;if(!ctx){ctx=new AC();master=ctx.createGain();master.gain.value=.55;master.connect(ctx.destination)}if(ctx.state==='suspended')ctx.resume().catch(()=>{});return ctx}
function tone(at,dur,f0,f1,vol,wave='sawtooth',filter=0){if(!ctx)return;const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type=wave;osc.frequency.setValueAtTime(Math.max(25,f0),at);osc.frequency.exponentialRampToValueAtTime(Math.max(25,f1),at+dur);amp.gain.setValueAtTime(.0001,at);amp.gain.exponentialRampToValueAtTime(Math.max(.0001,vol),at+Math.min(.018,dur/4));amp.gain.exponentialRampToValueAtTime(.0001,at+dur);if(filter){const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=filter;osc.connect(f);f.connect(amp)}else osc.connect(amp);amp.connect(master);osc.start(at);osc.stop(at+dur+.008)}
function metallic(at,vol=1){tone(at,.045,920,180,.085*vol,'square',2300);tone(at+.013,.075,310,90,.06*vol,'triangle',1400)}
function servo(at,vol=1){tone(at,.12,170,760,.045*vol,'sawtooth',1800);tone(at+.065,.10,650,220,.038*vol,'triangle',1400)}
function energy(at,vol=1){tone(at,.21,130,840,.055*vol,'sine');tone(at+.05,.18,950,240,.035*vol,'triangle');tone(at+.13,.16,420,110,.05*vol,'sine')}
function transform(at,vol=1){metallic(at,vol);servo(at+.065,vol);metallic(at+.16,.75*vol);servo(at+.23,.8*vol);tone(at+.32,.24,520,105,.065*vol,'sawtooth',1200);metallic(at+.45,.65*vol)}
function play(kind='click',force=false){if((!state.enabled&&!force)||state.volume<=0)return;try{if(!audio())return;const t=ctx.currentTime+.015;const v=(state.volume/100)*packs[state.preset].base;switch(state.preset){case 'servo':if(kind==='hover')servo(t,v*.45);else if(kind==='cart'||kind==='success')transform(t,v*.8);else if(kind==='error'){tone(t,.22,350,65,v*.1)}else servo(t,v);break;case 'energon':if(kind==='hover')tone(t,.055,600,850,v*.025,'sine');else if(kind==='error')tone(t,.28,400,75,v*.1,'sawtooth',900);else if(kind==='success'||kind==='cart') {energy(t,v);metallic(t+.21,v*.65)}else energy(t,v*.8);break;default:if(kind==='hover')metallic(t,v*.32);else if(kind==='cart'||kind==='success')transform(t,v);else if(kind==='error'){tone(t,.24,350,65,v*.11,'sawtooth',850);metallic(t+.18,v*.7)}else if(kind==='menu')servo(t,v);else metallic(t,v)}}catch(e){console.debug('Sound unavailable:',e)}}
function init(){const btn=$('#soundBtn'),panel=$('#soundPanel'),enabled=$('#soundEnabled'),preset=$('#soundPreset'),volume=$('#soundVolume'),label=$('#soundVolumeLabel'),preview=$('#soundPreview');if(!btn||!panel||!enabled||!preset||!volume)return;
  preset.innerHTML=Object.entries(packs).map(([id,p])=>`<option value="${id}">${p.label}</option>`).join('');
  const sync=()=>{enabled.checked=state.enabled;preset.value=state.preset;volume.value=state.volume;if(label)label.textContent=state.volume+'%';btn.textContent=state.enabled?'♫':'♩';btn.setAttribute('aria-label',state.enabled?'Звуки включены':'Звуки выключены')};sync();
  btn.addEventListener('click',e=>{e.stopPropagation();audio();panel.classList.toggle('hidden');btn.setAttribute('aria-expanded',String(!panel.classList.contains('hidden')))});
  panel.addEventListener('click',e=>e.stopPropagation());
  enabled.addEventListener('change',()=>{state.enabled=enabled.checked;save();sync();if(state.enabled)play('success')});
  preset.addEventListener('change',()=>{state.preset=preset.value;save();play('success',true)});
  volume.addEventListener('input',()=>{state.volume=Number(volume.value);save();sync()});
  preview?.addEventListener('click',()=>{audio();play('success',true)});
  document.addEventListener('pointerdown',()=>{if(state.enabled)audio()},{passive:true});
  document.addEventListener('click',e=>{if(!panel.classList.contains('hidden')&&!e.target.closest('#soundBtn,#soundPanel')){panel.classList.add('hidden');btn.setAttribute('aria-expanded','false')}if(e.target.closest('#soundBtn,#soundPanel'))return;const now=performance.now();if(now-lastClick<70)return;lastClick=now;const el=e.target.closest('button,a,[role="button"]');if(!el||el.disabled)return;if(el.matches('[data-add]')||el.closest('[data-add]'))play('cart');else if(el.matches('#checkoutBtn'))play('menu');else play('click')},true);
  if(window.matchMedia?.('(hover:hover) and (pointer:fine)').matches)document.addEventListener('pointerover',e=>{const el=e.target.closest('button,a,[role="button"]');if(!el||el.contains(e.relatedTarget)||el.closest('#soundPanel'))return;const now=performance.now();if(now-lastHover<300)return;lastHover=now;play('hover')},{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.classList.add('hidden');btn.setAttribute('aria-expanded','false')}});
  const toast=$('#toast');if(toast&&window.MutationObserver)new MutationObserver(()=>{if(!state.enabled||toast.classList.contains('hidden'))return;const s=toast.textContent.toLowerCase();if(/ошибк|не удалось|отказ|недоступ/.test(s))play('error');else if(/заказ|успеш|сохранен|сохранён/.test(s))play('success')}).observe(toast,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
