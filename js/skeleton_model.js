import * as THREE from 'three';
import { OPENPOSE_KEYPOINTS, OPENPOSE_LIMBS, DEFAULT_T_POSE_JOINTS } from './openpose_definition.js';

/**
 * 肤色预设配置 (PBR 材质次表面散射 SSS 模拟，真实温润肤色)
 */
const SKIN_PALETTES = {
  female: {
    color: 0xf2ded2,        // 温暖柔美象牙粉白肤色
    emissive: 0x48291f,     // 暖红微透光 (模拟皮下微血管次表面散射)
    roughness: 0.44,
    metalness: 0.02
  },
  male: {
    color: 0xd8b99d,        // 阳光健康暖麦小麦色
    emissive: 0x3d2015,     // 暖褐微透光
    roughness: 0.48,
    metalness: 0.02
  },
  child: {
    color: 0xf9e7de,        // 晶莹娇嫩粉白
    emissive: 0x4e2d23,
    roughness: 0.40,
    metalness: 0.01
  }
};

/**
 * 创建具有解剖学纺锤形肌肉隆起的旋转体几何体
 * @param {number} rTop 顶端接触面半径
 * @param {number} rMid 肌肉腹部最粗隆起半径
 * @param {number} rBottom 底端接触面半径
 * @param {number} midPos 肌肉隆起峰值位置 (0.0: 底部, 1.0: 顶部)
 * @param {number} segments 环向切分精度
 */
function createMuscleLimbGeo(rTop, rMid, rBottom, midPos = 0.65, segments = 18) {
  const points = [];
  const slices = 14;
  for (let i = 0; i <= slices; i++) {
    const t = i / slices; // 0.0 (底端) -> 1.0 (顶端)
    const y = t - 0.5;    // 沿局部中心从 -0.5 到 +0.5
    let r;
    if (t < midPos) {
      const u = t / midPos;
      const s = Math.sin((u * Math.PI) / 2);
      r = rBottom + (rMid - rBottom) * s;
    } else {
      const u = (t - midPos) / (1.0 - midPos);
      const c = Math.cos((u * Math.PI) / 2);
      r = rTop + (rMid - rTop) * c;
    }
    points.push(new THREE.Vector2(Math.max(r, 0.006), y));
  }
  return new THREE.LatheGeometry(points, segments);
}

/**
 * 单个人体骨架与体块轮廓实体 (支持 OpenPose 骨骼与 Lineart 精致手绘线稿双模式)
 */
export class HumanEntity {
  /**
   * @param {THREE.Scene|THREE.Group} parentGroup 
   * @param {string} entityId 'personA' | 'personB'
   */
  constructor(parentGroup, entityId = 'personA') {
    this.parentGroup = parentGroup;
    this.entityId = entityId;

    this.group = new THREE.Group();
    this.parentGroup.add(this.group);

    this.jointMeshes = new Map();
    this.limbMeshes = [];
    this.currentJointPositions = {};
    this.targetJointPositions = {};
    this.isTransitioning = false;
    this.transitionProgress = 1;
    this.transitionSpeed = 4.0;

    // 模式: 'openpose' | 'lineart'
    this.styleMode = 'openpose';

    // 体块轮廓
    this.silhouetteGroup = new THREE.Group();
    this.group.add(this.silhouetteGroup);
    this.silhouetteVisible = true;
    this.silhouetteOpacity = 0.55;

    // 线稿边缘组 (Lineart Outline)
    this.lineartGroup = new THREE.Group();
    this.lineartGroup.visible = false;
    this.group.add(this.lineartGroup);
    this.lineartMeshes = [];

    // 默认体型 profile: 'female' | 'male' | 'child'
    this.bodyProfile = 'female';

    this.initSkeleton();
    this.initSilhouette();
    this.initLineart();
  }

  initSkeleton() {
    const sphereGeo = new THREE.SphereGeometry(0.022, 16, 16);

    OPENPOSE_KEYPOINTS.forEach((kp) => {
      const color = new THREE.Color(kp.color);
      const mat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.3,
        metalness: 0.1,
        emissive: color,
        emissiveIntensity: 0.25
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.castShadow = true;
      mesh.userData = {
        isJoint: true,
        entityId: this.entityId,
        jointId: kp.id,
        name: kp.name,
        label: kp.label
      };

      this.jointMeshes.set(kp.id, mesh);
      this.group.add(mesh);

      const defPos = DEFAULT_T_POSE_JOINTS[kp.id];
      const vec = new THREE.Vector3(defPos.x, defPos.y, defPos.z);
      this.currentJointPositions[kp.id] = vec.clone();
      this.targetJointPositions[kp.id] = vec.clone();
      mesh.position.copy(vec);
    });

    OPENPOSE_LIMBS.forEach((limb) => {
      const color = new THREE.Color(limb.color);
      const cylGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 12);
      const cylMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.3,
        metalness: 0.1,
        emissive: color,
        emissiveIntensity: 0.25
      });
      const mesh = new THREE.Mesh(cylGeo, cylMat);
      mesh.castShadow = true;
      mesh.userData = { isLimb: true, entityId: this.entityId, from: limb.from, to: limb.to };

