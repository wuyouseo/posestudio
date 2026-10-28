import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkeletonModel } from './skeleton_model.js?v=20261028_human_anatomy';
import { CameraManager } from './camera_controls.js?v=20261028_human_anatomy';
import { OpenPoseExporter } from './exporter.js?v=20261028_human_anatomy';
import { POSE_CATEGORIES, POSE_PRESETS } from './pose_presets.js?v=20261028_human_anatomy';
import { LINEART_GALLERY_DATA } from './lineart_gallery_data.js?v=20261028_human_anatomy';

class PoseStudioApp {
  constructor() {
    this.currentPreset = POSE_PRESETS[0];
    this.customPresets = [];
    this.allPresets = [...POSE_PRESETS];
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.viewMode = 'openpose'; // 'openpose' | 'lineart'
    this.libraryTab = '3d';     // '3d' | 'gallery'
    this.galleryCategory = 'female1'; // 'female1' | 'female2' | 'men' | 'children' | 'couples'
    this.currentAngle = 'front';
    this.currentFocal = 50;
    this.currentAspect = '3:4';

    this.initDOM();
    this.loadCustomPresets();
    this.initPresetsUI();

    try {
      this.initThree();
      // 默认应用第一个姿态
      this.selectPose(this.currentPreset.id, false);
      this.updateAspectRatio('3:4');
    } catch (err) {
      console.error('Three.js / WebGL 渲染引擎初始化失败:', err);
    }

    this.bindEvents();
  }

  initDOM() {
    this.container = document.getElementById('canvas-container');
    this.frameOverlay = document.getElementById('frame-overlay');
    this.frameLabel = document.getElementById('frame-label');
    this.currentPoseBadge = document.getElementById('current-pose-badge');
    this.coupleModeIndicator = document.getElementById('couple-mode-indicator');
    this.photographerTipBox = document.getElementById('photographer-tip-box');
    this.categoryTabs = document.getElementById('category-tabs');
    this.presetList = document.getElementById('preset-list');
    this.searchInput = document.getElementById('preset-search-input');
    this.totalCountSpan = document.getElementById('total-preset-count');
    this.panelTitleText = document.getElementById('panel-title-text');
    this.promptBox = document.getElementById('prompt-box');
    this.copyPromptBtn = document.getElementById('copy-prompt-btn');

    // 模式切换按钮 (骨骼 vs 线稿)
    this.btnModeOpenPose = document.getElementById('view-mode-openpose');
    this.btnModeLineart = document.getElementById('view-mode-lineart');

    // 库切换按钮 (3D姿态 vs 线稿图库)
    this.btnTab3D = document.getElementById('tab-switch-3d');
    this.btnTabGallery = document.getElementById('tab-switch-gallery');

    // 人体轮廓控件
    this.checkboxSilhouette = document.getElementById('checkbox-silhouette');
    this.silhouetteSlider = document.getElementById('silhouette-opacity-slider');
    this.silhouetteVal = document.getElementById('silhouette-opacity-val');
    this.toggleSilhouetteBtn = document.getElementById('toggle-silhouette-btn');

    // 关节编辑器
    this.jointEditor = document.getElementById('joint-editor');
    this.selectedJointName = document.getElementById('selected-joint-name');
    this.sliderX = document.getElementById('joint-x');
    this.sliderY = document.getElementById('joint-y');
    this.sliderZ = document.getElementById('joint-z');
    this.valX = document.getElementById('val-x');
    this.valY = document.getElementById('val-y');
    this.valZ = document.getElementById('val-z');

    // 导出控件
    this.exportBtn = document.getElementById('export-btn');
    this.exportModeSelect = document.getElementById('export-mode-select');
    this.resSelect = document.getElementById('res-select');
    this.bgTypeSelect = document.getElementById('bg-type-select');

    // 线稿画廊大图预览弹窗模态控件
    this.lineartModal = document.getElementById('lineart-modal');
    this.modalBackdrop = document.getElementById('lineart-modal-backdrop');
    this.modalCatBadge = document.getElementById('modal-cat-badge');
    this.modalPoseTitle = document.getElementById('modal-pose-title');
    this.modalCounter = document.getElementById('modal-counter');
    this.modalCloseBtn = document.getElementById('modal-close-btn');
    this.modalPrevBtn = document.getElementById('modal-prev-btn');
    this.modalNextBtn = document.getElementById('modal-next-btn');
    this.modalPreviewImg = document.getElementById('modal-preview-img');
    this.modalTipText = document.getElementById('modal-tip-text');
    this.modalPromptBox = document.getElementById('modal-prompt-box');
    this.modalCopyPromptBtn = document.getElementById('modal-copy-prompt-btn');
    this.modalDownloadBtn = document.getElementById('modal-download-btn');
    this.currentModalIndex = 0;
    this.modalItems = [];

    // 网页细节打磨控件
    this.clearSearchBtn = document.getElementById('clear-search-btn');
    this.resetCurrentPoseBtn = document.getElementById('reset-current-pose-btn');
    this.helpGuideBtn = document.getElementById('help-guide-btn');
    this.guideModal = document.getElementById('guide-modal');
    this.guideModalBackdrop = document.getElementById('guide-modal-backdrop');
    this.guideModalCloseBtn = document.getElementById('guide-modal-close-btn');

    // Lightbox 大图滚轮无级缩放
    this.modalZoom = 1.0;
    this.modalImgWrapper = document.getElementById('modal-image-wrapper');
    this.modalZoomLevel = document.getElementById('modal-zoom-level');
    this.modalZoomInBtn = document.getElementById('modal-zoom-in-btn');
    this.modalZoomOutBtn = document.getElementById('modal-zoom-out-btn');
    this.modalZoomResetBtn = document.getElementById('modal-zoom-reset-btn');

    // 关节镜像与复位
    this.btnMirrorJoint = document.getElementById('btn-mirror-joint');
    this.btnResetSingleJoint = document.getElementById('btn-reset-single-joint');
    this.btnExportPoseJson = document.getElementById('export-pose-json-btn');

    // 双人模式快捷切换
    this.coupleBtnPersonA = document.getElementById('couple-btn-personA');
    this.coupleBtnPersonB = document.getElementById('couple-btn-personB');
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1015);

