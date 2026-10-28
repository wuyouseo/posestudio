import * as THREE from 'three';
import { OPENPOSE_KEYPOINTS, OPENPOSE_LIMBS } from './openpose_definition.js';

export class OpenPoseExporter {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {import('./skeleton_model.js').SkeletonModel} skeletonModel
   */
  constructor(renderer, scene, camera, skeletonModel) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.skeletonModel = skeletonModel;
  }

  /**
   * 辅助方法：将一个 HumanEntity 离屏渲染到目标场景中
   */
  renderHumanEntity(entity, exportScene, { exportMode = 'bones_only' }) {
    if (!entity || !entity.group.visible) return;

    const upVector = new THREE.Vector3(0, 1, 0);

    // 判断线稿模式
    const isLineartMode = exportMode.startsWith('lineart');

    if (isLineartMode) {
      // 线条颜色：白底黑线 vs 黑底白线
      const lineColorHex = (exportMode === 'lineart_black') ? 0xffffff : 0x0f172a;
      const lineMaterial = new THREE.LineBasicMaterial({ color: lineColorHex, linewidth: 2 });
      
      // 实体底色材质：白底则用纯白底块遮挡背面，黑底则用纯黑底块遮挡背面
      const baseFillColor = (exportMode === 'lineart_black') ? 0x000000 : 0xffffff;
      const baseMaterial = new THREE.MeshBasicMaterial({ color: baseFillColor });

      // 遍历解剖体块轮廓组，高精度导出完整真实人体轮廓
      if (entity.silhouetteGroup) {
        entity.silhouetteGroup.traverse((child) => {
          if (child.isMesh && child.visible && child.geometry) {
            const baseMesh = new THREE.Mesh(child.geometry, baseMaterial);
            child.getWorldPosition(baseMesh.position);
            child.getWorldQuaternion(baseMesh.quaternion);
            child.getWorldScale(baseMesh.scale);
            exportScene.add(baseMesh);

            // 关节过渡球不重复描边，避免线条杂乱；其余主要肌肉与肢体体块描摹优美素描轮廓
            const isJointSphere = entity.jointSphereMeshes && Object.values(entity.jointSphereMeshes).some(d => d.mesh === child);
            if (!isJointSphere) {
              const edges = new THREE.EdgesGeometry(child.geometry);
              const lineMesh = new THREE.LineSegments(edges, lineMaterial);
              lineMesh.position.copy(baseMesh.position);
              lineMesh.quaternion.copy(baseMesh.quaternion);
              lineMesh.scale.copy(baseMesh.scale);
              exportScene.add(lineMesh);
            }
          }
        });
      }

      return;
    }

    // 非线稿模式：OpenPose / 轮廓渲染
    const shouldRenderSilhouette = exportMode === 'composite' || exportMode === 'silhouette_only';
    const shouldRenderBones = exportMode === 'bones_only' || exportMode === 'composite';

    if (shouldRenderSilhouette && entity.silhouetteGroup) {
      const silMaterial = new THREE.MeshBasicMaterial({
        color: exportMode === 'silhouette_only' ? 0xffffff : 0x718096,
        transparent: exportMode === 'composite',
        opacity: exportMode === 'composite' ? 0.6 : 1.0,
        depthWrite: exportMode === 'silhouette_only'
      });

      entity.silhouetteGroup.traverse((child) => {
        if (child.isMesh && child.visible && child.geometry) {
          const mesh = new THREE.Mesh(child.geometry, silMaterial);
          child.getWorldPosition(mesh.position);
          child.getWorldQuaternion(mesh.quaternion);
          child.getWorldScale(mesh.scale);
          exportScene.add(mesh);
        }
      });
    }

    if (shouldRenderBones) {
      const sphereGeo = new THREE.SphereGeometry(0.022, 16, 16);

      OPENPOSE_KEYPOINTS.forEach((kp) => {
        const pos = entity.currentJointPositions[kp.id];
        if (!pos) return;
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(kp.color) });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.position.copy(pos);
        exportScene.add(mesh);
      });

      OPENPOSE_LIMBS.forEach((limb) => {
        const posA = entity.currentJointPositions[limb.from];
        const posB = entity.currentJointPositions[limb.to];
        if (!posA || !posB) return;

        const cylGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 16);
        const cylMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(limb.color) });
        const mesh = new THREE.Mesh(cylGeo, cylMat);

        const midpoint = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
        mesh.position.copy(midpoint);

        const distance = posA.distanceTo(posB);
        mesh.scale.set(1, Math.max(distance, 0.001), 1);

        const dir = new THREE.Vector3().subVectors(posB, posA).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, dir);
        mesh.quaternion.copy(quaternion);

        exportScene.add(mesh);
      });
    }
  }

  /**
   * 离屏渲染标准 ControlNet OpenPose 或 Lineart 线稿图像
   */
  exportOpenPoseImage({
    width = 768,
    height = 1024,
    transparent = false,
    exportMode = 'bones_only',
    poseName = 'pose'
  }) {
    const exportScene = new THREE.Scene();

    // 背景色处理
    if (exportMode === 'lineart_white') {
      exportScene.background = transparent ? null : new THREE.Color(0xffffff);
    } else if (exportMode === 'lineart_black') {
      exportScene.background = transparent ? null : new THREE.Color(0x000000);
    } else {
      exportScene.background = transparent ? null : new THREE.Color(0x000000);
    }

    const exportCamera = this.camera.clone();
    exportCamera.aspect = width / height;
    exportCamera.updateProjectionMatrix();

    // 渲染 Person A
    this.renderHumanEntity(this.skeletonModel.personA, exportScene, { exportMode });

    // 如果处于情侣双人模式，同时渲染 Person B
    if (this.skeletonModel.isCouplesMode) {
      this.renderHumanEntity(this.skeletonModel.personB, exportScene, { exportMode });
    }

    // 离屏渲染 RenderTarget
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });

    this.renderer.setRenderTarget(renderTarget);
    this.renderer.render(exportScene, exportCamera);
    this.renderer.setRenderTarget(null);

    // 像素读取与垂直翻转
    const buffer = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((height - 1 - y) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        imgData.data[dstIdx] = buffer[srcIdx];
        imgData.data[dstIdx + 1] = buffer[srcIdx + 1];
        imgData.data[dstIdx + 2] = buffer[srcIdx + 2];
        imgData.data[dstIdx + 3] = buffer[srcIdx + 3];
      }
    }
    ctx.putImageData(imgData, 0, 0);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const sanitizedName = poseName.replace(/\s+/g, '_');
      
      let modeSuffix = 'OpenPose';
      if (exportMode.startsWith('lineart')) {
        modeSuffix = 'Lineart_Sketch';
      } else if (exportMode === 'composite') {
        modeSuffix = 'Pose_Silhouette';
      } else if (exportMode === 'silhouette_only') {
        modeSuffix = 'Silhouette';
      }

      link.download = `${modeSuffix}_${sanitizedName}_${width}x${height}.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');

    renderTarget.dispose();
  }

  exportPoseJSON(poseData, poseName = 'custom_pose') {
    const jsonStr = JSON.stringify(poseData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${poseName.replace(/\s+/g, '_')}.json`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
