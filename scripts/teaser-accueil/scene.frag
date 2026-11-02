#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv; out vec4 sortie;
uniform vec2 uRes,uJit;
uniform float uT,uFov,uRoulis,uGraine,uFenetre,uCercle,uYeux,uBrume,uBalaye,uInvoque,uOnde,uGeste,uBaton,uSouffle;
uniform float uAiguilles,uEclipse,uAnneaux,uPierres,uFoudre,uVortex,uTunnel;
uniform vec3 uCam,uCible;
uniform sampler2D tMasque,tGlyphe;
uniform sampler3D tBruit;

const float PI=3.14159265,TAU=6.2831853,BOUCLE=12.;
float W(float n){return TAU*n/BOUCLE;}

// la fenêtre-horloge, au fond de la nef
const vec3 CF=vec3(0.,14.4,-24.2);
const float RF=9.6;
const vec3 L0=vec3(0.,24.,-74.);
// le magicien, en haut des marches
const vec3 H=vec3(0.,3.06,-13.2);
const vec3 CC=vec3(0.,0.,-.6);  // le cercle de runes, où se tient la mascotte
const float RC=2.9;

mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float sdBoite(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,vec3(0.)))+min(max(q.x,max(q.y,q.z)),0.);}
float sdCapsule(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}
float sdTore(vec3 p,float R,float r){return length(vec2(length(p.xy)-R,p.z))-r;}
float sdConeRond(vec3 p,vec3 a,vec3 b,float r1,float r2){
 vec3 ba=b-a;float l2=dot(ba,ba),rr=r1-r2,a2=l2-rr*rr,il2=1./l2;
 vec3 pa=p-a;float y=dot(pa,ba),z=y-l2;vec3 xv=pa*l2-ba*y;float x2=dot(xv,xv),y2=y*y*l2,z2=z*z*l2;
 float k=sign(rr)*rr*rr*x2;
 if(sign(z)*a2*z2>k)return sqrt(x2+z2)*il2-r2;
 if(sign(y)*a2*y2<k)return sqrt(x2+y2)*il2-r1;
 return (sqrt(x2*a2*il2)+y*rr)*il2-r1;
}
float bruit(vec3 p){return textureLod(tBruit,p,0.).r;}

