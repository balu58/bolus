(function(){
"use strict";
// ===== Versionsnummer: bei jeder neuen Version NUR HIER ändern =====
// Schema: neue Funktionen = ganze Zahl (z. B. "11"), Fehlerkorrekturen = Unterversion (z. B. "11.1")
var APP_VERSION = "18.0";
// ---------- Defaults ----------
var DEFAULT_SETTINGS = {
  slots:[
    {name:"Früh",       from:"04:00", ziel:120, korr:40, ke:1.5},
    {name:"Mittag",     from:"10:30", ziel:120, korr:40, ke:1.2},
    {name:"Nachmittag", from:"14:30", ziel:120, korr:40, ke:1.5},
    {name:"Abend",      from:"18:00", ziel:120, korr:40, ke:2.5},
    {name:"Nacht",      from:"22:00", ziel:120, korr:40, ke:2.5}
  ],
  pct:0,
  refBolus:11.5,
  profile:[[0,11.5],[15,11.2],[30,10.6],[45,9.9],[60,8.8],[75,7.6],[90,6.3],[105,5.1],[120,3.8],[135,2.9],[150,2.1],[165,1.5],[180,1],[195,0.7],[210,0.4],[225,0.2],[240,0]],
  model:"profile",
  step:0.5,
  keepDays:3,
  exp:{preset:"ultra", peak:55, dur:360}
};
// Vorlagen für das Standardmodell (Loop/OpenAPS): Wirkmaximum und Wirkdauer in Minuten
var EXP_PRESETS = {
  ultra:{label:"Ultra-rapid – Fiasp, Lyumjev", peak:55, dur:360},
  rapid:{label:"Rapid – Humalog, NovoRapid, Apidra", peak:75, dur:360},
  custom:{label:"Eigene Werte"}
};
var MODEL_NAMES = {profile:"Eigene", juggluco:"Fiasp", exp:"Standard"};
var DEFAULT_FOODS = [
  {id:"f1", name:"Banane", unit:"100g", ke:1.8},
  {id:"f2", name:"Johannisbeeren", unit:"100g", ke:0.8},
  {id:"f3", name:"Mirabellen", unit:"100g", ke:1.15},
  {id:"f4", name:"Erdbeeren", unit:"100g", ke:0.5},
  {id:"f5", name:"Süßkartoffel", unit:"100g", ke:2.4, },
  {id:"f6", name:"Kartoffeln roh geschält", unit:"100g", ke:2 },
  {id:"f7", name:"Brot Kamut", unit:"100g", ke:4},
  {id:"f14", name:"Döner", unit:"Stück", ke:6.5},
  {id:"f15", name:"Pizza 24 cm", unit:"Stück", ke:7.5}
];

// ---------- State ----------
var LS_KEY = "bolusrechner-v1";
var state = {settings:clone(DEFAULT_SETTINGS), injections:[], foods:clone(DEFAULT_FOODS), meta:{settingsAt:0, foodsAt:0}, deleted:{}};
var ui = {model:null, slot:null, slotManual:false, basket:[], recipe:[{n:"",g:"",kh:""}], view:"calc"};

function clone(o){return JSON.parse(JSON.stringify(o));}
function loadLocal(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(raw){ var d = JSON.parse(raw); if(d.settings) state.settings = fixSettings(d.settings); if(d.injections) state.injections = d.injections; if(d.foods) state.foods = d.foods; if(d.meta) state.meta = d.meta; if(d.deleted) state.deleted = d.deleted; }
  }catch(e){}
}
function fixSettings(x){
  if(!MODEL_NAMES[x.model]) x.model = "profile";   // fehlende oder alte Bezeichnungen umstellen
  if(!x.exp || !(x.exp.peak>0) || !(x.exp.dur>0) || x.exp.peak >= x.exp.dur/2) x.exp = clone(DEFAULT_SETTINGS.exp);
  if(!(x.step>0)) x.step = 0.5;
  if(!(x.keepDays>=1 && x.keepDays<=365)) x.keepDays = 3;
  if(!x.slots || !x.slots.length) x.slots = clone(DEFAULT_SETTINGS.slots);
  delete x.cmpJuggluco;
  return x;
}
function saveLocal(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
}

function persist(name){
  if(name==="settings" || name==="foods"){ state.meta = state.meta || {}; state.meta[name+"At"] = Date.now(); }
  saveLocal();
  scheduleGhSync();
}
function setSync(t){ document.getElementById("sync").textContent = t; }


// ---------- Helpers ----------
function fmt(n, d){ if(d===undefined) d=1; if(!isFinite(n)) return "–"; return n.toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d}); }
function num(s){ if(s===null||s===undefined) return NaN; s = String(s).trim().replace(/\s/g,"").replace(",","."); if(s==="") return NaN; return Number(s); }
// Rechenausdruck wie in Excel: =4,2*0,88  (nur Zahlen, + - * / und Klammern)
function evalExpr(str){
  if(str===null||str===undefined) return NaN;
  var t = String(str).trim().replace(/^=/,"").replace(/\s/g,"").replace(/,/g,".").replace(/[x×]/gi,"*").replace(/:/g,"/");
  if(t==="" || /[^0-9.+\-*\/()]/.test(t)) return NaN;
  var i=0;
  function peek(){ return t[i]; }
  function factor(){
    if(peek()==="+"){ i++; return factor(); }
    if(peek()==="-"){ i++; return -factor(); }
    if(peek()==="("){ i++; var v=expr(); if(t[i]!==")") throw 0; i++; return v; }
    var m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(t.slice(i)); if(!m) throw 0; i+=m[0].length; return parseFloat(m[0]);
  }
  function term(){ var v=factor(); while(peek()==="*"||peek()==="/"){ var o=t[i++]; var w=factor(); v = o==="*"? v*w : v/w; } return v; }
  function expr(){ var v=term(); while(peek()==="+"||peek()==="-"){ var o=t[i++]; var w=term(); v = o==="+"? v+w : v-w; } return v; }
  try{ var v=expr(); if(i!==t.length) return NaN; return isFinite(v)?v:NaN; }catch(e){ return NaN; }
}
function isExpr(str){ return /[+*\/()x×:=]|.-/.test(String(str||"").trim().replace(/^-/,"")); }
function roundStep(v){ var st = state.settings.step>0 ? state.settings.step : 0.5; return Math.round(v/st)*st; }
function pad(n){ return (n<10?"0":"")+n; }
function hhmm(d){ return pad(d.getHours())+":"+pad(d.getMinutes()); }
function minutesOf(s){ var p=String(s||"0:0").split(":"); return (+p[0])*60+(+p[1]||0); }
function el(tag, attrs, text){ var e=document.createElement(tag); if(attrs) for(var k in attrs){ if(k==="class") e.className=attrs[k]; else e.setAttribute(k, attrs[k]); } if(text!==undefined) e.textContent=text; return e; }
function toast(t){ var e=document.getElementById("toast"); e.textContent=t; e.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(function(){e.classList.remove("show");}, 2200); }
function uidGen(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

// ---------- Model ----------
function fracProfile(min){
  var p = state.settings.profile.slice().sort(function(a,b){return a[0]-b[0];});
  var ref = state.settings.refBolus || 1;
  if(min < 0 || p.length < 2) return 0;
  if(min >= p[p.length-1][0]) return 0;
  for(var i=0;i<p.length-1;i++){
    var a=p[i], b=p[i+1];
    if(min>=a[0] && min<b[0]){
      var fa=a[1]/ref, fb=b[1]/ref;
      return fa + (min-a[0])*(fb-fa)/(b[0]-a[0]);
    }
  }
  return 0;
}
function fracJ(min){
  if(min<0) return 0;
  return Math.max(0, 5.7952464925654*Math.exp(-0.016029021581167327*min) - 4.7952464925654*Math.exp(-0.019371711389922493*min));
}
// Standardmodell (exponentielles Insulinmodell wie in Loop/OpenAPS): tp = Wirkmaximum, td = Wirkdauer
function fracExpWith(min, tp, td){
  if(min<0) return 0; if(min>=td) return 0;
  var tau = tp*(1-tp/td)/(1-2*tp/td), a = 2*tau/td, S = 1/(1-a+(1+a)*Math.exp(-td/tau));
  var v = 1 - S*(1-a)*((min*min/(tau*td*(1-a)) - min/tau - 1)*Math.exp(-min/tau) + 1);
  return Math.min(1, Math.max(0, v));
}
function fracExp(min){ var e = state.settings.exp || DEFAULT_SETTINGS.exp; return fracExpWith(min, e.peak, e.dur); }
function fracFor(m){ return m==="juggluco" ? fracJ : m==="exp" ? fracExp : fracProfile; }
function activeFrac(){ return fracFor(ui.model); }
function iobAt(ts, fn){
  fn = fn || activeFrac();
  var sum=0;
  state.injections.forEach(function(x){ sum += x.u * fn((ts - x.t)/60000); });
  return sum;
}
function autoSlot(now){
  var m = now.getHours()*60+now.getMinutes();
  var s = state.settings.slots.map(function(x,i){return {i:i,m:minutesOf(x.from)};}).sort(function(a,b){return a.m-b.m;});
  var pick = s[s.length-1].i;
  for(var i=0;i<s.length;i++){ if(m>=s[i].m) pick=s[i].i; }
  return pick;
}

// ---------- Render ----------
function renderIOB(){
  var now = Date.now();
  var v = iobAt(now);
  document.getElementById("iobNow").textContent = fmt(v);
  var cmp = document.getElementById("iobCmp");
  cmp.textContent = Object.keys(MODEL_NAMES).filter(function(m){ return m!==ui.model; })
    .map(function(m){ return MODEL_NAMES[m]+": "+fmt(iobAt(now, fracFor(m))); }).join(" · ")+" IE";
  document.querySelectorAll(".seg button").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.model===ui.model)); });
  // curve -2h .. +2h
  var W=340,H=110,top=8,bottom=88,left=4,right=336;
  var pts=[], max=0, N=96;
  for(var i=0;i<=N;i++){ var t=now-7200000+i*(14400000/N); var y=iobAt(t); pts.push([t,y]); if(y>max) max=y; }
  max = Math.max(max, 1);
  function X(i){ return left + (right-left)*i/N; }
  function Y(y){ return bottom - (bottom-top)*y/max; }
  var d="M"+X(0)+","+Y(pts[0][1]);
  for(i=1;i<=N;i++) d+=" L"+X(i).toFixed(1)+","+Y(pts[i][1]).toFixed(1);
  var area = d+" L"+right+","+bottom+" L"+left+","+bottom+" Z";
  var svg = document.getElementById("curve");
  svg.innerHTML =
    '<line x1="'+left+'" y1="'+bottom+'" x2="'+right+'" y2="'+bottom+'" stroke="var(--line)"/>'+
    '<path d="'+area+'" fill="var(--curve-fill)"/>'+
    '<path d="'+d+'" fill="none" stroke="var(--curve)" stroke-width="3" stroke-linejoin="round"/>'+
    '<line x1="'+X(N/2)+'" y1="'+top+'" x2="'+X(N/2)+'" y2="'+bottom+'" stroke="var(--ink)" stroke-width="1.5"/>'+
    '<text class="axis" x="'+left+'" y="104">vor 2 Std.</text>'+
    '<text class="axis" x="'+X(N/2)+'" y="104" text-anchor="middle">jetzt</text>'+
    '<text class="axis" x="'+right+'" y="104" text-anchor="end">in 2 Std.</text>';
}

