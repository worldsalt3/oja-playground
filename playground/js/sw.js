let virtualFiles = {};

const BRIDGE = `<script>
(function(){
  function safe(v,seen){
    seen=seen||new Set();
    if(v===null)return null;
    if(v===undefined)return undefined;
    if(typeof v!=='object'&&typeof v!=='function')return v;
    if(seen.has(v))return'[Circular]';
    seen.add(v);
    if(Array.isArray(v))return v.map(function(i){return safe(i,seen)});
    var o={};
    Object.keys(v).forEach(function(k){try{o[k]=safe(v[k],seen)}catch(e){o[k]='[Error]'}});
    return o;
  }['log','info','warn','error'].forEach(function(m){
    var orig=console[m];
    console[m]=function(){
      var args=Array.from(arguments).map(function(a){return typeof a==='object'?safe(a):String(a)});
      window.parent.postMessage({type:'console',level:m,args:args,timestamp:Date.now()},'*');
      orig.apply(console,arguments);
    };
  });
  window.addEventListener('error',function(e){
    window.parent.postMessage({type:'console',level:'error',args:[e.message],stack:e.error&&e.error.stack,timestamp:Date.now()},'*');
  });
  window.addEventListener('unhandledrejection',function(e){
    var msg='Unhandled Promise: '+(e.reason&&e.reason.message||String(e.reason));
    window.parent.postMessage({type:'console',level:'error',args:[msg],timestamp:Date.now()},'*');
  });
})();
<\/script>`;

const MIME = {
    html:'text/html; charset=utf-8',
    js:'text/javascript; charset=utf-8',
    mjs:'text/javascript; charset=utf-8',
    css:'text/css; charset=utf-8',
    json:'application/json; charset=utf-8',
    svg:'image/svg+xml',
    png:'image/png',
    jpg:'image/jpeg',
    jpeg:'image/jpeg',
    gif:'image/gif',
    ico:'image/x-icon',
    woff2:'font/woff2',
    woff:'font/woff',
    ttf:'font/ttf',
};

function getMime(path) {
    const ext = path.split('.').pop().toLowerCase();
    return MIME[ext] || 'text/plain';
}

function injectBridge(html) {
    if (html.includes('<head>'))  return html.replace('<head>',  '<head>'  + BRIDGE);
    if (html.includes('<body>'))  return html.replace('<body>',  '<body>'  + BRIDGE);
    if (html.includes('<Head>'))  return html.replace('<Head>',  '<Head>'  + BRIDGE);
    return BRIDGE + html;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

self.addEventListener('message', event => {
    if (!event.data) return;
    if (event.data.type === 'SYNC_VFS') {
        virtualFiles = event.data.files || {};
        if (event.source) {
            event.source.postMessage({
                type: 'VFS_SYNCED',
                count: Object.keys(virtualFiles).length,
            });
        } else {
            self.clients.matchAll().then(clients => {
                clients.forEach(client => client.postMessage({ type: 'VFS_SYNCED' }));
            });
        }
    }
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (!url.pathname.includes('/preview-zone/')) return;
    event.respondWith(handlePreview(url.pathname));
});

function handlePreview(pathname) {
    const match = pathname.match(/\/preview-zone\/(.*)$/);
    const path = match && match[1] ? match[1].split('?')[0] : 'index.html';
    const cleanPath = path || 'index.html';
    const mime = getMime(cleanPath);

    let content = virtualFiles[cleanPath];

    if (content === undefined) {
        // Only fallback to index.html if the URL does NOT have an extension.
        // If they requested `pages/home.html` and it's missing, strictly return 404!
        if (!cleanPath.includes('.')) {
            content = virtualFiles['index.html'];
        } else {
            return Promise.resolve(new Response('Not Found', { status: 404 }));
        }
    }

    if (!content) {
        return Promise.resolve(new Response(
            '<body style="font-family:sans-serif;padding:32px;background:#0d1117;color:#f87171">' +
            '<h2 style="margin-bottom:8px">No index.html</h2>' +
            '<p style="color:#8b949e">Load an example or click Run after adding files.</p></body>',
            {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
        ));
    }

    if (mime.startsWith('text/html')) {
        content = injectBridge(content);
    }

    return Promise.resolve(new Response(content, {
        status: 200,
        headers: {
            'Content-Type': mime,
            'Cache-Control': 'no-store',
        },
    }));
}