// ---------- le magicien du temps obscur ----------
const float SH=.74;
// Tout s'annule en t=0 : l'intro finit exactement sur la pose de repos. Calculé une fois par pixel
// dans `poser()` : ces valeurs sont lues à chaque pas de marche, le rendu passait de 6 à 8,5 s par image.
float gFlotte,gCorps,gTete,gS1,gS2,gS3,gBal;
vec3 gMainG,gMainD,gCentre,gF,gR,gU;
float gK;
mat2 gRotCorps,gRotTete;
mat3 gA1,gA2,gA3;
mat3 rotAxe(vec3 a,float t){
 a=normalize(a);float c=cos(t),s=sin(t),o=1.-c;
 return mat3(o*a.x*a.x+c,o*a.x*a.y+a.z*s,o*a.z*a.x-a.y*s,
  o*a.x*a.y-a.z*s,o*a.y*a.y+c,o*a.y*a.z+a.x*s,
  o*a.z*a.x+a.y*s,o*a.y*a.z-a.x*s,o*a.z*a.z+c);
}
void poser(){
 gS1=sin(W(1.)*uT);gS2=sin(W(2.)*uT);gS3=sin(W(3.)*uT);
 gFlotte=.22*(1.-cos(W(2.)*uT))+.55*uGeste;
 gCorps=.03*gS1+.018*gS3-.1*uGeste;
 gTete=.08*gS1+.05*gS2-.22*uGeste;
 gRotCorps=rot(gCorps);gRotTete=rot(gTete);
 gMainG=mix(vec3(-3.3,8.9,.6)+vec3(.22*gS2,.34*gS1,.15*gS3),vec3(-2.4,12.1,1.4),uGeste);
 gMainD=vec3(3.75+.12*gS1,6.6+uBaton+.14*gS2,.5);
 gBal=.3*sin(TAU*uT/7.);
 gCentre=H+SH*vec3(0.,7.2+gFlotte,0.);
 float v=uT*.9;
 gA1=rotAxe(vec3(.2,1.,.1),v*.7+.4);
 gA2=rotAxe(vec3(1.,.3,.2),-v*.9+1.1);
 gA3=rotAxe(vec3(.3,.2,1.),v*1.15+2.2);
}
// D'un point du mage à sa place dans la nef : les yeux, l'orbe et l'étoile le suivent.
vec3 versMonde(vec3 l,float tete){
 vec2 e=l.xy;
 if(tete>.5){e-=vec2(0.,6.9);e=rot(-gTete)*e;e+=vec2(0.,6.9);}
 e=rot(-gCorps)*e;
 return H+SH*vec3(e.x,e.y+gFlotte,l.z);
}
float magicienU(vec3 q,out float partie){
 partie=0.;
 float borne=length(q-vec3(0.,7.5,0.))-12.;
 if(borne>1.)return borne;
 q.y-=gFlotte;
 q.xy=gRotCorps*q.xy;
 float y=q.y;
 float a=atan(q.z,q.x);
 float bas=smoothstep(6.8,0.,y);
 // le vent tire le bas de la robe sur le côté et vers l'arrière
 vec2 traine=vec2(bas*bas*(.55+.45*gS1+uSouffle*1.5),-bas*bas*(.8+uSouffle*.8));
 float a2=atan(q.z-traine.y,q.x-traine.x);
 float vent=sin(W(1.)*uT+y*.55+a2*2.)*.1+sin(W(3.)*uT+y*1.1-a2*3.)*.07;
 float plis=(.24*sin(a2*7.+y*.35+gS1)+.12*sin(a2*13.-y*.5))*bas;
 float ray=mix(2.75,.95,pow(clamp(y/6.2,0.,1.),.62))+plis+vent*bas*2.2+uSouffle*(1.1+.6*sin(a2*5.+uT*6.+y))*bas;
 float cape=(length(q.xz-traine)-ray)*.6;
 // le bas déchiré : le mage ne touche plus le sol
 float dechire=.3+2.2*textureLod(tBruit,vec3(cos(a2),sin(a2),uT*.01)*.21+.3,0.).r;
 cape=max(cape,max(y-6.6,(dechire-y)*.5));
 // épaules, capuche
 float d=smin(cape,sdConeRond(q,vec3(0.,5.4,0.),vec3(0.,6.9,0.),1.55,.92),.35);
 // manches : bras droit vers le bâton, bras gauche levé vers le temps
 vec3 md=gMainD,mg=gMainG;
 float h1=sdConeRond(q,vec3(1.3,6.3,.1),md,.62,.3);
 h1=smin(h1,sdConeRond(q,md+vec3(-.25,.05,0.),md+vec3(-1.,-2.8+.5*gS2,-.2),.6,.03),.2);
 float h2=sdConeRond(q,vec3(-1.3,6.3,.1),mg,.62,.28);
 h2=smin(h2,sdConeRond(q,mg+vec3(.2,-.2,0.),mg+vec3(.25+.3*uGeste,-3.3+.6*uGeste,-.2),.6,.03),.2);
 d=smin(d,min(h1,h2),.25);
 // chapeau : même silhouette que la mascotte, pointe recourbée vers la droite
 vec3 t_=q; t_.xy-=vec2(0.,6.9); t_.xy=gRotTete*t_.xy; t_.xy+=vec2(0.,6.9);
 vec3 b=t_-vec3(0.,7.75,0.);
 float rb=length(b.xz);
 float ond=.14*sin(atan(b.z,b.x)*3.+W(1.)*uT)*smoothstep(1.,2.8,rb);
 float bord=max(abs(b.y+.075*rb*rb+ond)-.035,rb-3.)*.55;
 vec3 c=b; float hc=clamp(c.y/5.2,0.,1.);
 c.x-=(2.1+.45*gS2)*hc*hc*hc; c.y-=.5*hc*hc*hc;
 float rc=mix(1.5,.05,pow(hc,.8));
 float cone=max(length(c.xz)-rc,max(c.y-5.,-c.y))*.62;
 float chap=min(bord,cone);
 if(chap<d){d=chap;partie=2.;}else partie=1.;
 // bâton surmonté d'un anneau
 vec3 sb=vec3(md.x+.15,uBaton-.2,.5),hb=vec3(md.x+.15+.1*gS1,13.+uBaton,.5);
 float bat=sdCapsule(q,sb,hb,.11);
 vec3 an=q-hb-vec3(0.,.8,0.);
 bat=min(bat,sdTore(an,.95,.09));
 bat=min(bat,sdTore(an,.62,.04));
 if(bat<d){d=bat;partie=3.;}
 return d;
}
float magicien(vec3 p,out float partie){return magicienU((p-H)/SH,partie)*SH;}

// ---------- engrenages suspendus ----------
// Ils tournent de 72 degres par boucle : un multiple de leurs dents ET de leurs 5 rayons, sinon la
// boucle saute a chaque tour. Meme regle pour la grande roue de la fenetre (6 rayons, 60 degres).
float roue(vec3 p,float R,float N,float ang,float ep){
 float a=atan(p.y,p.x)+ang,r=length(p.xy);
 float dent=R*(1.+.07*smoothstep(-.25,.25,cos(a*N)));
 float d2=max(r-dent,-(r-R*.8));
 float rayons=abs(mod(a+PI/5.,TAU/5.)-PI/5.)*r-R*.05;
 d2=min(d2,max(rayons,r-R*.82));
 d2=min(d2,r-R*.18);
 return max(d2,abs(p.z)-ep)*.8;
}
float engrenages(vec3 p){
 float borne=length(vec2(abs(p.x)-8.,p.y-12.))-10.;
 if(borne>2.)return borne;
 vec3 a=p-vec3(-8.3,11.,-9.); a.xz=rot(.55)*a.xz; a.yz=rot(.28)*a.yz;
 float d=roue(a,3.6,20.,W(1.)/5.*uT,.22);
 vec3 b=p-vec3(8.8,14.5,-13.); b.xz=rot(-.5)*b.xz; b.yz=rot(-.2)*b.yz;
 d=min(d,roue(b,4.8,25.,-W(1.)/5.*uT,.26));
 vec3 c=p-vec3(-6.6,19.,-16.); c.xz=rot(.3)*c.xz;
 d=min(d,roue(c,2.6,15.,-W(1.)/5.*uT,.18));
 return d;
}

// ---------- le balancier, derrière le mage ----------
float balancier(vec3 p){
 vec3 q=p-vec3(0.,46.,-20.);
 q.xy=rot(gBal)*q.xy;
 float b=sdCapsule(q,vec3(0.),vec3(0.,-33.,0.),.14);
 vec3 r=q-vec3(0.,-35.2,0.);
 float rr=length(r.xy);
 float disque=max(max(rr-2.3,-(rr-1.55)),abs(r.z)-.2)*.9;
 disque=min(disque,max(abs(rr-.0)-.5,abs(r.z)-.26));
 return min(b,disque);
}