function renderSlots(){
  if(!ui.slotManual || ui.slot===null || ui.slot>=state.settings.slots.length) ui.slot = autoSlot(new Date());
  var box = document.getElementById("slots"); box.innerHTML="";
  state.settings.slots.forEach(function(s,i){
    var b = el("button",{class:"slot","aria-pressed":String(i===ui.slot),type:"button"}, s.name);
    b.addEventListener("click", function(){ ui.slot=i; ui.slotManual=true; renderSlots(); renderCalc(); });
    box.appendChild(b);
  });
}

function calc(){
  var s = state.settings.slots[ui.slot];
  var bz = evalExpr(document.getElementById("bz").value);
  var keRaw = document.getElementById("ke").value;
  var ke = evalExpr(keRaw);
  var h = document.getElementById("keHint");
  h.textContent = (keRaw.trim() && isExpr(keRaw)) ? (isFinite(ke) ? "= "+fmt(ke,2)+" KE" : "Formel nicht lesbar") : "";
  if(!keRaw.trim()) ui.calcItems = [];
  var ci = document.getElementById("keItems"); if(ci) ci.textContent = (ui.calcItems&&ui.calcItems.length) ? ui.calcItems.join(" · ") : "";
  if(!isFinite(ke)) ke = 0;
  // Zusammenfassung über „Speichern“: genau diese Werte werden gespeichert
  var sum = document.getElementById("injSum"), parts = [];
  parts.push(isFinite(bz) && bz>0 ? "BZ "+fmt(bz,0) : "BZ fehlt");
  if(ke>0) parts.push(fmt(ke,1)+" KE");
  var pNow = num(state.settings.pct); if(isFinite(pNow) && pNow) parts.push((pNow>0?"+":"")+fmt(pNow,0)+" %");
  sum.textContent = "Wird gespeichert: "+parts.join(" · ");
  sum.classList.toggle("warn", !(isFinite(bz) && bz>0));
  if(isFinite(bz) && bz>0) document.getElementById("bz").classList.remove("missing");
  var iob = iobAt(Date.now());
  var meal = ke * s.ke;
  var corr = isFinite(bz) ? (bz - s.ziel)/s.korr : 0;
  var corrIOB = corr>0 ? Math.max(0, corr - iob) : corr;
  var base = meal + corr;
  var pct = num(state.settings.pct); if(!isFinite(pct)) pct=0;
  return {full: Math.max(0, meal + corr - iob), s:s, bz:bz, ke:ke, iob:iob, meal:meal, corr:corr, corrIOB:corrIOB, base:base, withPct: base*(1+pct/100), pct:pct, sugg: Math.max(0, meal + corrIOB), suggPct: Math.max(0, meal + corrIOB)*(1+pct/100)};
}

function renderCalc(){
  var r = calc(), box = document.getElementById("result");
  box.innerHTML = "";
  var injU = document.getElementById("injU");
  if(!isFinite(r.bz) && !r.ke){
    if(!ui.injUDirty) injU.value = "";
    box.appendChild(el("p",{class:"muted"}, "BZ und KE eingeben, dann erscheint hier der Vorschlag."));
    return;
  }
  function row(label, val, cls){ var d=el("div",{class:"row"+(cls?" "+cls:"")}); d.appendChild(el("span",null,label)); d.appendChild(el("b",{class:"num"},val)); box.appendChild(d); }
  row("Essen ("+fmt(r.ke)+" KE × "+fmt(r.s.ke,1)+")", fmt(r.meal)+" IE");
  row("Korrektur ("+(isFinite(r.bz)?fmt(r.bz,0):"–")+" − "+r.s.ziel+") ÷ "+r.s.korr, fmt(r.corr,2)+" IE");
  if(r.iob>0.05){
    var abz = r.corr>0 ? Math.min(r.iob, r.corr) : 0;
    row(r.corr>0 ? "Abzug aktives Insulin ("+fmt(r.iob)+" IE)" : "Aktives Insulin "+fmt(r.iob)+" IE (keine Korrektur)", (abz>0?"−":"")+fmt(abz,2)+" IE");
  }
  if(r.pct){
    row("Zwischensumme", fmt(r.sugg)+" IE");
    row((r.pct>0?"+":"")+fmt(r.pct,0)+" %", (r.pct>0?"+":"−")+fmt(Math.abs(r.suggPct-r.sugg),2)+" IE", "pctrow "+(r.pct>0?"pct-plus":"pct-minus"));
  }
  var val = r.pct ? r.suggPct : r.sugg;
  var sg = el("div",{class:"suggest"+(r.pct ? " alt "+(r.pct>0?"plus":"minus") : "")});
  var l = el("div"); l.appendChild(el("div",{class:"small muted"}, "Vorschlag"+(r.pct?" inkl. "+(r.pct>0?"+":"")+fmt(r.pct,0)+" %":"")));
  l.appendChild(el("div",{class:"big num"}, fmt(val)+" IE"));
  var rv = roundStep(val), st = state.settings.step, rvs = fmt(rv, st<1?1:0);
  // Vorschlag automatisch (gerundet) ins Feld „Gespritzt“ – außer der Wert wurde dort von Hand geändert
  if(!ui.injUDirty) injU.value = rv>0 ? rvs : "";
  var info = el("div",{class:"suggest-info small"});
  if(ui.injUDirty) info.appendChild(el("span",null,"„Gespritzt“ von Hand geändert"));
  else info.appendChild(el("span",null, rv>0 ? "→ Gespritzt: "+rvs+" IE" : "→ kein Insulin"));
  sg.appendChild(l); sg.appendChild(info); box.appendChild(sg);
  if(isFinite(r.bz) && r.bz < 70) box.appendChild(el("p",{class:"note",style:"color:var(--red)"},"BZ unter 70: erst die Unterzuckerung behandeln."));
}

