import * as THREE from 'three';

/**
 * 经典人像摄影布光预设配置表
 */
export const LIGHTING_PRESETS = {
  paramount: {
    id: 'paramount',
    name: '蝴蝶光 (Paramount)',
    icon: '🦋',
    description: '主光正高位俯照，鼻下形成小蝴蝶阴影，突出五官对称与颧骨线条，好莱坞黄金时代经典。',
    azimuth: 0,       // 正前高位
    elevation: 55,    // 55° 俯冲
    keyIntensity: 1.8,
    fillRatio: 0.35,  // 较强光比，凸显阴影
    rimIntensity: 0.4,
    promptTag: 'paramount butterfly lighting, glamorous butterfly shadow under nose, high-fashion portrait illumination, sculpted cheekbones'
  },
  rembrandt: {
    id: 'rembrandt',
    name: '伦勃朗光 (Rembrandt)',
    icon: '🎨',
    description: '主光在侧前45°高位，面颊暗部形成标志性倒三角光斑，极具戏剧张力与古典油画感。',
    azimuth: 45,      // 侧前 45°
    elevation: 45,    // 45° 仰角
    keyIntensity: 1.75,
    fillRatio: 0.3,   // 经典油画明暗对比
    rimIntensity: 0.6,
    promptTag: 'classic Rembrandt lighting, dramatic chiaroscuro, signature triangle light patch on cheek, painterly depth, cinematic mood'
  },
  rim: {
    id: 'rim',
    name: '侧逆轮廓光 (Rim)',
    icon: '🌅',
    description: '强主光置于侧后方，金边勾勒发丝与身体优美外轮廓，将人物与背景剥离，电影氛围拉满。',
    azimuth: 140,     // 侧后方 140°
    elevation: 50,
    keyIntensity: 2.2,
    fillRatio: 0.2,   // 极强光比
    rimIntensity: 1.6,
    promptTag: 'atmospheric rim lighting, ethereal hair backlight, dramatic silhouette glow, cinematic edge separation, golden hour glow'
  },
  soft_window: {
    id: 'soft_window',
    name: '窗边漫射柔光 (Soft)',
    icon: '☁️',
    description: '大面积漫射柔光，阴影过渡平缓几乎无硬边，肤质温润通透，适合日系小清新与居家私房。',
    azimuth: 35,
    elevation: 32,
    keyIntensity: 1.25,
    fillRatio: 0.75,  // 低光比，极为柔和
    rimIntensity: 0.25,
    promptTag: 'soft diffused window lighting, gentle wrap-around illumination, low contrast, natural skin glow, airy atmosphere'
  }
};

/**
 * 色温预设配置
 */
export const COLOR_TEMP_PRESETS = {
  warm: {
    id: 'warm',
    name: '暖光 3200K',
    color: 0xffe2b8,
    label: '🔥 暖调',
    promptTag: 'warm 3200k tungsten ambient, golden skin warmth'
  },
  white: {
    id: 'white',
    name: '闪光 5500K',
    color: 0xffffff,
    label: '⚪ 闪光',
    promptTag: 'crisp 5500k studio strobe, neutral color balance'
  },
  cool: {
    id: 'cool',
    name: '冷调 6500K',
    color: 0xd4e6ff,
    label: '❄️ 冷光',
    promptTag: 'cool 6500k cinematic blue hour, moody tone'
  }
};

export class StudioLightingManager {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.currentPresetId = 'paramount';
    this.currentTempKey = 'white';
    
    this.azimuth = 0;
    this.elevation = 55;
    this.keyIntensity = 1.8;
    this.fillRatio = 0.35; // 0.1 (硬光) ~ 0.9 (极柔光)
    this.rimIntensity = 0.4;
    this.lightDistance = 3.6;
    this.targetHeight = 0.95; // 人像受光中心约为胸口/面部位置

    this.group = new THREE.Group();
    this.group.name = 'StudioLightingRig';
    this.scene.add(this.group);

