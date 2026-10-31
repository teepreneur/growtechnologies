/* GrowTech farm engine: three.js scene + day/night energy simulation for one scaffold module.
   Shared by the website and the funding 3D page. Needs three@0.128.0 and its OrbitControls loaded first.
   Energy figures are planning assumptions from docs/plan.md. */
(function(){
"use strict";

/* ---------- Assumptions (team solar plan, Oct 2026) ---------- */
const PSH = {sunny:5, typical:4, cloudy:2.5, rainy:1};
const PANEL_W = 450, DERATE = 0.75;
const LOADS = {pump:20, esp:3, leds:60, fans:10};
const LED_ON = [15,23], FAN_ON = [8,20];
const SHED = {fanOff:35, fanOn:50, ledOff:20, ledOn:35, bmsOn:10};
const NOMINAL_V = 25.6;

function solarW(t, wx){
  if (t <= 6 || t >= 18) return 0;
  const peak = PANEL_W * DERATE * PSH[wx] / (24/Math.PI); // integral of sin over 12 h = 24/pi h
  return peak * Math.sin(Math.PI * (t - 6) / 12);
}
function inWin(t, w){ return t >= w[0] && t < w[1]; }
function battV(soc){
  const pts = [[0,24.0],[0.05,24.8],[0.1,25.6],[0.2,25.8],[0.3,26.0],[0.5,26.2],[0.7,26.4],[0.9,26.8],[1,27.2]];
  for (let i=1;i<pts.length;i++) if (soc <= pts[i][0]) { const a=pts[i-1], b=pts[i]; return a[1]+(b[1]-a[1])*(soc-a[0])/(b[0]-a[0]); }
  return 27.2;
}

function createSim(){
  const S = {T:6, soc:0.7, ah:100, wx:'typical', speed:30, playing:true,
    fansOk:true, ledsOk:true, bms:false, todaySolar:0, todayLoad:0, last:null, hist:[]};
  function step(dtH){
    const t = S.T % 24, pct = S.soc*100;
    if (S.fansOk && pct < SHED.fanOff) S.fansOk = false;
    if (!S.fansOk && pct > SHED.fanOn) S.fansOk = true;
    if (S.ledsOk && pct < SHED.ledOff) S.ledsOk = false;
    if (!S.ledsOk && pct > SHED.ledOn) S.ledsOk = true;
    if (!S.bms && S.soc <= 0.0005) S.bms = true;
    if (S.bms && pct > SHED.bmsOn) S.bms = false;
    const ledSched = inWin(t, LED_ON), fanSched = inWin(t, FAN_ON);
    const on = {pump:!S.bms, esp:!S.bms, leds:!S.bms && ledSched && S.ledsOk, fans:!S.bms && fanSched && S.fansOk};
    let load = 0; for (const k in on) if (on[k]) load += LOADS[k];
    const avail = solarW(t, S.wx), cap = S.ah * NOMINAL_V;
    let net = avail - load, harvest = avail;
    if (net > 0){
      const ch = Math.min(net*dtH, (1 - S.soc) * cap);
      S.soc += ch / cap;
      harvest = load + (dtH>0 ? ch/dtH : 0);
      net = dtH>0 ? ch/dtH : 0;
    } else S.soc += net*dtH / 0.95 / cap;
    S.soc = Math.max(0, Math.min(1, S.soc));
    S.todaySolar += harvest*dtH; S.todayLoad += load*dtH;
    S.last = {avail, harvest, load, net, on, ledSched, fanSched};
  }
  function advance(hours){
    let left = hours;
    while (left > 1e-9){
      const d = Math.min(left, 1/60), before = S.T;
      step(d); S.T += d; left -= d;
      if (Math.floor(before/24) !== Math.floor(S.T/24)) { S.todaySolar = 0; S.todayLoad = 0; }
      if (Math.floor(before*6) !== Math.floor(S.T*6)) {
        S.hist.push({T:S.T, sun:S.last.harvest, load:S.last.load, soc:S.soc});
        while (S.hist.length && S.hist[0].T < S.T - 48) S.hist.shift();
      }
    }
  }
  function prefill(startSoc, endT){
    S.hist = []; S.T = endT - 48; S.soc = startSoc; S.fansOk = S.ledsOk = true; S.bms = false;
    advance(48); S.todaySolar = 0; S.todayLoad = 0;
    const mid = Math.floor(S.T/24)*24;
    for (const h of S.hist) if (h.T > mid) { S.todaySolar += h.sun/6; S.todayLoad += h.load/6; }
  }
  function scenario(name){
    if (name==='typical'){ S.wx='typical'; S.speed=30; prefill(0.62, 24*2+6); }
    if (name==='cloudy'){ S.wx='cloudy'; S.speed=480; prefill(0.7, 24*2+6); }
    if (name==='low'){ S.wx='typical'; S.speed=30; prefill(0.5, 24*2+17); S.soc=0.38; }
    S.playing = true;
  }
  return {S, step, advance, prefill, scenario};
}

/* ---------- Parts ---------- */
const PARTS = {
  panel:{name:"Solar panel on top", role:"Makes the power", does:"Sits on top of the stack like a roof, so it takes no extra floor space. It turns sunlight into DC power. Its voltage can reach 45–50 V, so it always goes through the charge controller, never straight to the farm.", spec:"~450 W mono half-cut panel per module, tilted ~12°"},
  rack:{name:"Scaffold module", role:"Grows up and out", does:"A scaffolding frame of standard tubes and couplers. Modules join side by side or stack on top of each other, so a farm can be as large and as high as the site allows.", spec:"One module ~2.1 m × 1.1 m × 1.8 m, 4 tiers (indicative size)"},
  tray:{name:"Grow channels", role:"Where crops grow", does:"Plants sit in net pots. A thin film of nutrient water flows past the roots and drains back to the tank. No soil, so the farm is clean and suits leafy greens and herbs.", spec:"4 channels per tier · 32 plant sites per tier in this model"},
  leds:{name:"LED grow lights", role:"Extends the growing day", does:"Add light in the evening and on cloudy days, and under the panel roof. The controller switches them off second when the battery is low.", spec:"~60 W per module, example schedule 15:00–23:00 (assumption)"},
  fans:{name:"Circulation fans", role:"Keeps plants cool", does:"Move air around the leaves to cool them, strengthen stems and reduce mould. The first load the controller switches off when the battery is low.", spec:"~10 W per module, example schedule 08:00–20:00 (assumption)"},
  tank:{name:"Nutrient tank and pump", role:"Feeds the plants", does:"The 24 V pump lifts nutrient water to every tier; it drains back to the tank by gravity in a closed loop. The tank sits at the far end from the power cabinet.", spec:"Pump ~20 W, runs all day (assumption)"},
  wiring:{name:"Power cabinet", role:"Power in a small space", does:"A lockable cabinet on the end of the frame holds the battery, charge controller and ESP32. The power system takes almost no floor space and the cable from the panel above is short.", spec:"6 / 10 / 16 mm² cable · 32 A PV breaker · 40 A and 60 A fuses · frame earthed"},
  mppt:{name:"MPPT charge controller", role:"Manages charging", does:"Pulls the most power from the panel as the light changes and charges the battery at the right voltages for LiFePO4. It only runs with the battery connected.", spec:"30–40 A, PV input ≥ 100 V · absorb 28.4 V, float 27.0 V"},
  battery:{name:"24 V LiFePO4 battery", role:"Stores the power", does:"Stores the daytime surplus so the farm runs at night and through cloudy spells. Its built-in BMS protects the cells. It sits at the bottom of the power cabinet, away from the water.", spec:"25.6 V, 100 Ah (2.56 kWh), or 50 Ah if tests allow · 60 A fuse within 20 cm of +"},
  control:{name:"ESP32 controller", role:"The farm's brain", does:"Measures battery voltage and current through an INA226 sensor and a shunt. It runs the pump and switches loads off in order when the battery is low: fans first, then LEDs. The pump always runs.", spec:"ESP32 + INA226 on 50 A / 75 mV shunt · MOSFET switches · IP65 box"}
};

/* ---------- Scene ---------- */
const L = 2.1, D = 1.1, H = 1.8, TIERS = [0.45, 0.8, 1.15, 1.5], CH_Z = [-0.36,-0.12,0.12,0.36], TILT = 12*Math.PI/180;
const SX = 2.6; // module spacing along a row (frame + power cabinet + gap)

function mount(opts){
  const THREE = window.THREE;
  const canvas = opts.canvas, host = opts.host || canvas.parentElement;
  const sim = createSim(), S = sim.S;
  const api = {S, sim, PARTS, ok:false};
  if (!THREE || !THREE.OrbitControls) return api;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true}); } catch(e){ return api; }
  api.ok = true;
  const V = (x,y,z)=>new THREE.Vector3(x,y,z);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16/10, 0.1, 300);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI*0.495; controls.minDistance = 1.2; controls.maxDistance = 26;
  if (opts.zoom === false) controls.enableZoom = false;

  const clickables = [], partGroups = {};
  const anim = {fanBlades:[], ledMats:[], ledLights:[], water:[], energy:{}, clouds:[]};
  const M = (color,o)=>new THREE.MeshStandardMaterial(Object.assign({color, roughness:0.7, metalness:0.05}, o||{}));
  function box(w,h,d,mat,x,y,z,parent){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m; }
  function cyl(r,h,mat,x,y,z,parent,seg){ const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,seg||16),mat); m.position.set(x,y,z); m.castShadow=true; parent.add(m); return m; }
  const UP = V(0,1,0);
  function rod(a,b,r,mat,parent){ const d=b.clone().sub(a), m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),10),mat); m.position.copy(a).addScaledVector(d,0.5); m.quaternion.setFromUnitVectors(UP,d.clone().normalize()); m.castShadow=true; parent.add(m); return m; }
  function group(key, parent){ const g=new THREE.Group(); parent.add(g); if(key){ g.userData.part=key; (partGroups[key]=partGroups[key]||[]).push(g); clickables.push(g);} return g; }
  function tube(points, r, mat, parent){ const c=new THREE.CatmullRomCurve3(points,false,'centripetal'); const m=new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(24,points.length*14), r, 8, false), mat); m.castShadow=true; parent.add(m); return m; }
  function canvasTex(w,h,draw){ const c=document.createElement('canvas'); c.width=w; c.height=h; draw(c.getContext('2d'),w,h); const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; t.anisotropy=4; t.userData={canvas:c}; return t; }
  function polyline(pts){ const segs=[]; let len=0; for(let i=1;i<pts.length;i++){ const l=pts[i].distanceTo(pts[i-1]); segs.push({a:pts[i-1],b:pts[i],l,s:len}); len+=l;} return {segs,L:len}; }
  function along(pl,u,out){ const d=((u%1)+1)%1*pl.L; for(const s of pl.segs){ if(d<=s.s+s.l) return out.copy(s.a).lerp(s.b,(d-s.s)/s.l);} return out.copy(pl.segs[pl.segs.length-1].b); }

  /* sky, light, ground */
  anim.hemi = new THREE.HemisphereLight(0xdcecff, 0x3b3328, 0.55); scene.add(anim.hemi);
  const sl = new THREE.DirectionalLight(0xfff1d6, 1.0); sl.castShadow = true; sl.shadow.mapSize.set(2048,2048);
  Object.assign(sl.shadow.camera, {left:-9,right:9,top:9,bottom:-9,near:1,far:90}); sl.shadow.bias = -0.0004;
  scene.add(sl); scene.add(sl.target); anim.sunLight = sl;
  scene.fog = new THREE.Fog(0x8fc6e8, 24, 80);
  anim.sun = new THREE.Mesh(new THREE.SphereGeometry(1.4,24,16), new THREE.MeshBasicMaterial({color:0xffe08a, fog:false})); scene.add(anim.sun);
  anim.moon = new THREE.Mesh(new THREE.SphereGeometry(0.8,20,14), new THREE.MeshBasicMaterial({color:0xdfe6f2, fog:false})); scene.add(anim.moon);
  { const sp=[]; for(let i=0;i<500;i++){ const a=Math.random()*Math.PI*2, e=Math.random()*Math.PI*0.45+0.08, r=60; sp.push(r*Math.cos(e)*Math.cos(a), r*Math.sin(e), r*Math.cos(e)*Math.sin(a)); }
    const sg=new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp,3));
    anim.stars = new THREE.Points(sg, new THREE.PointsMaterial({color:0xffffff, size:0.25, transparent:true, opacity:0, fog:false})); scene.add(anim.stars); }
  const cloudMat = new THREE.MeshStandardMaterial({color:0xffffff, roughness:1, transparent:true, opacity:0.9, fog:false});
  for (let i=0;i<9;i++){ const g=new THREE.Group(); for(let j=0;j<5;j++){ const s=new THREE.Mesh(new THREE.SphereGeometry(1+Math.random()*0.8,14,10), cloudMat); s.position.set(j*1.3-2.6, Math.random()*0.5, Math.random()*1.2); s.scale.y=0.6; g.add(s);} g.position.set(-30+i*7.5, 13+Math.random()*4, -20-Math.random()*14); g.userData.speed=0.15+Math.random()*0.2; scene.add(g); anim.clouds.push(g); }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(45,48), M(0x7d6c52,{roughness:1})); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const pad = box(10,0.04,4.4, M(0xa19d93,{roughness:0.95}), 0.2,0.02,0, scene); pad.castShadow=false;
  for (let i=0;i<50;i++){ const g=new THREE.Mesh(new THREE.ConeGeometry(0.05,0.18+Math.random()*0.12,4), M(0x5f8a3a,{roughness:1})); const a=Math.random()*Math.PI*2, r=6+Math.random()*8; g.position.set(Math.cos(a)*r,0.08,Math.sin(a)*r); scene.add(g); }

  /* ----- one module, built at the origin ----- */
  const mod = new THREE.Group(); scene.add(mod);
  const growPart = new THREE.Group(), basePart = new THREE.Group(), panelPart = new THREE.Group(), cabPart = new THREE.Group();
  mod.add(growPart, basePart, panelPart, cabPart);

  // scaffold frame
  const steel = M(0xa9b2b8,{metalness:0.7, roughness:0.35});
  const coupler = M(0x5b6266,{metalness:0.6, roughness:0.4});
  const rack = group('rack', growPart);
  const XS = [-L/2, 0, L/2], ZS = [-D/2, D/2], LEVELS = [0.1, ...TIERS.map(y=>y-0.05), H];
  for (const x of XS) for (const z of ZS){ rod(V(x,0,z), V(x,H,z), 0.024, steel, rack); box(0.12,0.012,0.12,coupler,x,0.006,z,rack); }
  for (const y of LEVELS){
    for (const z of ZS) rod(V(-L/2,y,z), V(L/2,y,z), 0.02, steel, rack);
    for (const x of XS) rod(V(x,y,-D/2), V(x,y,D/2), 0.02, steel, rack);
    for (const x of XS) for (const z of ZS) box(0.06,0.06,0.06,coupler,x,y,z,rack);
  }
  rod(V(-L/2,0.1,-D/2), V(0,H,-D/2), 0.016, steel, rack);
  rod(V(0,0.1,-D/2), V(L/2,H,-D/2), 0.016, steel, rack);

  // channels + plants (instanced)
  const trays = group('tray', growPart);
  const pvc = M(0xeef1ec,{roughness:0.5});
  for (const y of TIERS) for (const z of CH_Z) box(1.95,0.07,0.1,pvc,0,y,z,trays);
  const nPlants = TIERS.length*CH_Z.length*8;
  const potMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03,0.03,0.03,10), M(0x2a2f2b,{roughness:0.8}), nPlants);
  const leafMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035,10,8), M(0xffffff,{roughness:0.85}), nPlants*5);
  leafMesh.castShadow = true;
  const greens = [0x5aa83c,0x6fbf47,0x3f8f35,0x86c75a,0x4c9a3f].map(c=>new THREE.Color(c));
  const dummy = new THREE.Object3D(); let pi=0, li=0;
  TIERS.forEach((y,ti)=>CH_Z.forEach((z,ci)=>{ for(let k=0;k<8;k++){
    const x=-0.84+k*0.24;
    dummy.position.set(x,y+0.045,z); dummy.rotation.set(0,0,0); dummy.scale.set(1,1,1); dummy.updateMatrix(); potMesh.setMatrixAt(pi++, dummy.matrix);
    const sc=(0.75+0.08*ti+Math.random()*0.25)*1.3, col=greens[(ti*3+k+ci)%greens.length];
    for(let l=0;l<5;l++){ const a=l*1.26+Math.random()*0.3; dummy.position.set(x+Math.cos(a)*0.03*sc, y+0.07+(0.025+Math.random()*0.02)*sc, z+Math.sin(a)*0.03*sc); dummy.scale.set(1.2*sc,0.7*sc,1.2*sc); dummy.updateMatrix(); leafMesh.setMatrixAt(li, dummy.matrix); leafMesh.setColorAt(li++, col); }
  }}));
  trays.add(potMesh, leafMesh);

  // LED bars
  const leds = group('leds', growPart);
  for (const y of TIERS){
    const ly = y + 0.28;
    for (const z of [-0.2,0.2]){
      const mat = new THREE.MeshStandardMaterial({color:0x333333, emissive:0xffd9ef, emissiveIntensity:0, roughness:0.4});
      box(1.8,0.018,0.035,mat,0,ly,z,leds); anim.ledMats.push(mat);
      box(1.82,0.012,0.05,M(0x8d969b,{metalness:0.6}),0,ly+0.014,z,leds);
    }
    for (const x of [-0.5,0.5]){ const p = new THREE.PointLight(0xffd6ee, 0, 1.2, 2); p.position.set(x,ly-0.06,0); growPart.add(p); anim.ledLights.push(p); }
  }

  // fans on the back face
  const fans = group('fans', growPart);
  for (const y of [TIERS[1]+0.16, TIERS[3]+0.16]) for (const x of [-0.5,0.5]){
    const fg = new THREE.Group(); fg.position.set(x,y,-D/2-0.03); fans.add(fg);
    fg.add(new THREE.Mesh(new THREE.TorusGeometry(0.085,0.012,8,24), M(0x2b2f31)));
    const hub = cyl(0.02,0.04,M(0x2b2f31),0,0,0,fg,12); hub.rotation.x=Math.PI/2;
    const blades = new THREE.Group(); fg.add(blades);
    for (let b=0;b<5;b++){ const piv=new THREE.Group(); piv.rotation.z=b*Math.PI*2/5; const bl=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.07,0.006), M(0x3a4044)); bl.position.y=0.04; bl.rotation.y=0.4; piv.add(bl); blades.add(piv); }
    anim.fanBlades.push(blades);
  }

  // tank, pump, plumbing
  const tank = group('tank', basePart);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.3,0.28,0.7), new THREE.MeshStandardMaterial({color:0x2d6a86, transparent:true, opacity:0.45, roughness:0.3}));
  shell.position.set(-0.3,0.17,0); tank.add(shell);
  const water = new THREE.Mesh(new THREE.BoxGeometry(1.26,0.19,0.66), new THREE.MeshStandardMaterial({color:0x3a9fd8, transparent:true, opacity:0.7, roughness:0.15}));
  water.position.set(-0.3,0.13,0); tank.add(water);
  box(1.32,0.02,0.72,M(0x1e4b60),-0.3,0.04,0,tank);
  cyl(0.045,0.09,M(0x22282b),-0.6,0.09,-0.15,tank,16);
  const hose = M(0x1b2420,{roughness:0.6}), white = M(0xe9ece8,{roughness:0.5});
  tube([V(-0.6,0.13,-0.15),V(-0.6,0.36,-0.15),V(0.2,0.37,-0.4),V(0.96,0.38,-0.48),V(0.96,TIERS[3]+0.06,-0.48)],0.014,hose,tank);
  for (const y of TIERS) tube([V(0.96,y+0.06,-0.48),V(0.95,y+0.06,-0.2),V(0.95,y+0.06,0.36)],0.01,hose,tank);
  tube([V(-0.98,TIERS[3]+0.05,-0.48),V(-0.98,0.40,-0.48),V(-0.9,0.33,-0.38),V(-0.85,0.32,-0.3)],0.016,white,tank);
  for (const y of TIERS) tube([V(-0.96,y+0.03,0.36),V(-0.97,y+0.03,-0.2),V(-0.98,y+0.03,-0.48)],0.012,white,tank);
  { const wMat = new THREE.MeshBasicMaterial({color:0x6cc8ff}), wGeo = new THREE.SphereGeometry(0.012,8,6);
    for (let i=0;i<110;i++){
      const y = TIERS[i%4]+0.06, z = CH_Z[Math.floor(i/4)%4];
      const path = [V(-0.6,0.1,-0.15),V(-0.6,0.36,-0.15),V(0.96,0.38,-0.48),V(0.96,y,-0.48),V(0.94,y,z),V(-0.94,y-0.01,z),V(-0.98,y-0.03,-0.48),V(-0.98,0.38,-0.48),V(-0.85,0.32,-0.3),V(-0.85,0.12,-0.3)];
      const m = new THREE.Mesh(wGeo,wMat); mod.add(m); anim.water.push({m, path:polyline(path), u:Math.random()});
    } }

  // solar panel on top of the frame
  const panel = group('panel', panelPart);
  const cells = canvasTex(512,256,(c,w,h)=>{
    c.fillStyle='#0b1630'; c.fillRect(0,0,w,h);
    const cols=24, rows=6, cw=(w-6)/cols, ch=h/rows;
    for(let i=0;i<cols;i++) for(let j=0;j<rows;j++){ const x=i*cw+(i>=12?6:0); c.fillStyle='#18305e'; c.fillRect(x+1.5,j*ch+2,cw-3,ch-4); c.strokeStyle='rgba(190,205,235,.35)'; c.lineWidth=0.8; for(let b=1;b<=4;b++){ c.beginPath(); c.moveTo(x+1.5,j*ch+2+b*(ch-4)/5); c.lineTo(x+cw-1.5,j*ch+2+b*(ch-4)/5); c.stroke(); } }
    c.fillStyle='#cfd5dd'; c.fillRect(w/2-3,0,6,h);
  });
  const frameM = M(0xc7ccd1,{metalness:0.7, roughness:0.35});
  const pivot = new THREE.Group(); pivot.position.set(0,H+0.18,0); pivot.rotation.x = TILT; panel.add(pivot);
  const pm = new THREE.Mesh(new THREE.BoxGeometry(2.09,0.035,1.13), [frameM,frameM,new THREE.MeshStandardMaterial({map:cells, roughness:0.25, metalness:0.2}),M(0xe8e8e8),frameM,frameM]);
  pm.castShadow=true; pm.receiveShadow=true; pivot.add(pm);
  box(0.12,0.03,0.08,M(0x111111),0.85,-0.035,-0.2,pivot);
  for (const x of [-0.95,0,0.95]) for (const zs of [-1,1]){
    const zz = zs*0.5*Math.cos(TILT), top = H+0.18 - zs*0.5*Math.sin(TILT) - 0.02;
    rod(V(x,H,zz), V(x,top,zz), 0.016, steel, panel);
  }

  // power cabinet on the +x end
  const cab = group('wiring', cabPart);
  const cabM = M(0x55644f,{roughness:0.6, metalness:0.2});
  box(0.02,1.1,0.7,cabM,1.09,0.67,0,cab);
  box(0.32,1.1,0.02,cabM,1.24,0.67,-0.35,cab); box(0.32,1.1,0.02,cabM,1.24,0.67,0.35,cab);
  box(0.32,0.02,0.7,cabM,1.24,1.22,0,cab); box(0.32,0.02,0.7,cabM,1.24,0.12,0,cab);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.01,1.1,0.7), new THREE.MeshStandardMaterial({color:0xcfe3d6, transparent:true, opacity:0.16, roughness:0.1})); door.position.set(1.405,0.67,0); cab.add(door);
  for (const z of [-0.3,0.3]) box(0.04,0.12,0.04,coupler,1.24,0.06,z,cab);
  box(0.07,0.1,0.06,M(0xf3f3f0),1.13,0.72,-0.27,cab);              // PV breaker
  box(0.04,0.04,0.18,M(0x6e5a2a,{metalness:0.6}),1.13,0.62,0,cab);  // + busbar
  box(0.04,0.04,0.18,M(0x2a2a2a,{metalness:0.4}),1.13,0.56,0,cab);  // - busbar
  box(0.05,0.08,0.14,M(0x2d2d2f),1.13,0.66,0.22,cab);               // fuse box

  const mppt = group('mppt', cabPart);
  const mpFront = canvasTex(160,128,(c,w,h)=>{ c.fillStyle='#1c3f73'; c.fillRect(0,0,w,h); c.fillStyle='#0d1b2e'; c.fillRect(18,16,w-36,44); c.fillStyle='#7dd3ff'; c.font='bold 22px monospace'; c.fillText('MPPT',46,46); c.fillStyle='#e8f0ff'; c.font='14px monospace'; c.fillText('40A  24V',42,88); c.fillStyle='#58d68d'; c.beginPath(); c.arc(40,108,6,0,7); c.fill(); c.fillStyle='#f5c542'; c.beginPath(); c.arc(64,108,6,0,7); c.fill(); });
  const mm = M(0x1c3f73,{metalness:0.4, roughness:0.4});
  const mb = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.28,0.22),[new THREE.MeshStandardMaterial({map:mpFront, roughness:0.5}),mm,mm,mm,mm,mm]);
  mb.position.set(1.14,0.95,-0.17); mb.castShadow=true; mppt.add(mb);

  const ctrl = group('control', cabPart);
  const enc = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.24,0.28), new THREE.MeshStandardMaterial({color:0xd5d9db, transparent:true, opacity:0.5, roughness:0.2}));
  enc.position.set(1.15,0.95,0.15); ctrl.add(enc);
  box(0.01,0.05,0.12,M(0x1b5e3a),1.11,1.0,0.12,ctrl); box(0.008,0.03,0.05,M(0x6a2a8a),1.11,1.0,0.25,ctrl);
  for (let k=0;k<3;k++) box(0.012,0.03,0.04,M(0x1d3b6e),1.11,0.9,0.06+k*0.07,ctrl);
  { const led = new THREE.Mesh(new THREE.SphereGeometry(0.008,8,6), new THREE.MeshBasicMaterial({color:0x58ff8a})); led.position.set(1.12,1.04,0.04); ctrl.add(led); }

  const bat = group('battery', cabPart);
  function drawBatLabel(c,w,h){ c.fillStyle='#2b3236'; c.fillRect(0,0,w,h); c.fillStyle='#2C64B0'; c.fillRect(0,0,w,26); c.fillStyle='#fff'; c.font='bold 16px monospace'; c.fillText('LiFePO4  BMS',12,19); c.fillStyle='#e8eef0'; c.font='bold 30px monospace'; c.fillText('25.6 V',12,64); c.font='bold 26px monospace'; c.fillStyle='#9fe0b3'; c.fillText(S.ah+' Ah',12,104); }
  const batTex = canvasTex(256,128,drawBatLabel);
  const bm = M(0x2b3236,{roughness:0.6});
  const bb = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.24,0.48),[new THREE.MeshStandardMaterial({map:batTex, roughness:0.6}),bm,bm,bm,bm,bm]);
  bb.position.set(1.25,0.26,0); bb.castShadow=true; bat.add(bb);
  cyl(0.018,0.03,M(0xc8372d),1.25,0.395,-0.16,bat,12); cyl(0.018,0.03,M(0x1e2421),1.25,0.395,0.16,bat,12);
  box(0.05,0.03,0.06,M(0xd9d2c0),1.2,0.45,-0.16,bat); // 60 A fuse

  // cables
  const red = M(0xc8372d,{roughness:0.5}), blk = M(0x1d2224,{roughness:0.5}), grey = M(0x3c4447,{roughness:0.6});
  const pvPts = top => [V(0.85,top+1.93,-0.15),V(1.06,top+1.84,-0.25),V(1.08,1.4,-0.25),V(1.16,1.26,-0.2),V(1.14,1.09,-0.17)];
  tube(pvPts(0),0.011,red,cab); tube(pvPts(0).map(p=>p.clone().add(V(0,0,0.025))),0.011,blk,cab);
  const mbPts = [V(1.14,0.81,-0.17),V(1.14,0.7,-0.1),V(1.13,0.62,-0.05)];
  const bbPts = [V(1.25,0.41,-0.16),V(1.18,0.52,-0.1),V(1.13,0.62,-0.06)];
  const ldPts = [V(1.13,0.66,0.22),V(1.12,0.8,0.32),V(1.06,0.9,0.5),V(1.0,1.6,0.52)];
  tube(mbPts,0.012,red,cab); tube(bbPts,0.016,red,cab); tube([V(1.25,0.41,0.16),V(1.18,0.5,0.08),V(1.13,0.56,0.04)],0.016,blk,cab);
  tube(ldPts,0.014,grey,cab); tube([V(1.15,0.83,0.15),V(1.13,0.7,0.2)],0.008,grey,cab);
  { const eMat = new THREE.MeshBasicMaterial({color:0xffcf3a}), eGeo = new THREE.SphereGeometry(0.016,8,6);
    const mk = (name, pts, n) => { const arr=[]; for(let i=0;i<n;i++){ const m=new THREE.Mesh(eGeo,eMat); mod.add(m); arr.push({m,u:i/n}); } anim.energy[name]={pl:polyline(pts.map(p=>p.clone().add(V(0.012,0.012,0)))),arr}; };
    mk('pv', pvPts(0), 14); mk('mb', mbPts, 5); mk('bb', bbPts, 5); mk('ld', ldPts, 10);
    anim.pvPaths = {1:anim.energy.pv.pl, 2:polyline(pvPts(H).map(p=>p.clone().add(V(0.012,0.012,0))))}; }

  /* ----- scaling: clones of the module ----- */
  const extras = new THREE.Group(); scene.add(extras);
  api.mode = {cols:1, levels:1};
  function setMode(cols, levels){
    api.mode = {cols, levels};
    while (extras.children.length) extras.remove(extras.children[0]);
    const top = (levels-1)*H;
    panelPart.position.y = top;
    anim.energy.pv.pl = anim.pvPaths[levels];
    const offs = cols===1 ? [0] : [-SX, 0, SX];
    for (const dx of offs){
      for (let l=0; l<levels; l++){ if (dx===0 && l===0) continue; const g=growPart.clone(); g.position.set(dx, l*H, 0); g.traverse(o=>{ if(o.isPointLight) o.intensity=0; }); extras.add(g); }
      if (dx!==0){ const b=basePart.clone(); b.position.x=dx; extras.add(b); const c=cabPart.clone(); c.position.x=dx; extras.add(c); const p=panelPart.clone(); p.position.set(dx, top, 0); extras.add(p); }
      if (levels>1){ tube([V(dx+1.06,top+1.84,-0.25),V(dx+1.07,1.85,-0.25)],0.011,red,extras); }
    }
  }
  api.setMode = setMode;

  /* ----- labels ----- */
  const LABELS = [
    ['panel','Solar panel on top',V(-0.4,2.32,0.2),true],
    ['rack','Scaffold module',V(-L/2,1.95,D/2),false],
    ['wiring','Power cabinet',V(1.3,1.28,0.3),false],
    ['battery','Battery',V(1.32,0.42,0.12),false],
    ['mppt','Charge controller',V(1.32,0.74,-0.36),false],
    ['leds','LED grow lights',V(-0.3,1.79,D/2),false],
    ['fans','Fans',V(0.5,1.28,-D/2),false],
    ['tank','Tank and pump',V(-0.4,0.4,0.4),false]
  ];
  const labelsEl = opts.labelsEl; let labelEls = [];
  if (labelsEl){ labelEls = LABELS.map(([k,t])=>{ const d=document.createElement('div'); d.className='lbl'; d.textContent=t; labelsEl.appendChild(d); return d; }); }
  api.showLabels = true;
  const tmpV = new THREE.Vector3();
  function updateLabels(){
    if (!labelsEl) return; labelsEl.hidden = !api.showLabels; if (!api.showLabels) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, top = panelPart.position.y;
    const big = api.mode.cols>1 || api.mode.levels>1;
    LABELS.forEach(([k,,p,isPanel],i)=>{ if (big && k!=='panel' && k!=='wiring'){ labelEls[i].hidden=true; return; } tmpV.copy(p); if(isPanel) tmpV.y+=top; tmpV.project(camera); const el=labelEls[i]; const vis = tmpV.z<1 && Math.abs(tmpV.x)<1.02 && Math.abs(tmpV.y)<1.02; el.hidden=!vis; if(vis){ el.style.left=((tmpV.x+1)/2*w)+'px'; el.style.top=((1-tmpV.y)/2*h)+'px'; } });
  }

  /* ----- picking ----- */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let helper = null, downAt = null; api.selected = null;
  canvas.addEventListener('pointerdown', e=>{ downAt=[e.clientX,e.clientY]; });
  canvas.addEventListener('pointerup', e=>{
    if (!downAt || !api.pickable) { downAt=null; return; }
    const dx=e.clientX-downAt[0], dy=e.clientY-downAt[1]; downAt=null; if (dx*dx+dy*dy > 25) return;
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects([...clickables, extras], true);
    for (const h of hits){ let o=h.object; while(o && !o.userData.part) o=o.parent; if(o){ select(o.userData.part, false); return; } }
    select(null);
  });
  api.pickable = true;
  function select(key, fly){
    api.selected = key;
    if (helper){ scene.remove(helper); helper=null; }
    if (key){
      const bbx = new THREE.Box3(); partGroups[key].forEach(g=>bbx.expandByObject(g));
      helper = new THREE.Box3Helper(bbx, 0xfec42d); scene.add(helper);
      if (fly){ const c=bbx.getCenter(new THREE.Vector3()), s=bbx.getSize(new THREE.Vector3()).length(); flyTo(c.clone().add(V(s*0.8+0.8, s*0.45+0.5, s*1.1+1.2)), c); }
    }
    if (opts.onSelect) opts.onSelect(key);
  }
  api.select = select;
  api.liveText = function(){
    const k = api.selected, Lt = S.last; if (!k || !Lt) return '';
    switch(k){
      case 'panel': return `Now: ${Math.round(Lt.harvest)} W used of ${Math.round(Lt.avail)} W available`;
      case 'mppt': return Lt.avail>0 ? (Lt.net>0.5 ? `Now: charging at ${(Lt.net/battV(S.soc)).toFixed(1)} A` : (S.soc>=0.999 ? 'Now: battery full, panel covers the load' : 'Now: panel covers part of the load')) : 'Now: night, waiting for the sun';
      case 'battery': return `Now: ${Math.round(S.soc*100)}% · ${battV(S.soc).toFixed(1)} V · ${S.ah} Ah`;
      case 'control': return `Now: fans ${S.fansOk?'allowed':'shed'} · LEDs ${S.ledsOk?'allowed':'shed'} · pump ${Lt.on.pump?'on':'off (battery empty)'}`;
      case 'leds': return `Now: ${Lt.on.leds?'on':(Lt.ledSched?'off: shed to save battery':'off: outside schedule')}`;
      case 'fans': return `Now: ${Lt.on.fans?'on':(Lt.fanSched?'off: shed to save battery':'off: outside schedule')}`;
      case 'tank': return `Now: pump ${Lt.on.pump?'running, water circulating':'stopped'}`;
      case 'rack': return `Showing ${api.mode.cols*api.mode.levels} module${api.mode.cols*api.mode.levels>1?'s':''}`;
      default: return `Module load now: ${Math.round(Lt.load)} W`;
    }
  };

  /* ----- camera views ----- */
  const VIEWS = {
    overview:{pos:[4.6,3.1,6.2], tgt:[0,1.1,0], mode:[1,1]},
    rack:{pos:[1.9,1.5,3.2], tgt:[-0.1,1.0,0], mode:[1,1]},
    power:{pos:[3.0,1.3,1.4], tgt:[1.22,0.75,0], mode:[1,1]},
    panel:{pos:[2.8,4.4,3.4], tgt:[0,1.95,0], lift:true, mode:[1,1]},
    water:{pos:[-2.6,1.2,2.6], tgt:[-0.3,0.6,0], mode:[1,1]},
    night:{pos:[3.6,2.3,5.0], tgt:[0,1.0,0], time:21, mode:[1,1]},
    noon:{pos:[4.6,3.1,6.2], tgt:[0,1.1,0], time:12, mode:[1,1]},
    racknight:{pos:[1.9,1.5,3.2], tgt:[-0.1,1.0,0], time:21, mode:[1,1]},
    powernoon:{pos:[3.0,1.3,1.4], tgt:[1.22,0.75,0], time:12, mode:[1,1]},
    row:{pos:[6.5,4.2,10.5], tgt:[0,1.1,0], mode:[3,1]},
    stack:{pos:[5.6,4.8,8.2], tgt:[0,2.0,0], mode:[1,2]},
    stacknoon:{pos:[5.0,4.4,7.4], tgt:[0,2.0,0], mode:[1,2], time:11},
    farm:{pos:[7.6,5.4,10.4], tgt:[0,1.8,0], mode:[3,2]},
    farmnoon:{pos:[7.6,5.4,10.4], tgt:[0,1.8,0], mode:[3,2], time:12},
    panelnoon:{pos:[2.8,4.4,3.4], tgt:[0,1.95,0], lift:true, time:12, mode:[1,1]}
  };
  api.VIEWS = VIEWS;
  let fly = null;
  function flyTo(pos, tgt){ fly = {p0:camera.position.clone(), t0:controls.target.clone(), p1:pos, t1:tgt, k:0}; }
  api.setView = function(name, instant){
    const v = VIEWS[name]; if (!v) return;
    if (v.mode) setMode(v.mode[0], v.mode[1]);
    if (v.time !== undefined) S.T = Math.floor(S.T/24)*24 + v.time;
    const lift = v.lift ? panelPart.position.y : 0;
    const p=V(...v.pos).add(V(0,lift,0)), t=V(...v.tgt).add(V(0,lift,0));
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches){ camera.position.copy(p); controls.target.copy(t); controls.update(); fly=null; }
    else flyTo(p,t);
  };
  api.setInteractive = function(rotate, zoom){ controls.enableRotate = rotate; controls.enableZoom = !!zoom; controls.enablePan = !!zoom; };
  api.setBattery = function(ah){ S.ah = ah; const c=batTex.userData.canvas; drawBatLabel(c.getContext('2d'),c.width,c.height); batTex.needsUpdate=true; };

  /* ----- per-frame scene update ----- */
  const sky = {night:new THREE.Color(0x0a1322), dusk:new THREE.Color(0xe39a63), day:{sunny:new THREE.Color(0x86c4ec), typical:new THREE.Color(0x9ccbe6), cloudy:new THREE.Color(0xa8b5bd), rainy:new THREE.Color(0x7e8a92)}};
  const tmpC = new THREE.Color();
  function updateScene(dt){
    const t = S.T%24, Lt = S.last, a = Math.PI*(t-6)/12, elev = Math.sin(a);
    const sunPos = V(Math.cos(a)*40, Math.sin(a)*34, 10);
    anim.sun.position.copy(sunPos); anim.sun.visible = elev > -0.05;
    anim.moon.position.set(-Math.cos(a)*40, -Math.sin(a)*30+4, -6); anim.moon.visible = elev < 0.05;
    const wxF = {sunny:1, typical:0.85, cloudy:0.5, rainy:0.3}[S.wx];
    const dayK = Math.max(0, Math.min(1, (elev+0.08)/0.35));
    const duskK = Math.max(0, 1-Math.abs(elev)/0.18) * (t>4&&t<20?1:0);
    tmpC.copy(sky.night).lerp(sky.day[S.wx], dayK).lerp(sky.dusk, duskK*0.55*wxF);
    scene.background = tmpC.clone(); scene.fog.color.copy(tmpC);
    anim.sunLight.position.copy(elev>0?sunPos:V(-sunPos.x,10,8)); anim.sunLight.intensity = elev>0 ? (0.2+0.8*Math.min(1,elev*1.6))*wxF : 0.12;
    anim.sunLight.color.set(elev>0.25?0xfff1d6:0xffc69a);
    anim.hemi.intensity = 0.18 + 0.4*dayK*(0.6+0.4*wxF);
    anim.stars.material.opacity = Math.max(0, 1-dayK*1.5)*0.9;
    const cloudN = {sunny:2, typical:4, cloudy:8, rainy:9}[S.wx];
    anim.clouds.forEach((c,i)=>{ c.visible = i<cloudN; c.position.x += c.userData.speed*dt; if(c.position.x>34) c.position.x=-34; c.children.forEach(s=>s.material.color.setScalar(S.wx==='rainy'?0.62:(0.55+0.45*dayK))); });
    if (!Lt) return;
    anim.ledMats.forEach(m=>{ m.emissiveIntensity = Lt.on.leds ? 1.6 : 0; });
    anim.ledLights.forEach(p=>{ p.intensity = Lt.on.leds ? 0.7 : 0; });
    anim.fanBlades.forEach(b=>{ if (Lt.on.fans) b.rotation.z += dt*18; });
    const wSpeed = Lt.on.pump ? 0.05 : 0;
    anim.water.forEach(w=>{ w.u = (w.u + wSpeed*dt) % 1; along(w.path, w.u, w.m.position); w.m.visible = Lt.on.pump; });
    const flows = {pv:Lt.harvest, mb:Lt.harvest, bb:Lt.net, ld:Lt.load};
    for (const k in anim.energy){
      const e = anim.energy[k], P = flows[k], mag = Math.abs(P), dir = (k==='bb') ? (P>=0?1:-1) : 1;
      const frac = Math.min(1, mag/120), sp = 0.05 + 0.25*Math.min(1, mag/200);
      e.arr.forEach((p,i)=>{ p.u = (p.u + dir*sp*dt/Math.max(0.5,e.pl.L)*2 + 1) % 1; const vis = mag>1 && (i/e.arr.length) < Math.max(0.25,frac); p.m.visible = vis; if(vis) along(e.pl, p.u, p.m.position); });
    }
  }

  function resize(){ const w=host.clientWidth, h=host.clientHeight; if(!w||!h) return; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(host);
  api.resize = resize;
  api.camera = camera; api.controls = controls; api.renderer = renderer;

  let last = performance.now();
  function frame(now){
    const dt = Math.min(0.1, (now-last)/1000); last = now;
    if (S.playing) sim.advance(dt * S.speed/60);
    if (fly){ fly.k = Math.min(1, fly.k + dt*1.2); const e = fly.k<0.5?2*fly.k*fly.k:1-Math.pow(-2*fly.k+2,2)/2; camera.position.lerpVectors(fly.p0,fly.p1,e); controls.target.lerpVectors(fly.t0,fly.t1,e); if(fly.k>=1) fly=null; }
    if (opts.autoRotate && !fly && api.autoRotate) { const ang = dt*0.05; const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(UP, ang); camera.position.copy(controls.target).add(off); }
    controls.update(); updateScene(dt); renderer.render(scene,camera); updateLabels();
    if (opts.onFrame) opts.onFrame(dt);
    requestAnimationFrame(frame);
  }
  sim.prefill(0.62, 24*2+6.25);
  sim.step(0);
  resize();
  requestAnimationFrame(frame);
  return api;
}

window.GrowFarm = {mount, createSim, PARTS, battV, solarW, LOADS, SHED, LED_ON, FAN_ON, PSH, NOMINAL_V};
})();