function injItem(x, withDate){
  var li = el("li");
  var d = new Date(x.t);
  var m = el("div",{class:"li-main"});
  var today = new Date(); var isToday = d.toDateString()===today.toDateString();
  var y = new Date(today.getTime()-86400000);
  var day = isToday ? "heute" : (d.toDateString()===y.toDateString() ? "gestern" : d.toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"numeric"}));
  var keText = x.ke>0 ? " · "+fmt(x.ke)+" KE"+(x.keExpr ? " ("+x.keExpr+")" : "") : "";
  m.appendChild(el("div",{class:"li-title num"}, (x.u>0?fmt(x.u)+" IE · ":"")+hhmm(d)+keText+(x.u>0?"":" · ohne Insulin")+(x.bz>0?" · BZ "+fmt(x.bz,0):"")+(x.pct?" · "+(x.pct>0?"+":"")+fmt(x.pct,0)+" %":"")));
  var act = x.u*activeFrac()((Date.now()-x.t)/60000);
  m.appendChild(el("div",{class:"small muted"}, day+(x.slot?", "+x.slot:"")+(act>0.005?", noch "+fmt(act)+" IE aktiv":"")));
  var edit = el("button",{class:"ghost",type:"button","aria-label":"Eintrag bearbeiten"},"Bearbeiten");
  edit.addEventListener("click", function(){ editDlg(x); });
  var del = el("button",{class:"ghost",type:"button","aria-label":"Injektion löschen"},"Löschen");
  del.addEventListener("click", function(){
    confirmDlg("Injektion löschen?", fmt(x.u)+" IE um "+hhmm(d)+" ("+day+")", "Löschen", function(){
      state.injections = state.injections.filter(function(z){return z.id!==x.id;});
      state.deleted = state.deleted || {}; state.deleted[x.id] = Date.now();
      persist("injections"); renderAll(); toast("Injektion gelöscht");
    });
  });
  var acts = el("div",{class:"injacts"}); acts.appendChild(edit); acts.appendChild(del);
  li.appendChild(m); li.appendChild(acts);
  return li;
}
function editDlg(x){
  openDlg(function(d){
    var dt = new Date(x.t);
    d.appendChild(el("h2",{style:"margin-top:0"},"Eintrag bearbeiten"));
    d.appendChild(el("p",{class:"small muted"}, dt.toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long"})+(x.slot?", "+x.slot:"")));
    var g = el("div",{class:"fields",style:"margin-top:4px"}); d.appendChild(g);
    function f(id,label,val,mode,type){ var w=el("div"); w.appendChild(el("label",{for:id},label)); var i=el("input",{id:id,autocomplete:"off"}); if(mode) i.setAttribute("inputmode",mode); if(type) i.type=type; i.value=val; w.appendChild(i); g.appendChild(w); return i; }
    var u = f("eU","Gespritzt (IE)", x.u>0?fmt(x.u):"", "decimal");
    var t = f("eT","Uhrzeit", hhmm(dt), null, "time");
    var k = f("eK","Gegessen (KE)", x.keExpr || (x.ke>0?fmt(x.ke):""), "decimal");
    var b = f("eB","BZ (mg/dl) *", x.bz>0?fmt(x.bz,0):"", "numeric");
    var pc = f("eP","Auf-/Abschlag (%)", x.pct?fmt(x.pct,0):"", "text");
    d.appendChild(actions("Speichern", function(){
      var nu = evalExpr(u.value); if(!isFinite(nu)||nu<0) nu=0;
      var nk = evalExpr(k.value); if(!isFinite(nk)||nk<0) nk=0;
      var nb = evalExpr(b.value);
      if(nu<=0 && nk<=0){ toast("Bitte IE oder KE eingeben"); return; }
      if(!(nb>0)){ toast("Bitte den BZ eingeben"); b.classList.add("missing"); b.focus(); return; }
      var p = (t.value||hhmm(dt)).split(":"); var nd = new Date(x.t); nd.setHours(+p[0], +p[1], 0, 0);
      if(nd.getTime() > Date.now()+5*60000){ toast("Die Uhrzeit liegt in der Zukunft"); return; }
      var rec = state.injections.filter(function(z){return z.id===x.id;})[0]; if(!rec){ closeDlg(); return; }
      rec.u = nu; rec.t = nd.getTime(); rec.up = Date.now();
      if(nk>0){
        rec.ke = Math.round(nk*100)/100;
        if(isExpr(k.value)) rec.keExpr = k.value.trim(); else delete rec.keExpr;
      } else {
        delete rec.ke;
        delete rec.keExpr;
      }
      rec.bz = Math.round(nb);
      var np = evalExpr(String(pc.value).replace("+","")); if(isFinite(np) && np!==0) rec.pct = np; else delete rec.pct;
      state.injections.sort(function(a,c){return a.t-c.t;});
      persist("injections"); closeDlg(); renderAll(); toast("Eintrag geändert");
    }));
  });
}
function renderRecent(){
  var ul = document.getElementById("recent"); ul.innerHTML="";
  var cut = Date.now()-6*3600000;
  var list = state.injections.filter(function(x){return x.t>=cut;}).sort(function(a,b){return b.t-a.t;});
  if(!list.length){ ul.appendChild(el("li",{class:"muted"},"Keine Injektion in den letzten 6 Stunden.")); return; }
  list.forEach(function(x){ ul.appendChild(injItem(x)); });
}
function renderLog(){
  var kd = state.settings.keepDays||3;
  document.getElementById("logTitle").textContent = kd===1 ? "Injektionen des letzten Tages" : "Injektionen der letzten "+kd+" Tage";
  var ul = document.getElementById("log"); ul.innerHTML="";
  var list = state.injections.slice().sort(function(a,b){return b.t-a.t;});
  document.getElementById("clearLocalLog").disabled = !list.length;
  if(!list.length){ ul.appendChild(el("li",{class:"muted"},"Noch keine Injektionen gespeichert.")); return; }
  list.forEach(function(x){ ul.appendChild(injItem(x)); });
}

// ---------- Food ----------
function unitLabel(u){ return u==="100g" ? "100 g" : u; }
function renderFoods(){
  var q = document.getElementById("foodSearch").value.trim().toLowerCase();
  var ul = document.getElementById("foods"); ul.innerHTML="";
  var list = state.foods.filter(function(f){ return !q || f.name.toLowerCase().indexOf(q)>=0; }).sort(function(a,b){return a.name.localeCompare(b.name,"de");});
  if(!list.length){ ul.appendChild(el("li",{class:"muted"}, q ? "Nichts gefunden. Lege es als neues Lebensmittel an." : "Noch keine Lebensmittel.")); return; }
  list.forEach(function(f){
    var li = el("li"); var m = el("div",{class:"li-main"});
    var t = el("div",{class:"li-title"}, f.name);
    if(f.check) t.appendChild(el("span",{class:"badge"},"bitte prüfen"));
    m.appendChild(t);
    m.appendChild(el("div",{class:"small muted num"}, fmt(f.ke,2)+" KE je "+unitLabel(f.unit)+(f.note?" · "+f.note:"")));
    var acts = el("div",{style:"display:flex;gap:2px;flex:0 0 auto"});
    var add = el("button",{class:"ghost",type:"button"},"Hinzufügen");
    add.addEventListener("click", function(){ amountDlg(f); });
    var ed = el("button",{class:"ghost",type:"button"},"Ändern");
    ed.addEventListener("click", function(){ foodDlg(f); });
    acts.appendChild(add); acts.appendChild(ed);
    li.appendChild(m); li.appendChild(acts); ul.appendChild(li);
  });
}
function renderBasket(){
  var ul = document.getElementById("basket"); ul.innerHTML="";
  if(!ui.basket.length) ul.appendChild(el("li",{class:"muted"},"Tippe unten bei einem Lebensmittel auf „Hinzufügen“."));
  var sum=0;
  ui.basket.forEach(function(b, i){
    sum += b.ke;
    var li = el("li"); var m = el("div",{class:"li-main"});
    m.appendChild(el("div",{class:"li-title"}, b.label));
    m.appendChild(el("div",{class:"small muted num"}, fmt(b.ke,2)+" KE"));
    var rm = el("button",{class:"ghost",type:"button"},"Entfernen");
    rm.addEventListener("click", function(){ ui.basket.splice(i,1); renderBasket(); });
    li.appendChild(m); li.appendChild(rm); ul.appendChild(li);
  });
  document.getElementById("basketSum").textContent = fmt(sum)+" KE";
  ui.basketSum = sum;
}
function renderRecipe(){
  var tb = document.querySelector("#recipe tbody"); tb.innerHTML="";
  var total=0;
  ui.recipe.forEach(function(r, i){
    var tr = el("tr");
    function cell(key, ph, mode, w){
      var td = el("td"); var inp = el("input",{value:r[key],placeholder:ph,autocomplete:"off"});
      if(mode) inp.setAttribute("inputmode", mode);
      if(w) inp.style.width=w;
      inp.addEventListener("input", function(){ r[key]=inp.value; updRecipeTotals(); });
      td.appendChild(inp); tr.appendChild(td);
    }
    cell("n","Mehl"); cell("g","250","decimal","80px"); cell("kh","70","decimal","80px");
    var ke = num(r.g)*num(r.kh)/1000; if(isFinite(ke)) total+=ke;
    tr.appendChild(el("td",{class:"num","data-ke":i}, isFinite(ke)?fmt(ke):"–"));
    var td = el("td"); var rm = el("button",{class:"ghost",type:"button","aria-label":"Zutat entfernen"},"×");
    rm.addEventListener("click", function(){ ui.recipe.splice(i,1); if(!ui.recipe.length) ui.recipe.push({n:"",g:"",kh:""}); renderRecipe(); });
    td.appendChild(rm); tr.appendChild(td);
    tb.appendChild(tr);
  });
  updRecipeTotals();
}
function updRecipeTotals(){
  var total=0;
  ui.recipe.forEach(function(r,i){
    var ke = num(r.g)*num(r.kh)/1000;
    var c = document.querySelector('[data-ke="'+i+'"]'); if(c) c.textContent = isFinite(ke)?fmt(ke):"–";
    if(isFinite(ke)) total+=ke;
  });
  var pcs = num(document.getElementById("recipePieces").value);
  document.getElementById("recipeTotal").textContent = fmt(total)+" KE";
  document.getElementById("recipePer").textContent = pcs>0 ? fmt(total/pcs,2)+" KE" : "–";
  ui.recipeTotal = total;
}

// ---------- Settings ----------
function renderSettings(){
  var S = state.settings;
  var tb = document.getElementById("slotTable"); tb.innerHTML="";
  S.slots.sort(function(a,b){ return minutesOf(a.from)-minutesOf(b.from); });
  S.slots.forEach(function(s, si){
    var wrap = el("div",{class:"slotset"});
    var head = el("div",{class:"slothead"});
    var nw = el("div"); nw.appendChild(el("label",{for:"sn"+si},"Name"));
    var nin = el("input",{id:"sn"+si,list:"slotNames",autocomplete:"off"}); nin.value = s.name;
    nin.addEventListener("change", function(){ var v=nin.value.trim(); if(!v){ nin.value=s.name; toast("Bitte einen Namen eingeben"); return; } s.name=v; persist("settings"); renderSlots(); });
    nw.appendChild(nin); head.appendChild(nw);
    var rm = el("button",{class:"ghost",type:"button"},"Entfernen");
    rm.addEventListener("click", function(){
      if(S.slots.length<=1){ toast("Mindestens eine Tageszeit nötig"); return; }
      confirmDlg("Tageszeit entfernen?", s.name+" ab "+s.from, "Entfernen", function(){ S.slots.splice(si,1); ui.slotManual=false; persist("settings"); renderSettings(); renderSlots(); renderCalc(); });
    });
    head.appendChild(rm);
    wrap.appendChild(head);
    var kiCell = el("div",{class:"small muted num",style:"margin-top:4px"}, "KI "+fmt(10/s.ke,1));
    var tr = el("div",{class:"slotgrid"});
    [["from","time","Ab"],["ziel","numeric","Ziel"],["korr","numeric","Korr"],["ke","decimal","KE-Fak"]].forEach(function(c){
      var td = el("div"); var lid="s"+si+c[0]; td.appendChild(el("label",{for:lid},c[2])); var inp = el("input",{autocomplete:"off",id:lid});
      if(c[1]==="time"){ inp.type="time"; inp.value=s.from; } else { inp.setAttribute("inputmode",c[1]); inp.value = fmt(s[c[0]], c[0]==="ke"?1:0).replace(/\./g,""); }
      inp.addEventListener("change", function(){
        if(c[1]==="time"){ if(inp.value) s.from=inp.value; }
        else { var v=num(inp.value); if(isFinite(v) && v>0){ s[c[0]]=v; } else { inp.value = fmt(s[c[0]], c[0]==="ke"?1:0); toast("Bitte eine Zahl größer 0 eingeben"); return; } }
        kiCell.textContent = "KI "+fmt(10/s.ke,1);
        persist("settings"); renderSlots(); renderCalc();
      });
      td.appendChild(inp); tr.appendChild(td);
    });
    wrap.appendChild(tr); wrap.appendChild(kiCell); tb.appendChild(wrap);
  });
  renderPct();
  var rb = document.getElementById("refBolus"); rb.value = fmt(S.refBolus,1);
  document.getElementById("modelSel").value = S.model;
  if(document.activeElement!==document.getElementById("keepDays")) document.getElementById("keepDays").value = String(S.keepDays||3);
  renderAlgo();
  renderExp();
  document.getElementById("stepSel").value = String(S.step);
  var pt = document.querySelector("#profTable tbody"); pt.innerHTML="";
  S.profile.sort(function(a,b){return a[0]-b[0];});
  S.profile.forEach(function(p, i){
    var tr = el("tr");
    var share;
    [0,1].forEach(function(k){
      var td = el("td"); var inp = el("input",{inputmode:"decimal",autocomplete:"off"}); inp.value = fmt(p[k], k?1:0); inp.style.width="80px";
      inp.addEventListener("change", function(){
        var v = num(inp.value);
        if(!isFinite(v) || v<0){ inp.value = fmt(p[k],k?1:0); toast("Bitte eine Zahl eingeben"); return; }
        p[k]=v; persist("settings");
        if(k===0) renderSettings(); else share.textContent = fmt(100*p[1]/S.refBolus,0)+" %";
        renderIOB(); renderCalc();
      });
      td.appendChild(inp); tr.appendChild(td);
    });
    share = el("td",{class:"num"}, fmt(100*p[1]/S.refBolus,0)+" %"); tr.appendChild(share);
    var td = el("td"); var rm = el("button",{class:"ghost",type:"button","aria-label":"Punkt entfernen"},"×");
    rm.addEventListener("click", function(){
      if(S.profile.length<=2){ toast("Mindestens zwei Punkte nötig"); return; }
      S.profile.splice(i,1); persist("settings"); renderSettings(); renderIOB(); renderCalc();
    });
    td.appendChild(rm); tr.appendChild(td);
    pt.appendChild(tr);
  });
}

// ---------- Dialogs ----------
var dlg = document.getElementById("dlg");
function openDlg(build){
  dlg.innerHTML=""; build(dlg);
  if(dlg.showModal) dlg.showModal(); else dlg.setAttribute("open","");
}
function closeDlg(){ if(dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
function actions(okText, onOk, danger){
  var a = el("div",{class:"dlg-actions"});
  var c = el("button",{class:"secondary",type:"button"},"Abbrechen"); c.addEventListener("click", closeDlg);
  var o = el("button",{class:danger?"danger":"primary",type:"button"}, okText); o.addEventListener("click", onOk);
  a.appendChild(c); a.appendChild(o); return a;
}
function confirmDlg(title, text, okText, onOk){
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"},title)); d.appendChild(el("p",null,text));
    d.appendChild(actions(okText, function(){ closeDlg(); onOk(); }, true));
  });
}
function field(d, id, label, value, mode, type){
  var w = el("div",{style:"margin-top:10px"}); w.appendChild(el("label",{for:id},label));
  var i = el("input",{id:id,autocomplete:"off"}); if(mode) i.setAttribute("inputmode",mode); if(type) i.type=type; if(value!==undefined) i.value=value;
  w.appendChild(i); d.appendChild(w); return i;
}
function amountDlg(f, onAdd){
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"}, f.name));
    var isG = f.unit==="100g";
    var amt = field(d,"amt", isG ? "Menge in Gramm" : "Anzahl ("+f.unit+")", isG?"":"1", "decimal");
    var out = el("p",{class:"num",style:"margin-top:10px"},"");
    d.appendChild(out);
    function upd(){ var a=num(amt.value); var ke = isG ? a*f.ke/100 : a*f.ke; out.textContent = isFinite(ke) ? "= "+fmt(ke,2)+" KE" : ""; return ke; }
    amt.addEventListener("input", upd); upd();
    d.appendChild(actions("Hinzufügen", function(){
      var ke = upd(); if(!isFinite(ke) || ke<0){ toast("Bitte eine Menge eingeben"); return; }
      var label = f.name+" ("+amt.value+(isG?" g":" × "+f.unit)+")";
      markRecent(f.id);
      closeDlg();
      if(onAdd){ onAdd(ke, label); return; }
      ui.basket.push({label: label, ke:ke});
      renderBasket(); toast(fmt(ke,2)+" KE hinzugefügt");
    }));
    setTimeout(function(){ amt.focus(); }, 50);
  });
}
var RECENT_KEY = "bolusrechner-foodrecent";
function recentMap(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||"{}"); }catch(e){ return {}; } }
function markRecent(id){ try{ var m = recentMap(); m[id] = Date.now(); localStorage.setItem(RECENT_KEY, JSON.stringify(m)); }catch(e){} }
function pickFoodDlg(){
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"},"Lebensmittel wählen"));
    var q = el("input",{type:"search",placeholder:"Suchen …",autocomplete:"off","aria-label":"Lebensmittel suchen"}); d.appendChild(q);
    var ul = el("ul",{class:"list picklist"}); d.appendChild(ul);
    function draw(){
      var rec = recentMap(), term = q.value.trim().toLowerCase();
      var list = state.foods.filter(function(f){ return !term || f.name.toLowerCase().indexOf(term)>=0; })
        .sort(function(a,b){ var ra=rec[a.id]||0, rb=rec[b.id]||0; if(ra!==rb) return rb-ra; return a.name.localeCompare(b.name,"de"); });
      ul.innerHTML="";
      if(!list.length){ ul.appendChild(el("li",{class:"muted"},"Nichts gefunden. Neue Lebensmittel legst du im Tab „Essen“ an.")); return; }
      list.forEach(function(f){
        var li = el("li",{role:"button",tabindex:"0"}); var m = el("div",{class:"li-main"});
        var t = el("div",{class:"li-title"}, f.name); if(f.check) t.appendChild(el("span",{class:"badge"},"bitte prüfen"));
        m.appendChild(t); m.appendChild(el("div",{class:"small muted num"}, fmt(f.ke,2)+" KE je "+unitLabel(f.unit)+(rec[f.id]?" · zuletzt verwendet":"")));
        li.appendChild(m);
        function go(){ amountDlg(f, addToKe); }
        li.addEventListener("click", go); li.addEventListener("keydown", function(e){ if(e.key==="Enter") go(); });
        ul.appendChild(li);
      });
    }
    q.addEventListener("input", draw); draw();
    var a = el("div",{class:"dlg-actions"}); var c = el("button",{class:"secondary",type:"button"},"Abbrechen"); c.addEventListener("click", closeDlg); a.appendChild(c); d.appendChild(a);
  });
}
function addToKe(ke, label){
  var i = document.getElementById("ke");
  var v = fmt(Math.round(ke*100)/100, 2).replace(/,?0+$/,"");
  i.value = i.value.trim() ? i.value.trim()+"+"+v : v;
  ui.calcItems = (ui.calcItems||[]).concat([label]);
  renderCalc(); toast(fmt(ke,2)+" KE übernommen");
}
function foodDlg(f){
  var isNew = !f;
  f = f || {id:uidGen(), name:"", unit:"100g", ke:NaN};
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"}, isNew?"Neues Lebensmittel":"Lebensmittel ändern"));
    var name = field(d,"fName","Name", f.name);
    var w = el("div",{style:"margin-top:10px"}); w.appendChild(el("label",{for:"fUnit"},"Einheit"));
    var unit = el("select",{id:"fUnit"});
    [["100g","je 100 g"],["Stück","je Stück"],["Portion","je Portion"]].forEach(function(o){ var op=el("option",{value:o[0]},o[1]); if(o[0]===f.unit) op.selected=true; unit.appendChild(op); });
    w.appendChild(unit); d.appendChild(w);
    var ke = field(d,"fKe","KE je Einheit", isFinite(f.ke)?fmt(f.ke,2):"", "decimal");
    var kh = field(d,"fKh","oder KH je 100 g (rechnet KE aus)", "", "decimal");
    kh.addEventListener("input", function(){ var v=num(kh.value); if(isFinite(v)){ unit.value="100g"; ke.value=fmt(v/10,2); } });
    var note = field(d,"fNote","Notiz (optional)", f.note||"");
    d.appendChild(actions("Speichern", function(){
      var v = num(ke.value);
      if(!name.value.trim()){ toast("Bitte einen Namen eingeben"); return; }
      if(!isFinite(v) || v<0){ toast("Bitte KE eingeben"); return; }
      f.name=name.value.trim(); f.unit=unit.value; f.ke=v; f.note=note.value.trim(); delete f.check;
      if(isNew) state.foods.push(f);
      persist("foods"); closeDlg(); renderFoods(); toast("Gespeichert");
    }));
    if(!isNew){
      var del = el("button",{class:"danger",type:"button",style:"width:100%;margin-top:10px"},"Lebensmittel löschen");
      del.addEventListener("click", function(){ state.foods = state.foods.filter(function(z){return z.id!==f.id;}); persist("foods"); closeDlg(); renderFoods(); toast("Gelöscht"); });
      d.appendChild(del);
    }
  });
}