      this.limbMeshes.push({
        from: limb.from,
        to: limb.to,
        mesh: mesh
      });
      this.group.add(mesh);
    });

    this.updateLimbs();
  }

  initSilhouette() {
    this.silhouetteMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2ded2,
      roughness: 0.44,
      metalness: 0.02,
      transparent: true,
      opacity: this.silhouetteOpacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.updateSkinMaterial();

    // ── 1. 头部复合解剖结构 (颅脑卵球 + 下颌下巴 + 耳部) ──
    const headGeo = new THREE.SphereGeometry(0.096, 24, 20);
    headGeo.scale(0.86, 1.12, 0.96);
    this.headMesh = new THREE.Mesh(headGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.headMesh);

    // 下颌下巴立体三角体量
    const chinGeo = new THREE.CylinderGeometry(0.042, 0.024, 0.065, 14);
    chinGeo.scale(0.85, 1.0, 0.95);
    this.chinMesh = new THREE.Mesh(chinGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.chinMesh);

    // ── 2. 颈部与斜方肌过渡 ──
    const neckGeo = new THREE.CylinderGeometry(0.044, 0.054, 1, 16);
    this.neckMesh = new THREE.Mesh(neckGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.neckMesh);

    // ── 3. 躯干三段式解剖体块 (胸廓 + 胸肌/乳房 + 腰腹 + 骨盆与臀部) ──
    // 3.1 胸廓 (上宽下微收的倒梯形胸腔)
    const chestGeo = new THREE.CylinderGeometry(0.142, 0.126, 1, 20);
    this.torsoMesh = new THREE.Mesh(chestGeo, this.silhouetteMaterial); // 保持属性名与外部兼容
    this.chestMesh = this.torsoMesh;
    this.silhouetteGroup.add(this.chestMesh);

    // 胸部体量 (左右前胸饱满体块)
    const chestVolGeo = new THREE.SphereGeometry(0.042, 16, 14);
    chestVolGeo.scale(1.0, 1.05, 0.85);
    this.rChestVolMesh = new THREE.Mesh(chestVolGeo, this.silhouetteMaterial);
    this.lChestVolMesh = new THREE.Mesh(chestVolGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.rChestVolMesh);
    this.silhouetteGroup.add(this.lChestVolMesh);

    // 3.2 腰腹 (沙漏收窄过渡)
    const waistGeo = new THREE.CylinderGeometry(0.122, 0.112, 1, 20);
    this.waistMesh = new THREE.Mesh(waistGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.waistMesh);

    // 3.3 骨盆与下腹
    const pelvisGeo = new THREE.CylinderGeometry(0.116, 0.138, 1, 20);
    this.pelvisMesh = new THREE.Mesh(pelvisGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.pelvisMesh);

    // 3.4 臀大肌 (后方自然翘挺的立体弧线)
    const gluteGeo = new THREE.SphereGeometry(0.062, 18, 14);
    gluteGeo.scale(0.92, 1.05, 0.95);
    this.rGluteMesh = new THREE.Mesh(gluteGeo, this.silhouetteMaterial);
    this.lGluteMesh = new THREE.Mesh(gluteGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.rGluteMesh);
    this.silhouetteGroup.add(this.lGluteMesh);

    // ── 4. 纺锤形解剖肌肉四肢 (带真实的肌腹隆起与两端肌腱收窄) ──
    this.limbCapsuleDefs = [
      { name: 'RUpperArm', from: 2, to: 3, rTop: 0.045, rMid: 0.052, rBottom: 0.035, midPos: 0.55 },
      { name: 'RForearm',  from: 3, to: 4, rTop: 0.037, rMid: 0.042, rBottom: 0.026, midPos: 0.68 },
      { name: 'LUpperArm', from: 5, to: 6, rTop: 0.045, rMid: 0.052, rBottom: 0.035, midPos: 0.55 },
      { name: 'LForearm',  from: 6, to: 7, rTop: 0.037, rMid: 0.042, rBottom: 0.026, midPos: 0.68 },
      { name: 'RThigh',    from: 8, to: 9, rTop: 0.068, rMid: 0.076, rBottom: 0.048, midPos: 0.62 },
      { name: 'RCalf',     from: 9, to: 10, rTop: 0.048, rMid: 0.058, rBottom: 0.033, midPos: 0.68 },
      { name: 'LThigh',    from: 11, to: 12, rTop: 0.068, rMid: 0.076, rBottom: 0.048, midPos: 0.62 },
      { name: 'LCalf',     from: 12, to: 13, rTop: 0.048, rMid: 0.058, rBottom: 0.033, midPos: 0.68 }
    ];

    this.limbVolumeMeshes = [];
    this.limbCapsuleDefs.forEach((def) => {
      const geo = createMuscleLimbGeo(def.rTop, def.rMid, def.rBottom, def.midPos, 18);
      const mesh = new THREE.Mesh(geo, this.silhouetteMaterial);
      this.silhouetteGroup.add(mesh);
      this.limbVolumeMeshes.push({
        ...def,
        mesh: mesh
      });
    });

    // ── 5. 关节球过渡系统 (消除所有体块连接断裂缝隙) ──
    this.jointSphereDefs = [
      { name: 'rShoulder', jointId: 2, radius: 0.052 },
      { name: 'lShoulder', jointId: 5, radius: 0.052 },
      { name: 'rElbow',    jointId: 3, radius: 0.036 },
      { name: 'lElbow',    jointId: 6, radius: 0.036 },
      { name: 'rWrist',    jointId: 4, radius: 0.027 },
      { name: 'lWrist',    jointId: 7, radius: 0.027 },
      { name: 'rHip',      jointId: 8, radius: 0.058 },
      { name: 'lHip',      jointId: 11, radius: 0.058 },
      { name: 'rKnee',     jointId: 9, radius: 0.045 },
      { name: 'lKnee',     jointId: 12, radius: 0.045 },
      { name: 'rAnkle',    jointId: 10, radius: 0.031 },
      { name: 'lAnkle',    jointId: 13, radius: 0.031 },
    ];
    this.jointSphereMeshes = {};
    this.jointSphereDefs.forEach(def => {
      const geo = new THREE.SphereGeometry(def.radius, 16, 12);
      const mesh = new THREE.Mesh(geo, this.silhouetteMaterial);
      this.silhouetteGroup.add(mesh);
      this.jointSphereMeshes[def.name] = { ...def, mesh };
    });

    // ── 6. 解剖级手掌与足部系统 ──
    // 手掌体量 (手腕到掌指关节渐宽梯形)
    const handGeo = new THREE.BoxGeometry(0.056, 0.076, 0.022);
    this.rHandMesh = new THREE.Mesh(handGeo, this.silhouetteMaterial);
    this.lHandMesh = new THREE.Mesh(handGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.rHandMesh);
    this.silhouetteGroup.add(this.lHandMesh);

    // 足部体量 (脚跟弧度 + 落地前脚掌)
    const footGeo = new THREE.BoxGeometry(0.062, 0.032, 0.125);
    this.rFootMesh = new THREE.Mesh(footGeo, this.silhouetteMaterial);
    this.lFootMesh = new THREE.Mesh(footGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.rFootMesh);
    this.silhouetteGroup.add(this.lFootMesh);

    this.updateSilhouette();
  }

  /**
   * 初始化手绘素描边缘线稿系统 (Lineart)
   */
  initLineart() {
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x1e293b,
      linewidth: 2,
      depthTest: true
    });

    // 头部线稿轮廓
    const headEdges = new THREE.EdgesGeometry(new THREE.SphereGeometry(0.098, 16, 14));
    this.headLineMesh = new THREE.LineSegments(headEdges, this.lineMaterial);
    this.lineartGroup.add(this.headLineMesh);

    // 颈部线稿
    const neckEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.046, 0.056, 1, 12));
    this.neckLineMesh = new THREE.LineSegments(neckEdges, this.lineMaterial);
    this.lineartGroup.add(this.neckLineMesh);

    // 胸腔线稿轮廓
    const chestEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.144, 0.128, 1, 14));
    this.torsoLineMesh = new THREE.LineSegments(chestEdges, this.lineMaterial);
    this.lineartGroup.add(this.torsoLineMesh);

    // 腰腹线稿
    const waistEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.124, 0.114, 1, 14));
    this.waistLineMesh = new THREE.LineSegments(waistEdges, this.lineMaterial);
    this.lineartGroup.add(this.waistLineMesh);

    // 骨盆线稿
    const pelvisEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.118, 0.140, 1, 14));
    this.pelvisLineMesh = new THREE.LineSegments(pelvisEdges, this.lineMaterial);
    this.lineartGroup.add(this.pelvisLineMesh);

    // 四肢各部分边缘线条
    this.limbLineMeshes = [];
    this.limbCapsuleDefs.forEach((def) => {
      const geo = createMuscleLimbGeo(def.rTop * 1.02, def.rMid * 1.02, def.rBottom * 1.02, def.midPos, 14);
      const edges = new THREE.EdgesGeometry(geo);
      const lineMesh = new THREE.LineSegments(edges, this.lineMaterial);
      this.lineartGroup.add(lineMesh);
      this.limbLineMeshes.push({
        ...def,
        lineMesh: lineMesh
      });
    });

    // 手部与足部线稿边缘
    const handEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.058, 0.078, 0.024));
    this.rHandLineMesh = new THREE.LineSegments(handEdges, this.lineMaterial);
    this.lHandLineMesh = new THREE.LineSegments(handEdges, this.lineMaterial);
    this.lineartGroup.add(this.rHandLineMesh);
    this.lineartGroup.add(this.lHandLineMesh);

    const footEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.064, 0.034, 0.128));
    this.rFootLineMesh = new THREE.LineSegments(footEdges, this.lineMaterial);
    this.lFootLineMesh = new THREE.LineSegments(footEdges, this.lineMaterial);
    this.lineartGroup.add(this.rFootLineMesh);
    this.lineartGroup.add(this.lFootLineMesh);

    this.lineartGroup.visible = false; // 默认骨骼模式下隐藏
  }

  /**
   * 获取当前实体的解剖肤色配置
   */
  getSkinPalette() {
    let profile = this.bodyProfile || 'female';
    if (this.entityId === 'personB') {
      profile = 'male'; // 双人情侣模式下伴侣采用阳刚温暖小麦肤色
    }
    return SKIN_PALETTES[profile] || SKIN_PALETTES.female;
  }

  /**
   * 刷新皮肤材质的 PBR 质感与微透光 (SSS)
   */
  updateSkinMaterial() {
    if (!this.silhouetteMaterial) return;

    if (this.styleMode === 'lineart') {
      this.silhouetteMaterial.color.setHex(0xfafafa);
      this.silhouetteMaterial.emissive.setHex(0x000000);
      this.silhouetteMaterial.roughness = 0.85;
      this.silhouetteMaterial.metalness = 0.0;
      this.silhouetteMaterial.opacity = 0.98;
      this.silhouetteMaterial.transparent = false;
      this.silhouetteMaterial.depthWrite = true;
    } else {
      const p = this.getSkinPalette();
      this.silhouetteMaterial.color.setHex(p.color);
      this.silhouetteMaterial.emissive.setHex(p.emissive);
      this.silhouetteMaterial.roughness = p.roughness;
      this.silhouetteMaterial.metalness = p.metalness;
      this.silhouetteMaterial.opacity = this.silhouetteOpacity;
      this.silhouetteMaterial.transparent = true;
      this.silhouetteMaterial.depthWrite = false;
    }
  }

  /**
   * 切换视觉模式: 'openpose' (彩色骨骼) vs 'lineart' (手绘素描线稿)
   */
  setStyleMode(mode = 'openpose') {
    this.styleMode = mode;

    if (mode === 'lineart') {
      // 隐藏彩色关节与肢体圆柱
      this.jointMeshes.forEach(mesh => mesh.visible = false);
      this.limbMeshes.forEach(item => item.mesh.visible = false);

      // 显示线稿线条
      this.lineartGroup.visible = true;
      this.updateSkinMaterial();
      this.updateLineart();
    } else {
      // 恢复彩色骨骼
      this.jointMeshes.forEach(mesh => mesh.visible = true);
      this.limbMeshes.forEach(item => item.mesh.visible = true);

      // 隐藏线稿
      this.lineartGroup.visible = false;
      this.updateSkinMaterial();
    }
  }

  updateLineart() {
    if (!this.lineartGroup || !this.lineartGroup.visible || !this.headLineMesh) return;

    // 头部线条与头部体块同步
    if (this.headMesh) {
      this.headLineMesh.position.copy(this.headMesh.position);
      this.headLineMesh.quaternion.copy(this.headMesh.quaternion);
      this.headLineMesh.scale.copy(this.headMesh.scale);
    }

    // 颈部线条
    if (this.neckLineMesh && this.neckMesh) {
      this.neckLineMesh.position.copy(this.neckMesh.position);
      this.neckLineMesh.quaternion.copy(this.neckMesh.quaternion);
      this.neckLineMesh.scale.copy(this.neckMesh.scale);
    }

    // 躯干三段式线条同步
    if (this.chestMesh && this.torsoLineMesh) {
      this.torsoLineMesh.position.copy(this.chestMesh.position);
      this.torsoLineMesh.quaternion.copy(this.chestMesh.quaternion);
      this.torsoLineMesh.scale.copy(this.chestMesh.scale);
    }

    if (this.waistMesh && this.waistLineMesh) {
      this.waistLineMesh.position.copy(this.waistMesh.position);
      this.waistLineMesh.quaternion.copy(this.waistMesh.quaternion);
      this.waistLineMesh.scale.copy(this.waistMesh.scale);
    }

    if (this.pelvisMesh && this.pelvisLineMesh) {
      this.pelvisLineMesh.position.copy(this.pelvisMesh.position);
      this.pelvisLineMesh.quaternion.copy(this.pelvisMesh.quaternion);
      this.pelvisLineMesh.scale.copy(this.pelvisMesh.scale);
    }

    // 四肢各段轮廓线条
    if (Array.isArray(this.limbLineMeshes) && Array.isArray(this.limbVolumeMeshes)) {
      this.limbLineMeshes.forEach((item, idx) => {
        const vol = this.limbVolumeMeshes[idx];
        if (vol && vol.mesh && item && item.lineMesh) {
          item.lineMesh.position.copy(vol.mesh.position);
          item.lineMesh.quaternion.copy(vol.mesh.quaternion);
          item.lineMesh.scale.copy(vol.mesh.scale);
        }
      });
    }

    const syncLineartPair = (lineMesh, volMesh) => {
      if (lineMesh && volMesh) {
        lineMesh.position.copy(volMesh.position);
        lineMesh.quaternion.copy(volMesh.quaternion);
        lineMesh.scale.copy(volMesh.scale);
      }
    };
    syncLineartPair(this.rHandLineMesh, this.rHandMesh);
    syncLineartPair(this.lHandLineMesh, this.lHandMesh);
    syncLineartPair(this.rFootLineMesh, this.rFootMesh);
    syncLineartPair(this.lFootLineMesh, this.lFootMesh);
  }

  updateLimbs() {
    const upVector = new THREE.Vector3(0, 1, 0);

    this.limbMeshes.forEach(({ from, to, mesh }) => {
      const posA = this.currentJointPositions[from];
      const posB = this.currentJointPositions[to];
      if (!posA || !posB) return;

      const midpoint = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
      mesh.position.copy(midpoint);

      const distance = posA.distanceTo(posB);
      mesh.scale.set(1, Math.max(distance, 0.001), 1);

      const dir = new THREE.Vector3().subVectors(posB, posA).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, dir);
      mesh.quaternion.copy(quaternion);
    });
  }

  updateSilhouette() {
    if (!this.silhouetteVisible && this.styleMode !== 'lineart') return;

    const upVector = new THREE.Vector3(0, 1, 0);

    // 1. 头部复合结构 (颅脑 + 下巴下颌线)
    const neckPos = this.currentJointPositions[1];
    const nosePos = this.currentJointPositions[0];
    if (neckPos && nosePos) {
      const headCenter = new THREE.Vector3()
        .subVectors(nosePos, neckPos)
        .multiplyScalar(0.72)
        .add(nosePos);
      this.headMesh.position.copy(headCenter);

      const lookDir = new THREE.Vector3().subVectors(nosePos, neckPos).normalize();
      this.headMesh.quaternion.setFromUnitVectors(upVector, lookDir);

      if (this.bodyProfile === 'child') {
        this.headMesh.scale.set(1.22, 1.25, 1.20);
      } else if (this.bodyProfile === 'male') {
        this.headMesh.scale.set(1.05, 1.05, 1.05);
      } else {
        this.headMesh.scale.set(0.96, 1.00, 0.96);
      }

      // 下巴立体块位置 (位于鼻子略偏下前侧)
      if (this.chinMesh) {
        const chinPos = nosePos.clone().addScaledVector(lookDir, -0.04);
        this.chinMesh.position.copy(chinPos);
        this.chinMesh.quaternion.copy(this.headMesh.quaternion);
      }
    }

    // 2. 颈部
    if (neckPos && nosePos) {
      const neckTop = new THREE.Vector3().lerpVectors(neckPos, nosePos, 0.38);
      const neckCenter = new THREE.Vector3().addVectors(neckPos, neckTop).multiplyScalar(0.5);
      this.neckMesh.position.copy(neckCenter);
      const neckLen = neckPos.distanceTo(neckTop);
      this.neckMesh.scale.set(1, Math.max(neckLen, 0.001), 1);
      const neckDir = new THREE.Vector3().subVectors(neckTop, neckPos).normalize();
      this.neckMesh.quaternion.setFromUnitVectors(upVector, neckDir);
    }

    // 3. 躯干三段式解剖体块 (胸廓 + 胸肌/乳房 + 腰腹 + 骨盆与臀大肌)
    const rHip = this.currentJointPositions[8];
    const lHip = this.currentJointPositions[11];
    if (neckPos && rHip && lHip) {
      const hipsCenter = new THREE.Vector3().addVectors(rHip, lHip).multiplyScalar(0.5);
      const torsoVector = new THREE.Vector3().subVectors(neckPos, hipsCenter);
      const torsoLen = torsoVector.length();
      const torsoDir = torsoVector.clone().normalize();
      const spineQuat = new THREE.Quaternion().setFromUnitVectors(upVector, torsoDir);

      // 解剖学体型差异系数
      const isMale = this.bodyProfile === 'male' || (this.entityId === 'personB');
      const isChild = this.bodyProfile === 'child';
      const chestWidth = isMale ? 1.30 : (isChild ? 0.90 : 1.12);
      const waistWidth = isMale ? 1.08 : (isChild ? 0.88 : 0.88);
      const pelvisWidth = isMale ? 1.02 : (isChild ? 0.85 : 1.25); // 女性拥有经典沙漏大胯宽

      // 3.1 上段：胸廓 (占躯干上部 45%)
      const chestCenter = new THREE.Vector3().lerpVectors(hipsCenter, neckPos, 0.76);
      this.chestMesh.position.copy(chestCenter);
      this.chestMesh.quaternion.copy(spineQuat);
      this.chestMesh.scale.set(chestWidth, Math.max(torsoLen * 0.45, 0.01), isMale ? 1.08 : 0.95);

      // 胸肌/乳房体量
      const chestForward = new THREE.Vector3(0, 0, 1).applyQuaternion(spineQuat);
      const chestRight = new THREE.Vector3(1, 0, 0).applyQuaternion(spineQuat);
      const breastOffsetOut = isMale ? 0.070 : 0.062;
      const breastForwardDist = isMale ? 0.075 : (isChild ? 0.03 : 0.095);

      if (this.rChestVolMesh && this.lChestVolMesh) {
        this.rChestVolMesh.position.copy(chestCenter)
          .addScaledVector(chestRight, -breastOffsetOut)
          .addScaledVector(chestForward, breastForwardDist);
        this.rChestVolMesh.quaternion.copy(spineQuat);
        this.rChestVolMesh.visible = !isChild;

        this.lChestVolMesh.position.copy(chestCenter)
          .addScaledVector(chestRight, breastOffsetOut)
          .addScaledVector(chestForward, breastForwardDist);
        this.lChestVolMesh.quaternion.copy(spineQuat);
        this.lChestVolMesh.visible = !isChild;

        if (isMale) {
          this.rChestVolMesh.scale.set(1.2, 0.9, 0.7);
          this.lChestVolMesh.scale.set(1.2, 0.9, 0.7);
        } else {
          this.rChestVolMesh.scale.set(1.0, 1.08, 1.0);
          this.lChestVolMesh.scale.set(1.0, 1.08, 1.0);
        }
      }

      // 3.2 中段：腰腹 (占躯干中部 28%)
      const waistCenter = new THREE.Vector3().lerpVectors(hipsCenter, neckPos, 0.42);
      this.waistMesh.position.copy(waistCenter);
      this.waistMesh.quaternion.copy(spineQuat);
      this.waistMesh.scale.set(waistWidth, Math.max(torsoLen * 0.28, 0.01), isMale ? 1.02 : 0.88);

      // 3.3 下段：骨盆 (占下部 27%)
      const pelvisCenter = new THREE.Vector3().lerpVectors(hipsCenter, neckPos, 0.12);
      this.pelvisMesh.position.copy(pelvisCenter);
      this.pelvisMesh.quaternion.copy(spineQuat);
      this.pelvisMesh.scale.set(pelvisWidth, Math.max(torsoLen * 0.27, 0.01), isMale ? 0.98 : 1.05);

      // 3.4 臀大肌 (位于骨盆后下侧，展现臀部优美弧线)
      const gluteBackDist = isMale ? -0.065 : -0.082;
      const gluteOutDist = isMale ? 0.065 : 0.075;
      if (this.rGluteMesh && this.lGluteMesh) {
        this.rGluteMesh.position.copy(pelvisCenter)
          .addScaledVector(chestRight, -gluteOutDist)
          .addScaledVector(chestForward, gluteBackDist);
        this.rGluteMesh.quaternion.copy(spineQuat);
        this.rGluteMesh.scale.set(pelvisWidth * 0.95, 1.0, isMale ? 0.90 : 1.15);

        this.lGluteMesh.position.copy(pelvisCenter)
          .addScaledVector(chestRight, gluteOutDist)
          .addScaledVector(chestForward, gluteBackDist);
        this.lGluteMesh.quaternion.copy(spineQuat);
        this.lGluteMesh.scale.set(pelvisWidth * 0.95, 1.0, isMale ? 0.90 : 1.15);
      }
    }

    // 4. 纺锤形解剖肌肉四肢
    this.limbVolumeMeshes.forEach(({ from, to, mesh }) => {
      const posA = this.currentJointPositions[from];
      const posB = this.currentJointPositions[to];
      if (!posA || !posB) return;

      const midpoint = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
      mesh.position.copy(midpoint);

      const distance = posA.distanceTo(posB);
      const isMale = this.bodyProfile === 'male' || (this.entityId === 'personB');
      const thicknessScale = isMale ? 1.12 : (this.bodyProfile === 'child' ? 0.78 : 1.0);
      mesh.scale.set(thicknessScale, Math.max(distance, 0.001), thicknessScale);

      const dir = new THREE.Vector3().subVectors(posA, posB).normalize();
      mesh.quaternion.setFromUnitVectors(upVector, dir);
    });

    // 5. 关节球过渡
    if (this.jointSphereMeshes) {
      for (const def of Object.values(this.jointSphereMeshes)) {
        const pos = this.currentJointPositions[def.jointId];
        if (pos) def.mesh.position.copy(pos);
      }
    }

    // 6. 手掌体量 (沿前臂腕肘方向自然延伸，并微带手势)
    const rElbowPos = this.currentJointPositions[3];
    const rWristPos = this.currentJointPositions[4];
    if (rElbowPos && rWristPos) {
      const armDir = new THREE.Vector3().subVectors(rWristPos, rElbowPos).normalize();
      this.rHandMesh.position.copy(rWristPos.clone().addScaledVector(armDir, 0.042));
      this.rHandMesh.quaternion.setFromUnitVectors(upVector, armDir);
    }
    const lElbowPos = this.currentJointPositions[6];
    const lWristPos = this.currentJointPositions[7];
    if (lElbowPos && lWristPos) {
      const armDir = new THREE.Vector3().subVectors(lWristPos, lElbowPos).normalize();
      this.lHandMesh.position.copy(lWristPos.clone().addScaledVector(armDir, 0.042));
      this.lHandMesh.quaternion.setFromUnitVectors(upVector, armDir);
    }

    // 7. 足部体量 (脚踝下方与前方着地形态)
    const rAnklePos = this.currentJointPositions[10];
    if (rAnklePos) {
      this.rFootMesh.position.set(rAnklePos.x, Math.max(rAnklePos.y - 0.015, 0.015), rAnklePos.z + 0.045);
      this.rFootMesh.quaternion.identity();
    }
    const lAnklePos = this.currentJointPositions[13];
    if (lAnklePos) {
      this.lFootMesh.position.set(lAnklePos.x, Math.max(lAnklePos.y - 0.015, 0.015), lAnklePos.z + 0.045);
      this.lFootMesh.quaternion.identity();
    }

    this.updateLineart();
  }

  setSilhouetteVisible(visible) {
    this.silhouetteVisible = visible;
    this.silhouetteGroup.visible = visible;
    if (visible) this.updateSilhouette();
  }

  setSilhouetteOpacity(opacity) {
    this.silhouetteOpacity = opacity;
    if (this.silhouetteMaterial && this.styleMode !== 'lineart') {
      this.silhouetteMaterial.opacity = opacity;
    }
  }

  setBodyProfile(profile = 'female') {
    this.bodyProfile = profile;
    this.updateSkinMaterial();
    this.updateSilhouette();
  }

  applyPose(jointsData, animate = true) {
    if (!jointsData) return;

    if (!animate) {
      for (const [idStr, pos] of Object.entries(jointsData)) {
        const id = parseInt(idStr, 10);
        if (this.currentJointPositions[id]) {
          this.currentJointPositions[id].set(pos.x, pos.y, pos.z);
          this.targetJointPositions[id].set(pos.x, pos.y, pos.z);
          const mesh = this.jointMeshes.get(id);
          if (mesh) mesh.position.copy(this.currentJointPositions[id]);
        }
      }
      this.updateLimbs();
      this.updateSilhouette();
      this.isTransitioning = false;
      return;
    }

    for (const [idStr, pos] of Object.entries(jointsData)) {
      const id = parseInt(idStr, 10);
      if (this.targetJointPositions[id]) {
        this.targetJointPositions[id].set(pos.x, pos.y, pos.z);
      }
    }
    this.transitionProgress = 0;
    this.isTransitioning = true;
  }

  update(delta) {
    if (this.isTransitioning) {
      this.transitionProgress += delta * this.transitionSpeed;
      const t = Math.min(this.transitionProgress, 1.0);

      for (const id of Object.keys(this.currentJointPositions)) {
        const current = this.currentJointPositions[id];
        const target = this.targetJointPositions[id];
        current.lerp(target, Math.min(delta * 12, 1.0));

        const mesh = this.jointMeshes.get(parseInt(id, 10));
        if (mesh) mesh.position.copy(current);
      }

      this.updateLimbs();
      this.updateSilhouette();

      if (t >= 1.0) {
        this.isTransitioning = false;
        for (const id of Object.keys(this.currentJointPositions)) {
          this.currentJointPositions[id].copy(this.targetJointPositions[id]);
          const mesh = this.jointMeshes.get(parseInt(id, 10));
          if (mesh) mesh.position.copy(this.currentJointPositions[id]);
        }
        this.updateLimbs();
        this.updateSilhouette();
      }
    }
  }

  setJointPosition(jointId, x, y, z) {
    if (this.currentJointPositions[jointId]) {
      this.currentJointPositions[jointId].set(x, y, z);
      this.targetJointPositions[jointId].set(x, y, z);
      const mesh = this.jointMeshes.get(jointId);
      if (mesh) mesh.position.set(x, y, z);
      this.updateLimbs();
      this.updateSilhouette();
    }
  }

  getPoseData() {
    const data = {};
    for (const [id, vec] of Object.entries(this.currentJointPositions)) {
      data[id] = {
        x: parseFloat(vec.x.toFixed(3)),
        y: parseFloat(vec.y.toFixed(3)),
        z: parseFloat(vec.z.toFixed(3))
      };
    }
    return data;
  }

  selectJoint(jointId) {
    this.jointMeshes.forEach((mesh, id) => {
      if (id === jointId) {
        mesh.material.emissiveIntensity = 0.9;
        mesh.scale.set(1.4, 1.4, 1.4);
      } else {
        mesh.material.emissiveIntensity = 0.25;
        mesh.scale.set(1.0, 1.0, 1.0);
      }
    });
  }

  clearSelection() {
    this.jointMeshes.forEach((mesh) => {
      mesh.material.emissiveIntensity = 0.25;
      mesh.scale.set(1.0, 1.0, 1.0);
    });
  }

  setVisible(visible) {
    this.group.visible = visible;
  }
}

