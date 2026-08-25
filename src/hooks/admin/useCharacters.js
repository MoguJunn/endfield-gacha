/**
 * 角色管理 Hook
 * 封装角色/武器管理的所有状态和业务逻辑
 *
 * @version 1.0.0
 * @date 2026-02-04
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import * as characterService from '../../services/admin/characterService';
import { invalidatePublicCache } from '../../services/admin/publicCacheService';
import { buildManualCharacterId, isGeneratedManualCharacterId } from '../../utils/canonicalEntityUtils';
import {
  buildSklandExtractScript,
  matchSklandImagesToCharacters,
  parseSklandImportPayload
} from '../../utils/sklandCatalogImport';
import { useAuthStore } from '../../stores';

/**
 * 角色表单初始状态
 */
export const INITIAL_CHARACTER_FORM = {
  id: '',
  name: '',
  rarity: 6,
  type: 'character',
  avatar_url: '',
  is_limited: false,
  aliases: [],
  pool_config: {
    pools: [],
    limited_rotation_count: 0,
    removes_after: null,
    is_active_in_limited: true,
    introduced_at: ''
  }
};

function normalizePoolsForType(type = 'character', pools = []) {
  if (type === 'weapon') {
    return ['weapon'];
  }

  return Array.from(new Set(
    (Array.isArray(pools) ? pools : [])
      .filter(pool => pool === 'limited' || pool === 'standard')
  ));
}

function createInitialCharacterForm(type = 'character') {
  return {
    ...INITIAL_CHARACTER_FORM,
    type,
    aliases: [],
    pool_config: {
      ...INITIAL_CHARACTER_FORM.pool_config,
      pools: normalizePoolsForType(type)
    }
  };
}

/**
 * 批量编辑表单初始状态
 */
export const INITIAL_BATCH_EDIT_FORM = {
  is_limited: null,
  pools: {
    limited: null,
    standard: null,
    weapon: null
  }
};

/**
 * 角色管理 Hook
 * @param {Object} options - 选项
 * @param {Function} options.showToast - Toast 提示函数
 * @returns {Object} 角色管理状态和方法
 */