// ---------- l'astrolabe géant autour du mage ----------
float anneau(vec3 q,float R,float L){
 vec2 w=vec2(length(q.xy)-R,q.z);
 vec2 e=abs(w)-vec2(.05,L);
 return length(max(e,0.))+min(max(e.x,e.y),0.)-.03;
}
float astrolabe(vec3 p){
 if(uAnneaux<.002)return 1e3;
 vec3 q=p-gCentre;
 float borne=length(q)-8.6*uAnneaux;
 if(borne>1.)return borne;
 float d=anneau(gA1*q,5.4*uAnneaux,.24);
 d=min(d,anneau(gA2*q,6.5*uAnneaux,.2));
 return min(d,anneau(gA3*q,7.6*uAnneaux,.26));
}

// ---------- les dalles arrachées au sol ----------
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float unePierre(vec3 p,float dec){
 const float C=3.4;
 vec2 g=(p.xz+dec)/C,id=floor(g),f=(fract(g)-.5)*C;
 // une pierre ne touche jamais le bord de sa case : la marche ne la rate pas
 float limite=C*.5-max(abs(f.x),abs(f.y))+.32;
 vec2 cen=(id+.5)*C-dec;
 float h=hash21(id+dec*.13);
 if(h<.55||abs(cen.x)<4.6||abs(cen.x)>12.5||cen.y<-19.||cen.y>9.)return limite+.5;
 float h2=fract(h*37.7),h3=fract(h*91.3);
 float m=smoothstep(h2*.55,h2*.55+.42,uPierres);
 float y=m*(.6+h*h*h*8.)+.34*sin(uT*.9+h*40.)*m;
 vec3 q=vec3(f.x,p.y-y-.12,f.y);
 q.xz=rot(h*6.+uT*.3*(h2-.5)*m)*q.xz;
 q.xy=rot((h3-.5)*1.5*m+uT*.22*(h-.5)*m)*q.xy;
 float r=.42+.6*h3;
 float d=sdBoite(q,vec3(r,.14+.18*h2,r*(.65+.5*h)))-.04;
 return min(d,limite);
}
float pierres(vec3 p){
 if(uPierres<.002)return 1e3;
 if(p.y>14.)return p.y-13.;
 return min(unePierre(p,0.),unePierre(p,1.7));
}

// ---------- la nef ----------
float piliers(vec3 p){
 vec3 q=p; q.x=abs(q.x)-10.5;
 float cz=7.; float id=clamp(floor((q.z+24.)/cz),0.,5.);
 q.z=q.z+24.-(id+.5)*cz;
 float r=length(q.xz),a=atan(q.z,q.x);
 float d=r-(1.05+.075*cos(a*12.));
 d=min(d,sdBoite(q-vec3(0.,.45,0.),vec3(1.5,.45,1.5))-.03);
 d=min(d,sdBoite(q-vec3(0.,1.3,0.),vec3(1.26,.3,1.26))-.03);
 // nervures transversales en ogive, au niveau de chaque pilier
 vec2 ar=vec2(abs(p.x)+7.5,p.y-15.);
 float og=abs(length(ar)-18.)-.34;
 float nerv=max(max(og,-(p.y-15.)),abs(q.z)-.42);
 d=min(d,nerv);
 return d;
}
float escalier(vec3 p){
 const float Z0=-5.,PAS=.75,HM=.34;
 float i=clamp(floor((Z0-p.z)/PAS),0.,8.);
 float z1=Z0-i*PAS, z2=Z0-(i+1.)*PAS;
 float d1=sdBoite(p-vec3(0.,(HM*(i+1.)-1.)*.5,z1-20.),vec3(9.,(HM*(i+1.)+1.)*.5,20.));
 float d2=sdBoite(p-vec3(0.,(HM*(i+2.)-1.)*.5,z2-20.),vec3(9.,(HM*(i+2.)+1.)*.5,20.));
 return min(d1,d2);
}
float fond(vec3 p){
 float d=max(abs(p.z+24.9)-.5,-(length(p.xy-CF.xy)-RF));
 d=min(d,sdTore(p-vec3(CF.xy,-24.2),RF+.1,.55));
 d=min(d,sdTore(p-vec3(CF.xy,-23.6),RF+.9,.3));
 return d;
}

vec2 carte(vec3 p){
 float d=p.y; float m=1.;
 float e=escalier(p); if(e<d){d=e;m=1.;}
 float pi=piliers(p); if(pi<d){d=pi;m=2.;}
 float mur=min(16.-abs(p.x),fond(p)); if(mur<d){d=mur;m=2.;}
 float pa; float h=magicien(p,pa); if(h<d){d=h;m=3.+pa;}
 float en=min(engrenages(p),balancier(p)); if(en<d){d=en;m=8.;}
 float as=astrolabe(p); if(as<d){d=as;m=9.;}
 float pr=pierres(p); if(pr<d){d=pr;m=10.;}
 return vec2(d,m);
}
vec3 normale(vec3 p,float e){
 const vec2 k=vec2(1.,-1.);
 return normalize(k.xyy*carte(p+k.xyy*e).x+k.yyx*carte(p+k.yyx*e).x+k.yxy*carte(p+k.yxy*e).x+k.xxx*carte(p+k.xxx*e).x);
}

