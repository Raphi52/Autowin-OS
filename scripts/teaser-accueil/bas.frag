#version 300 es
precision highp float;
in vec2 vUv; out vec4 c; uniform sampler2D t; uniform vec2 uPas;
void main(){ vec2 d=uPas;
 vec3 a=texture(t,vUv+d*vec2(-2,2)).rgb,b=texture(t,vUv+d*vec2(0,2)).rgb,e=texture(t,vUv+d*vec2(2,2)).rgb;
 vec3 f=texture(t,vUv+d*vec2(-2,0)).rgb,g=texture(t,vUv).rgb,h=texture(t,vUv+d*vec2(2,0)).rgb;
 vec3 i=texture(t,vUv+d*vec2(-2,-2)).rgb,j=texture(t,vUv+d*vec2(0,-2)).rgb,k=texture(t,vUv+d*vec2(2,-2)).rgb;
 vec3 l=texture(t,vUv+d*vec2(-1,1)).rgb,m=texture(t,vUv+d*vec2(1,1)).rgb,n=texture(t,vUv+d*vec2(-1,-1)).rgb,o=texture(t,vUv+d*vec2(1,-1)).rgb;
 vec3 r=g*.125+(a+e+i+k)*.03125+(b+f+h+j)*.0625+(l+m+n+o)*.125;
 c=vec4(min(r,vec3(60.)),1.); }
