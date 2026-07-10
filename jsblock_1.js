
(function(){
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/sw.js').catch(function(err){
        console.warn('Service worker registration failed', err);
      });
    });
  }
})();