// ---------- la lumière du temps ----------
float aiguille(vec2 uv,float ang,float lon,float lar){
 uv=rot(ang)*uv;
 float d=abs(uv.x)-lar*(1.-clamp((uv.y-.25)/(lon-.25),0.,1.))-.0025;
 return (uv.y>.25&&uv.y<lon&&d<0.)?0.:1.;
}
float transmission(vec2 uv,float lod){
 float r=length(uv); if(r>1.)return 0.;
 float m=textureLod(tMasque,uv*.5+.5,lod).r;
 m*=textureLod(tMasque,(rot(W(1.)/60.*uT+uAiguilles*.5)*uv)*.5+.5,lod).g;
 m*=textureLod(tMasque,(rot(-W(1.)/6.*uT-uAiguilles*.8)*uv)*.5+.5,lod).b;
 // le temps est figé : la trotteuse tremble ; quand le mage le brise, tout repart à l'envers
 float sec=-1.05+.022*sin(W(9.)*uT)*sin(W(1.)*uT)-uAiguilles*12.;
 m*=aiguille(uv,sec,.92,.009);
 m*=aiguille(uv,.62-uAiguilles*2.4,.78,.02);
 m*=aiguille(uv,2.2-uAiguilles*.4,.55,.028);
 return m;
}
vec3 spirale(vec2 uv){
 float r=length(uv),a=atan(uv.y,uv.x);
 float tw=a+2.6/(r+.12)-uT*1.4;
 vec3 q=vec3(cos(tw),sin(tw),r*1.2-uT*.2)*.24;
 float n=bruit(q)*.6+bruit(q*2.4+.3)*.4;
 n=smoothstep(.34,.76,n);
 vec3 c=mix(vec3(1.,.66,.28),vec3(.2,.36,1.),smoothstep(.1,.9,r));
 return c*n*2.6+vec3(1.,.9,.72)*exp(-r*6.)*9.;
}
vec3 ciel(vec2 uv){
 float r=length(uv),ang=atan(uv.y,uv.x);
 float nu=textureLod(tBruit,vec3(uv*.32+uT*.006,.31),1.).r;
 vec3 c=mix(vec3(.05,.07,.28),vec3(.3,.42,.9),smoothstep(1.05,.34,r));
 c*=.22+.8*nu*nu*2.;
 float st=.55+.45*sin(ang*31.+sin(ang*7.)*3.)*sin(ang*13.+1.);
 float cor=exp(-max(r-.235,0.)*mix(9.,24.,uEclipse));
 c=mix(c,c*vec3(.3,.16,.1),uEclipse);
 c+=vec3(1.,.62,.24)*cor*(1.+4.*st);
 c+=vec3(1.,.86,.6)*exp(-max(r-.23,0.)*mix(42.,90.,uEclipse))*9.;
 float lune=textureLod(tBruit,vec3(uv*1.1+.2,.6),0.).r;
 vec3 disque=mix(vec3(1.,.74,.38),vec3(1.,.9,.68),smoothstep(.23,.05,r))*(3.2+2.4*lune*lune);
 // l'ombre qui glisse sur la lune, jusqu'au noir total
 vec2 ombre=uv-vec2(mix(.52,0.,uEclipse),mix(.2,0.,uEclipse));
 float noir=smoothstep(.232,.222,length(ombre));
 disque=mix(disque,vec3(.004,.003,.006),noir*smoothstep(0.,.06,uEclipse));
 c=mix(disque,c,smoothstep(.228,.236,r));
 // le diamant de l'éclipse : un seul point sur le bord du disque
 c+=vec3(1.,.92,.78)*uEclipse*uEclipse*exp(-length(uv-vec2(.16,.17))*60.)*50.;
 if(uVortex>.001&&r<.8)c=mix(c,spirale(uv/.8),uVortex*smoothstep(.8,.42,r));
 return c*uFenetre;
}
float ombreMagicien2D(vec2 x){
 // silhouette du magicien vue depuis la lumière, pour son ombre dans la brume
 vec2 q=(x-H.xy)/SH;
 vec2 a=q-vec2(0.,clamp(q.y,0.,7.)); float d=length(a)-mix(2.6,1.2,clamp(q.y/7.,0.,1.));
 vec2 c=q-vec2(0.,7.8); float hc=clamp(c.y/5.2,0.,1.);
 c.x-=2.1*hc*hc*hc;
 float dh=(c.y>0.&&c.y<5.)?abs(c.x)-mix(1.5,.05,pow(hc,.8)):1.;
 float bord=(abs(c.y)<.5)?abs(q.x)-2.8:1.;
 return smoothstep(-.2,.3,min(d,min(dh,bord)));
}
float rayon(vec3 p){
 if(p.z<CF.z)return 0.;
 float s=(CF.z-L0.z)/(p.z-L0.z);
 vec3 q=L0+(p-L0)*s;
 vec2 uv=(q.xy-CF.xy)/RF;
 float r=length(uv); if(r>1.02)return 0.;
 float tr=transmission(uv,2.2);
 float couronne=smoothstep(.21,.26,r)*(.28+2.8*exp(-max(r-.235,0.)*5.));
 float om=1.;
 if(p.z>H.z){
  float s2=(H.z-L0.z)/(p.z-L0.z);
  om=ombreMagicien2D((L0+(p-L0)*s2).xy);
 }
 return tr*couronne*om*(1.-.9*uEclipse);
}
float brume(vec3 p){
 float ph=fract(uT/BOUCLE),a=ph,b=fract(ph+.5),w=abs(2.*a-1.);
 vec3 v=vec3(.09,.05,.04)/BOUCLE;
 vec3 q=p*.026;
 float n1=bruit(q+v*a*BOUCLE)*.65+bruit(q*2.7+v*a*BOUCLE*2.)*.35;
 float n2=bruit(q+v*b*BOUCLE+.37)*.65+bruit(q*2.7+v*b*BOUCLE*2.+.11)*.35;
 float n=mix(n1,n2,w);
 float sol=exp(-max(p.y,0.)*.6)*smoothstep(.36,.72,n)*.16;
 float masse=exp(-max(p.y-1.,0.)*.05)*(.004+.085*n*n*n)*exp(-p.x*p.x*.02);
 return uBrume*(sol+masse);
}

