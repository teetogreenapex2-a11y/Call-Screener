// Your always-ring-through list. Open https://YOUR-PROJECT.vercel.app/api/contacts?key=YOUR_ADMIN_KEY
// (set ADMIN_KEY in Vercel), then load your phone's contacts file or paste numbers.
const contacts = require('../lib/contacts');
const store = require('../lib/store');
const { keyOk } = require('../lib/admin');

function send(res, status, type, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ring-through list</title>
<style>body{font:16px system-ui;max-width:560px;margin:24px auto;padding:0 16px}textarea{width:100%;height:140px}
button{font-size:16px;padding:10px 16px;margin:8px 8px 8px 0}label{display:block;margin:10px 0}#msg{font-weight:600;margin-top:12px}</style></head><body>
<h2>Ring-through list</h2>
<p><b id="n">__COUNT__</b> numbers saved. Anyone on this list rings your phone directly, with no AI screening.</p>
<label>1. Contacts file (.vcf or .csv exported from your phone)<br><input type="file" id="f" accept=".vcf,.csv,.txt"></label>
<label>2. Or paste numbers (one per line):<br><textarea id="t"></textarea></label>
<label><input type="checkbox" id="r"> Replace the whole list (otherwise these are added)</label>
<button id="go">Save</button>
<div id="msg"></div>
<script>
var key=new URLSearchParams(location.search).get('key');
document.getElementById('f').onchange=function(e){var f=e.target.files[0];if(!f)return;var rd=new FileReader();
rd.onload=function(){document.getElementById('t').value=extract(String(rd.result)).join('\\n');msg(extract(String(rd.result)).length+' numbers found. Press Save.')};rd.readAsText(f)};
function extract(txt){var src=txt;
 if(/BEGIN:VCARD/i.test(txt)){src=txt.split(/\\r?\\n/).filter(function(l){return /^(item\\d+\\.)?TEL/i.test(l)}).join('\\n')}
 var m=src.match(/\\+?[\\d][\\d\\s().\\-]{8,18}\\d/g)||[];var seen={},out=[];
 m.forEach(function(x){var d=x.replace(/\\D/g,'');if(d.length<10||d.length>13)return;d=d.slice(-10);if(!seen[d]){seen[d]=1;out.push(d)}});return out}
function msg(s){document.getElementById('msg').textContent=s}
document.getElementById('go').onclick=function(){var nums=extract(document.getElementById('t').value);
 if(!nums.length&&!document.getElementById('r').checked){msg('No numbers found.');return}
 msg('Saving...');
 fetch('/api/contacts?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({numbers:nums,replace:document.getElementById('r').checked})})
 .then(function(r){return r.json()}).then(function(j){if(j.error){msg(j.error)}else{document.getElementById('n').textContent=j.count;msg('Saved. '+j.count+' numbers on the list.')}})
 .catch(function(){msg('Could not save. Try again.')})};
</script></body></html>`;

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!keyOk(url.searchParams.get('key'))) return send(res, 403, 'text/plain', 'Forbidden');
  if (!store.configured()) return send(res, 200, 'text/plain', 'The settings database is not connected in Vercel yet.');

  if (req.method === 'POST') {
    const b = req.body || {};
    const nums = Array.isArray(b.numbers) ? b.numbers.slice(0, 20000) : [];
    try {
      const count = b.replace ? await contacts.replaceAll(nums) : await contacts.add(nums);
      return send(res, 200, 'application/json', JSON.stringify({ count }));
    } catch (err) {
      console.error('contacts save failed:', err && err.message);
      return send(res, 200, 'application/json', JSON.stringify({ error: "Couldn't save. Try again in a minute." }));
    }
  }

  let count = 0;
  try {
    count = await contacts.count();
  } catch (_) {}
  return send(res, 200, 'text/html; charset=utf-8', PAGE.replace('__COUNT__', String(count)));
};
