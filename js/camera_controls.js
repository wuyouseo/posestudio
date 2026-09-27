import * as THREE from 'three';

export class CameraManager {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {any} controls OrbitControls 实例
   * @param {HTMLElement} viewportContainer
   */
  constructor(camera, controls, viewportContainer) {
    this.camera = camera;
    this.controls = controls;
    this.container = viewportContainer;

    // 默认人像中心高度 (大约在胸口-盆骨中间 1.0m 高度)
    this.targetCenter = new THREE.Vector3(0, 1.0, 0);
    this.controls.target.copy(this.targetCenter);

    // 焦段映射 (焦距 mm -> 对应的相机 FOV)
    // 35mm 全画幅传感器垂直高度 24mm
    // fov = 2 * Math.atan(12 / focalLength) * (180 / Math.PI)
    this.focalLengths = {
      24: 53.1,
      28: 46.4,
      35: 37.8,
      50: 27.0,
      85: 16.1,
      135: 10.2
    };

    // 常用画幅比例 (width / height)
    this.aspectRatios = {
      '3:4': 3 / 4,
      '9:16': 9 / 16,
      '1:1': 1 / 1,
      '2:3': 2 / 3,
      '16:9': 16 / 9
    };

    this.currentAspect = '3:4';
  }

  /**
   * 快捷机位切换
   * @param {'front'|'left45'|'right45'|'left90'|'low'|'high'|'back'} angleType 
   */
  setAnglePreset(angleType) {
    const dist = 3.2; // 默认观察距离
    const center = this.targetCenter;

    let targetCamPos = new THREE.Vector3();

    switch (angleType) {
      case 'front': // 正面平视
        targetCamPos.set(0, center.y + 0.1, dist);
        break;
      case 'left45': // 摄影师视角的左前方 45 度
        targetCamPos.set(-dist * 0.707, center.y + 0.1, dist * 0.707);
        break;
      case 'right45': // 摄影师视角的右前方 45 度
        targetCamPos.set(dist * 0.707, center.y + 0.1, dist * 0.707);
        break;
      case 'left90': // 正侧面
        targetCamPos.set(-dist, center.y + 0.1, 0);
        break;
      case 'low': // 仰拍 (低机位向上看，显腿长、张力感)
        targetCamPos.set(0, 0.25, dist * 0.85);
        break;
      case 'high': // 俯拍 (高机位俯视，情绪感、面部与眼神)
        targetCamPos.set(0, 2.2, dist * 0.75);
        break;
      case 'back': // 背部机位
        targetCamPos.set(0, center.y + 0.1, -dist);
        break;
      default:
        targetCamPos.set(0, center.y, dist);
    }

    this.camera.position.copy(targetCamPos);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /**
   * 切换镜头模拟焦段
   * @param {number} mm 
   */
  setFocalLength(mm) {
    const fov = this.focalLengths[mm] || 27.0;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 设置人像画幅比例，并更新视口遮罩
   * @param {string} aspectKey 
   */
  setAspectRatio(aspectKey) {
    if (!this.aspectRatios[aspectKey]) return;
    this.currentAspect = aspectKey;
    const ratio = this.aspectRatios[aspectKey];

    // 获取视口容器尺寸
    const rect = this.container.getBoundingClientRect();
    const cWidth = rect.width;
    const cHeight = rect.height;

    let targetWidth, targetHeight;

    if (cWidth / cHeight > ratio) {
      targetHeight = cHeight * 0.94;
      targetWidth = targetHeight * ratio;
    } else {
      targetWidth = cWidth * 0.94;
      targetHeight = targetWidth / ratio;
    }

    return {
      aspectRatio: ratio,
      frameWidth: Math.round(targetWidth),
      frameHeight: Math.round(targetHeight)
    };
  }
}