// ---------- matières ----------
float ombre(vec3 ro,vec3 rd,float tmax){
 float res=1.,t=.15;
 for(int i=0;i<22;i++){
  float pa; float d=min(magicien(ro+rd*t,pa),engrenages(ro+rd*t));
  res=min(res,9.*d/t);
  t+=clamp(d,.12,2.2);
  if(res<.01||t>tmax)break;
 }
 return clamp(res,0.,1.);
}
float occlusion(vec3 p,vec3 n){
 float o=0.,s=1.;
 for(int i=1;i<=4;i++){float h=.08+.32*float(i);float d=carte(p+n*h).x;o+=(h-d)*s;s*=.55;}
 return clamp(1.-.55*o,0.,1.);
}
vec3 lumiereCercle(vec3 p,vec3 n){
 vec3 g=CC+vec3(0.,.5,0.)-p; float d2=dot(g,g);
 return vec3(1.,.62,.24)*uCercle*5.5/(1.+d2*.55)*max(dot(n,normalize(g)),0.);
}
float etoile(vec2 p,float r){
 float a=atan(p.x,p.y); float s=TAU/5.; a=mod(a,s)-s*.5;
 return length(p)*cos(a*1.)-r*(.55+.45*abs(a)/(s*.5));
}
vec3 eclairer(vec3 p,vec3 n,vec3 rd,float m,float t,out float reflet){
 reflet=0.;
 vec3 versF=CF-p; float dF=length(versF); vec3 L=versF/dF;
 float nl=max(dot(n,L),0.);
 float tr=rayon(p+n*.05);
 vec3 lum=vec3(.62,.72,1.)*uFenetre;
 vec3 alb; float rug=.5; vec3 em=vec3(0.);
 float gr=bruit(p*.33)*.6+bruit(p*1.4)*.4;
 if(m<1.5){ // dalles
  vec2 g=abs(fract(p.xz/2.6+vec2(.5*floor(p.z/2.6),0.))-.5);
  float joint=smoothstep(.485,.47,max(g.x,g.y));
  alb=vec3(.082,.085,.095)*(.55+.9*gr)*mix(.35,1.,joint);
  float mouille=smoothstep(.3,.56,bruit(p*vec3(.09,.02,.09)+.2))*mix(.6,1.,joint);
  reflet=mix(.15,1.,mouille)*step(.8,n.y)*step(p.y,.05);
 } else if(m<2.5){ // pierre
  alb=vec3(.07,.07,.08)*(.5+1.1*gr);
 } else if(m<4.5){ // étoffe
  alb=vec3(.016,.012,.024);
 } else if(m<5.5){ // chapeau, violet nuit
  alb=vec3(.035,.018,.075);
 } else if(m<6.5){ // bâton
  alb=vec3(.12,.09,.05);
 } else if(m<8.5){ // bronze
  alb=vec3(.16,.1,.05)*(.6+gr);
 } else if(m<9.5){ // or de l'astrolabe
  alb=vec3(.3,.2,.07);
  vec3 q=p-gCentre;
  vec3 q1=gA1*q,q2=gA2*q,q3=gA3*q;
  float d1=anneau(q1,5.4*uAnneaux,.24),d2=anneau(q2,6.5*uAnneaux,.2),d3=anneau(q3,7.6*uAnneaux,.26);
  vec3 l=d1<d2?(d1<d3?q1:q3):(d2<d3?q2:q3);
  float an=atan(l.y,l.x)/TAU*72.;
  float trait=smoothstep(.09,.05,abs(fract(an)-.5))*smoothstep(.15,.11,abs(l.z));
  float rune=smoothstep(.2,.12,abs(fract(an/6.)-.5))*smoothstep(.1,.06,abs(l.z));
  em=vec3(1.,.62,.24)*(trait*.7+rune*2.4);
 } else { // pierre arrachée, fendue d'or
  alb=vec3(.07,.07,.08)*(.5+1.1*gr);
  float veine=bruit(p*.11+.13);
  float fente=smoothstep(.016,.004,abs(veine-.5));
  em=vec3(1.,.5,.14)*fente*uPierres*2.2;
  em+=vec3(1.,.52,.18)*max(-n.y,0.)*.16*uCercle;
  em+=vec3(.42,.56,1.)*pow(1.-max(dot(n,-rd),0.),3.)*.1*uFenetre;
 }
 vec3 c=vec3(0.);
 // la lumière de la fenêtre, plus forte près d'elle
 float att=70./(30.+dF*dF*.32);
 float sh=(m<2.5||m>7.5)?ombre(p+n*.08,L,dF-1.):1.;
 c+=alb*lum*nl*tr*att*sh*5.;
 vec3 h_=normalize(L-rd);
 float sp=pow(max(dot(n,h_),0.),m<1.5?90.:30.);
 c+=lum*sp*tr*att*sh*(m<1.5?.5:.1);
 // contre-jour sur les silhouettes
 float fres=pow(1.-max(dot(n,-rd),0.),6.);
 if(m>2.5){
  float bord=max(dot(n,normalize(vec3(L.xy,L.z*.2))),0.);
  c+=vec3(.5,.62,1.)*fres*(.02+1.1*bord)*(m<6.5?1.:.5)*att*.2*uFenetre*smoothstep(-.2,.3,-n.y+.25);
 }
 // or du cercle, et chaleur des cierges sur les marches
 c+=alb*lumiereCercle(p,n)*2.;
 vec2 ci=vec2(abs(p.x)-5.2,p.z+5.);
 c+=alb*vec3(1.,.5,.17)*uCercle*1.6/(1.+dot(ci,ci)*.3+p.y*p.y*.1);
 float ao=occlusion(p,n);
 c+=alb*vec3(.06,.075,.14)*ao*.5;
 c*=mix(.5,1.,ao);
 // vitraux de la nef, entre les piliers : sans eux, les côtés de l'image sont vides
 if(m>1.5&&m<2.5&&abs(p.x)>15.8){
  float zz=mod(p.z+24.,7.)-3.5;
  float yy=p.y-2.5;
  float dedans=step(abs(zz),1.25)*step(0.,yy)*step(yy,10.8-zz*zz*1.4);
  float bar=step(.09,abs(fract(zz*1.2)-.5))*step(.08,abs(fract(yy*.62)-.5));
  float teinte=bruit(vec3(p.z,p.y,1.)*.07);
  vec3 v=mix(vec3(.1,.22,.85),vec3(1.,.58,.2),smoothstep(.46,.6,teinte));
  c+=v*dedans*bar*(.35+.25*bruit(p*vec3(.2,.1,.2)))*(1.+uFenetre)*(1.-uEclipse*.7);
 }
 // le galon d'or de la robe et du chapeau
 if(m>3.5&&m<5.5){
  vec3 l=(p-H)/SH; l.y-=gFlotte; l.xy=gRotCorps*l.xy;
  float galon=0.;
  if(m<4.5){
   galon=smoothstep(.05,.02,abs(l.x-.02*sin(l.y*2.)))*step(0.,l.z)*step(.62,fract(l.y*1.4))*step(l.y,4.8);
  } else {
   vec3 tl=l; tl.xy-=vec2(0.,6.9); tl.xy=gRotTete*tl.xy; tl.xy+=vec2(0.,6.9);
   galon=smoothstep(.05,.02,abs(tl.y-8.3));
  }
  c+=vec3(1.,.66,.26)*galon*uYeux*.5;
 }
 // étoile d'or sur le chapeau, sœur de celle de la mascotte
 if(m>4.5&&m<5.5){
  vec3 q=p-versMonde(vec3(.28,9.7,0.),1.); q=vec3(rot(gTete+gCorps)*q.xy,q.z)/SH; q.z=1.;
  if(q.z>0.){ float e=etoile(q.xy,.42); c+=vec3(1.,.72,.3)*(smoothstep(.02,-.02,e)*1.8+exp(-max(e,0.)*12.)*.12)*uYeux; }
 }
 return c+em*(1.+uInvoque);
}
vec3 fondOuvert(vec3 ro,vec3 rd){
 if(rd.z>=0.)return vec3(0.);
 float t=(CF.z-ro.z)/rd.z; vec3 q=ro+rd*t;
 vec2 uv=(q.xy-CF.xy)/RF;
 if(length(uv)>1.)return vec3(0.);
 return ciel(uv)*transmission(uv,0.);
}
float marcher(vec3 ro,vec3 rd,float tmax,int pas,out float m){
 float t=.02; m=0.;
 for(int i=0;i<pas;i++){
  vec2 r=carte(ro+rd*t);
  if(r.x<.0009*t){m=r.y;return t;}
  t+=r.x*.92;
  if(t>tmax)break;
 }
 return tmax;
}