    this.initLights();
    this.applyPreset('paramount');
  }

  initLights() {
    // 1. 环境光 (微弱基础漫反射，杜绝死黑)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.group.add(this.ambientLight);

    // 2. 主光 Key Light (核心造型光，投射真实柔和阴影)
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 10.0;
    this.keyLight.shadow.camera.left = -1.4;
    this.keyLight.shadow.camera.right = 1.4;
    this.keyLight.shadow.camera.top = 2.0;
    this.keyLight.shadow.camera.bottom = -0.3;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.radius = 2.5; // 柔化阴影边缘
    this.group.add(this.keyLight);
    this.group.add(this.keyLight.target);

    // 3. 辅光 Fill Light (控制暗部细节与光比)
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.fillLight.castShadow = false;
    this.group.add(this.fillLight);
    this.group.add(this.fillLight.target);

    // 4. 轮廓光 Rim Light (勾勒发丝与身体剪影边缘)
    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    this.rimLight.castShadow = false;
    this.group.add(this.rimLight);
    this.group.add(this.rimLight.target);

    // 设置目标瞄准点
    this.keyLight.target.position.set(0, this.targetHeight, 0);
    this.fillLight.target.position.set(0, this.targetHeight, 0);
    this.rimLight.target.position.set(0, this.targetHeight, 0);
  }

  /**
   * 应用经典光位预设
   */
  applyPreset(presetKey) {
    const preset = LIGHTING_PRESETS[presetKey] || LIGHTING_PRESETS.paramount;
    this.currentPresetId = preset.id;
    this.azimuth = preset.azimuth;
    this.elevation = preset.elevation;
    this.keyIntensity = preset.keyIntensity;
    this.fillRatio = preset.fillRatio;
    this.rimIntensity = preset.rimIntensity;

    this.updateLights();
  }

  /**
   * 设置主光水平方位角 (0° ~ 360°)
   */
  setAzimuth(deg) {
    this.azimuth = (deg % 360 + 360) % 360;
    this.updateLights();
  }

  /**
   * 设置主光仰角高度 (15° ~ 75°)
   */
  setElevation(deg) {
    this.elevation = Math.max(15, Math.min(75, deg));
    this.updateLights();
  }

  /**
   * 设置光比 / 辅光充盈度 (0.1 ~ 0.9)
   */
  setFillRatio(ratio) {
    this.fillRatio = Math.max(0.1, Math.min(0.9, ratio));
    this.updateLights();
  }

  /**
   * 设置色温
   */
  setColorTemp(tempKey) {
    const config = COLOR_TEMP_PRESETS[tempKey] || COLOR_TEMP_PRESETS.white;
    this.currentTempKey = config.id;
    const c = new THREE.Color(config.color);
    
    this.keyLight.color.copy(c);
    // 辅光保持微偏冷以形成自然对比，或跟随色温
    this.fillLight.color.copy(c);
    this.rimLight.color.set(config.id === 'warm' ? 0xfffaed : (config.id === 'cool' ? 0xb0d4ff : 0xffffff));
  }

  /**
   * 核心数学计算：球坐标到三维光位矩阵映射
   */
  updateLights() {
    const r = this.lightDistance;
    const phi = (90 - this.elevation) * (Math.PI / 180);
    const theta = this.azimuth * (Math.PI / 180);

    // 1. 主光坐标 (以模特中心为原点)
    const kx = r * Math.sin(phi) * Math.sin(theta);
    const ky = this.targetHeight + r * Math.cos(phi);
    const kz = r * Math.sin(phi) * Math.cos(theta);
    this.keyLight.position.set(kx, ky, kz);
    this.keyLight.intensity = this.keyIntensity;

    // 2. 辅光坐标 (主光对侧偏前方 120°，较低机位 25°)
    const fillTheta = (this.azimuth + 120) * (Math.PI / 180);
    const fillPhi = (90 - 25) * (Math.PI / 180);
    const fx = (r * 1.1) * Math.sin(fillPhi) * Math.sin(fillTheta);
    const fy = this.targetHeight + (r * 1.1) * Math.cos(fillPhi);
    const fz = (r * 1.1) * Math.sin(fillPhi) * Math.cos(fillTheta);
    this.fillLight.position.set(fx, fy, fz);
    this.fillLight.intensity = this.keyIntensity * this.fillRatio;

    // 3. 轮廓背光坐标 (主光对侧偏后方 150°，高位 50°)
    const rimTheta = (this.azimuth + 150) * (Math.PI / 180);
    const rimPhi = (90 - 50) * (Math.PI / 180);
    const rx = (r * 1.0) * Math.sin(rimPhi) * Math.sin(rimTheta);
    const ry = this.targetHeight + (r * 1.0) * Math.cos(rimPhi);
    const rz = (r * 1.0) * Math.sin(rimPhi) * Math.cos(rimTheta);
    this.rimLight.position.set(rx, ry, rz);
    this.rimLight.intensity = this.rimIntensity;

    // 4. 环境光根据辅光比例轻微自适应
    this.ambientLight.intensity = 0.25 + (this.fillRatio * 0.2);
  }

  /**
   * 组合当前布光与色温的 AI 摄影生成提示词
   */
  getPromptSnippet() {
    const preset = LIGHTING_PRESETS[this.currentPresetId] || LIGHTING_PRESETS.paramount;
    const temp = COLOR_TEMP_PRESETS[this.currentTempKey] || COLOR_TEMP_PRESETS.white;
    return `${preset.promptTag}, ${temp.promptTag}`;
  }
}