/**
 * 统摄双人/单人骨架系统的模型管理器
 */
export class SkeletonModel {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.personA = new HumanEntity(this.group, 'personA');
    this.personB = new HumanEntity(this.group, 'personB');
    this.personB.setVisible(false);

    this.isCouplesMode = false;
    this.activeEntity = this.personA;
    this.selectedJointId = null;
    this.styleMode = 'openpose'; // 'openpose' | 'lineart'
  }

  get currentJointPositions() {
    return this.activeEntity.currentJointPositions;
  }
  get jointMeshes() {
    return this.activeEntity.jointMeshes;
  }
  get silhouetteVisible() {
    return this.personA.silhouetteVisible;
  }
  get headMesh() {
    return this.activeEntity.headMesh;
  }
  get torsoMesh() {
    return this.activeEntity.torsoMesh;
  }
  get pelvisMesh() {
    return this.activeEntity.pelvisMesh;
  }
  get limbVolumeMeshes() {
    return this.activeEntity.limbVolumeMeshes;
  }

  setCouplesMode(isCouple) {
    this.isCouplesMode = isCouple;
    this.personB.setVisible(isCouple);
    if (!isCouple) {
      this.activeEntity = this.personA;
    }
  }

  setBodyProfile(profile) {
    this.personA.setBodyProfile(profile);
    if (profile === 'female') {
      this.personB.setBodyProfile('male');
    }
  }

  setStyleMode(mode = 'openpose') {
    this.styleMode = mode;
    this.personA.setStyleMode(mode);
    this.personB.setStyleMode(mode);
  }

  applyPreset(preset, animate = true) {
    if (!preset) return;

    if (preset.isCouple || preset.jointsB) {
      this.setCouplesMode(true);
      this.personA.applyPose(preset.joints, animate);
      this.personB.applyPose(preset.jointsB, animate);
    } else {
      this.setCouplesMode(false);
      this.personA.applyPose(preset.joints, animate);
    }

    if (preset.bodyProfile) {
      this.setBodyProfile(preset.bodyProfile);
    }

    // 保持当前的视觉风格
    this.setStyleMode(this.styleMode);
  }

  applyPose(jointsData, animate = true) {
    this.personA.applyPose(jointsData, animate);
  }

  update(delta) {
    this.personA.update(delta);
    if (this.isCouplesMode) {
      this.personB.update(delta);
    }
  }

  setSilhouetteVisible(visible) {
    this.personA.setSilhouetteVisible(visible);
    this.personB.setSilhouetteVisible(visible);
  }

  setSilhouetteOpacity(opacity) {
    this.personA.setSilhouetteOpacity(opacity);
    this.personB.setSilhouetteOpacity(opacity);
  }

  setJointPosition(jointId, x, y, z) {
    this.activeEntity.setJointPosition(jointId, x, y, z);
  }

  selectJoint(jointId, entityId = 'personA') {
    this.selectedJointId = jointId;
    this.activeEntity = (entityId === 'personB' && this.isCouplesMode) ? this.personB : this.personA;
    this.personA.clearSelection();
    this.personB.clearSelection();
    this.activeEntity.selectJoint(jointId);
  }

  clearSelection() {
    this.selectedJointId = null;
    this.personA.clearSelection();
    this.personB.clearSelection();
  }

  getPoseData() {
    return {
      jointsA: this.personA.getPoseData(),
      jointsB: this.isCouplesMode ? this.personB.getPoseData() : null
    };
  }
}
