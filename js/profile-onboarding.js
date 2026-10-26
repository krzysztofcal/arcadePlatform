(function(){
 'use strict';
 var status=null,identity=null,generation=0,pending=null,requestId=null,dialog=null,prompt=null,displayed=null;
 var pl=function(){return (window.I18N?window.I18N.getLang():document.documentElement.lang)==='pl';};
 function label(en,polish){return pl()?polish:en;}
 function log(code){try{if(window.KLog)window.KLog.log('profile:terms',{code:code});}catch(_err){}}
 function tokenSubject(token){
  try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch(_err){return null;}
 }
 async function credentials(){
  if(new URLSearchParams(location.search).get('guest')==='1'){
   try{var guest=JSON.parse(sessionStorage.getItem('poker:guestSession')||'null');if(guest&&guest.token){var guestId=guest.guestId||guest.userId;if(tokenSubject(guest.token)!==guestId)throw Error('stale_identity');return {id:guestId,token:guest.token};}}catch(_err){return null;}
   return null;
  }
  var auth=window.SupabaseAuth,bridge=window.SupabaseAuthBridge;
  if(!auth||!bridge)return null;
  var user=await auth.getCurrentUser();if(!user||!user.id)return null;
  var token=await bridge.getAccessToken(),current=await auth.getCurrentUser();
  if(!current||current.id!==user.id||tokenSubject(token)!==user.id)throw Error('stale_identity');
  return {id:user.id,token:token};
 }
 async function api(method,body,expected){
  var principal=await credentials();if(!principal)throw Error('not_authenticated');
  if(method==='POST'&&(!expected||principal.id!==expected.id||generation!==expected.generation||identity!==expected.id))throw Error('stale_identity');
  var response=await fetch(window.ArcadeApi?window.ArcadeApi.url('/.netlify/functions/profile-onboarding'):'/.netlify/functions/profile-onboarding',{
   method:method,headers:{Authorization:'Bearer '+principal.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined
  });
  var data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'terms_unavailable'),{code:data.error});
  var current=await credentials();if(!current||current.id!==principal.id)throw Error('stale_identity');
  identity=principal.id;return data;
 }
 function close(){displayed=null;if(dialog&&dialog.open)dialog.close();if(pending){pending(false);pending=null;}}
 function show(){
  if(!dialog){
   dialog=document.createElement('dialog');dialog.className='arcade-terms-dialog';dialog.setAttribute('aria-labelledby','arcadeTermsTitle');
   dialog.innerHTML='<h2 id="arcadeTermsTitle"></h2><p data-terms-copy></p><p><a data-terms-link target="_blank" rel="noopener">Terms</a> · <a data-privacy-link target="_blank" rel="noopener">Privacy</a></p><p data-terms-error role="status"></p><button type="button" data-terms-accept></button><button type="button" data-terms-back></button><p><a href="/account.html" data-terms-account></a> · <a href="mailto:contact@kcswh.pl">contact@kcswh.pl</a></p>';
   document.body.appendChild(dialog);
   dialog.querySelector('[data-terms-back]').onclick=close;
   dialog.addEventListener('cancel',function(){if(pending){pending(false);pending=null;}});
   dialog.querySelector('[data-terms-accept]').onclick=async function(){
    var button=this,error=dialog.querySelector('[data-terms-error]');button.disabled=true;error.textContent='';
    try{
     if(!requestId)requestId='terms_'+(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now()+'_'+Math.random().toString(36).slice(2));
     var intent=displayed;if(!intent)throw Error('stale_identity');
     var result=await api('POST',{action:'acceptTerms',version:intent.version,requestId:requestId},intent);
     if(intent.id!==identity||intent.generation!==generation)throw Error('stale_identity');status=result;requestId=null;displayed=null;
     if(prompt)prompt.hidden=true;if(dialog.open)dialog.close();
     if(pending){pending(true);pending=null;}
     document.dispatchEvent(new CustomEvent('profile:terms-accepted'));
    }catch(err){error.textContent=label('Could not record acceptance. Reconnect and retry.','Nie udało się zapisać akceptacji. Połącz się i spróbuj ponownie.');log(err.code||'failed');if(err.code==='terms_version_changed'){requestId=null;await refresh(true);}}
    finally{button.disabled=false;}
   };
  }
  dialog.querySelector('#arcadeTermsTitle').textContent=label('Terms & Conditions','Regulamin');
  dialog.querySelector('[data-terms-copy]').textContent=label('Accept the current Terms before starting new use of your account. This does not consent to publishing a Google photo.','Zaakceptuj aktualny regulamin przed nowym korzystaniem z konta. Nie oznacza to zgody na publikację zdjęcia Google.')+' ('+status.version+')';
  dialog.querySelector('[data-terms-link]').href='/legal/terms.'+status.version+'.'+(pl()?'pl':'en')+'.html';
  dialog.querySelector('[data-privacy-link]').href='/legal/privacy.'+(pl()?'pl':'en')+'.html';
  dialog.querySelector('[data-terms-accept]').textContent=label('I accept the Terms','Akceptuję regulamin');
  dialog.querySelector('[data-terms-back]').textContent=label('Not now','Nie teraz');
  dialog.querySelector('[data-terms-account]').textContent=label('Account / Sign out / Delete account','Konto / Wylogowanie / Usuń konto');
  displayed={id:identity,version:status.version,generation:generation};
  if(!dialog.open)dialog.showModal();
 }
 async function refresh(open){
  var version=++generation;
  try{
   var principal=await credentials();if(version!==generation)return;
   if(!principal){identity=null;status=null;requestId=null;close();if(prompt)prompt.hidden=true;return;}
   if(identity!==principal.id){identity=principal.id;status=null;requestId=null;close();}
   var result=await api('GET');if(version!==generation)return;status=result;
   if(!result.required||result.current){if(prompt)prompt.hidden=true;close();return;}
   if(!prompt){prompt=document.createElement('button');prompt.type='button';prompt.className='arcade-terms-prompt';prompt.onclick=show;document.body.appendChild(prompt);}
   prompt.textContent=label('Review Terms','Akceptuj regulamin');prompt.hidden=false;
   if(open&&location.pathname.indexOf('table-v2.html')===-1)show();
  }catch(err){log(err.code||'unavailable');}
 }
 window.ArcadeTerms={open:function(){if(status&&status.required&&!status.current)show();else refresh(true);},refresh:refresh,requireAcceptance:async function(){
  await refresh(false);if(!status)throw Error('terms_unavailable');if(!status.required||status.current)return true;
  if(pending)return false;return new Promise(function(resolve){pending=resolve;show();});
 }};
 function init(){
  if(location.pathname.indexOf('/legal/')===0)return;
  var stylesheet=document.querySelector('link[href="/css/profile-account.css"]');
  if(!stylesheet){stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='/css/profile-account.css';stylesheet.onload=initReady;stylesheet.onerror=function(){log('style_unavailable');};document.head.appendChild(stylesheet);return;}
  initReady();
 }
 function initReady(){
  if(window.SupabaseAuth)window.SupabaseAuth.onAuthChange(function(){generation++;status=null;requestId=null;close();setTimeout(function(){refresh(true);},0);});
  refresh(true);
  document.addEventListener('profile:terms-required',function(){window.ArcadeTerms.open();});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