    // 地面标尺
    this.gridHelper = new THREE.GridHelper(6, 20, 0x3b82f6, 0x1f242d);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    // 专业影楼三点式人像布光系统 (主光暖白 + 辅光冷透 + 轮廓光立体勾勒)
    const ambientLight = new THREE.AmbientLight(0xfff7ed, 0.88);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.35);
    keyLight.position.set(2.8, 4.2, 4.0);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbfdbfe, 0.70);
    fillLight.position.set(-3.2, 2.2, 2.5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xf472b6, 0.90);
    rimLight.position.set(0, 3.2, -4.2);
    this.scene.add(rimLight);

    // 相机与渲染器 (50mm 镜头在 4.8m 处，完美容纳 1.76m 全身人像并具备黄金比例空间)
    const rect = this.container.getBoundingClientRect();
    this.camera = new THREE.PerspectiveCamera(27.0, rect.width / rect.height, 0.1, 50);
    this.camera.position.set(0, 1.05, 4.8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(rect.width, rect.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // 轨道控制 (目标设在人体几何中心 y=0.90m)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.target.set(0, 0.90, 0);

    // 骨骼与立体轮廓模型系统
    this.skeleton = new SkeletonModel(this.scene);

    // 相机与导出管理器
    this.cameraManager = new CameraManager(this.camera, this.controls, this.container);
    this.exporter = new OpenPoseExporter(this.renderer, this.scene, this.camera, this.skeleton);

    // 射线拾取
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.clock = new THREE.Clock();
    this.isAutoRotating = false;

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initPresetsUI() {
    if (this.libraryTab === '3d') {
      this.render3DPresetsUI();
    } else {
      this.renderLineartGalleryUI();
    }
  }

  /**
   * 渲染 3D 姿态库分类与卡片
   */
  render3DPresetsUI() {
    this.panelTitleText.textContent = '3D 姿势分类预设';
    this.categoryTabs.innerHTML = '';

    if (this.totalCountSpan) {
      this.totalCountSpan.textContent = `共 ${this.allPresets.length} 款姿势`;
    }

    POSE_CATEGORIES.forEach((cat) => {
      const count = cat.id === 'all'
        ? this.allPresets.length
        : this.allPresets.filter(p => p.category === cat.id).length;

      const btn = document.createElement('button');
      btn.className = `cat-tab ${cat.id === this.currentCategory ? 'active' : ''}`;
      btn.dataset.category = cat.id;
      btn.innerHTML = `
        <span>${cat.name}</span>
        <span class="cat-badge">${count}</span>
      `;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentCategory = cat.id;
        this.renderPresetList();
      });
      this.categoryTabs.appendChild(btn);
    });

    this.renderPresetList();
  }

  /**
   * 渲染大师手绘线稿库 (100张原画) 分类与卡片
   */
  renderLineartGalleryUI() {
    this.panelTitleText.textContent = '🎨 大师经典手绘线稿原画';
    this.categoryTabs.innerHTML = '';

    const galleryCats = [
      { id: 'female1', name: '👩 女生篇 (I)', count: 21 },
      { id: 'female2', name: '👩 女生篇 (II)', count: 21 },
      { id: 'men', name: '👨 男生篇', count: 21 },
      { id: 'children', name: '👶 兒童篇', count: 21 },
      { id: 'couples', name: '💑 情侣篇', count: 16 }
    ];

    if (this.totalCountSpan) {
      this.totalCountSpan.textContent = `共 100 张经典线稿`;
    }

    galleryCats.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = `cat-tab ${cat.id === this.galleryCategory ? 'active' : ''}`;
      btn.dataset.category = cat.id;
      btn.innerHTML = `
        <span>${cat.name}</span>
        <span class="cat-badge">${cat.count}</span>
      `;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.galleryCategory = cat.id;
        this.renderLineartCardList();
      });
      this.categoryTabs.appendChild(btn);
    });

    this.renderLineartCardList();
  }

  getCategoryBadge(category) {
    switch (category) {
      case 'female':
        return '<span class="preset-category-tag tag-female">👩 女生篇</span>';
      case 'men':
        return '<span class="preset-category-tag tag-men">👨 男生篇</span>';
      case 'children':
        return '<span class="preset-category-tag tag-children">👶 儿童篇</span>';
      case 'couples':
        return '<span class="preset-category-tag tag-couples">💑 情侣双人</span>';
      default:
        return '<span class="preset-category-tag" style="background:#374151; color:#9ca3af;">经典姿态</span>';
    }
  }

  renderPresetList() {
    if (this.libraryTab !== '3d') {
      this.renderLineartCardList();
      return;
    }

    this.presetList.innerHTML = '';
    
    let list = this.currentCategory === 'all'
      ? this.allPresets
      : this.allPresets.filter(p => p.category === this.currentCategory);

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      list = list.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.photographerTip && p.photographerTip.toLowerCase().includes(q))
      );
    }

    if (list.length === 0) {
      this.presetList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 12px;">
          未找到匹配的姿态，试试搜索其他关键字~
        </div>
      `;
      return;
    }

    list.forEach((preset) => {
      const card = document.createElement('div');
      card.className = `preset-card ${preset.id === this.currentPreset?.id ? 'active' : ''}`;
      card.dataset.id = preset.id;
      
      const badgeHtml = this.getCategoryBadge(preset.category);

      card.innerHTML = `
        <div class="card-top-bar">
          <span class="preset-card-title">${preset.name}</span>
          <div>
            ${badgeHtml}
            ${preset.isCustom ? '<span style="font-size:10px; color:#f59e0b; margin-left:4px;">自定义</span>' : ''}
          </div>
        </div>
        <div class="preset-card-desc">${preset.description || ''}</div>
      `;
      card.addEventListener('click', () => {
        this.selectPose(preset.id, true);
      });

      if (preset.isCustom) {
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️';
        delBtn.title = '删除此自定义姿势';
        delBtn.style.cssText = 'background:none; border:none; cursor:pointer; font-size:12px; opacity:0.65; margin-left:6px; padding:0;';
        delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1.0');
        delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.65');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`确定要从本地预设库中删除姿势【${preset.name}】吗？`)) {
            this.deleteCustomPose(preset.id);
          }
        });
        card.querySelector('.card-top-bar > div')?.appendChild(delBtn);
      }

      this.presetList.appendChild(card);
    });
  }

  deleteCustomPose(id) {
    this.customPresets = this.customPresets.filter(p => p.id !== id);
    this.allPresets = this.allPresets.filter(p => p.id !== id);
    localStorage.setItem('photographer_custom_poses_v2', JSON.stringify(this.customPresets));
    this.initPresetsUI();
    if (this.currentPreset?.id === id) {
      this.selectPose(POSE_PRESETS[0].id, false);
    }
    this.showToast('🗑️ 自定义姿态已成功删除');
  }

  /**
   * 渲染手绘线稿画廊卡片 (增强点击大图预览与直接下载)
   */
  renderLineartCardList() {
    this.presetList.innerHTML = '';
    const group = LINEART_GALLERY_DATA[this.galleryCategory];
    if (!group || !group.items) return;

    let items = group.items;
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      items = items.filter(it => it.name.toLowerCase().includes(q) || it.tip.toLowerCase().includes(q));
    }

    this.modalItems = items;

    if (items.length === 0) {
      this.presetList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 12px;">
          未找到匹配的手绘线稿~
        </div>
      `;
      return;
    }

    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'lineart-card';
      const downloadName = `Fotobeginner_${group.title}_${item.name}.png`.replace(/\s+/g, '_');

      card.innerHTML = `
        <div class="lineart-thumb-wrapper" title="点击查看高清大图与构图指南">
          <img src="${item.img}" class="lineart-thumb-img" alt="${item.name}">
        </div>
        <div class="lineart-info-col">
          <div>
            <div class="lineart-title" title="点击查看大图">${item.name}</div>
            <div class="lineart-tip-text">${item.tip}</div>
          </div>
          <div class="lineart-card-actions">
            <button class="lineart-action-btn btn-download-lineart" title="一键保存高清线稿到本地">
              <span>⬇️</span> 下载线稿
            </button>
            <button class="lineart-action-btn btn-preview-lineart" title="大图预览与翻页">
              <span>🔍</span> 预览
            </button>
            <button class="lineart-action-btn btn-sync-3d" data-name="${item.name}" title="将3D视口切换为此风格">
              <span>🔄</span> 3D视角
            </button>
          </div>
        </div>
      `;

      // 点击缩略图、标题或预览按钮打开大图模态框
      card.querySelector('.lineart-thumb-wrapper')?.addEventListener('click', () => {
        this.openLineartModal(index);
      });
      card.querySelector('.lineart-title')?.addEventListener('click', () => {
        this.openLineartModal(index);
      });
      card.querySelector('.btn-preview-lineart')?.addEventListener('click', () => {
        this.openLineartModal(index);
      });

      // 下载按钮直接触发文件保存
      card.querySelector('.btn-download-lineart')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadFile(item.img, downloadName);
      });

      // 联动 3D
      card.querySelector('.btn-sync-3d')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setViewMode('lineart');
        this.photographerTipBox.textContent = item.tip;
        this.promptBox.textContent = 'minimalist pencil lineart, clean anatomical contour sketch, fine art drawing, black ink on white paper, ' + item.tip;
      });

      this.presetList.appendChild(card);
    });
  }

  /**
   * 打开线稿大图预览模态框
   */
  openLineartModal(index) {
    if (!this.modalItems || this.modalItems.length === 0) return;
    this.currentModalIndex = Math.max(0, Math.min(index, this.modalItems.length - 1));
    this.setModalZoom(1.0);
    this.updateModalContent();
    if (this.lineartModal) {
      this.lineartModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  setModalZoom(zoom) {
    this.modalZoom = Math.max(1.0, Math.min(3.0, zoom));
    if (this.modalPreviewImg) {
      this.modalPreviewImg.style.transform = `scale(${this.modalZoom})`;
      this.modalPreviewImg.style.transformOrigin = 'center center';
      this.modalPreviewImg.style.cursor = this.modalZoom > 1.05 ? 'zoom-out' : 'zoom-in';
    }
    if (this.modalZoomLevel) {
      this.modalZoomLevel.textContent = `${Math.round(this.modalZoom * 100)}%`;
    }
  }

  closeLineartModal() {
    if (this.lineartModal) {
      this.lineartModal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  navigateModal(delta) {
    if (!this.modalItems || this.modalItems.length === 0) return;
    let nextIndex = this.currentModalIndex + delta;
    if (nextIndex < 0) nextIndex = this.modalItems.length - 1;
    if (nextIndex >= this.modalItems.length) nextIndex = 0;
    this.currentModalIndex = nextIndex;
    this.setModalZoom(1.0);
    this.updateModalContent();
  }

  updateModalContent() {
    const item = this.modalItems[this.currentModalIndex];
    if (!item) return;

    const group = LINEART_GALLERY_DATA[this.galleryCategory];
    const catTitle = group ? group.title : '经典手绘线稿';

    if (this.modalCatBadge) this.modalCatBadge.textContent = catTitle;
    if (this.modalPoseTitle) this.modalPoseTitle.textContent = item.name;
    if (this.modalCounter) this.modalCounter.textContent = `${this.currentModalIndex + 1} / ${this.modalItems.length}`;
    if (this.modalPreviewImg) {
      this.modalPreviewImg.src = item.img;
      this.modalPreviewImg.alt = item.name;
    }
    if (this.modalTipText) this.modalTipText.textContent = item.tip;
    if (this.modalPromptBox) {
      this.modalPromptBox.textContent = `minimalist pencil lineart, clean anatomical contour sketch, fine art portrait pose, black ink on white paper, master sketch, ${item.tip}`;
    }
  }

  /**
   * 稳妥的通用文件下载方法 (优先 Blob 触发浏览器保存，防止跳页)
   */
  async downloadFile(url, defaultFilename) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('网络响应异常');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = defaultFilename || 'lineart.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFilename || 'lineart.png';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  /**
   * 全局轻量现代 Toast 气泡通知
   */
  showToast(message, type = 'info', duration = 2400) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 280);
    }, duration);
  }

  selectPose(presetId, animate = true) {
    const preset = this.allPresets.find(p => p.id === presetId);
    if (!preset) return;

    this.currentPreset = preset;
    this.currentPoseBadge.textContent = preset.name;

    this.updatePromptText();

    this.photographerTipBox.textContent = preset.photographerTip || '保持自然放松的呼吸，引导模特眼神与光线产生互动。';

    if (preset.isCouple) {
      this.coupleModeIndicator.style.display = 'flex';
      if (this.coupleBtnPersonA) this.coupleBtnPersonA.classList.add('active');
      if (this.coupleBtnPersonB) this.coupleBtnPersonB.classList.remove('active');
    } else {
      this.coupleModeIndicator.style.display = 'none';
    }

    this.skeleton.applyPreset(preset, animate);

    const targetProfile = preset.bodyProfile || (preset.category === 'men' ? 'male' : (preset.category === 'children' ? 'child' : 'female'));
    document.querySelectorAll('[data-bodyprofile]').forEach(b => {
      b.classList.toggle('active', b.dataset.bodyprofile === targetProfile);
    });

    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.toggle('active', card.dataset.id === presetId);
    });

    this.skeleton.clearSelection();
    this.jointEditor.style.display = 'none';
  }

  /**
   * 动态智能组装生图提示词 (结合预设主词 + 真实拍摄机位 + 镜头焦段 + 画幅)
   */
  updatePromptText() {
    if (!this.currentPreset) return;
    const basePrompt = this.currentPreset.promptHint || 'portrait photography, realistic details, high quality';
    
    const angleMap = {
      'front': 'front view, eye level shot',
      'left45': 'three-quarter view, 45 degree angle',
      'right45': 'three-quarter view, 45 degree angle',
      'left90': 'profile view, 90 degree side angle',
      'low': 'low angle shot, heroic perspective, dynamic view, looking up',
      'high': 'high angle shot, overhead perspective, intimate mood, looking down',
      'back': 'back view, looking back over shoulder'
    };

    const focalMap = {
      28: '28mm wide angle lens, environmental portrait, street style',
      50: '50mm prime lens, natural human eye perspective, sharp bokeh',
      85: '85mm portrait telephoto lens, creamy bokeh, shallow depth of field, sharp facial focus'
    };

    const aspectMap = {
      '3:4': '3:4 portrait aspect ratio',
      '9:16': 'vertical 9:16 full-screen framing',
      '1:1': '1:1 square framing, centered composition',
      '2:3': '2:3 classic 35mm film format'
    };

    const angleTag = angleMap[this.currentAngle || 'front'] || '';
    const focalTag = focalMap[this.currentFocal || 50] || '';
    const aspectTag = aspectMap[this.cameraManager?.currentAspect || '3:4'] || '';

    let fullPrompt = `${basePrompt}, ${angleTag}, ${focalTag}, ${aspectTag}`;

    if (this.viewMode === 'lineart') {
      fullPrompt += ', minimalist pencil lineart, clean anatomical contour sketch, fine art drawing, black ink on white paper, master sketch';
    }

    if (this.promptBox) {
      this.promptBox.textContent = fullPrompt;
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.skeleton.setStyleMode(mode);

    if (mode === 'lineart') {
      this.btnModeLineart.classList.add('active');
      this.btnModeOpenPose.classList.remove('active');

      this.scene.background = new THREE.Color(0xf1f5f9);
      this.gridHelper.visible = false;
      this.exportModeSelect.value = 'lineart_white';
    } else {
      this.btnModeOpenPose.classList.add('active');
      this.btnModeLineart.classList.remove('active');

      this.scene.background = new THREE.Color(0x0e1015);
      this.gridHelper.visible = true;
      this.exportModeSelect.value = 'bones_only';
    }

    this.updatePromptText();
  }

  updateAspectRatio(aspectKey) {
    const frame = this.cameraManager.setAspectRatio(aspectKey);
    if (!frame) return;

    this.frameOverlay.style.width = `${frame.frameWidth}px`;
    this.frameOverlay.style.height = `${frame.frameHeight}px`;
    this.frameLabel.textContent = `${aspectKey} 人像取景框`;

    // 自动将导出分辨率同步切换至与画幅匹配的最佳档位
    const aspectResolutionMap = {
      '3:4': '768x1024',
      '9:16': '720x1280',
      '1:1': '1024x1024',
      '2:3': '1024x1536'
    };
    if (this.resSelect && aspectResolutionMap[aspectKey]) {
      this.resSelect.value = aspectResolutionMap[aspectKey];
    }

    this.updatePromptText();
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      const rect = this.container.getBoundingClientRect();
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(rect.width, rect.height);
      this.updateAspectRatio(this.cameraManager.currentAspect);
    });

    // 库切换：3D姿态 vs 线稿画廊
    this.btnTab3D?.addEventListener('click', () => {
      this.libraryTab = '3d';
      this.btnTab3D.classList.add('active');
      this.btnTabGallery.classList.remove('active');
      this.initPresetsUI();
    });

    this.btnTabGallery?.addEventListener('click', () => {
      this.libraryTab = 'gallery';
      this.btnTabGallery.classList.add('active');
      this.btnTab3D.classList.remove('active');
      this.initPresetsUI();
    });

    // 模式切换按钮 (骨骼 vs 手绘线稿)
    this.btnModeOpenPose?.addEventListener('click', () => this.setViewMode('openpose'));
    this.btnModeLineart?.addEventListener('click', () => this.setViewMode('lineart'));

    // 搜索输入与实时联动
    const handleSearch = (query) => {
      this.searchQuery = query;
      if (this.clearSearchBtn) {
        this.clearSearchBtn.style.display = query.trim() ? 'flex' : 'none';
      }
      if (this.libraryTab === '3d') {
        this.renderPresetList();
      } else {
        this.renderLineartCardList();
      }
    };

    this.searchInput?.addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });

    // 搜索清空按钮
    this.clearSearchBtn?.addEventListener('click', () => {
      if (this.searchInput) this.searchInput.value = '';
      document.querySelectorAll('.quick-tag').forEach(t => t.classList.remove('active'));
      handleSearch('');
      this.searchInput?.focus();
    });

    // 快捷热词标签筛选
    document.querySelectorAll('.quick-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        const kw = e.currentTarget.dataset.kw;
        const wasActive = e.currentTarget.classList.contains('active');
        document.querySelectorAll('.quick-tag').forEach(t => t.classList.remove('active'));
        if (!wasActive) {
          e.currentTarget.classList.add('active');
          if (this.searchInput) this.searchInput.value = kw;
          handleSearch(kw);
        } else {
          if (this.searchInput) this.searchInput.value = '';
          handleSearch('');
        }
      });
    });

    // 快捷机位按钮
    document.querySelectorAll('[data-angle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const angle = e.currentTarget.dataset.angle;
        this.currentAngle = angle;
        this.cameraManager.setAnglePreset(angle);
        document.querySelectorAll('[data-angle]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.updatePromptText();
      });
    });

    // 画幅切换按钮
    document.querySelectorAll('[data-aspect]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const aspect = e.currentTarget.dataset.aspect;
        this.currentAspect = aspect;
        this.updateAspectRatio(aspect);
        document.querySelectorAll('[data-aspect]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // 焦段切换
    document.querySelectorAll('[data-focal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mm = parseInt(e.currentTarget.dataset.focal, 10);
        this.currentFocal = mm;
        this.cameraManager.setFocalLength(mm);
        document.querySelectorAll('[data-focal]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.updatePromptText();
      });
    });

    // 人体轮廓控制
    const updateSilhouetteVisibility = (visible) => {
      this.skeleton.setSilhouetteVisible(visible);
      this.checkboxSilhouette.checked = visible;
      this.toggleSilhouetteBtn.classList.toggle('active', visible);
    };

    this.checkboxSilhouette.addEventListener('change', (e) => {
      updateSilhouetteVisibility(e.target.checked);
    });

    this.toggleSilhouetteBtn.addEventListener('click', () => {
      const targetState = !this.skeleton.silhouetteVisible;
      updateSilhouetteVisibility(targetState);
    });

    this.silhouetteSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.skeleton.setSilhouetteOpacity(val);
      this.silhouetteVal.textContent = `${Math.round(val * 100)}%`;
    });

    // 解剖体型切换 (女性沙漏 / 男性倒三角 / 儿童可爱)
    document.querySelectorAll('[data-bodyprofile]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const profile = e.currentTarget.dataset.bodyprofile;
        this.skeleton.setBodyProfile(profile);
        document.querySelectorAll('[data-bodyprofile]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.showToast(`✨ 体型已切换为【${e.currentTarget.textContent.trim()}】解剖形态！`);
      });
    });

    // 视口浮动按钮
    document.getElementById('toggle-grid-btn')?.addEventListener('click', (e) => {
      this.gridHelper.visible = !this.gridHelper.visible;
      e.currentTarget.classList.toggle('active', this.gridHelper.visible);
    });

    document.getElementById('toggle-rotate-btn')?.addEventListener('click', (e) => {
      this.isAutoRotating = !this.isAutoRotating;
      this.controls.autoRotate = this.isAutoRotating;
      this.controls.autoRotateSpeed = 2.0;
      e.currentTarget.classList.toggle('active', this.isAutoRotating);
    });

    document.getElementById('reset-cam-btn')?.addEventListener('click', () => {
      this.cameraManager.setAnglePreset('front');
      document.querySelectorAll('[data-angle]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-angle="front"]')?.classList.add('active');
    });

    // 还原当前姿势初始形态
    this.resetCurrentPoseBtn?.addEventListener('click', () => {
      if (this.currentPreset) {
        this.selectPose(this.currentPreset.id, true);
        this.showToast('↺ 已还原当前姿势【' + this.currentPreset.name + '】初始骨架！');
      }
    });

    // 操作指南弹窗控制
    const openGuideModal = () => {
      if (this.guideModal) {
        this.guideModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
    };
    const closeGuideModal = () => {
      if (this.guideModal) {
        this.guideModal.style.display = 'none';
        document.body.style.overflow = '';
      }
    };

    this.helpGuideBtn?.addEventListener('click', openGuideModal);
    this.guideModalCloseBtn?.addEventListener('click', closeGuideModal);
    this.guideModalBackdrop?.addEventListener('click', closeGuideModal);

    // 复制提示词
    this.copyPromptBtn.addEventListener('click', () => {
      const text = this.promptBox.textContent;
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('📋 AI 绘画提示词已复制到剪贴板！可直接粘贴生图');
      });
    });

    // 导出姿态图按钮
    this.exportBtn.addEventListener('click', () => {
      const [wStr, hStr] = this.resSelect.value.split('x');
      const width = parseInt(wStr, 10);
      const height = parseInt(hStr, 10);
      const transparent = this.bgTypeSelect.value === 'transparent';
      const exportMode = this.exportModeSelect.value;
      const poseName = this.currentPreset?.name || 'custom_pose';

      this.showToast('⬇️ 正在导出 ControlNet 姿态图 (PNG)，请稍候...');

      this.exporter.exportOpenPoseImage({
        width,
        height,
        transparent,
        exportMode,
        poseName
      });
    });

    // 导出姿态 JSON 数据按钮
    this.btnExportPoseJson?.addEventListener('click', () => {
      const poseData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        name: this.currentPreset?.name || 'custom_pose',
        isCouplesMode: this.skeleton.isCouplesMode,
        joints: this.skeleton.personA.getPoseData(),
        jointsB: this.skeleton.isCouplesMode ? this.skeleton.personB.getPoseData() : null,
        camera: {
          angle: this.currentAngle || 'front',
          focal: this.currentFocal || 50,
          aspect: this.currentAspect || '3:4'
        }
      };
      this.exporter.exportPoseJSON(poseData, `PoseStudio_${this.currentPreset?.name || 'pose'}`);
      this.showToast('📥 姿态 3D 坐标数据 (JSON) 已导出！可在其它项目复用', 'success');
    });

    // 保存自定义姿态
    document.getElementById('save-custom-btn')?.addEventListener('click', () => {
      const name = prompt('请输入新姿势名称：', '我的定制人像姿势');
      if (!name) return;

      const newPreset = {
        id: 'custom_' + Date.now(),
        category: 'female',
        name: name,
        description: '摄影师个性化调优姿态',
        photographerTip: '根据实际现场环境微调肢体与光影角度。',
        promptHint: 'custom portrait pose, high fashion photography, professional lighting',
        isCustom: true,
        joints: this.skeleton.personA.getPoseData(),
        jointsB: this.skeleton.isCouplesMode ? this.skeleton.personB.getPoseData() : null
      };

      this.customPresets.push(newPreset);
      this.allPresets.push(newPreset);
      localStorage.setItem('photographer_custom_poses_v2', JSON.stringify(this.customPresets));
      this.initPresetsUI();
      this.selectPose(newPreset.id, false);
      this.showToast(`💾 姿势【${name}】已成功存入本地预设库！`, 'success');
    });

    // 双人模式快捷控制切换
    this.coupleBtnPersonA?.addEventListener('click', () => {
      this.skeleton.activeEntity = this.skeleton.personA;
      this.coupleBtnPersonA.classList.add('active');
      this.coupleBtnPersonB.classList.remove('active');
      this.selectJoint(0, '面部/头部', 'personA', '主模特');
      this.showToast('👩 已切换至【主模特】进行肢体调节');
    });

    this.coupleBtnPersonB?.addEventListener('click', () => {
      this.skeleton.activeEntity = this.skeleton.personB;
      this.coupleBtnPersonB.classList.add('active');
      this.coupleBtnPersonA.classList.remove('active');
      this.selectJoint(0, '头部/视线', 'personB', '副模特/伴侣');
      this.showToast('👨 已切换至【副模特/伴侣】进行肢体调节');
    });

    // 鼠标悬停关节反馈 (改变光标形状)
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);

      const jointMeshesArray = [...this.skeleton.personA.jointMeshes.values()];
      if (this.skeleton.isCouplesMode) {
        jointMeshesArray.push(...this.skeleton.personB.jointMeshes.values());
      }
      const intersects = this.raycaster.intersectObjects(jointMeshesArray, true);
      this.renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
    });

    // 鼠标点击精准拾取关节 (支持大碰撞体穿透)
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      const jointMeshesArray = [...this.skeleton.personA.jointMeshes.values()];
      if (this.skeleton.isCouplesMode) {
        jointMeshesArray.push(...this.skeleton.personB.jointMeshes.values());
      }

      const intersects = this.raycaster.intersectObjects(jointMeshesArray, true);

      if (intersects.length > 0) {
        let hit = intersects[0].object;
        let jointId = hit.userData.jointId;
        let entityId = hit.userData.entityId;
        let label = hit.userData.label;

        if (jointId === undefined && hit.parent?.userData?.jointId !== undefined) {
          hit = hit.parent;
          jointId = hit.userData.jointId;
          entityId = hit.userData.entityId;
          label = hit.userData.label;
        }

        if (jointId !== undefined) {
          const roleLabel = entityId === 'personB' ? '副模特/伴侣' : (this.skeleton.isCouplesMode ? '主模特/女' : '');
          this.selectJoint(jointId, label, entityId, roleLabel);

          // 同步双人切换按钮的高亮
          if (this.skeleton.isCouplesMode) {
            if (entityId === 'personB') {
              this.coupleBtnPersonB?.classList.add('active');
              this.coupleBtnPersonA?.classList.remove('active');
            } else {
              this.coupleBtnPersonA?.classList.add('active');
              this.coupleBtnPersonB?.classList.remove('active');
            }
          }
        }
      }
    });

    // 关节滑块微调
    const onSliderChange = () => {
      if (this.skeleton.selectedJointId === null) return;
      const x = parseFloat(this.sliderX.value);
      const y = parseFloat(this.sliderY.value);
      const z = parseFloat(this.sliderZ.value);

      this.valX.textContent = x.toFixed(2);
      this.valY.textContent = y.toFixed(2);
      this.valZ.textContent = z.toFixed(2);

      this.skeleton.setJointPosition(this.skeleton.selectedJointId, x, y, z);
    };

    this.sliderX.addEventListener('input', onSliderChange);
    this.sliderY.addEventListener('input', onSliderChange);
    this.sliderZ.addEventListener('input', onSliderChange);

    // 关节对称镜像按钮
    this.btnMirrorJoint?.addEventListener('click', () => {
      if (this.skeleton.selectedJointId === null) {
        this.showToast('⚠️ 请先在 3D 人体上点击选择一个关节点！');
        return;
      }
      const oppId = this.skeleton.mirrorJoint(this.skeleton.selectedJointId);
      if (oppId !== null) {
        this.showToast('🪞 关节点已对称镜像到对侧！');
      } else {
        this.showToast('ℹ️ 该关节已位于正中轴或暂无对称点');
      }
    });

    // 还原单个关节至初始预设
    this.btnResetSingleJoint?.addEventListener('click', () => {
      const jointId = this.skeleton.selectedJointId;
      if (jointId === null) {
        this.showToast('⚠️ 请先点击选择要复位的关节！');
        return;
      }
      if (!this.currentPreset) return;

      const isPersonB = this.skeleton.activeEntity === this.skeleton.personB;
      const presetJoints = (isPersonB && this.currentPreset.jointsB)
        ? this.currentPreset.jointsB
        : this.currentPreset.joints;

      const targetPos = presetJoints ? presetJoints[jointId] : null;
      if (targetPos) {
        this.skeleton.setJointPosition(jointId, targetPos.x, targetPos.y, targetPos.z);
        this.sliderX.value = targetPos.x;
        this.sliderY.value = targetPos.y;
        this.sliderZ.value = targetPos.z;
        this.valX.textContent = targetPos.x.toFixed(2);
        this.valY.textContent = targetPos.y.toFixed(2);
        this.valZ.textContent = targetPos.z.toFixed(2);
        this.showToast('↺ 当前关节已恢复到初始预设位置！');
      } else {
        this.showToast('⚠️ 无法获取此关节的原始预设数据');
      }
    });

    // ── 大师手绘线稿 Lightbox 模态框事件 ──
    this.modalCloseBtn?.addEventListener('click', () => this.closeLineartModal());
    this.modalBackdrop?.addEventListener('click', () => this.closeLineartModal());
    this.modalPrevBtn?.addEventListener('click', () => this.navigateModal(-1));
    this.modalNextBtn?.addEventListener('click', () => this.navigateModal(1));

    // Lightbox 大图缩放控制
    this.modalZoomInBtn?.addEventListener('click', () => {
      this.setModalZoom(this.modalZoom + 0.25);
    });
    this.modalZoomOutBtn?.addEventListener('click', () => {
      this.setModalZoom(this.modalZoom - 0.25);
    });
    this.modalZoomResetBtn?.addEventListener('click', () => {
      this.setModalZoom(1.0);
    });

    // 滚轮无级平滑缩放
    this.modalImgWrapper?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      this.setModalZoom(this.modalZoom + delta);
    }, { passive: false });

    // 双击快速缩放/复原
    this.modalPreviewImg?.addEventListener('dblclick', () => {
      this.setModalZoom(this.modalZoom > 1.2 ? 1.0 : 2.0);
    });

    // 模态框下载按钮
    this.modalDownloadBtn?.addEventListener('click', () => {
      const item = this.modalItems[this.currentModalIndex];
      if (!item) return;
      const group = LINEART_GALLERY_DATA[this.galleryCategory];
      const filename = `Fotobeginner_${group ? group.title : '线稿'}_${item.name}.png`.replace(/\s+/g, '_');
      this.downloadFile(item.img, filename);
    });

    // 模态框复制提示词按钮
    this.modalCopyPromptBtn?.addEventListener('click', () => {
      const text = this.modalPromptBox.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const orig = this.modalCopyPromptBtn.innerHTML;
        this.modalCopyPromptBtn.innerHTML = '<span>✅</span> 已复制到剪贴板！可以直接在生图软件垫图';
        this.modalCopyPromptBtn.style.color = '#34d399';
        setTimeout(() => {
          this.modalCopyPromptBtn.innerHTML = orig;
          this.modalCopyPromptBtn.style.color = '';
        }, 1800);
      });
    });

    // 模态框联动 3D 按钮
    this.modalSync3dBtn?.addEventListener('click', () => {
      const item = this.modalItems[this.currentModalIndex];
      if (!item) return;
      this.setViewMode('lineart');
      this.photographerTipBox.textContent = item.tip;
      this.promptBox.textContent = 'minimalist pencil lineart, clean anatomical contour sketch, fine art drawing, black ink on white paper, ' + item.tip;
      this.closeLineartModal();
    });

    // 全局键盘快捷键
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      if (e.key === 'Escape') {
        if (this.lineartModal && this.lineartModal.style.display !== 'none') {
          this.closeLineartModal();
        }
        if (this.guideModal && this.guideModal.style.display !== 'none') {
          this.guideModal.style.display = 'none';
          document.body.style.overflow = '';
        }
      } else if (this.lineartModal && this.lineartModal.style.display !== 'none') {
        if (e.key === 'ArrowLeft') {
          this.navigateModal(-1);
        } else if (e.key === 'ArrowRight') {
          this.navigateModal(1);
        }
      } else if (!isTyping) {
        if (e.code === 'Space') {
          e.preventDefault();
          const rotateBtn = document.getElementById('toggle-rotate-btn');
          rotateBtn?.click();
        } else if (e.code === 'KeyF') {
          const resetCamBtn = document.getElementById('reset-cam-btn');
          resetCamBtn?.click();
          this.showToast('📷 视角已复位至正视');
        } else if (e.code === 'KeyR') {
          this.resetCurrentPoseBtn?.click();
        }
      }
    });
  }

  selectJoint(jointId, label, entityId = 'personA', roleLabel = '') {
    this.skeleton.selectJoint(jointId, entityId);
    this.jointEditor.style.display = 'flex';
    const tag = roleLabel ? `[${roleLabel}] ${label}` : label;
    this.selectedJointName.textContent = tag;

    const pos = this.skeleton.activeEntity.currentJointPositions[jointId];
    if (pos) {
      this.sliderX.value = pos.x;
      this.sliderY.value = pos.y;
      this.sliderZ.value = pos.z;
      this.valX.textContent = pos.x.toFixed(2);
      this.valY.textContent = pos.y.toFixed(2);
      this.valZ.textContent = pos.z.toFixed(2);
    }
  }

  loadCustomPresets() {
    try {
      const stored = localStorage.getItem('photographer_custom_poses_v2');
      if (stored) {
        this.customPresets = JSON.parse(stored);
        this.allPresets = [...POSE_PRESETS, ...this.customPresets];
      }
    } catch (e) {
      console.error('加载本地预设失败', e);
    }
  }

  animate() {
    requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();

    this.controls.update();
    if (this.skeleton) {
      this.skeleton.update(delta);
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

function initStudio() {
  try {
    window.poseStudioApp = new PoseStudioApp();
  } catch (e) {
    console.error('PoseStudioApp 初始化异常:', e);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initStudio);
} else {
  initStudio();
}
