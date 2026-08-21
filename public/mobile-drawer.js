(function(){
  const app=document.querySelector('#app');
  if(!app)return;
  let open=false;
  const sync=()=>{
    const shell=app.querySelector('.shell'), sidebar=app.querySelector('.sidebar'), topbar=app.querySelector('.topbar');
    if(!shell||!sidebar||!topbar)return;
    shell.classList.toggle('mobile-menu-open',open);
    document.documentElement.classList.toggle('mobile-menu-open',open);
    document.body.classList.toggle('mobile-menu-open',open);
    let toggle=topbar.querySelector('[data-mobile-menu]');
    if(!toggle){
      toggle=document.createElement('button');
      toggle.type='button'; toggle.className='icon-btn mobile-menu-toggle';
      toggle.dataset.mobileMenu='1'; toggle.setAttribute('aria-label','Abrir menu');
      toggle.innerHTML='<span class="mi" aria-hidden="true">menu</span>';
      topbar.prepend(toggle);
    }
    toggle.setAttribute('aria-expanded',String(open));
    let backdrop=shell.querySelector('.mobile-menu-backdrop');
    if(!backdrop){backdrop=document.createElement('button');backdrop.type='button';backdrop.className='mobile-menu-backdrop';backdrop.setAttribute('aria-label','Fechar menu');shell.append(backdrop)}
    backdrop.hidden=!open;
  };
  app.addEventListener('click',event=>{
    if(event.target.closest('[data-mobile-menu]')||event.target.closest('.mobile-menu-backdrop')){open=!open;sync();return}
    if(open&&event.target.closest('.sidebar [data-view],.sidebar [data-custom-list]')){open=false;sync()}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open){open=false;sync()}});
  new MutationObserver(sync).observe(app,{childList:true,subtree:true});
  sync();
})();
