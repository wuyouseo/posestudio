import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkeletonModel } from './skeleton_model.js?v=20260927_camera_fit';
import { CameraManager } from './camera_controls.js?v=20260927_camera_fit';
import { OpenPoseExporter } from './exporter.js?v=20260927_camera_fit';
import { POSE_CATEGORIES, POSE_PRESETS } from './pose_presets.js?v=20260927_camera_fit';
import { LINEART_GALLERY_DATA } from './lineart_gallery_data.js?v=20260927_camera_fit';

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
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1015);

    // 地面标尺
    this.gridHelper = new THREE.GridHelper(6, 20, 0x3b82f6, 0x1f242d);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    // 三点式摄影棚布光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(3, 4, 4);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
    fillLight.position.set(-3, 2, 2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xa855f7, 0.8);
    rimLight.position.set(0, 3, -4);
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
      this.presetList.appendChild(card);
    });
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
    this.updateModalContent();
    if (this.lineartModal) {
      this.lineartModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
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

    const basePrompt = preset.promptHint || 'portrait photography, realistic details, high quality';
    if (this.viewMode === 'lineart') {
      this.promptBox.textContent = basePrompt + ', minimalist pencil lineart, clean anatomical contour sketch, fine art drawing, black ink on white paper';
    } else {
      this.promptBox.textContent = basePrompt;
    }

    this.photographerTipBox.textContent = preset.photographerTip || '保持自然放松的呼吸，引导模特眼神与光线产生互动。';

    if (preset.isCouple) {
      this.coupleModeIndicator.style.display = 'inline-block';
    } else {
      this.coupleModeIndicator.style.display = 'none';
    }

    this.skeleton.applyPreset(preset, animate);

    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.toggle('active', card.dataset.id === presetId);
    });

    this.skeleton.clearSelection();
    this.jointEditor.style.display = 'none';
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

      if (this.currentPreset) {
        this.promptBox.textContent = (this.currentPreset.promptHint || '') + ', minimalist pencil lineart, clean anatomical contour sketch, fine art drawing, black ink on white paper';
      }
    } else {
      this.btnModeOpenPose.classList.add('active');
      this.btnModeLineart.classList.remove('active');

      this.scene.background = new THREE.Color(0x0e1015);
      this.gridHelper.visible = true;
      this.exportModeSelect.value = 'bones_only';

      if (this.currentPreset) {
        this.promptBox.textContent = this.currentPreset.promptHint || '';
      }
    }
  }

  updateAspectRatio(aspectKey) {
    const frame = this.cameraManager.setAspectRatio(aspectKey);
    if (!frame) return;

    this.frameOverlay.style.width = `${frame.frameWidth}px`;
    this.frameOverlay.style.height = `${frame.frameHeight}px`;
    this.frameLabel.textContent = `${aspectKey} 人像取景框`;
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
        this.cameraManager.setAnglePreset(angle);
        document.querySelectorAll('[data-angle]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // 画幅切换按钮
    document.querySelectorAll('[data-aspect]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const aspect = e.currentTarget.dataset.aspect;
        this.updateAspectRatio(aspect);
        document.querySelectorAll('[data-aspect]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // 焦段切换
    document.querySelectorAll('[data-focal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mm = parseInt(e.currentTarget.dataset.focal, 10);
        this.cameraManager.setFocalLength(mm);
        document.querySelectorAll('[data-focal]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
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

    // 鼠标点击拾取关节
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

      const intersects = this.raycaster.intersectObjects(jointMeshesArray);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const jointId = hit.userData.jointId;
        const entityId = hit.userData.entityId;
        const roleLabel = entityId === 'personB' ? '副模特/伴侣' : (this.skeleton.isCouplesMode ? '主模特/女' : '');
        this.selectJoint(jointId, hit.userData.label, entityId, roleLabel);
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

    // ── 大师手绘线稿 Lightbox 模态框事件 ──
    this.modalCloseBtn?.addEventListener('click', () => this.closeLineartModal());
    this.modalBackdrop?.addEventListener('click', () => this.closeLineartModal());
    this.modalPrevBtn?.addEventListener('click', () => this.navigateModal(-1));
    this.modalNextBtn?.addEventListener('click', () => this.navigateModal(1));

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

    // 全局键盘快捷键 (ESC关闭各弹窗, 左右键切换线稿)
    window.addEventListener('keydown', (e) => {
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
