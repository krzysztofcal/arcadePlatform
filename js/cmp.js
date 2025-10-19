(function(){
  function getChoiceSrc(){
    var meta = document.querySelector('meta[name="qc:choice-src"]');
    if (meta && meta.content) return meta.content;
    if (window.CMP_CHOICE_SRC) return window.CMP_CHOICE_SRC;
    return '';
  }

  function loadQuantcast(){
    var src = getChoiceSrc();
    if (!src) return;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.type = 'text/javascript';
    var ref = document.getElementsByTagName('script')[0];
    ref.parentNode.insertBefore(s, ref);
  }

  function wireManageLink(){
    var handler = function(e){
      if (e) e.preventDefault();
      try {
        if (typeof window.__tcfapi === 'function'){
          window.__tcfapi('displayConsentUi', 2, function(){} , null);
        }
      } catch {}
      return false;
    };
    document.querySelectorAll('#manageCookies, .manage-cookies').forEach(function(el){
      el.addEventListener('click', handler);
    });
  }

  loadQuantcast();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireManageLink); else wireManageLink();
})();

