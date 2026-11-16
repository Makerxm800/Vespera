/** The guest bridge script injected into every proxied page.
 *  Single source of truth: the Rust proxy (src-tauri) embeds this exact script
 *  (see build.rs) so the preview behaves identically in the Tauri app and the
 *  browser preview. It reports page state, routes link gestures to the host,
 *  counts blocked resources and manages tab audio muting. */
'use strict';

function bridgeScript(pageUrl, error = '', extra = '', parentOrigin = '') {
  const config = JSON.stringify({ url: pageUrl, error, extra, parentOrigin }).replace(/</g, '\\u003c');
  return `<script data-vespera-bridge>(()=>{
    const cfg=${config};
    const report=()=>parent.postMessage({type:'vespera:page',title:document.title||new URL(cfg.url).hostname,url:cfg.url,error:cfg.error},'*');
    report();document.addEventListener('DOMContentLoaded',report);
    const original=(v)=>{try{const parsed=new URL(v,cfg.url);if(parsed.origin===location.origin&&parsed.pathname==='/proxy'){const target=parsed.searchParams.get('url');return target&&/^https?:/.test(target)?target:null}const u=parsed;return /^https?:$/.test(u.protocol)?u.href:null}catch{return null}};
    const proxify=(v)=>{const u=original(v);return u?location.origin+'/proxy?url='+encodeURIComponent(u)+cfg.extra+'&vt=xmlhttprequest&doc='+encodeURIComponent(cfg.url):v};
    document.addEventListener('click',e=>{
      const a=e.target.closest?.('a[href]');if(!a)return;
      const url=original(a.getAttribute('href'));if(!url)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(a.hasAttribute('download'))parent.postMessage({type:'vespera:download',url,name:a.getAttribute('download')||''},'*');
      else {
        const modified=e.ctrlKey||e.metaKey;
        const targetBlank=(a.getAttribute('target')||'').toLowerCase()==='_blank';
        const newTab=targetBlank||modified;
        parent.postMessage({type:'vespera:navigate',url,newTab,foreground:!modified||e.shiftKey,gesture:modified?'modifier':''},'*');
      }
    },true);
    document.addEventListener('auxclick',e=>{
      if(e.button!==1)return;
      const a=e.target.closest?.('a[href]');if(!a)return;
      const url=original(a.getAttribute('href'));if(!url)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(a.hasAttribute('download'))parent.postMessage({type:'vespera:download',url,name:a.getAttribute('download')||''},'*');
      else parent.postMessage({type:'vespera:navigate',url,newTab:true,foreground:false,gesture:'middle'},'*');
    },true);
    document.addEventListener('contextmenu',e=>{
      const editable=e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
      if(editable)return;
      e.preventDefault();
      const a=e.target.closest?.('a[href]'),img=e.target.closest?.('img');
      parent.postMessage({type:'vespera:context',x:e.clientX,y:e.clientY,link:a?original(a.getAttribute('href')):null,image:img?original(img.getAttribute('src')):null,selection:String(window.getSelection()||'').slice(0,2000)},'*');
    },true);
    document.addEventListener('submit',e=>{
      const f=e.target;if(!(f instanceof HTMLFormElement))return;
      e.preventDefault();
      if((f.method||'get').toLowerCase()!=='get'){alert('This form needs the desktop app. The web preview does not submit account or payment forms.');return;}
      const url=new URL(original(f.getAttribute('action'))||cfg.url);
      for(const [k,v] of new FormData(f))if(typeof v==='string')url.searchParams.append(k,v);
      parent.postMessage({type:'vespera:navigate',url:url.href,newTab:false},'*');
    },true);
    let reported=0;
    const countBlocks=()=>{for(const entry of performance.getEntriesByType('resource').slice(reported)){reported++;let u;try{u=new URL(entry.name)}catch{continue}const kind=u.searchParams.get('vespera_blocked');if(kind)parent.postMessage({type:'vespera:shield',kind,count:1},'*')}};
    document.addEventListener('DOMContentLoaded',()=>setTimeout(countBlocks,100));setTimeout(countBlocks,1500);setTimeout(countBlocks,4000);
    const fetchOriginal=window.fetch;
    window.fetch=function(input,init){
      try{if(typeof input==='string'||input instanceof URL)input=proxify(String(input));}catch{}
      return fetchOriginal.call(window,input,{...init,credentials:'omit'});
    };
    const openOriginal=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url,...rest){return openOriginal.call(this,method,proxify(String(url)),...rest)};
    window.open=(url)=>{const u=original(url);if(u)parent.postMessage({type:'vespera:navigate',url:u,newTab:true,foreground:true},'*');return null};
    let tabMuted=false,audioQueued=false;
    const originalMuted=new WeakMap(),watchedMedia=new WeakSet();
    const reportAudio=()=>{audioQueued=false;const audible=[...document.querySelectorAll('audio,video')].some(m=>!m.paused&&!m.ended&&!m.muted&&m.volume>0);parent.postMessage({type:'vespera:audio',audible},'*')};
    const queueAudioReport=()=>{if(audioQueued)return;audioQueued=true;setTimeout(reportAudio,40)};
    const watchMedia=(media)=>{if(!(media instanceof HTMLMediaElement))return;if(!originalMuted.has(media))originalMuted.set(media,Boolean(media.muted));if(tabMuted)media.muted=true;if(watchedMedia.has(media))return;watchedMedia.add(media);for(const name of ['play','playing','pause','ended','volumechange','emptied'])media.addEventListener(name,queueAudioReport)};
    const scanMedia=(root=document)=>{if(root instanceof HTMLMediaElement)watchMedia(root);root.querySelectorAll?.('audio,video').forEach(watchMedia);queueAudioReport()};
    window.addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.type!=='vespera:mute')return;tabMuted=Boolean(e.data.muted);for(const media of document.querySelectorAll('audio,video')){watchMedia(media);media.muted=tabMuted||originalMuted.get(media)}queueAudioReport()});
    if(document.documentElement)new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scanMedia(node)}).observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('DOMContentLoaded',()=>scanMedia(),{once:true});scanMedia();
  })();</script>`;
}
module.exports = { bridgeScript };
