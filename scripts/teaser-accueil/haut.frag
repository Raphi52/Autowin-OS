#version 300 es
precision highp float;
in vec2 vUv; out vec4 c; uniform sampler2D t; uniform vec2 uPas; uniform float k;
void main(){ vec2 d=uPas; vec3 r=texture(t,vUv).rgb*4.;
 r+=(texture(t,vUv+vec2(d.x,0)).rgb+texture(t,vUv-vec2(d.x,0)).rgb+texture(t,vUv+vec2(0,d.y)).rgb+texture(t,vUv-vec2(0,d.y)).rgb)*2.;
 r+=texture(t,vUv+d).rgb+texture(t,vUv-d).rgb+texture(t,vUv+vec2(d.x,-d.y)).rgb+texture(t,vUv+vec2(-d.x,d.y)).rgb;
 c=vec4(r/16.*k,1.); }
