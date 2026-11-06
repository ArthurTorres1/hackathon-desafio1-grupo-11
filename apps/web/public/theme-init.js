/* Executar de forma síncrona no <head>, antes do CSS, para evitar flash de tema. */
(function(){
  var preference;try{preference=localStorage.getItem('foresttrace-theme')}catch(e){}
  var valid=preference==='dark'||preference==='light';
  var theme=valid?preference:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=theme==='dark'?'#101e19':'#f5f2e9';
})();
