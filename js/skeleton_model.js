import * as THREE from 'three';
import { OPENPOSE_KEYPOINTS, OPENPOSE_LIMBS, DEFAULT_T_POSE_JOINTS } from './openpose_definition.js';

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
    const colorHex = this.entityId === 'personA' ? 0x94a3b8 : 0x818cf8;

    this.silhouetteMaterial = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.45,
      metalness: 0.1,
      transparent: true,
      opacity: this.silhouetteOpacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // 头部椭球
    const headGeo = new THREE.SphereGeometry(0.105, 24, 24);
    headGeo.scale(0.85, 1.15, 0.95);
    this.headMesh = new THREE.Mesh(headGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.headMesh);

    // 躯干
    const torsoGeo = new THREE.CylinderGeometry(0.13, 0.11, 1, 20);
    this.torsoMesh = new THREE.Mesh(torsoGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.torsoMesh);

    // 骨盆
    const pelvisGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.14, 18);
    this.pelvisMesh = new THREE.Mesh(pelvisGeo, this.silhouetteMaterial);
    this.silhouetteGroup.add(this.pelvisMesh);

    // 四肢
    this.limbCapsuleDefs = [
      { name: 'RUpperArm', from: 2, to: 3, rTop: 0.045, rBottom: 0.038 },
      { name: 'RForearm',  from: 3, to: 4, rTop: 0.038, rBottom: 0.030 },
      { name: 'LUpperArm', from: 5, to: 6, rTop: 0.045, rBottom: 0.038 },
      { name: 'LForearm',  from: 6, to: 7, rTop: 0.038, rBottom: 0.030 },
      { name: 'RThigh',    from: 8, to: 9, rTop: 0.065, rBottom: 0.052 },
      { name: 'RCalf',     from: 9, to: 10, rTop: 0.050, rBottom: 0.038 },
      { name: 'LThigh',    from: 11, to: 12, rTop: 0.065, rBottom: 0.052 },
      { name: 'LCalf',     from: 12, to: 13, rTop: 0.050, rBottom: 0.038 }
    ];

    this.limbVolumeMeshes = [];
    this.limbCapsuleDefs.forEach((def) => {
      const cylGeo = new THREE.CylinderGeometry(def.rBottom, def.rTop, 1, 16);
      const mesh = new THREE.Mesh(cylGeo, this.silhouetteMaterial);
      this.silhouetteGroup.add(mesh);
      this.limbVolumeMeshes.push({
        ...def,
        mesh: mesh
      });
    });

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
    const headEdges = new THREE.EdgesGeometry(new THREE.SphereGeometry(0.106, 16, 12));
    this.headLineMesh = new THREE.LineSegments(headEdges, this.lineMaterial);
    this.lineartGroup.add(this.headLineMesh);

    // 躯干线稿轮廓
    const torsoEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.132, 0.112, 1, 12));
    this.torsoLineMesh = new THREE.LineSegments(torsoEdges, this.lineMaterial);
    this.lineartGroup.add(this.torsoLineMesh);

    // 骨盆线稿
    const pelvisEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.122, 0.122, 0.14, 12));
    this.pelvisLineMesh = new THREE.LineSegments(pelvisEdges, this.lineMaterial);
    this.lineartGroup.add(this.pelvisLineMesh);

    // 四肢各部分边缘线条
    this.limbLineMeshes = [];
    this.limbCapsuleDefs.forEach((def) => {
      const cylEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(def.rBottom * 1.02, def.rTop * 1.02, 1, 10));
      const lineMesh = new THREE.LineSegments(cylEdges, this.lineMaterial);
      this.lineartGroup.add(lineMesh);
      this.limbLineMeshes.push({
        ...def,
        lineMesh: lineMesh
      });
    });

    this.lineartGroup.visible = false; // 默认骨骼模式下隐藏
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
      this.updateLineart();

      // 体块切换为手绘高光纸白底
      this.silhouetteMaterial.color.setHex(0xf8fafc);
      this.silhouetteMaterial.opacity = 0.95;
      this.silhouetteMaterial.transparent = false;
      this.silhouetteMaterial.depthWrite = true;
    } else {
      // 恢复彩色骨骼
      this.jointMeshes.forEach(mesh => mesh.visible = true);
      this.limbMeshes.forEach(item => item.mesh.visible = true);

      // 隐藏线稿
      this.lineartGroup.visible = false;

      // 恢复半透明高级蓝灰体块
      const colorHex = this.entityId === 'personA' ? 0x94a3b8 : 0x818cf8;
      this.silhouetteMaterial.color.setHex(colorHex);
      this.silhouetteMaterial.opacity = this.silhouetteOpacity;
      this.silhouetteMaterial.transparent = true;
      this.silhouetteMaterial.depthWrite = false;
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

    // 躯干与骨盆线条
    if (this.torsoMesh && this.torsoLineMesh) {
      this.torsoLineMesh.position.copy(this.torsoMesh.position);
      this.torsoLineMesh.quaternion.copy(this.torsoMesh.quaternion);
      this.torsoLineMesh.scale.copy(this.torsoMesh.scale);
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

    // 1. 头部
    const neckPos = this.currentJointPositions[1];
    const nosePos = this.currentJointPositions[0];
    if (neckPos && nosePos) {
      const headCenter = new THREE.Vector3()
        .subVectors(nosePos, neckPos)
        .multiplyScalar(0.7)
        .add(nosePos);
      this.headMesh.position.copy(headCenter);

      const lookDir = new THREE.Vector3().subVectors(nosePos, neckPos).normalize();
      this.headMesh.quaternion.setFromUnitVectors(upVector, lookDir);

      if (this.bodyProfile === 'child') {
        this.headMesh.scale.set(1.15, 1.25, 1.15);
      } else {
        this.headMesh.scale.set(1.0, 1.0, 1.0);
      }
    }

    // 2. 躯干
    const rHip = this.currentJointPositions[8];
    const lHip = this.currentJointPositions[11];
    if (neckPos && rHip && lHip) {
      const hipsCenter = new THREE.Vector3().addVectors(rHip, lHip).multiplyScalar(0.5);
      const torsoCenter = new THREE.Vector3().addVectors(neckPos, hipsCenter).multiplyScalar(0.5);
      this.torsoMesh.position.copy(torsoCenter);

      const torsoLen = neckPos.distanceTo(hipsCenter);
      const widthScale = this.bodyProfile === 'male' ? 1.25 : (this.bodyProfile === 'child' ? 0.9 : 1.15);
      this.torsoMesh.scale.set(widthScale, Math.max(torsoLen, 0.01), 0.95);

      const dir = new THREE.Vector3().subVectors(neckPos, hipsCenter).normalize();
      this.torsoMesh.quaternion.setFromUnitVectors(upVector, dir);

      this.pelvisMesh.position.copy(hipsCenter);
      this.pelvisMesh.quaternion.setFromUnitVectors(upVector, dir);
      this.pelvisMesh.scale.set(widthScale, 1, 1.0);
    }

    // 3. 四肢
    this.limbVolumeMeshes.forEach(({ from, to, mesh }) => {
      const posA = this.currentJointPositions[from];
      const posB = this.currentJointPositions[to];
      if (!posA || !posB) return;

      const midpoint = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
      mesh.position.copy(midpoint);

      const distance = posA.distanceTo(posB);
      mesh.scale.set(1, Math.max(distance, 0.001), 1);

      const dir = new THREE.Vector3().subVectors(posA, posB).normalize();
      mesh.quaternion.setFromUnitVectors(upVector, dir);
    });

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