// ---------- Backup ----------
var BK_KEY = "bolusrechner-lastbackup";
function lastBackup(){ try{ return +localStorage.getItem(BK_KEY) || 0; }catch(e){ return 0; } }
function markBackup(){ try{ localStorage.setItem(BK_KEY, String(Date.now())); }catch(e){} renderBackup(); }
function keepMs(st){ var d = (st||state.settings||{}).keepDays; return ((d>=1 && d<=365) ? d : 3)*86400000; }
function renderBackup(){
  var lb = lastBackup(), days = lb ? Math.floor((Date.now()-lb)/86400000) : null;
  var info = document.getElementById("backupInfo");
  info.textContent = lb ? "Letzte Sicherung: "+new Date(lb).toLocaleDateString("de-DE")+(days?" (vor "+days+(days===1?" Tag)":" Tagen)"):" (heute)") : "Noch keine Sicherung. Sichere deine Daten z. B. in OneDrive.";
  var syncOk = ghReady() && gh.lastSync && !gh.lastError && (Date.now()-gh.lastSync) < 7*86400000;   // funktionierender Sync ersetzt die Erinnerung
  var due = (!lb || days>=7) && state.injections.length>0 && !syncOk;
  document.getElementById("backupBanner").classList.toggle("hidden", !due);
  document.getElementById("backupBannerText").textContent = lb ? "Letzte Sicherung vor "+days+" Tagen." : "Deine Daten sind noch nicht gesichert.";
}
function exportData(){
  var json = JSON.stringify({app:"bolusrechner", version:1, exported:new Date().toISOString(), data:state}, null, 1);
  var name = "bolusrechner-"+new Date().toISOString().slice(0,10)+".json";
  var file = null;
  try{ file = new File([json], name, {type:"application/json"}); }catch(e){}
  if(file && navigator.canShare && navigator.canShare({files:[file]})){
    navigator.share({files:[file], title:"Bolusrechner-Sicherung"}).then(function(){ markBackup(); toast("Sicherung geteilt"); }, function(e){ if(e && e.name==="AbortError") return; downloadFile(json, name); });
    return;
  }
  downloadFile(json, name);
}
function downloadFile(json, name){
  try{
    var url = URL.createObjectURL(new Blob([json],{type:"application/json"}));
    var a = el("a",{href:url,download:name}); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    markBackup(); toast("Sicherung heruntergeladen");
  }catch(e){ showJson(json); }
}