float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}

vec2 proj(vec3 P){vec3 v=P-uCam;float z=max(dot(v,gF),.1);return vec2(dot(v,gR),dot(v,gU))*gK/z;}
float eclair(vec2 uv,vec2 a,vec2 b,float g){
 vec2 ab=b-a;float l=max(length(ab),.001);vec2 te=ab/l,no=vec2(-te.y,te.x);
 float s=dot(uv-a,te)/l;
 if(s<-.02||s>1.02)return 0.;
 float e=dot(uv-a,no),f=0.,am=.5,fr=.11;
 for(int i=0;i<4;i++){f+=am*(textureLod(tBruit,vec3(s*fr+g*.37,g*.19,.2),0.).r*2.-1.);am*=.55;fr*=2.3;}
 float d=abs(e-f*sin(PI*clamp(s,0.,1.))*l*.34);
 return .0034/(d+.0016)*smoothstep(0.,.05,s)*smoothstep(1.,.95,s);
}

// ---------- le tunnel du temps : nuages en spirale, cadrans et roues qui filent ----------
vec3 tunnel(vec3 rd){
 rd.xy=rot(uT*.5)*rd.xy;
 float r=length(rd.xy),a=atan(rd.y,rd.x);
 float dz=max(-rd.z,.05);
 vec3 c=vec3(0.);
 for(int i=0;i<3;i++){
  float fi=float(i),R=1.+fi*.9;
  float z=R*dz/max(r,.03);
  float tw=a+z*.16-uT*(.8+.3*fi);
  vec3 q=vec3(cos(tw)*.5,sin(tw)*.5,(z-uTunnel*(1.+.2*fi))*.016);
  float n=bruit(q)*.6+bruit(q*2.3+.3)*.4;
  n=smoothstep(.42,.66,n);
  float prof=exp(-z*.03);
  vec3 col=mix(vec3(1.,.6,.22),vec3(.13,.26,1.),clamp(prof*1.25,0.,1.));
  c+=col*n*(.2+.9*(1.-prof))*(1.-fi*.2);
 }
 float st=bruit(vec3(cos(a)*5.3,sin(a)*5.3,uTunnel*.0012));
 c+=vec3(.7,.82,1.)*pow(max(st,0.),11.)*7.*smoothstep(.2,.9,r);
 c+=vec3(1.,.72,.4)*exp(-r*9.)*1.5+vec3(1.,.96,.84)*exp(-r*42.)*12.;
 const float L=11.;
 float base=floor(uTunnel/L);
 for(int k=8;k>=0;k--){
  float z=(base+float(k)+1.)*L-uTunnel,tp=z/dz;
  vec2 pl=rd.xy*tp;
  float sp=base+float(k),h=fract(sp*.618);
  float pres=smoothstep(.5,6.,z),loin=exp(-z*.014);
  float genre=mod(sp,3.);
  if(genre<.5){
   vec2 u=rot(sp+uT*(h-.5)*2.)*pl/9.5;
   if(length(u)<1.){
    float m=1.-textureLod(tMasque,u*.5+.5,.8).r;
    c+=vec3(.55,.76,1.)*m*1.1*pres*loin;
   }
  } else {
   float sens=mod(sp,2.)*2.-1.;
   float ech=genre<1.5?14.:8.4;
   vec2 u=rot(sens*uT*(1.1+h)+sp)*pl/ech;
   if(length(u)<.96){
    float m=1.-textureLod(tMasque,u*.5+.5,.6).b;
    c*=1.-m*.96*pres;
    c+=vec3(1.,.58,.22)*m*.34*pres*loin*(1.+1.5*h);
   }
  }
 }
 return c;
}

