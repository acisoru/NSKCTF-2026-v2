#version 330
in vec2 fragTexCoord;
in vec4 fragColor;
uniform sampler2D texture0;
uniform vec2 resolution;
uniform float worldTime;
out vec4 finalColor;

float grain(vec2 pixel, float time) {
    return fract(sin(dot(pixel + vec2(time * 17.0, time * 13.0), vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 uv = fragTexCoord;
    vec3 color = texture(texture0, uv).rgb;
    vec2 pixel = 1.0 / resolution;
    vec3 glow = vec3(0.0);
    vec2 taps[8] = vec2[8](
        vec2(-5.0, 0.0), vec2(5.0, 0.0), vec2(0.0, -5.0), vec2(0.0, 5.0),
        vec2(-3.0, -3.0), vec2(3.0, -3.0), vec2(-3.0, 3.0), vec2(3.0, 3.0));
    for (int i = 0; i < 8; i++) {
        vec3 sampleColor = texture(texture0, uv + taps[i] * pixel).rgb;
        glow += max(sampleColor - vec3(0.54), vec3(0.0));
    }
    color += glow * 0.075;
    float lift = 0.026;
    color = color * 1.08 + vec3(lift, lift * 1.05, lift * 1.10);
    float vignette = 1.0 - 0.27 * smoothstep(0.28, 0.80, length((uv - 0.5) * vec2(1.2, 1.0)));
    color *= vignette;
    color += (grain(gl_FragCoord.xy, worldTime) - 0.5) * 0.010;
    finalColor = vec4(clamp(color, 0.0, 1.0), 1.0) * fragColor;
}