// ---------- Vollständige Browser-Speicher-Sicherung ----------
function localBackupStatus(text){
  var elStatus = document.getElementById("localBackupStatus");
  if(elStatus) elStatus.textContent = text;
}
function bytesToBase64(bytes){
  var binary = "";
  for(var i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
function base64ToBytes(text){
  var binary = atob(String(text).replace(/\s/g,""));
  var bytes = new Uint8Array(binary.length);
  for(var i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function deriveLocalBackupKey(password, salt){
  var keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2", salt:salt, iterations:250000, hash:"SHA-256"},
    keyMaterial,
    {name:"AES-GCM", length:256},
    false,
    ["encrypt","decrypt"]
  );
}
async function exportLocalStorage(){
  var password = document.getElementById("localBackupPassword").value;
  var entries = [];
  try{
    for(var i=0;i<localStorage.length;i++){
      var key = localStorage.key(i);
      if(key !== null) entries.push({key:key, value:localStorage.getItem(key)});
    }
  }catch(e){
    toast("Lokaler Speicher ist nicht verfügbar");
    return;
  }
  var payload = JSON.stringify({app:"bolusrechner", version:2, kind:"localStorage", exported:new Date().toISOString(), entries:entries}, null, 2);
  var date = new Date().toISOString().slice(0,10);
  if(!password){
    downloadFile(payload, "bolusrechner-browser-speicher-"+date+".json");
    localBackupStatus(entries.length+" Schlüssel unverschlüsselt exportiert.");
    return;
  }
  if(!crypto || !crypto.subtle){
    toast("Verschlüsselung wird in diesem Browser nicht unterstützt");
    return;
  }
  try{
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveLocalBackupKey(password, salt);
    var encrypted = await crypto.subtle.encrypt({name:"AES-GCM", iv:iv}, key, new TextEncoder().encode(payload));
    var envelope = JSON.stringify({
      app:"bolusrechner",
      version:2,
      kind:"localStorage-encrypted",
      cipher:"AES-GCM",
      kdf:"PBKDF2-SHA256",
      iterations:250000,
      exported:new Date().toISOString(),
      salt:bytesToBase64(salt),
      iv:bytesToBase64(iv),
      data:bytesToBase64(new Uint8Array(encrypted))
    }, null, 2);
    downloadFile(envelope, "bolusrechner-browser-speicher-"+date+".bolusenc");
    localBackupStatus(entries.length+" Schlüssel verschlüsselt exportiert.");
  }catch(e){
    toast("Verschlüsselung fehlgeschlagen");
  }
}
async function readLocalBackup(text){
  var password = document.getElementById("localBackupPassword").value;
  var envelope;
  try{ envelope = JSON.parse(text); }catch(e){ throw new Error("invalid"); }
  if(envelope.kind === "localStorage") return envelope;
  if(envelope.kind !== "localStorage-encrypted") throw new Error("invalid");
  if(!password) throw new Error("password");
  if(!crypto || !crypto.subtle) throw new Error("unsupported");
  var salt = base64ToBytes(envelope.salt);
  var iv = base64ToBytes(envelope.iv);
  var key = await deriveLocalBackupKey(password, salt);
  var decrypted = await crypto.subtle.decrypt({name:"AES-GCM", iv:iv}, key, base64ToBytes(envelope.data));
  var payload = JSON.parse(new TextDecoder().decode(decrypted));
  if(payload.kind !== "localStorage") throw new Error("invalid");
  return payload;
}
function confirmLocalImport(payload){
  if(!payload || payload.app !== "bolusrechner" || payload.kind !== "localStorage" || !Array.isArray(payload.entries)){
    toast("Das ist keine gültige Browser-Speicher-Sicherung");
    return;
  }
  var valid = payload.entries.every(function(entry){ return entry && typeof entry.key === "string" && typeof entry.value === "string"; });
  if(!valid){
    toast("Die Sicherung enthält ungültige Einträge");
    return;
  }
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"},"Browser-Speicher wiederherstellen"));
    d.appendChild(el("p",{class:"small"},"Die Sicherung enthält "+payload.entries.length+" Schlüssel."));
    d.appendChild(el("p",{class:"small muted"},"Die API-Konfiguration kann übernommen werden, ohne andere App-Daten zu verändern."));
    d.appendChild(actions("Nur API-Konfiguration übernehmen", function(){
      try{
        BolusStorage.importEntries(payload.entries, true);
        closeDlg();
        if(window.CarbScanner) window.CarbScanner.init({
          triggerSelector:"#openCarbScannerBtn",
          targetInputSelector:null,
          groqKeyStorageName:"carbs_groq_api_key",
          geminiKeyStorageName:"carbs_gemini_api_key",
          customUrlStorageName:"carbs_custom_api_url",
          customKeyStorageName:"carbs_custom_api_key",
          customModelStorageName:"carbs_custom_api_model"
        });
        localBackupStatus("API-Konfiguration aus "+payload.entries.length+" Sicherungseinträgen übernommen.");
        toast("API-Konfiguration übernommen");
      }catch(e){
        toast("API-Import fehlgeschlagen");
      }
    }, true));
    d.appendChild(el("p",{class:"small muted",style:"margin-top:12px"},"Alternativ kann der gesamte lokale Browser-Speicher ersetzt werden."));
    d.appendChild(actions("Komplette Konfiguration ersetzen", function(){
      try{
        localStorage.clear();
        for(var i=0;i<payload.entries.length;i++){
          localStorage.setItem(payload.entries[i].key, payload.entries[i].value);
        }
        closeDlg();
        localBackupStatus(payload.entries.length+" Schlüssel wiederhergestellt.");
        setTimeout(function(){ location.reload(); }, 200);
      }catch(e){
        toast("Wiederherstellung fehlgeschlagen");
      }
    }, true));
  });
}
function showJson(json){
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"},"Daten sichern"));
    d.appendChild(el("p",{class:"small muted"},"Kopiere den Text und bewahre ihn z. B. in einer Notiz auf."));
    var ta = el("textarea",{readonly:""}); ta.value=json; d.appendChild(ta);
    d.appendChild(actions("Kopieren", function(){
      ta.select();
      (navigator.clipboard ? navigator.clipboard.writeText(json) : Promise.reject()).then(function(){ markBackup(); toast("Kopiert"); closeDlg(); }, function(){ try{document.execCommand("copy"); markBackup(); toast("Kopiert");}catch(e){ toast("Bitte manuell kopieren"); } });
    }));
  });
}
function applyImport(text){
  try{
    var o = JSON.parse(text); var x = o.data || o;
    if(!x.settings || !x.foods || !x.injections) throw 0;
    var nowTs = Date.now();
    state = {settings:fixSettings(x.settings), foods:x.foods, injections:x.injections, meta:{settingsAt:nowTs, foodsAt:nowTs}, deleted:x.deleted||{}};
    ["settings","foods","injections"].forEach(persist);
    closeDlg(); renderAll(); toast("Sicherung wiederhergestellt");
  }catch(e){ toast("Das ist keine gültige Sicherung"); }
}
function importData(){
  openDlg(function(d){
    d.appendChild(el("h2",{style:"margin-top:0"},"Sicherung wiederherstellen"));
    d.appendChild(el("p",{class:"small muted"},"Wähle die Sicherungsdatei, z. B. aus OneDrive. Deine aktuellen Daten werden dabei ersetzt."));
    var fi = el("input",{type:"file",accept:".json,application/json,text/plain"});
    fi.style.fontSize="1rem";
    fi.addEventListener("change", function(){
      var f = fi.files && fi.files[0]; if(!f) return;
      var r = new FileReader(); r.onload = function(){ applyImport(String(r.result)); }; r.readAsText(f);
    });
    d.appendChild(fi);
    d.appendChild(el("p",{class:"small muted",style:"margin-top:12px"},"Oder den gesicherten Text einfügen:"));
    var ta = el("textarea"); d.appendChild(ta);
    d.appendChild(actions("Wiederherstellen", function(){ applyImport(ta.value); }, true));
  });
}

// ---------- GitHub-Synchronisation ----------
var GH_KEY = "bolusrechner-github";
var gh = {repo:"", token:"", path:"bolus-daten.json", lastSync:0, lastError:"", warn:""};
var ghBusy = false, ghAgain = false, ghTimer = null;
function loadGh(){ try{ var o = JSON.parse(localStorage.getItem(GH_KEY)||"null"); if(o) for(var k in o) gh[k]=o[k]; }catch(e){} }
function saveGh(){ try{ localStorage.setItem(GH_KEY, JSON.stringify(gh)); }catch(e){} }
function ghReady(){ return !!gh.repo && !!gh.token; }
function b64e(str){ var bytes = new TextEncoder().encode(str), bin=""; for(var i=0;i<bytes.length;i+=0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000)); return btoa(bin); }
function b64d(b){ var bin = atob(String(b).replace(/\s/g,"")), bytes = new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function stable(o){ if(Array.isArray(o)) return "["+o.map(stable).join(",")+"]"; if(o && typeof o==="object") return "{"+Object.keys(o).sort().map(function(k){return JSON.stringify(k)+":"+stable(o[k]);}).join(",")+"}"; return JSON.stringify(o); }
function snapshot(){ return {settings:state.settings, foods:state.foods, injections:state.injections, meta:state.meta||{settingsAt:0,foodsAt:0}, deleted:state.deleted||{}}; }
function mergeData(L, Rm){
  L = clone(L);
  Rm = Rm ? clone(Rm) : {};   // auch ohne Gegenstück: Aufbewahrungsdauer anwenden
  var lm = L.meta||{}, rm = Rm.meta||{};
  var out = {meta:{}};
  if((rm.settingsAt||0) > (lm.settingsAt||0) && Rm.settings){ out.settings = fixSettings(Rm.settings); out.meta.settingsAt = rm.settingsAt; } else { out.settings = L.settings; out.meta.settingsAt = lm.settingsAt||0; }
  if((rm.foodsAt||0) > (lm.foodsAt||0) && Rm.foods){ out.foods = Rm.foods; out.meta.foodsAt = rm.foodsAt; } else { out.foods = L.foods; out.meta.foodsAt = lm.foodsAt||0; }
  var del = {}, cut = Date.now()-7*86400000;
  [L.deleted||{}, Rm.deleted||{}].forEach(function(d){ for(var k in d){ if(d[k]>=cut && (!del[k] || d[k]>del[k])) del[k]=d[k]; } });
  out.deleted = del;
  var map = {}, icut = Date.now()-keepMs(out.settings);
  (Rm.injections||[]).concat(L.injections||[]).forEach(function(x){
    if(!x || !x.id || del[x.id] || x.t<icut) return;
    var o = map[x.id];
    if(!o || (x.up||0) >= (o.up||0)) map[x.id]=x;   // neuere Bearbeitung gewinnt
  });
  out.injections = Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return a.t-b.t;});
  return {settings:out.settings, foods:out.foods, injections:out.injections, meta:out.meta, deleted:out.deleted};
}
function ghUrl(){ return "https://api.github.com/repos/"+gh.repo.trim().replace(/^\/+|\/+$/g,"")+"/contents/"+encodeURIComponent(gh.path); }
function ghHeaders(){ return {"Accept":"application/vnd.github+json","Authorization":"Bearer "+gh.token.trim(),"X-GitHub-Api-Version":"2022-11-28"}; }
function ghErrText(st){ return st===401 ? "Token ungültig oder abgelaufen" : st===403 ? "Token hat keine Berechtigung (Contents: Read and write)" : st===404 ? "Repository nicht gefunden oder Token hat keinen Zugriff darauf" : "Fehler "+st; }
function scheduleGhSync(){ if(!ghReady()) return; clearTimeout(ghTimer); ghTimer = setTimeout(ghSync, 2500); }
async function ghSync(){
  if(!ghReady()) return;
  if(!navigator.onLine){ renderSyncStatus("offline"); return; }
  if(ghBusy){ ghAgain = true; return; }
  ghBusy = true; renderSyncStatus("busy");
  try{
    for(var attempt=0; attempt<3; attempt++){
      var res = await fetch(ghUrl(), {headers:ghHeaders(), cache:"no-store"});
      var remote = null, sha = null;
      if(res.status===404){ remote = null; }
      else if(!res.ok){ throw new Error(ghErrText(res.status)); }
      else { var j = await res.json(); sha = j.sha; var parsed = JSON.parse(b64d(j.content)); remote = parsed.data || parsed; }
      var local = snapshot();
      var merged = mergeData(local, remote);
      if(stable(merged)!==stable(local)){
        state.settings = merged.settings; state.foods = merged.foods; state.injections = merged.injections; state.meta = merged.meta; state.deleted = merged.deleted;
        ui.model = ui.model || state.settings.model;
        saveLocal(); renderAll();
      }
      if(remote && stable(merged)===stable(mergeData(remote, null))){ break; }
      var body = {message:"Sync "+new Date().toISOString(), content:b64e(JSON.stringify({app:"bolusrechner", version:2, saved:new Date().toISOString(), data:merged}, null, 1))};
      if(sha) body.sha = sha;
      var put = await fetch(ghUrl(), {method:"PUT", headers:ghHeaders(), body:JSON.stringify(body)});
      if(put.status===409 || put.status===422){ continue; }
      if(!put.ok){ throw new Error(ghErrText(put.status)); }
      break;
    }
    gh.lastSync = Date.now(); gh.lastError = ""; saveGh(); renderBackup();
  }catch(e){
    gh.lastError = (e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message)) ? e.message : "keine Verbindung zu GitHub"; saveGh();
  }finally{
    ghBusy = false; renderSyncStatus(); renderBackup();
    if(ghAgain){ ghAgain=false; setTimeout(ghSync, 500); }
  }
}
function renderSyncStatus(mode){
  var st = document.getElementById("ghStatus");
  if(!ghReady()){
    setSync("nur auf diesem Gerät");
    if(st) st.textContent = gh.repo||gh.token ? "Bitte Repository und Token eintragen." : "Nicht verbunden.";
    return;
  }
  var t = gh.lastSync ? new Date(gh.lastSync) : null;
  if(mode==="busy"){ setSync("synchronisiere …"); }
  else if(mode==="offline"){ setSync("offline"); }
  else if(gh.lastError){ setSync("Sync-Fehler"); }
  else if(t){ setSync("Sync "+hhmm(t)); }
  if(st){
    st.style.color = gh.lastError ? "var(--red)" : "";
    st.textContent = gh.lastError ? "Fehler: "+gh.lastError :
      (t ? "Verbunden mit "+gh.repo+". Letzter Abgleich: "+t.toLocaleDateString("de-DE")+" "+hhmm(t)+"." : "Verbunden mit "+gh.repo+".") + (gh.warn ? " "+gh.warn : "");
  }
}
function renderGhForm(){
  document.getElementById("ghRepo").value = gh.repo;
  document.getElementById("ghToken").value = gh.token;
  renderSecretInfo("ghToken","gh");
  renderSyncStatus();
}
document.getElementById("ghSave").addEventListener("click", async function(){
  var repo = document.getElementById("ghRepo").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/+$/,"");
  var token = cleanSecret(document.getElementById("ghToken").value);
  if(!/^[^\/\s]+\/[^\/\s]+$/.test(repo)){ toast("Repository bitte als benutzername/name eingeben"); return; }
  if(!token){ toast("Bitte den Token eintragen"); return; }
  gh.repo = repo; gh.token = token; gh.lastError = ""; gh.warn = ""; saveGh();
  document.getElementById("ghRepo").value = repo;
  var st = document.getElementById("ghStatus"); st.style.color=""; st.textContent = "Prüfe Verbindung …";
  try{
    var r = await fetch("https://api.github.com/repos/"+repo, {headers:ghHeaders(), cache:"no-store"});
    if(!r.ok){ gh.lastError = ghErrText(r.status); saveGh(); renderSyncStatus(); return; }
    var info = await r.json();
    if(!info.private) gh.warn = "Achtung: Dieses Repository ist ÖFFENTLICH – deine Daten wären für alle sichtbar. Bitte auf privat stellen!";
    saveGh();
  }catch(e){ gh.lastError = "keine Verbindung zu GitHub"; saveGh(); renderSyncStatus(); return; }
  await ghSync(); toast(gh.lastError ? "Verbindung fehlgeschlagen" : "Synchronisation eingerichtet");
});
document.getElementById("ghNow").addEventListener("click", function(){ if(!ghReady()){ toast("Erst Repository und Token eintragen"); return; } ghSync(); });
document.getElementById("ghOff").addEventListener("click", function(){
  confirmDlg("Synchronisation trennen?", "Der Token wird von diesem Gerät entfernt. Deine Daten bleiben hier und im Repository erhalten.", "Trennen", function(){
    gh = {repo:"", token:"", path:"bolus-daten.json", lastSync:0, lastError:"", warn:""}; saveGh(); renderGhForm(); setSync("nur auf diesem Gerät"); toast("Getrennt");
  });
});
window.addEventListener("online", function(){ ghSync(); });