export function useCharacters({
  showToast,
  service = characterService,
  invalidateCache = invalidatePublicCache,
  sandboxMode = false,
}) {
  const userRole = useAuthStore(state => state.userRole);

  const formatDateTimeLocal = useCallback((utcDateString) => {
    if (!utcDateString) return '';
    const date = new Date(utcDateString);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }, []);

  // 数据状态
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  // 同步状态
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');

  // Tab 切换状态
  const [activeTab, setActiveTabState] = useState('character');

  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState(new Set());

  // 搜索和筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [limitedFilter, setLimitedFilter] = useState('all');

  // 排序状态
  const [sortField, setSortField] = useState('rarity');
  const [sortDirection, setSortDirection] = useState('desc');

  // 编辑对话框状态
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [characterForm, setCharacterForm] = useState(() => createInitialCharacterForm(activeTab));
  const [aliasInput, setAliasInput] = useState('');

  // 批量编辑对话框状态
  const [showBatchEditDialog, setShowBatchEditDialog] = useState(false);
  const [batchEditForm, setBatchEditForm] = useState(INITIAL_BATCH_EDIT_FORM);
  const [showSklandImportDialog, setShowSklandImportDialog] = useState(false);
  const [sklandImportText, setSklandImportText] = useState('');

  const ensureSuperAdmin = useCallback(() => {
    if (userRole !== 'super_admin') {
      showToast('只有超级管理员可以执行该操作', 'error');
      return false;
    }
    return true;
  }, [showToast, userRole]);

  // 加载角色列表
  const loadCharacters = useCallback(async () => {
    setLoading(true);
    const { data, error } = await service.loadCharacters();
    if (error) {
      showToast('加载角色失败: ' + error.message, 'error');
    } else {
      setCharacters(data);
    }
    setLoading(false);
  }, [service, showToast]);

  // 初始化加载
  useEffect(() => {
    queueMicrotask(() => {
      loadCharacters();
    });
  }, [loadCharacters]);

  const setActiveTab = useCallback((nextTab) => {
    setActiveTabState(nextTab);
    setSelectedIds(new Set());
  }, []);

  const handleCharacterIdChange = useCallback((nextId) => {
    setCharacterForm(prev => ({
      ...prev,
      id: nextId
    }));
  }, []);

  const handleCharacterNameChange = useCallback((nextName) => {
    setCharacterForm(prev => {
      const nextForm = {
        ...prev,
        name: nextName
      };

      if (!editingCharacter && (!prev.id || isGeneratedManualCharacterId(prev.id))) {
        nextForm.id = nextName.trim() ? buildManualCharacterId(nextName, prev.type) : '';
      }

      return nextForm;
    });
  }, [editingCharacter]);

  const handleCharacterTypeChange = useCallback((nextType) => {
    setCharacterForm(prev => {
      const nextForm = {
        ...prev,
        type: nextType,
        pool_config: {
          ...prev.pool_config,
          pools: normalizePoolsForType(nextType, prev.pool_config.pools)
        }
      };

      if (!editingCharacter && (!prev.id || isGeneratedManualCharacterId(prev.id))) {
        nextForm.id = prev.name.trim() ? buildManualCharacterId(prev.name, nextType) : '';
      }

      return nextForm;
    });
  }, [editingCharacter]);

  // 过滤和排序后的角色列表
  const filteredCharacters = useMemo(() => {
    const result = characters.filter(char => {
      const matchesTab = char.type === activeTab;
      const matchesSearch = char.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           char.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           char.aliases?.some(alias => alias.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesRarity = rarityFilter === 'all' || char.rarity === parseInt(rarityFilter);
      const matchesLimited = limitedFilter === 'all' ||
                            (limitedFilter === 'limited' && char.is_limited) ||
                            (limitedFilter === 'standard' && !char.is_limited);
      return matchesTab && matchesSearch && matchesRarity && matchesLimited;
    });

    // 排序
    result.sort((a, b) => {
      let aVal, bVal;

      switch (sortField) {
        case 'id':
          aVal = a.id || '';
          bVal = b.id || '';
          break;
        case 'name':
          aVal = a.name || '';
          bVal = b.name || '';
          break;
        case 'rarity':
          aVal = a.rarity || 0;
          bVal = b.rarity || 0;
          break;
        case 'is_limited':
          aVal = a.is_limited ? 1 : 0;
          bVal = b.is_limited ? 1 : 0;
          break;
        default:
          aVal = a.rarity || 0;
          bVal = b.rarity || 0;
      }

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal, 'zh-CN');
        return sortDirection === 'asc' ? cmp : -cmp;
      } else {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });

    return result;
  }, [characters, activeTab, searchQuery, rarityFilter, limitedFilter, sortField, sortDirection]);

  // 排序处理
  const handleSort = useCallback((field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'name' || field === 'id' ? 'asc' : 'desc');
    }
  }, [sortField]);

  // 批量选择函数
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allIds = filteredCharacters.map(c => c.id);
    setSelectedIds(new Set(allIds));
  }, [filteredCharacters]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = filteredCharacters.length > 0 &&
    filteredCharacters.every(c => selectedIds.has(c.id));

  const sklandImportPreview = useMemo(() => {
    const { records, error } = parseSklandImportPayload(sklandImportText);
    if (error) {
      return {
        error,
        recordCount: 0,
        matchCount: 0,
        ambiguousCount: 0,
        unmatchedCount: 0,
        updates: [],
        sampleMatches: []
      };
    }

    const { updates, unmatched, ambiguous } = matchSklandImagesToCharacters(records, characters, activeTab);

    return {
      error: null,
      recordCount: records.length,
      matchCount: updates.length,
      ambiguousCount: ambiguous.length,
      unmatchedCount: unmatched.length,
      updates,
      sampleMatches: updates.slice(0, 5)
    };
  }, [activeTab, characters, sklandImportText]);

  // 重置表单
  const resetForm = useCallback(() => {
    setCharacterForm(createInitialCharacterForm(activeTab));
    setAliasInput('');
    setEditingCharacter(null);
    setShowEditDialog(false);
  }, [activeTab]);

  const startCreate = useCallback(() => {
    setCharacterForm(createInitialCharacterForm(activeTab));
    setAliasInput('');
    setEditingCharacter(null);
    setShowEditDialog(true);
  }, [activeTab]);

  const openSklandImportDialog = useCallback(() => {
    if (!ensureSuperAdmin()) return;
    setSklandImportText('');
    setShowSklandImportDialog(true);
  }, [ensureSuperAdmin]);

  const closeSklandImportDialog = useCallback(() => {
    setShowSklandImportDialog(false);
  }, []);

  // 开始编辑
  const startEdit = useCallback((character) => {
    const existingPoolConfig = character.pool_config || {};
    setCharacterForm({
      id: character.id || '',
      name: character.name || '',
      rarity: character.rarity || 6,
      type: character.type || 'character',
      avatar_url: character.avatar_url || '',
      is_limited: character.is_limited || false,
      aliases: character.aliases || [],
      pool_config: {
        pools: normalizePoolsForType(character.type || 'character', existingPoolConfig.pools),
        limited_rotation_count: existingPoolConfig.limited_rotation_count || 0,
        removes_after: existingPoolConfig.removes_after ?? null,
        is_active_in_limited: existingPoolConfig.is_active_in_limited !== false,
        introduced_at: formatDateTimeLocal(existingPoolConfig.introduced_at)
      }
    });
    setEditingCharacter(character);
    setShowEditDialog(true);
  }, [formatDateTimeLocal]);

  // 添加别名
  const addAlias = useCallback(() => {
    const trimmedAlias = aliasInput.trim();
    if (!trimmedAlias) return;

    if (characterForm.aliases.includes(trimmedAlias)) {
      showToast('该别名已存在', 'error');
      return;
    }

    setCharacterForm(prev => ({
      ...prev,
      aliases: [...prev.aliases, trimmedAlias]
    }));
    setAliasInput('');
  }, [aliasInput, characterForm.aliases, showToast]);

  // 删除别名
  const removeAlias = useCallback((index) => {
    setCharacterForm(prev => ({
      ...prev,
      aliases: prev.aliases.filter((_, i) => i !== index)
    }));
  }, []);

  // 保存角色
  const saveCharacter = useCallback(async () => {
    if (!ensureSuperAdmin()) return { success: false };

    // 验证必填字段
    if (!characterForm.id.trim()) {
      showToast('角色ID不能为空', 'error');
      return { success: false };
    }
    if (!characterForm.name.trim()) {
      showToast('角色名称不能为空', 'error');
      return { success: false };
    }

    setActionLoading('save');

    const normalizedPools = normalizePoolsForType(characterForm.type, characterForm.pool_config.pools);
    const normalizedIntroducedAt = characterForm.pool_config.introduced_at
      ? new Date(characterForm.pool_config.introduced_at).toISOString()
      : (normalizedPools.includes('limited') ? new Date().toISOString() : null);
    const isAvailableInLimitedPool = normalizedPools.includes('limited');

    const poolConfig = {
      pools: normalizedPools,
      limited_rotation_count: 0,
      removes_after: null,
      is_active_in_limited: isAvailableInLimitedPool,
      introduced_at: normalizedIntroducedAt
    };

    const characterData = {
      id: characterForm.id.trim(),
      name: characterForm.name.trim(),
      rarity: characterForm.rarity,
      type: characterForm.type,
      avatar_url: characterForm.avatar_url.trim() || null,
      is_limited: characterForm.is_limited,
      aliases: characterForm.aliases.length > 0 ? characterForm.aliases : null,
      pool_config: poolConfig
    };

    try {
      const { success, error } = await service.saveCharacter(characterData, editingCharacter);

      if (success) {
        await invalidateCache('characters', 'admin:character:save');
        showToast(editingCharacter ? '角色已更新' : '角色已创建', 'success');
        await loadCharacters();
        resetForm();
        return {
          success: true,
          characterData,
        };
      }

      showToast('保存失败: ' + error.message, 'error');
      return {
        success: false,
        error,
      };
    } finally {
      setActionLoading(null);
    }
  }, [characterForm, editingCharacter, ensureSuperAdmin, invalidateCache, loadCharacters, resetForm, service, showToast]);

  // 删除角色
  const deleteCharacter = useCallback(async (character) => {
    if (!ensureSuperAdmin()) return;

    if (!window.confirm(`确定要删除角色「${character.name}」吗？此操作无法撤销。`)) {
      return;
    }

    setActionLoading(character.id);

    const { success, error } = await service.deleteCharacter(character.id);

    if (success) {
      await invalidateCache('characters', 'admin:character:delete');
      showToast('角色已删除', 'success');
      await loadCharacters();
    } else {
      showToast('删除失败: ' + error.message, 'error');
    }

    setActionLoading(null);
  }, [ensureSuperAdmin, invalidateCache, loadCharacters, service, showToast]);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (!ensureSuperAdmin()) return;
    if (selectedIds.size === 0) return;

    const confirmMsg = `确定要删除选中的 ${selectedIds.size} 个${activeTab === 'character' ? '角色' : '武器'}吗？此操作不可恢复！`;
    if (!window.confirm(confirmMsg)) return;

    setActionLoading('batch-delete');

    const { success, error } = await service.batchDeleteCharacters(Array.from(selectedIds));

    if (success) {
      await invalidateCache('characters', 'admin:character:batch-delete');
      showToast(`成功删除 ${selectedIds.size} 个项目`, 'success');
      setSelectedIds(new Set());
      await loadCharacters();
    } else {
      showToast('批量删除失败: ' + error.message, 'error');
    }

    setActionLoading(null);
  }, [activeTab, ensureSuperAdmin, invalidateCache, loadCharacters, selectedIds, service, showToast]);

  // 打开批量编辑对话框
  const openBatchEditDialog = useCallback(() => {
    if (selectedIds.size === 0) {
      showToast('请先选择要编辑的项目', 'warning');
      return;
    }
    setBatchEditForm(INITIAL_BATCH_EDIT_FORM);
    setShowBatchEditDialog(true);
  }, [selectedIds.size, showToast]);

  // 关闭批量编辑对话框
  const closeBatchEditDialog = useCallback(() => {
    setShowBatchEditDialog(false);
    setBatchEditForm(INITIAL_BATCH_EDIT_FORM);
  }, []);

  // 执行批量编辑
  const executeBatchEdit = useCallback(async () => {
    if (!ensureSuperAdmin()) return;
    if (selectedIds.size === 0) return;

    setActionLoading('batch-edit');

    const { success, updateCount, error } = await service.batchUpdateCharacters(
      Array.from(selectedIds),
      batchEditForm
    );

    if (success) {
      await invalidateCache('characters', 'admin:character:batch-update');
      showToast(`成功更新 ${updateCount} 个项目`, 'success');
      setSelectedIds(new Set());
      await loadCharacters();
      closeBatchEditDialog();
    } else {
      showToast('批量编辑失败: ' + error.message, 'error');
    }

    setActionLoading(null);
  }, [batchEditForm, closeBatchEditDialog, ensureSuperAdmin, invalidateCache, loadCharacters, selectedIds, service, showToast]);

  // 从 API 同步
  const handleSyncFromAPI = useCallback(async () => {
    if (!ensureSuperAdmin()) return;
    if (sandboxMode) {
      showToast('本地沙盒请使用顶部“刷新正式目录”，不会执行外部图鉴同步或上传。', 'info');
      return;
    }

    setIsSyncing(true);
    setSyncProgress('正在获取数据...');

    const result = await service.syncFromAPI({
      onProgress: setSyncProgress,
      existingIds: characters.map(c => c.id)
    });

    if (result.success) {
      await invalidateCache('characters', 'admin:character:sync');
      await loadCharacters();

      let message = `同步完成！新增 ${result.newCount} 个`;
      if (result.skippedCount > 0) {
        message += `，跳过 ${result.skippedCount} 个已存在的项目`;
      }
      if (result.avatarCount > 0) {
        message += `，头像已上传 ${result.avatarCount} 个`;
      }
      if (result.avatarFailedCount > 0) {
        message += `，头像失败 ${result.avatarFailedCount} 个`;
      }
      if (result.errorCount > 0) {
        message += `，失败 ${result.errorCount} 个`;
      }

      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        message += `。注意：${result.warnings.join('；')}`;
      }

      const toastType = result.errorCount > 0
        || result.avatarFailedCount > 0
        || (Array.isArray(result.warnings) && result.warnings.length > 0)
        ? 'warning'
        : 'success';

      showToast(message, toastType);
    } else {
      showToast('同步失败: ' + result.error.message, 'error');
    }

    setIsSyncing(false);
    setSyncProgress('');
  }, [characters, ensureSuperAdmin, invalidateCache, loadCharacters, sandboxMode, service, showToast]);

  const copySklandExtractScript = useCallback(async () => {
    if (!ensureSuperAdmin()) return;

    const script = buildSklandExtractScript(activeTab);

    if (!navigator?.clipboard?.writeText) {
      showToast('当前浏览器不支持写入剪贴板，请手动复制脚本', 'warning');
      return;
    }

    try {
      await navigator.clipboard.writeText(script);
      showToast('森空岛终末地 WIKI 提取脚本已复制，请到对应图鉴页控制台执行', 'success');
    } catch (error) {
      showToast(`复制脚本失败: ${error.message}`, 'error');
    }
  }, [activeTab, ensureSuperAdmin, showToast]);

  const applySklandImages = useCallback(async () => {
    if (!ensureSuperAdmin()) return;
    if (sandboxMode) {
      showToast('本地沙盒不执行外部图鉴图片写入。可直接编辑实体的头像 URL 字段。', 'info');
      return;
    }

    if (sklandImportPreview.error) {
      showToast(sklandImportPreview.error, 'error');
      return;
    }

    if (!sklandImportPreview.updates.length) {
      showToast('当前没有可写入的图片匹配结果', 'warning');
      return;
    }

    setActionLoading('skland-import');

    const { success, updateCount, errorCount, error } = await service.batchUpdateCharacterAvatars(
      sklandImportPreview.updates
    );

    if (success || updateCount > 0) {
      await invalidateCache('characters', 'admin:character:avatar-update');
      await loadCharacters();
      const parts = [`成功写入 ${updateCount} 个${activeTab === 'weapon' ? '武器' : '角色'}图片`];
      if (sklandImportPreview.unmatchedCount > 0) {
        parts.push(`未匹配 ${sklandImportPreview.unmatchedCount} 个`);
      }
      if (sklandImportPreview.ambiguousCount > 0) {
        parts.push(`名称冲突 ${sklandImportPreview.ambiguousCount} 个`);
      }
      if (errorCount > 0) {
        parts.push(`写库失败 ${errorCount} 个`);
      }
      showToast(parts.join('，'), errorCount > 0 ? 'warning' : 'success');
      if (errorCount === 0) {
        setShowSklandImportDialog(false);
        setSklandImportText('');
      }
    } else {
      showToast(`图片导入失败: ${error.message}`, 'error');
    }

    setActionLoading(null);
  }, [activeTab, ensureSuperAdmin, invalidateCache, loadCharacters, sandboxMode, service, showToast, sklandImportPreview]);

  return {
    // 数据状态
    characters,
    loading,
    actionLoading,
    filteredCharacters,

    // 同步状态
    isSyncing,
    syncProgress,

    // Tab
    activeTab,
    setActiveTab,

    // 批量选择
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    isAllSelected,

    // 搜索筛选
    searchQuery,
    setSearchQuery,
    rarityFilter,
    setRarityFilter,
    limitedFilter,
    setLimitedFilter,

    // 排序
    sortField,
    sortDirection,
    handleSort,

    // 编辑对话框
    showEditDialog,
    setShowEditDialog,
    editingCharacter,
    characterForm,
    setCharacterForm,
    handleCharacterIdChange,
    handleCharacterNameChange,
    handleCharacterTypeChange,
    aliasInput,
    setAliasInput,
    resetForm,
    startCreate,
    startEdit,
    addAlias,
    removeAlias,
    saveCharacter,
    deleteCharacter,

    // 批量编辑
    showBatchEditDialog,
    batchEditForm,
    setBatchEditForm,
    openBatchEditDialog,
    closeBatchEditDialog,
    executeBatchEdit,
    handleBatchDelete,
    showSklandImportDialog,
    openSklandImportDialog,
    closeSklandImportDialog,
    sklandImportText,
    setSklandImportText,
    sklandImportPreview,
    copySklandExtractScript,
    applySklandImages,

    // 同步操作
    handleSyncFromAPI,
    loadCharacters
  };
}