// `N` : la brume d'un reflet sur le sol n'a pas besoin du détail de celle qu'on regarde en face.
vec4 volume(vec3 ro,vec3 rd,float tfin,float jit,int N){
 float tf=min(tfin,52.);
 float dt=tf/float(N);
 vec3 li=vec3(0.); float T=1.;
 float cosT=dot(rd,normalize(CF-ro));
 float ph=.1+.9*pow(max(cosT,0.),10.);
 for(int i=0;i<N;i++){
  float t=(float(i)+jit)*dt;
  vec3 p=ro+rd*t;
  float d=brume(p);
  float s=rayon(p);
  vec3 c=vec3(.42,.56,1.)*s*ph*uFenetre*.35;
  vec3 g=p-CC-vec3(0.,.3,0.);
  c+=vec3(1.,.55,.18)*uCercle*.22*(1.+uInvoque*9.)/(1.+dot(g,g)*(.8-.62*min(uInvoque,1.)));
  vec2 ci=vec2(abs(p.x)-5.2,p.z+7.);
  c+=vec3(1.,.45,.13)*uCercle*.12/(1.+dot(ci,ci)*.2+(p.y-1.)*(p.y-1.)*.25);
  c+=vec3(.05,.065,.13)*.012;
  li+=T*c*d*dt;
  T*=exp(-d*dt*.72);
 }
 return vec4(li,T);
}

