/**
 * ControlNet OpenPose 官方 18 节点与肢体骨骼连线标准规范
 * 节点列表:
 * 0: 鼻子 (Nose)
 * 1: 脖子 (Neck)
 * 2: 右肩 (RShoulder)
 * 3: 右肘 (RElbow)
 * 4: 右手腕 (RWrist)
 * 5: 左肩 (LShoulder)
 * 6: 左肘 (LElbow)
 * 7: 左手腕 (LWrist)
 * 8: 右髋 (RHip)
 * 9: 右膝 (RKnee)
 * 10: 右脚踝 (RAnkle)
 * 11: 左髋 (LHip)
 * 12: 左膝 (LKnee)
 * 13: 左脚踝 (LAnkle)
 * 14: 右眼 (REye)
 * 15: 左眼 (LEye)
 * 16: 右耳 (REar)
 * 17: 左耳 (LEar)
 */

export const OPENPOSE_KEYPOINTS = [
  { id: 0, name: 'Nose', color: '#ff0000', label: '鼻子' },
  { id: 1, name: 'Neck', color: '#ff5500', label: '颈部' },
  { id: 2, name: 'RShoulder', color: '#ffaa00', label: '右肩' },
  { id: 3, name: 'RElbow', color: '#ffff00', label: '右肘' },
  { id: 4, name: 'RWrist', color: '#aaff00', label: '右腕' },
  { id: 5, name: 'LShoulder', color: '#55ff00', label: '左肩' },
  { id: 6, name: 'LElbow', color: '#00ff00', label: '左肘' },
  { id: 7, name: 'LWrist', color: '#00ff55', label: '左腕' },
  { id: 8, name: 'RHip', color: '#00ffaa', label: '右髋' },
  { id: 9, name: 'RKnee', color: '#00ffff', label: '右膝' },
  { id: 10, name: 'RAnkle', color: '#00aaff', label: '右踝' },
  { id: 11, name: 'LHip', color: '#0055ff', label: '左髋' },
  { id: 12, name: 'LKnee', color: '#0000ff', label: '左膝' },
  { id: 13, name: 'LAnkle', color: '#5500ff', label: '左踝' },
  { id: 14, name: 'REye', color: '#aa00ff', label: '右眼' },
  { id: 15, name: 'LEye', color: '#ff00ff', label: '左眼' },
  { id: 16, name: 'REar', color: '#ff00aa', label: '右耳' },
  { id: 17, name: 'LEar', color: '#ff0055', label: '左耳' }
];

// OpenPose 官方定义的肢体骨骼连线及对应标准颜色 (RGB)
export const OPENPOSE_LIMBS = [
  { from: 1, to: 2, color: '#ffaa00', name: 'Neck-RShoulder' },
  { from: 1, to: 5, color: '#55ff00', name: 'Neck-LShoulder' },
  { from: 2, to: 3, color: '#ffff00', name: 'RShoulder-RElbow' },
  { from: 3, to: 4, color: '#aaff00', name: 'RElbow-RWrist' },
  { from: 5, to: 6, color: '#00ff00', name: 'LShoulder-LElbow' },
  { from: 6, to: 7, color: '#00ff55', name: 'LElbow-LWrist' },
  { from: 1, to: 8, color: '#00ffaa', name: 'Neck-RHip' },
  { from: 8, to: 9, color: '#00ffff', name: 'RHip-RKnee' },
  { from: 9, to: 10, color: '#00aaff', name: 'RKnee-RAnkle' },
  { from: 1, to: 11, color: '#0055ff', name: 'Neck-LHip' },
  { from: 11, to: 12, color: '#0000ff', name: 'LHip-LKnee' },
  { from: 12, to: 13, color: '#5500ff', name: 'LKnee-LAnkle' },
  { from: 1, to: 0, color: '#ff5500', name: 'Neck-Nose' },
  { from: 0, to: 14, color: '#aa00ff', name: 'Nose-REye' },
  { from: 14, to: 16, color: '#ff00aa', name: 'REye-REar' },
  { from: 0, to: 15, color: '#ff00ff', name: 'Nose-LEye' },
  { from: 15, to: 17, color: '#ff0055', name: 'LEye-LEar' }
];

// 标准人体基础比例坐标 (Y轴向上，头顶大约1.8米，原点在地面中心)
export const DEFAULT_T_POSE_JOINTS = {
  0: { x: 0, y: 1.63, z: 0.08 },    // 0: Nose
  1: { x: 0, y: 1.48, z: 0 },       // 1: Neck
  2: { x: -0.20, y: 1.45, z: 0 },   // 2: RShoulder
  3: { x: -0.45, y: 1.45, z: 0 },   // 3: RElbow
  4: { x: -0.70, y: 1.45, z: 0 },   // 4: RWrist
  5: { x: 0.20, y: 1.45, z: 0 },    // 5: LShoulder
  6: { x: 0.45, y: 1.45, z: 0 },    // 6: LElbow
  7: { x: 0.70, y: 1.45, z: 0 },    // 7: LWrist
  8: { x: -0.11, y: 0.95, z: 0 },   // 8: RHip
  9: { x: -0.11, y: 0.50, z: 0 },   // 9: RKnee
  10: { x: -0.11, y: 0.05, z: 0.05 },// 10: RAnkle
  11: { x: 0.11, y: 0.95, z: 0 },   // 11: LHip
  12: { x: 0.11, y: 0.50, z: 0 },   // 12: LKnee
  13: { x: 0.11, y: 0.05, z: 0.05 },// 13: LAnkle
  14: { x: -0.035, y: 1.66, z: 0.07 },// 14: REye
  15: { x: 0.035, y: 1.66, z: 0.07 }, // 15: LEye
  16: { x: -0.075, y: 1.65, z: 0 },   // 16: REar
  17: { x: 0.075, y: 1.65, z: 0 }    // 17: LEar
};