// ---------- Glukose-Sensor (eigener REST-Dienst) ----------
var CGM_KEY = "bolusrechner-cgm";
var cgm = {url:"", key:"", timeout:60, poll:150, last:null, lastError:"", lastOk:0};
var cgmTimer = null, cgmBusy = false;
var TREND = {doubleup:"⇈", singleup:"↑", fortyfiveup:"↗", flat:"→", fortyfivedown:"↘", singledown:"↓", doubledown:"⇊",
             "1":"⇈", "2":"↑", "3":"↗", "4":"→", "5":"↘", "6":"↓", "7":"⇊"};   // Dexcom liefert den Trend teils auch als Zahl
// Geheimnisse bereinigen: Leerzeichen, Zeilenumbrüche und unsichtbare Zeichen aus dem Einfügen entfernen
function cleanSecret(v){ return String(v||"").replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF]/g,""); }
function secretSummary(v){ v = cleanSecret(v); if(!v) return ""; if(v.length<10) return v.length+" Zeichen"; return v.length+" Zeichen, beginnt mit "+v.slice(0,3)+"…, endet auf …"+v.slice(-3); }
function renderSecretInfo(id, kind){
  var raw = document.getElementById(id).value, v = cleanSecret(raw), info = document.getElementById(id+"Info");
  var msg = secretSummary(raw), warn = false;
  if(raw && raw!==v){ msg += " (Leerzeichen/unsichtbare Zeichen werden entfernt)"; }
  if(kind==="cgm" && /^(github_pat_|ghp_)/.test(v)){ msg = "Achtung: Das ist ein GitHub-Token, kein API-Schlüssel."; warn = true; }
  if(kind==="gh" && v && !/^(github_pat_|ghp_)/.test(v)){ msg += " – sieht nicht wie ein GitHub-Token aus"; warn = true; }
  info.textContent = msg; info.classList.toggle("warn", warn);
}
document.querySelectorAll(".secretwrap .eye").forEach(function(b){
  b.setAttribute("aria-pressed","false");
  b.addEventListener("click", function(){
    var i = document.getElementById(b.dataset.for), show = i.classList.contains("masked");
    i.classList.toggle("masked", !show); b.setAttribute("aria-pressed", String(show));
    if(show) setTimeout(function(){ if(!i.classList.contains("masked")){ i.classList.add("masked"); b.setAttribute("aria-pressed","false"); } }, 30000);
  });
});
document.getElementById("cgmKey").addEventListener("input", function(){ renderSecretInfo("cgmKey","cgm"); });
document.getElementById("ghToken").addEventListener("input", function(){ renderSecretInfo("ghToken","gh"); });
var CGM_STALE_MIN = 15;   // älter: grau anzeigen und nicht in den Rechner übernehmen
function loadCgm(){ try{ var o = JSON.parse(localStorage.getItem(CGM_KEY)||"null"); if(o) for(var k in o) cgm[k]=o[k]; }catch(e){} }
function saveCgm(){ try{ localStorage.setItem(CGM_KEY, JSON.stringify(cgm)); }catch(e){} }
function cgmReady(){ return /^https?:\/\//i.test(cgm.url||""); }
function cgmAgeMin(){ return cgm.last ? (Date.now()-cgm.last.time)/60000 : Infinity; }
function cgmFresh(){ return cgm.last && cgmAgeMin() <= CGM_STALE_MIN; }
var cgmGen = 0, cgmCtrl = null;
// force = true: laufenden Abruf abbrechen und mit den aktuellen Einstellungen neu starten
async function fetchCgm(force){
  if(!cgmReady()) return;
  if(cgmBusy && !force) return;
  if(cgmBusy && cgmCtrl) cgmCtrl.abort();
  var gen = ++cgmGen;
  cgmBusy = true; renderCgm("busy");
  var ctrl = (typeof AbortController!=="undefined") ? new AbortController() : null; cgmCtrl = ctrl;
  var to = setTimeout(function(){ if(ctrl) ctrl.abort(); }, Math.max(5, +cgm.timeout||60)*1000);
  var url = cgm.url, k = cleanSecret(cgm.key);
  try{
    var hdr = {"Accept":"application/json"};
    if(k) hdr["X-Api-Key"] = k;   // nur mitsenden, wenn eingetragen
    var res = await fetch(url, {cache:"no-store", signal: ctrl ? ctrl.signal : undefined, headers:hdr});
    if(gen!==cgmGen) return;      // inzwischen durch neueren Abruf ersetzt – Ergebnis verwerfen
    if(res.status===401 || res.status===403) throw new Error(k ? "Schlüssel ungültig (gesendet: "+secretSummary(k)+")" : "Schlüssel fehlt – im Feld „API-Schlüssel“ ist nichts gespeichert");
    if(!res.ok) throw new Error("Fehler "+res.status);
    var j = await res.json();
    if(gen!==cgmGen) return;
    var v = Number(j.value), t = Number(j.time);
    if(j.success!==true || !isFinite(v) || v<20 || v>600 || !isFinite(t)) throw new Error("Antwort ungültig");
    cgm.last = {value:Math.round(v), trend:String(j.trend||"").toLowerCase(), time:t};
    cgm.lastError = ""; cgm.lastOk = Date.now(); saveCgm();
    applyCgmToBz();
  }catch(e){
    if(gen!==cgmGen) return;
    cgm.lastError = (e && e.name==="AbortError") ? "Zeitüberschreitung ("+cgm.timeout+" s)" :
      (e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message)) ? e.message : "keine Verbindung (Internet oder CORS)";
    saveCgm();
  }finally{
    clearTimeout(to);
    if(gen===cgmGen){ cgmBusy = false; cgmCtrl = null; renderCgm(); }
  }
}
function applyCgmToBz(){
  var i = document.getElementById("bz");
  if(!cgmFresh() || ui.bzDirty) { renderBzSrc(); return; }
  if(document.activeElement === i) return;          // nie überschreiben, während das Feld bearbeitet wird
  if(i.value.trim() && !ui.bzFromCgm) return;
  i.value = String(cgm.last.value); ui.bzFromCgm = true;
  renderBzSrc(); renderCalc();
}
function renderBzSrc(){
  var e = document.getElementById("bzSrc"); e.innerHTML = "";
  if(ui.bzFromCgm && cgm.last){ e.textContent = "vom Sensor, "+hhmm(new Date(cgm.last.time)); return; }
  // eigener Wert eingetragen: aktuellen Sensorwert zum Übernehmen anbieten
  if(ui.bzDirty && cgmFresh() && String(cgm.last.value) !== document.getElementById("bz").value.trim()){
    var b = el("button",{type:"button",class:"linkbtn"}, "Sensor "+cgm.last.value+" übernehmen");
    b.addEventListener("click", function(){ ui.bzDirty = false; ui.bzFromCgm = false; document.getElementById("bz").value = ""; applyCgmToBz(); });
    e.appendChild(b);
  }
}
function renderCgm(mode){
  var box = document.getElementById("cgm");
  box.classList.toggle("hidden", !cgmReady());
  var st = document.getElementById("cgmStatus");
  if(!cgmReady()){ if(st) st.textContent = "Nicht eingerichtet."; return; }
  var L = cgm.last;
  document.getElementById("cgmVal").textContent = L ? String(L.value) : "–";
  document.getElementById("cgmArrow").textContent = L ? (TREND[L.trend]||"?") : "";
  document.getElementById("cgmTime").textContent = L ? hhmm(new Date(L.time)) : "";
  box.classList.toggle("stale", !!L && !cgmFresh());
  box.classList.toggle("low", !!L && cgmFresh() && L.value < 70);
  box.classList.toggle("high", !!L && cgmFresh() && L.value > 180);
  box.classList.toggle("err", !!cgm.lastError);
  box.title = cgm.lastError ? "Sensor: "+cgm.lastError : "Sensorwert";
  if(st){
    st.style.color = cgm.lastError ? "var(--red)" : "";
    st.textContent = mode==="busy" ? "Rufe ab …" :
      cgm.lastError ? "Fehler: "+cgm.lastError+(L ? " – letzter Wert "+L.value+" mg/dl von "+hhmm(new Date(L.time)) : "") :
      L ? "Letzter Wert: "+L.value+" mg/dl "+(TREND[L.trend]||"")+" von "+new Date(L.time).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})+(cgmFresh()?"":" (älter als "+CGM_STALE_MIN+" Min.)") : "Noch kein Wert abgerufen.";
  }
}
function startCgmPolling(){
  clearInterval(cgmTimer); cgmTimer = null;
  if(!cgmReady()) return;
  cgmTimer = setInterval(function(){ if(!document.hidden) fetchCgm(); }, Math.max(30, +cgm.poll||150)*1000);
}
function renderCgmForm(){
  document.getElementById("cgmUrl").value = cgm.url||"";
  document.getElementById("cgmKey").value = cgm.key||"";
  renderSecretInfo("cgmKey","cgm");
  document.getElementById("cgmTimeout").value = String(cgm.timeout||60);
  document.getElementById("cgmPoll").value = String(cgm.poll||150);
  renderCgm();
}
function cgmFormError(msg){ var st=document.getElementById("cgmStatus"); st.style.color="var(--red)"; st.textContent="Nicht gespeichert: "+msg; toast(msg); }
// übernimmt die Werte aus dem Formular; true = gespeichert
function saveCgmForm(){
  var u = document.getElementById("cgmUrl").value.trim();
  var to = num(document.getElementById("cgmTimeout").value), po = num(document.getElementById("cgmPoll").value);
  var key = cleanSecret(document.getElementById("cgmKey").value);
  if(!/^https:\/\//i.test(u)){ cgmFormError("Bitte eine https-Adresse eingeben"); return false; }
  if(!(to>=5 && to<=120)){ cgmFormError("Timeout: 5 bis 120 Sekunden"); return false; }
  if(!(po>=30 && po<=3600)){ cgmFormError("Polling: 30 bis 3600 Sekunden"); return false; }
  if(/^(github_pat_|ghp_)/.test(key)){ cgmFormError("Das ist ein GitHub-Token, kein API-Schlüssel"); return false; }
  cgm.url = u; cgm.key = key; cgm.timeout = Math.round(to); cgm.poll = Math.round(po); cgm.lastError = ""; saveCgm();
  renderSecretInfo("cgmKey","cgm");
  return true;
}
document.getElementById("cgmSave").addEventListener("click", function(){
  if(!saveCgmForm()) return;
  startCgmPolling(); fetchCgm(true).then(function(){ toast(cgm.lastError ? "Abruf fehlgeschlagen" : "Sensor verbunden"); });
});
document.getElementById("cgmNow").addEventListener("click", function(){
  if(!saveCgmForm()) return;   // auch hier die aktuellen Feldwerte verwenden
  fetchCgm(true);
});
document.getElementById("cgmOff").addEventListener("click", function(){
  confirmDlg("Sensor-Anbindung entfernen?", "URL, API-Schlüssel und letzter Wert werden von diesem Gerät gelöscht.", "Entfernen", function(){
    clearInterval(cgmTimer); cgm = {url:"", key:"", timeout:60, poll:150, last:null, lastError:"", lastOk:0}; saveCgm(); renderCgmForm(); toast("Entfernt");
  });
});
document.getElementById("cgm").addEventListener("click", function(){ if(cgmReady()) fetchCgm(true); });

// ---------- Events ----------
function nowForInput(){ var d=new Date(); document.getElementById("injT").value = hhmm(d); }
// Jede eigene Eingabe (auch Löschen) sperrt die automatische Übernahme bis Speichern/Abbrechen
document.getElementById("bz").addEventListener("input", function(){ ui.bzDirty = true; ui.bzFromCgm = false; renderBzSrc(); renderCalc(); });
document.getElementById("ke").addEventListener("input", renderCalc);
var photoConversionInstalled = false;
document.getElementById("openCarbScannerBtn").addEventListener("click", function(){
  if(photoConversionInstalled) return;
  var scanner = window.CarbScanner;
  if(!scanner || !scanner.config){
    console.error("CarbScanner ist nicht initialisiert.");
    return;
  }
  var previousOnApply = scanner.config.onApply;
  scanner.config.targetInputSelector = null;
  scanner.config.onApply = function(result){
    var keInput = document.getElementById("ke");
    keInput.value = String(result.totalCarbs / 10);
    keInput.dispatchEvent(new Event("input", {bubbles:true}));
    keInput.dispatchEvent(new Event("change", {bubbles:true}));
    if(typeof previousOnApply === "function") previousOnApply(result);
  };
  photoConversionInstalled = true;
});
document.getElementById("kePick").addEventListener("click", pickFoodDlg);
document.getElementById("clearLocalLog").addEventListener("click", function(){
  if(!state.injections.length) return;
  var count = state.injections.length;
  var syncNote = ghReady()
    ? " Die GitHub-Synchronisation bleibt unverändert; synchronisierte Einträge können beim nächsten Abgleich zurückkehren."
    : "";
  confirmDlg(
    "Lokalen Verlauf leeren?",
    count+" Verlaufseinträge werden nur auf diesem Gerät gelöscht."+syncNote,
    "Lokal leeren",
    function(){
      state.injections = [];
      saveLocal();
      renderAll();
      toast("Lokaler Verlauf geleert");
    }
  );
});
document.querySelectorAll(".kebtns button").forEach(function(b){ b.addEventListener("mousedown", function(e){ e.preventDefault(); }); b.addEventListener("click", function(){
  var i = document.getElementById("ke"); var a = i.selectionStart!=null ? i.selectionStart : i.value.length, z = i.selectionEnd!=null ? i.selectionEnd : i.value.length;
  i.value = i.value.slice(0,a) + b.dataset.ins + i.value.slice(z); i.focus(); try{ i.setSelectionRange(a+1,a+1); }catch(e){} renderCalc();
}); });
function resetEntry(){
  ["bz","ke","injU"].forEach(function(id){ var i=document.getElementById(id); i.value=""; i.classList.remove("missing"); });
  document.getElementById("keHint").textContent=""; ui.calcItems=[];
  ui.injUDirty=false; ui.slotManual=false; ui.bzDirty=false; ui.bzFromCgm=false;
  nowForInput(); applyCgmToBz(); renderSlots(); renderCalc();
}
document.getElementById("injCancel").addEventListener("click", function(){
  var any = ["bz","ke","injU"].some(function(id){ return document.getElementById(id).value.trim(); });
  if(!any){ resetEntry(); return; }
  confirmDlg("Eingaben verwerfen?", "BZ, KE und gespritzte IE werden geleert. Gespeicherte Einträge bleiben erhalten.", "Verwerfen", function(){ resetEntry(); toast("Eingaben verworfen"); });
});
document.getElementById("injSave").addEventListener("click", function(){
  var u = evalExpr(document.getElementById("injU").value);
  // BZ und KE kommen direkt aus dem Rechner oben
  var keEat = evalExpr(document.getElementById("ke").value); if(!isFinite(keEat) || keEat<0) keEat = 0;
  var bzIn = evalExpr(document.getElementById("bz").value); if(!isFinite(bzIn) || bzIn<=0) bzIn = 0;
  if(!isFinite(u) || u<0) u = 0;
  if(u<=0 && keEat<=0){ toast("Bitte gespritzte IE oder gegessene KE eingeben"); return; }
  if(!(bzIn>0)){ toast("Bitte oben den BZ eingeben"); var bzf=document.getElementById("bz"); bzf.classList.add("missing"); bzf.scrollIntoView({block:"center"}); bzf.focus(); return; }
  if(u<=0){
    // Mahlzeit ohne Insulin: bewusst bestätigen lassen (z. B. vergessenes „Übernehmen“)
    var sg = calc(), val = sg.pct ? sg.suggPct : sg.sugg;
    document.getElementById("injU").classList.add("missing");
    confirmDlg("Wirklich ohne Insulin speichern?",
      "Im Feld „Gespritzt (IE)“ ist nichts eingetragen."+(val>0.05 ? " Der Vorschlag liegt bei "+fmt(val)+" IE." : "")+" Für eine reine Mahlzeit (z. B. Traubenzucker) bestätigen, sonst abbrechen und die Insulinmenge eintragen.",
      "Ohne Insulin speichern", function(){ document.getElementById("injU").classList.remove("missing"); saveEntry(u, keEat, bzIn); });
    return;
  }
  saveEntry(u, keEat, bzIn);
});
function saveEntry(u, keEat, bzIn){
  var tv = document.getElementById("injT").value || hhmm(new Date());
  var now = new Date(); var d = new Date(now); var p = tv.split(":"); d.setHours(+p[0], +p[1], 0, 0);
  if(d.getTime() > now.getTime()+5*60000) d = new Date(d.getTime()-86400000);
  var rec = {id:uidGen(), up:Date.now(), t:d.getTime(), u:u, slot: state.settings.slots[ui.slot] ? state.settings.slots[ui.slot].name : ""};
  if(keEat>0){
    rec.ke = Math.round(keEat*100)/100;
    var keExpr = document.getElementById("ke").value.trim();
    if(isExpr(keExpr)) rec.keExpr = keExpr;
  }
  if(bzIn>0) rec.bz = Math.round(bzIn);
  var pctNow = num(state.settings.pct); if(isFinite(pctNow) && pctNow!==0 && u>0) rec.pct = pctNow;
  state.injections.push(rec);
  var cut = Date.now()-keepMs();
  state.injections = state.injections.filter(function(x){return x.t>=cut;}).sort(function(a,b){return a.t-b.t;});
  persist("injections");
  document.getElementById("injU").value=""; nowForInput();
  ui.injUDirty=false;
  document.getElementById("bz").value=""; document.getElementById("ke").value=""; document.getElementById("keHint").textContent="";
  ui.bzDirty=false; ui.bzFromCgm=false; applyCgmToBz();
  ui.basket=[]; renderBasket();
  ui.slotManual=false;
  renderAll(); toast((u>0?fmt(u)+" IE":fmt(keEat)+" KE")+" um "+hhmm(d)+" gespeichert");
  setTimeout(function(){ window.scrollTo(0,0); }, 3000);
}
document.getElementById("injU").addEventListener("input", function(e){ e.target.classList.remove("missing"); ui.injUDirty = true; renderCalc(); });
document.getElementById("foodSearch").addEventListener("input", renderFoods);
document.getElementById("foodNew").addEventListener("click", function(){ foodDlg(null); });
document.getElementById("basketClear").addEventListener("click", function(){ ui.basket=[]; renderBasket(); });
document.getElementById("basketUse").addEventListener("click", function(){
  if(!ui.basket.length){ toast("Noch nichts hinzugefügt"); return; }
  document.getElementById("ke").value = fmt(ui.basketSum);
  show("calc"); renderCalc(); toast(fmt(ui.basketSum)+" KE übernommen");
});
document.getElementById("recipeAdd").addEventListener("click", function(){ ui.recipe.push({n:"",g:"",kh:""}); renderRecipe(); });
document.getElementById("recipePieces").addEventListener("input", updRecipeTotals);
document.getElementById("recipeSave").addEventListener("click", function(){
  var pcs = num(document.getElementById("recipePieces").value), nm = document.getElementById("recipeName").value.trim();
  if(!nm){ toast("Bitte einen Namen eingeben"); return; }
  if(!(pcs>0) || !(ui.recipeTotal>0)){ toast("Bitte Zutaten und Stückzahl eingeben"); return; }
  state.foods.push({id:uidGen(), name:nm, unit:"Stück", ke:Math.round(ui.recipeTotal/pcs*100)/100, note:fmt(ui.recipeTotal)+" KE ÷ "+pcs+" Stück"});
  persist("foods"); renderFoods(); toast(nm+" gespeichert");
});
function setPct(v){ state.settings.pct = v; persist("settings"); renderPct(); renderCalc(); }
function renderPct(){
  var v = num(state.settings.pct); if(!isFinite(v)) v=0;
  var i = document.getElementById("pct"); if(document.activeElement!==i) i.value = (v>0?"+":"")+fmt(v,0);
  var f = i.closest(".pctfield"); f.classList.toggle("plus", v>0); f.classList.toggle("minus", v<0);
}
document.getElementById("pct").addEventListener("input", function(e){ var v=num(e.target.value.replace("+","")); if(isFinite(v)){ state.settings.pct=v; persist("settings"); var f=e.target.closest(".pctfield"); f.classList.toggle("plus",v>0); f.classList.toggle("minus",v<0); renderCalc(); } });
document.getElementById("pct").addEventListener("change", renderPct);
document.getElementById("pctMinus").addEventListener("click", function(){ setPct((num(state.settings.pct)||0)-5); });
document.getElementById("pctPlus").addEventListener("click", function(){ setPct((num(state.settings.pct)||0)+5); });
document.getElementById("refBolus").addEventListener("change", function(e){ var v=num(e.target.value); if(v>0){ state.settings.refBolus=v; persist("settings"); renderSettings(); renderIOB(); renderCalc(); } else { e.target.value=fmt(state.settings.refBolus,1); toast("Bitte eine Zahl größer 0 eingeben"); } });
// nur die Einstellungen des gewählten IOB-Algorithmus anzeigen
function renderAlgo(){
  var m = state.settings.model;
  document.getElementById("algoProfile").classList.toggle("hidden", m!=="profile");
  document.getElementById("algoJ").classList.toggle("hidden", m!=="juggluco");
  document.getElementById("algoExp").classList.toggle("hidden", m!=="exp");
}
function renderExp(){
  var S = state.settings, e = S.exp, sel = document.getElementById("expPreset");
  if(!sel.options.length) Object.keys(EXP_PRESETS).forEach(function(k){ sel.appendChild(el("option",{value:k}, EXP_PRESETS[k].label)); });
  sel.value = e.preset in EXP_PRESETS ? e.preset : "custom";
  var pk = document.getElementById("expPeak"), du = document.getElementById("expDur");
  if(document.activeElement!==pk) pk.value = fmt(e.peak,0); if(document.activeElement!==du) du.value = fmt(e.dur,0);
  var tb = document.querySelector("#cmpTable tbody"); tb.innerHTML="";
  [30,60,90,120,180,240,300].forEach(function(m){
    var tr = el("tr"); tr.appendChild(el("td",{class:"num"}, String(m)));
    ["profile","juggluco","exp"].forEach(function(k){ tr.appendChild(el("td",{class:"num"}, fmt(100*fracFor(k)(m),0)+" %")); });
    tb.appendChild(tr);
  });
}
function applyExp(peak, dur, preset){
  var msg = document.getElementById("expMsg");
  if(!(peak>0) || !(dur>0)){ msg.style.color="var(--red)"; msg.textContent="Bitte Zahlen größer 0 eingeben."; return false; }
  if(peak >= dur/2){ msg.style.color="var(--red)"; msg.textContent="Das Wirkmaximum muss kleiner als die halbe Wirkdauer sein."; return false; }
  if(dur < 120 || dur > 600){ msg.style.color="var(--red)"; msg.textContent="Die Wirkdauer muss zwischen 120 und 600 Minuten liegen."; return false; }
  msg.textContent = "";
  state.settings.exp = {preset:preset, peak:peak, dur:dur};
  persist("settings"); renderExp(); renderIOB(); renderCalc(); renderRecent(); renderLog();
  return true;
}
document.getElementById("expPreset").addEventListener("change", function(e){
  var k = e.target.value, p = EXP_PRESETS[k], cur = state.settings.exp;
  if(k==="custom"){ applyExp(cur.peak, cur.dur, "custom"); return; }
  var dur = cur.dur; if(!(p.peak < dur/2)) dur = p.dur;   // eigene Wirkdauer beibehalten
  applyExp(p.peak, dur, k);
});
["expPeak","expDur"].forEach(function(id){
  document.getElementById(id).addEventListener("change", function(){
    var pk = num(document.getElementById("expPeak").value), du = num(document.getElementById("expDur").value);
    var e = state.settings.exp, preset = e.preset;
    if(preset!=="custom" && (pk!==EXP_PRESETS[preset].peak)) preset = "custom";
    if(!applyExp(pk, du, preset)){ /* ungültig: Felder bleiben zur Korrektur stehen */ }
  });
});
document.getElementById("keepDays").addEventListener("change", function(e){
  var v = Math.round(num(e.target.value));
  if(!(v>=1 && v<=365)){ toast("Bitte 1 bis 365 Tage eingeben"); e.target.value = String(state.settings.keepDays||3); return; }
  var old = state.settings.keepDays||3;
  function apply(){ state.settings.keepDays = v; document.getElementById("keepDays").value = String(v); persist("settings"); renderLog(); toast("Verlauf: "+v+" Tage"); }
  if(v < old && state.injections.some(function(x){ return x.t < Date.now()-v*86400000; })){
    confirmDlg("Ältere Einträge entfernen?", "Einträge, die älter als "+v+" Tage sind, werden beim nächsten Speichern bzw. Abgleich gelöscht – auf allen synchronisierten Geräten.", "Übernehmen", apply);
    e.target.value = String(old);
    return;
  }
  apply();
});
document.getElementById("modelSel").addEventListener("change", function(e){ state.settings.model = e.target.value; ui.model = e.target.value; persist("settings"); renderAlgo(); renderIOB(); renderCalc(); renderRecent(); renderLog(); });
document.getElementById("stepSel").addEventListener("change", function(e){ state.settings.step = +e.target.value; persist("settings"); renderCalc(); });
document.querySelectorAll(".seg button").forEach(function(b){ b.addEventListener("click", function(){ ui.model = b.dataset.model; renderIOB(); renderCalc(); renderRecent(); renderLog(); }); });
document.getElementById("profAdd").addEventListener("click", function(){
  var p = state.settings.profile; var m = 60;
  while(p.some(function(x){return x[0]===m;})) m+=5;
  p.push([m, Math.round(fracProfile(m)*state.settings.refBolus*10)/10]);
  persist("settings"); renderSettings(); toast("Punkt bei "+m+" Min. angelegt, bitte Wert anpassen");
});
document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("localExportBtn").addEventListener("click", exportLocalStorage);
document.getElementById("localImportFile").addEventListener("change", function(){
  var file = this.files && this.files[0];
  if(!file) return;
  var input = this;
  localBackupStatus("Datei wird gelesen...");
  var reader = new FileReader();
  reader.onload = async function(){
    try{
      var payload = await readLocalBackup(String(reader.result));
      confirmLocalImport(payload);
    }catch(e){
      if(e && e.message === "password"){
        toast("Für diese verschlüsselte Sicherung ist ein Passwort erforderlich");
        localBackupStatus("Passwort eingeben und Datei erneut auswählen.");
      }else if(e && e.message === "unsupported"){
        toast("Verschlüsselung wird in diesem Browser nicht unterstützt");
        localBackupStatus("Öffne die App über HTTPS.");
      }else if(e && (e.name === "OperationError" || e.message === "invalid")){
        toast("Passwort falsch oder Sicherung ungültig");
        localBackupStatus("Wiederherstellung fehlgeschlagen.");
      }else{
        toast("Diese Datei konnte nicht gelesen werden");
        localBackupStatus("Wiederherstellung fehlgeschlagen.");
      }
    }finally{
      input.value = "";
    }
  };
  reader.readAsText(file);
});
document.getElementById("slotAdd").addEventListener("click", function(){
  var S = state.settings, base = S.slots[ui.slot] || S.slots[0];
  S.slots.push({name:"Zwischenmahlzeit", from:hhmm(new Date()).slice(0,3)+"00", ziel:base.ziel, korr:base.korr, ke:base.ke});
  persist("settings"); renderSettings(); renderSlots(); toast("Tageszeit angelegt, Werte bitte prüfen");
});
document.getElementById("backupNow").addEventListener("click", exportData);
document.getElementById("importBtn").addEventListener("click", importData);

function show(v){
  ui.view = v;
  ["calc","food","log","set","key"].forEach(function(n){ document.getElementById("view-"+n).classList.toggle("hidden", n!==v); });
  document.querySelectorAll("nav button").forEach(function(b){ if(b.dataset.view===v) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  if(v==="log") renderLog();
  window.scrollTo(0,0);
}
document.querySelectorAll("nav button").forEach(function(b){ b.addEventListener("click", function(){ show(b.dataset.view); }); });

function renderAll(){ renderBackup(); renderIOB(); renderSlots(); renderCalc(); renderRecent(); renderLog(); renderFoods(); renderBasket(); renderSettings(); }

// ---------- Start ----------
document.getElementById("appVersion").textContent = "v" + APP_VERSION;
loadLocal();
loadGh();
loadCgm();
if(window.BolusStorage){
  var apiConfig = BolusStorage.loadApiConfig();
  Object.keys(BolusStorage.fieldKeys).forEach(function(fieldId){
    var field = document.getElementById(fieldId);
    if(field) field.value = apiConfig[fieldId] || "";
  });
  document.querySelectorAll(".eye-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var input = document.getElementById(btn.getAttribute("data-target"));
      if(!input) return;
      var isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.textContent = isHidden ? "🙈" : "👁";
    });
  });
  var saveKeysButton = document.getElementById("saveKeysBtn");
  if(saveKeysButton){
    saveKeysButton.addEventListener("click", function(){
      var values = {};
      Object.keys(BolusStorage.fieldKeys).forEach(function(fieldId){
        var field = document.getElementById(fieldId);
        values[fieldId] = field ? field.value : "";
      });
      BolusStorage.saveApiConfig(values);
      var feedback = document.getElementById("saveFeedback");
      if(feedback){
        feedback.hidden = false;
        setTimeout(function(){ feedback.hidden = true; }, 2500);
      }
      toast("API-Konfiguration gespeichert");
    });
  }
}
ui.model = state.settings.model;
nowForInput();
renderRecipe();
renderAll();
renderGhForm();
renderCgmForm();
startCgmPolling();
fetchCgm();
if(window.CarbScanner){
  window.CarbScanner.init({
    triggerSelector:"#openCarbScannerBtn",
    targetInputSelector:"#mainCarbsInput",
    groqKeyStorageName:"carbs_groq_api_key",
    geminiKeyStorageName:"carbs_gemini_api_key",
    customUrlStorageName:"carbs_custom_api_url",
    customKeyStorageName:"carbs_custom_api_key",
    customModelStorageName:"carbs_custom_api_model"
  });
}
setInterval(function(){ renderCgm(); }, 60000);   // Uhrzeit/Alter der Anzeige aktuell halten
ghSync();
setInterval(function(){ if(!document.hidden) ghSync(); }, 120000);
if("serviceWorker" in navigator && (location.protocol==="https:" || location.hostname==="localhost" || location.hostname==="127.0.0.1")){ navigator.serviceWorker.register("sw.js?v="+APP_VERSION).catch(function(){}); }
setInterval(function(){ renderIOB(); renderRecent(); renderCalc(); if(!ui.slotManual) renderSlots(); }, 30000);
window.addEventListener("pageshow", function(e){ if(e.persisted) fetchCgm(); });
document.addEventListener("visibilitychange", function(){ if(!document.hidden){ fetchCgm(); ghSync(); nowForInput(); renderIOB(); renderRecent(); renderCalc(); renderSlots(); } });
})();