void main(){
 poser();
 vec2 px=gl_FragCoord.xy+uJit;
 vec2 uv=(px-.5*uRes)/uRes.y*2.;
 vec3 f=normalize(uCible-uCam),r=normalize(cross(f,vec3(sin(uRoulis),cos(uRoulis),0.))),u=cross(r,f);
 float k=1./tan(radians(uFov)*.5);
 gF=f;gR=r;gU=u;gK=k;
 vec3 ro=uCam,rd=normalize(uv.x*r+uv.y*u+k*f);
 if(uTunnel>.001){sortie=vec4(tunnel(rd),1.);return;}
 float jit=ign(gl_FragCoord.xy+uGraine*531.);
 float tMax=rd.z<0.?min(64.,(-25.6-ro.z)/rd.z):64.;
 float m; float t=marcher(ro,rd,tMax,150,m);
 vec3 c;
 if(m>0.){
  vec3 p=ro+rd*t;
  vec3 n=normale(p,.0012*t+.002);
  if(m<1.5){ // relief et joints de dalles
   float e=.02; vec3 q=p*.9;
   vec3 g=vec3(bruit(q+vec3(e,0,0))-bruit(q-vec3(e,0,0)),0.,bruit(q+vec3(0,0,e))-bruit(q-vec3(0,0,e)));
   n=normalize(n-g*.28*step(.8,n.y));
  }
  float rf;
  c=eclairer(p,n,rd,m,t,rf);
  // le cercle de runes, gravé dans le sol
  if(m<1.5&&p.y<.02){
   vec2 q=(p.xz-CC.xz)/RC; q.y=-q.y;
   float d=length(q);
   if(d<1.25){
    float g=textureLod(tGlyphe,q/1.25*.5+.5,.4).r;
    float halo=textureLod(tGlyphe,q/1.25*.5+.5,4.5).r;
    float ang=atan(q.y,q.x);
    float vague=.62+.38*sin(ang*3.-W(2.)*uT);
    vec3 orr=vec3(1.,.66,.26);
    float front=(ang+PI)/TAU;
    float bal=smoothstep(0.,.05,uBalaye*1.08-front);
    float etincelle=exp(-abs(uBalaye*1.08-front)*40.)*(1.-smoothstep(.9,1.,uBalaye));
    c+=orr*g*uCercle*bal*vague*3.2*(1.+uInvoque*3.5)+orr*g*uCercle*etincelle*14.;
    c+=orr*halo*uCercle*.5*bal;
   }
  }
  if(m<1.5&&p.y<.02&&uOnde>0.){
   float rayonOnde=uOnde*17.,dO=length(p.xz-CC.xz);
   c+=vec3(1.,.7,.34)*exp(-(dO-rayonOnde)*(dO-rayonOnde)*1.6)*(1.-uOnde)*(1.-uOnde)*9.;
  }
  if(rf>.001){
   float fr=.1+.9*pow(1.-max(dot(n,-rd),0.),4.);
   vec3 rr=reflect(rd,n);
   float tmr=rr.z<0.?min(60.,(-25.6-p.z)/rr.z):60.;
   float mr; float tr=marcher(p+n*.03,rr,tmr,70,mr);
   vec3 cr;
   if(mr>0.){ vec3 pr=p+rr*tr; vec3 nr=normale(pr,.01); float d0; cr=eclairer(pr,nr,rr,mr,tr,d0); }
   else cr=fondOuvert(p,rr);
   vec4 vr=volume(p,rr,min(tr,34.),jit,14);
   cr=cr*vr.a+vr.rgb;
   c=mix(c,cr,fr*rf);
   c+=cr*rf*.12;
  }
 } else {
  c=fondOuvert(ro,rd);
 }
 vec4 v=volume(ro,rd,t,jit,44);
 c=c*v.a+v.rgb;
 // la colonne de lumière : un cœur blanc, des filaments qui montent, des anneaux qui s'élèvent
 if(uInvoque>.001){
  vec2 a=CC.xz-ro.xz,h=rd.xz;
  float tt=dot(a,h)/max(dot(h,h),1e-5);
  float d=length(a-h*tt),y=ro.y+rd.y*tt;
  float cote=dot(a-h*tt,vec2(h.y,-h.x))/max(length(h),1e-4);
  float haut=smoothstep(6.2,.4,y)*smoothstep(-.3,.1,y);
  float large=1.+1.8*(1.-min(uInvoque,1.));
  if(tt>0.&&tt<t+3.){
   float fil=bruit(vec3(cote*.32+.1,y*.012-uT*.16,uT*.05));
   fil=.45+1.5*smoothstep(.42,.7,fil);
   float eau=exp(-d*d*1.4/large);
   c+=vec3(1.,.66,.3)*uInvoque*(eau*.44*fil+exp(-d*d*16./large)*2.8)*haut;
   for(int i=0;i<4;i++){
    float yy=fract(uT*.42+float(i)/4.)*7.;
    float tp=(yy-ro.y)/rd.y;
    if(tp>0.&&tp<t+1.){
     vec3 q=ro+rd*tp;
     float rr=1.4+yy*.3,dq=length(q.xz-CC.xz);
     c+=vec3(1.,.72,.36)*uInvoque*exp(-pow((dq-rr)*7.,2.))*1.4*(1.-yy/7.);
    }
   }
  }
 }
 // la foudre du temps, entre le bâton, l'astrolabe et le disque
 if(uFoudre>.01){
  vec2 uvf=uv;
  vec2 ob=proj(versMonde(gMainD*vec3(1.,0.,1.)+vec3(.15,13.8+uBaton,0.),0.));
  vec2 mg=proj(versMonde(gMainG+vec3(0.,.42,0.),0.));
  float gr=floor(uT*11.);
  float e=eclair(uvf,ob,proj(CF+vec3(3.4,3.2,0.)),gr)+eclair(uvf,ob,proj(gCentre+vec3(6.,-3.4,2.)),gr+3.);
  e+=eclair(uvf,mg,proj(CF+vec3(-3.,4.,0.)),gr+7.)+eclair(uvf,mg,proj(gCentre+vec3(-6.5,-3.,2.)),gr+11.);
  e+=eclair(uvf,mg,ob,gr+13.)*.7;
  c+=vec3(.5,.72,1.)*e*uFoudre*1.6;
 }
 // yeux du magicien : deux braises sous le bord du chapeau
 // yeux du magicien : deux braises sous le bord du chapeau
 for(int i=0;i<2;i++){
  vec3 oe=versMonde(vec3(i==0?-.33:.33,7.05,1.02),1.)-ro;
  float z=dot(oe,rd);
  vec3 o=oe-rd*z;
  vec2 s=vec2(dot(o,r),dot(o,u));
  float d=length(s)/max(z*.03,.12);
  s=rot(i==0?-.32:.32)*s;
  float e=length(s/vec2(.075,.016));
  c+=vec3(1.,.72,.3)*uYeux*(exp(-e*e)*12.+exp(-d*4.)*.1);
 }
 {
  vec3 ob=versMonde(gMainD*vec3(1.,0.,1.)+vec3(.15+.1*gS1,13.8+uBaton,0.),0.)-ro; float z=dot(ob,rd); float d=length(ob-rd*z)/max(z,.1)*40.;
  float pouls=.8+.2*sin(W(2.)*uT)+uGeste*1.4;
  c+=vec3(.5,.7,1.)*uYeux*pouls*(exp(-d*d*50.)*5.+exp(-d*5.)*.14);
  vec3 om_=versMonde(gMainG+vec3(0.,.42,0.),0.)-ro; z=dot(om_,rd); d=length(om_-rd*z)/max(z,.1)*40.;
  c+=vec3(1.,.66,.26)*uYeux*(.8+.2*sin(W(3.)*uT+1.)+uGeste*2.)*(exp(-d*d*90.)*4.+exp(-d*6.)*.12);
 }
 sortie=vec4(max(c,vec3(0.)),1.);
}
