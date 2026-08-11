(function(global){
  'use strict';

  class RouteBookLayer {
    constructor(options){
      this.map=options.map;
      this.L=options.L||global.L;
      this.routes=options.routes||[];
      this.points=options.points||{};
      this.configUrl=options.configUrl||'';
      this.baseUrl=options.baseUrl||global.location.href;
      this.router=options.router||null;
      this.renderer=options.renderer||this.L.svg({padding:.35});
      this.layers=new Map();
      this.arrowLayers=new Map();
      this.nodeLayers=new Map();
      this.labelLayers=new Map();
      this.activeId='all';
      this._arrowTimer=null;
      this._destroyed=false;
      this._resizeHandler=()=>this._scheduleArrows();
    }

    static async fromConfig(options){
      const absoluteConfigUrl=new URL(options.configUrl,global.location.href).href;
      const res=await fetch(absoluteConfigUrl,{cache:'no-store'});
      if(!res.ok) throw new Error(`RouteBook config failed: ${res.status}`);
      const cfg=await res.json();
      const baseUrl=options.baseUrl||new URL('.',absoluteConfigUrl).href;
      return new RouteBookLayer({...options,...cfg,configUrl:absoluteConfigUrl,baseUrl});
    }

    async init(){
      for(const route of this.routes) this._buildRoute(route,this._waypointLatLngs(route));
      this.map.on('zoomend moveend',this._resizeHandler);
      this.setActive('all',{fit:false});
      this._enhanceRoutes();
      return this;
    }

    destroy(){
      this._destroyed=true;
      this.map.off('zoomend moveend',this._resizeHandler);
      clearTimeout(this._arrowTimer);
      for(const item of this.layers.values()) this.map.removeLayer(item.group);
      for(const g of this.arrowLayers.values()) this.map.removeLayer(g);
      for(const g of this.nodeLayers.values()) this.map.removeLayer(g);
      for(const g of this.labelLayers.values()) this.map.removeLayer(g);
      this.layers.clear();
      this.arrowLayers.clear();
      this.nodeLayers.clear();
      this.labelLayers.clear();
    }

    _buildRoute(route,latlngs){
      if(!latlngs||latlngs.length<2) return;
      const casing=this.L.polyline(latlngs,{renderer:this.renderer,color:route.casingColor||'#071019',weight:route.casingWeight||11,opacity:.9,lineCap:'round',lineJoin:'round',interactive:false,className:'rb-casing-path'});
      const core=this.L.polyline(latlngs,{renderer:this.renderer,color:route.color,weight:route.weight||6,opacity:.98,lineCap:'round',lineJoin:'round',interactive:true,className:'rb-core-path'});
      const hit=this.L.polyline(latlngs,{renderer:this.renderer,color:'#000',weight:20,opacity:0,interactive:true});
      const group=this.L.layerGroup([casing,core,hit]).addTo(this.map);
      const tooltip=`${route.name||route.id}｜${route.title||''}`;
      core.bindTooltip(tooltip,{sticky:true,className:'rb-tooltip'});
      hit.on('click',()=>this.setActive(route.id,{fit:true}));
      core.on('click',()=>this.setActive(route.id,{fit:true}));
      this.layers.set(route.id,{route,group,casing,core,hit,latlngs,source:'waypoints'});
      this._buildNodes(route);
      this._buildLabel(route,latlngs);
      this._buildArrows(route,latlngs);
    }

    async _enhanceRoutes(){
      const router=this.router||{};
      const interval=Math.max(0,router.minIntervalMs??1100);
      let lastOnlineAt=0;

      for(const route of this.routes){
        if(this._destroyed) return;
        let geometry=null;
        let source=null;

        if(route.geometryUrl){
          geometry=await this._loadStaticGeometry(route);
          if(geometry?.length>1) source='geojson';
        }

        if(!geometry?.length && (route.router||this.router)?.enabled!==false){
          geometry=this._readCache(route);
          if(geometry?.length>1) source='cache';
        }

        if(!geometry?.length && (route.router||this.router)?.enabled!==false){
          const wait=Math.max(0,interval-(Date.now()-lastOnlineAt));
          if(wait) await this._sleep(wait);
          try{
            geometry=await this._routeOnline(route,this._waypointLatLngs(route));
            lastOnlineAt=Date.now();
            if(geometry?.length>1){
              source='router';
              this._writeCache(route,geometry);
            }
          }catch(e){
            lastOnlineAt=Date.now();
            console.warn('[RouteBook] road geometry unavailable; keeping waypoint fallback',route.id,e);
          }
        }

        if(this._destroyed) return;
        if(geometry?.length>1) this._replaceGeometry(route.id,geometry,source);
      }
    }

    async _loadStaticGeometry(route){
      try{
        const url=new URL(route.geometryUrl,this.baseUrl).href;
        const res=await fetch(url,{cache:'force-cache'});
        if(!res.ok) return null;
        return this._extractGeoJSON(await res.json());
      }catch(e){
        console.warn('[RouteBook] static geometry unavailable',route.id,e);
        return null;
      }
    }

    _replaceGeometry(id,latlngs,source){
      const item=this.layers.get(id);
      if(!item||!latlngs?.length) return;
      item.latlngs=latlngs;
      item.source=source||'geometry';
      item.casing.setLatLngs(latlngs);
      item.core.setLatLngs(latlngs);
      item.hit.setLatLngs(latlngs);
      const label=this.labelLayers.get(id);
      if(label) label.setLatLng(latlngs[Math.floor(latlngs.length*.52)]);
      this._buildArrows(item.route,latlngs);
      this._applyState();
      if(typeof this.onGeometryUpgrade==='function') this.onGeometryUpgrade(id,item.source,latlngs);
    }

    _waypointLatLngs(route){
      const refs=route.waypoints||route.route||[];
      return refs.map(ref=>{
        if(Array.isArray(ref)) return this.L.latLng(ref[0],ref[1]);
        if(typeof ref==='object'&&ref.lat!=null) return this.L.latLng(ref.lat,ref.lng);
        const p=this.points[ref];
        return p?this.L.latLng(p[0],p[1]):null;
      }).filter(Boolean);
    }

    async _routeOnline(route,latlngs){
      const cfg=route.router||this.router;
      if(!cfg||cfg.enabled===false||latlngs.length<2) return null;
      const service=cfg.service||'osrm';
      if(service!=='osrm') throw new Error(`Unsupported router: ${service}`);
      const endpoint=(cfg.endpoint||'https://router.project-osrm.org/route/v1/driving/').replace(/\/$/,'')+'/';
      const coords=latlngs.map(p=>`${p.lng},${p.lat}`).join(';');
      const url=`${endpoint}${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),cfg.timeout||6500);
      try{
        const res=await fetch(url,{signal:ctrl.signal,mode:'cors'});
        if(!res.ok) throw new Error(`router ${res.status}`);
        const data=await res.json();
        if(data.code!=='Ok') throw new Error(`router code ${data.code||'unknown'}`);
        const coordsOut=data?.routes?.[0]?.geometry?.coordinates||[];
        return coordsOut.map(([lng,lat])=>this.L.latLng(lat,lng));
      }finally{
        clearTimeout(timer);
      }
    }

    _extractGeoJSON(gj){
      let geom=gj;
      if(gj.type==='FeatureCollection') geom=gj.features?.[0]?.geometry;
      else if(gj.type==='Feature') geom=gj.geometry;
      if(!geom) return null;
      const coords=geom.type==='LineString'?geom.coordinates:(geom.type==='MultiLineString'?geom.coordinates.flat():[]);
      return coords.map(([lng,lat])=>this.L.latLng(lat,lng));
    }

    _cacheKey(route){
      const refs=JSON.stringify(route.waypoints||route.route||[]);
      const raw=`${this.configUrl}|${route.id}|${refs}|${route.cacheVersion||1}`;
      let h=2166136261;
      for(let i=0;i<raw.length;i++){
        h^=raw.charCodeAt(i);
        h=Math.imul(h,16777619);
      }
      return `routebook:${route.id}:${(h>>>0).toString(16)}`;
    }

    _readCache(route){
      try{
        const raw=global.localStorage?.getItem(this._cacheKey(route));
        if(!raw) return null;
        const entry=JSON.parse(raw);
        const ttlDays=(route.router||this.router)?.cacheTtlDays??14;
        if(Date.now()-entry.savedAt>ttlDays*86400000){
          global.localStorage.removeItem(this._cacheKey(route));
          return null;
        }
        return (entry.coordinates||[]).map(([lat,lng])=>this.L.latLng(lat,lng));
      }catch(e){return null;}
    }

    _writeCache(route,latlngs){
      try{
        const entry={savedAt:Date.now(),coordinates:latlngs.map(p=>[p.lat,p.lng])};
        global.localStorage?.setItem(this._cacheKey(route),JSON.stringify(entry));
      }catch(e){}
    }

    _buildNodes(route){
      const refs=route.waypoints||route.route||[];
      if(!refs.length) return;
      const group=this.L.layerGroup().addTo(this.map);
      const important=route.nodes||refs.map((_,i)=>i);
      important.forEach((idx,order)=>{
        const ref=refs[idx];
        let p=null,label='';
        if(typeof ref==='string'&&this.points[ref]){p=this.L.latLng(this.points[ref][0],this.points[ref][1]);label=ref;}
        else if(Array.isArray(ref)){p=this.L.latLng(ref[0],ref[1]);label=`${idx+1}`;}
        else if(ref&&ref.lat!=null){p=this.L.latLng(ref.lat,ref.lng);label=ref.name||`${idx+1}`;}
        if(!p) return;
        const icon=this.L.divIcon({className:'rb-node-icon',html:`<div class="rb-node" style="--rb-color:${route.color}">${order+1}</div>`,iconSize:[20,20],iconAnchor:[10,10]});
        const marker=this.L.marker(p,{icon,interactive:true,riseOnHover:true,zIndexOffset:-300}).addTo(group);
        if(label) marker.bindTooltip(label,{direction:'top',offset:[0,-10],className:'rb-tooltip'});
      });
      this.nodeLayers.set(route.id,group);
    }

    _buildLabel(route,latlngs){
      if(route.showLabel===false) return;
      const mid=latlngs[Math.floor(latlngs.length*.52)];
      if(!mid) return;
      const icon=this.L.divIcon({className:'rb-route-label-icon',html:`<div class="rb-route-label" style="--rb-color:${route.color}">${route.name||route.id.toUpperCase()}</div>`,iconSize:[48,24],iconAnchor:[24,12]});
      const marker=this.L.marker(mid,{icon,interactive:false,zIndexOffset:-200}).addTo(this.map);
      this.labelLayers.set(route.id,marker);
    }

    _buildArrows(route,latlngs){
      const old=this.arrowLayers.get(route.id);
      if(old) this.map.removeLayer(old);
      const group=this.L.layerGroup().addTo(this.map);
      const spacing=global.innerWidth<=900?(route.mobileArrowSpacing||130):(route.arrowSpacing||170);
      const pts=latlngs.map(ll=>this.map.latLngToLayerPoint(ll));
      let acc=0;
      let next=spacing*.8;
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1];
        const b=pts[i];
        const seg=a.distanceTo(b);
        if(seg<=0) continue;
        while(acc+seg>=next){
          const t=(next-acc)/seg;
          const x=a.x+(b.x-a.x)*t;
          const y=a.y+(b.y-a.y)*t;
          const ll=this.map.layerPointToLatLng(this.L.point(x,y));
          const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
          const icon=this.L.divIcon({className:'rb-arrow-icon',html:`<div class="rb-arrow" style="--rb-angle:${angle}deg;--rb-color:${route.color}"><svg viewBox="0 0 18 12" aria-hidden="true"><path d="M3 2.5 9 6l-6 3.5M9 2.5 15 6 9 9.5"/></svg></div>`,iconSize:[20,20],iconAnchor:[10,10]});
          this.L.marker(ll,{icon,interactive:false,zIndexOffset:-100}).addTo(group);
          next+=spacing;
        }
        acc+=seg;
      }
      this.arrowLayers.set(route.id,group);
    }

    _scheduleArrows(){
      clearTimeout(this._arrowTimer);
      this._arrowTimer=setTimeout(()=>{
        for(const {route,latlngs} of this.layers.values()) this._buildArrows(route,latlngs);
        this._applyState();
      },90);
    }

    setActive(id,options={}){
      this.activeId=id||'all';
      this._applyState();
      if(options.fit!==false) this.fit(this.activeId);
      if(typeof this.onChange==='function') this.onChange(this.activeId);
    }

    _applyState(){
      for(const [id,item] of this.layers.entries()){
        const selected=this.activeId==='all'||id===this.activeId;
        const dim=this.activeId!=='all'&&!selected;
        item.casing.setStyle({opacity:dim?.16:.9,weight:selected?(item.route.casingWeight||11):8});
        item.core.setStyle({opacity:dim?.18:.98,weight:selected?(item.route.weight||6):4});
        item.hit.setStyle({opacity:0});
        const arrows=this.arrowLayers.get(id);
        const nodes=this.nodeLayers.get(id);
        const label=this.labelLayers.get(id);
        if(arrows){
          if(dim&&this.map.hasLayer(arrows)) this.map.removeLayer(arrows);
          else if(!dim&&!this.map.hasLayer(arrows)) arrows.addTo(this.map);
        }
        if(nodes) nodes.getLayers().forEach(x=>{if(x.setOpacity)x.setOpacity(dim?.24:1);});
        if(label?.setOpacity) label.setOpacity(dim?.2:1);
      }
    }

    fit(id='all'){
      let all=[];
      if(id==='all'){
        for(const item of this.layers.values()) all=all.concat(item.latlngs);
      }else{
        all=this.layers.get(id)?.latlngs||[];
      }
      if(all.length) this.map.fitBounds(this.L.latLngBounds(all).pad(id==='all'?.08:.12),{animate:false});
    }

    _sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  }

  global.RouteBookLayer=RouteBookLayer;
})(window);