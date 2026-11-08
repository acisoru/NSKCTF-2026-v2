#version 330
in vec3 fragPosition;
in vec2 fragTexCoord;
in vec4 fragColor;
in vec3 fragNormal;
uniform sampler2D texture0;
uniform vec4 colDiffuse;
uniform vec3 lightPos;
uniform vec3 lightTint;
uniform vec3 secondaryPos;
uniform vec3 secondaryTint;
uniform vec3 viewPos;
uniform float worldTime;
uniform vec3 lightDir;
uniform mat4 lightVP;
uniform sampler2D shadowMap;
uniform int shadowMapResolution;
uniform int shadowEnabled;
out vec4 finalColor;
void main() {
    vec4 albedo = texture(texture0, fragTexCoord) * colDiffuse * fragColor;
    vec3 normal = normalize(fragNormal);
    vec3 sun = normalize(-lightDir);
    float diffuse = max(dot(normal, sun), 0.0);
    vec4 fromLight = lightVP * vec4(fragPosition, 1.0);
    vec3 mapCoords = fromLight.xyz / fromLight.w * 0.5 + 0.5;
    float shadow = 0.0;
    if (shadowEnabled != 0 && mapCoords.x >= 0.0 && mapCoords.x <= 1.0 && mapCoords.y >= 0.0 && mapCoords.y <= 1.0 && mapCoords.z <= 1.0) {
        float bias = max(0.00025 * (1.0 - diffuse), 0.00004);
        float texel = 1.0 / float(shadowMapResolution);
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
            float depth = texture(shadowMap, mapCoords.xy + vec2(float(x), float(y)) * texel).r;
            shadow += mapCoords.z - bias > depth ? 1.0 : 0.0;
        }
        shadow /= 9.0;
    }
    vec3 towardLamp = lightPos - fragPosition;
    float distanceToLamp = length(towardLamp);
    vec3 lampDir = normalize(towardLamp);
    float local = max(dot(normal, lampDir), 0.0);
    float falloff = 1.0 / (1.0 + 0.022 * distanceToLamp * distanceToLamp);
    vec3 towardSecondary = secondaryPos - fragPosition;
    float secondaryDistance = length(towardSecondary);
    float secondary = max(dot(normal, normalize(towardSecondary)), 0.0);
    float secondaryFalloff = 1.0 / (1.0 + 0.028 * secondaryDistance * secondaryDistance);
    vec3 viewDir = normalize(viewPos - fragPosition);
    float highlight = pow(max(dot(reflect(-lampDir, normal), viewDir), 0.0), 28.0) * falloff;
    float flicker = 0.94 + 0.06 * sin(worldTime * 2.7) + 0.025 * sin(worldTime * 9.1);
    vec3 illumination = vec3(0.35, 0.41, 0.45) + diffuse * (1.0 - shadow * 0.78) * vec3(0.35, 0.35, 0.32)
                      + local * falloff * lightTint * 1.25 * flicker
                      + secondary * secondaryFalloff * secondaryTint * 0.95;
    vec3 lit = albedo.rgb * illumination + highlight * lightTint * 0.32;
    float fog = smoothstep(16.0, 46.0, length(viewPos - fragPosition));
    lit = mix(lit, vec3(0.10, 0.17, 0.20), fog * 0.36);
    finalColor = vec4(lit, albedo.a);
}
